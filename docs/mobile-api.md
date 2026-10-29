# PropertyPro Mobile API Guide

The REST API a native (React Native / Expo) client builds against. Base path
for external clients is **`/api/v1`** (an alias of the live handlers today;
the un-versioned paths carry no compatibility promise). The one exception is
**auth**: Better Auth owns `/api/auth/*` and versions its own protocol — call
it unversioned.

## Authentication (bearer tokens)

Auth is Better Auth with the `bearer` plugin — no cookie jar needed.

1. **Sign in** — `POST /api/auth/sign-in/email` with
   `{ "email": "...", "password": "..." }`. The response body contains
   `token`; the same value is also echoed in the `set-auth-token` response
   header. Store it securely (Keychain / EncryptedSharedPreferences).
2. **Authenticated requests** — send `Authorization: Bearer <token>` on every
   call. No `x-propertypro-org-slug` header is needed: the session already
   knows the user's organization, and row-level security scopes every query
   server-side.
3. **Session info** — `GET /api/auth/get-session` returns the user
   (`role`, `organizationId`, profile fields).
4. **Sign out** — `POST /api/auth/sign-out` (invalidates the session row;
   the token dies immediately).

Sign-in refusals (deactivated, locked, suspended organization) return 403
with a human message; wrong credentials return 401. Rate limiting is
DB-backed (10 attempts / 5 min per IP on sign-in).

## Response envelope

Every JSON endpoint responds with:

```json
{ "success": true,  "data": { ... }, "message": "...", "pagination": { "page", "limit", "total", "totalPages" } }
{ "success": false, "error": "human text", "code": "MACHINE_CODE" }
```

Branch on `code`, never on `error` text. Codes live in
`@propertypro/contracts/errors` (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION_ERROR`, `DUPLICATE`, `PLAN_LIMIT`, `RATE_LIMITED`, …). Types for
every domain object are in `@propertypro/contracts`.

Objects carry both `id` and `_id` (same value) during the Mongo→Postgres
transition — prefer `id`.

## Tenant-portal surface (renter app MVP)

All under `/api/v1/tenant/*`, scoped to the signed-in tenant:
`dashboard`, `invoices`, `payments` (+ `summary`, `[id]/receipt`),
`maintenance`, `tickets`, `documents` (+ upload/download), `receipts`,
`notifications`. (`recurring-payments` is retired: 410 `GONE`.)

To pay one of those payments online, do what the web's Pay Rent page does:
`GET /api/v1/payments/config` lists `available` — the gateways the office can
take payments through (`id`, `name`, `methods`: mada, card, applepay, stcpay,
paypal; `currencies`, null for any) — and
`POST /api/v1/payments/<id>/checkout` with `{ "gateway": "<id>" }` answers
`{ url }`: open it in a browser. The gateway's hosted page takes the money,
and the payment is recorded when the gateway confirms it (its return, or its
webhook); `alreadyCompleted: true` means it is paid already. Only gateways in
`available` that take the payment's currency are accepted (403/409 otherwise;
PayPal never takes SAR). A 503 `MIGRATION_REQUIRED` means online payments are
being upgraded on the server; try later.

Stripe's in-app card flow also remains:
`POST /api/v1/payments/create-intent` with `{ "paymentId": "<id>" }`, then
confirm the returned `clientSecret` with Stripe's SDK, using
`gateways.stripe.publishableKey` from `GET /api/v1/payments/config`. Stripe's
webhook then records the payment on that same row; `alreadyCompleted: true` in
the response means it is paid already. A 409 `CONFLICT` means it cannot be
paid online as it stands: it is refunded, cancelled or part-paid, its
installment has since been settled, or a card payment already on file for it
does not match it or could not be recorded — do not retry; the office has to
look. A 502 `UPSTREAM_ERROR` means Stripe could not be asked about an earlier
attempt; nothing was changed, so retry later. Both routes need the `payments`
module on the organization's plan, or they answer 402 `plan_feature_required`.
`payments/[id]/pay` is retired (410 `GONE`): it marked a payment paid without
charging anything. So is the `processPayment` action of `PATCH payments/[id]`
(410 `GONE`): it stored a payment-intent id sent by the caller, which
`create-intent` then took as proof of payment. Also retired (410): the saved
Stripe cards (`payments/methods`), the Stripe/PayPal-only checkout routes
(`invoices/<id>/checkout-session`, `invoices/<id>/paypal/*`,
`payments/<id>/paypal/*`, `invoices/<id>/stripe-payment`) and
`payments/status/<intent>` — use the `checkout` routes above.

Staff apps use the org-wide resources (`/api/v1/properties`, `leases`,
`invoices`, `payments`, `maintenance`, …) — same envelope, permission-gated
per role.

## File uploads (presigned, direct-to-storage)

Never proxy file bytes through the API from mobile:

1. `POST /api/v1/upload/presign` with
   `{ "folder": "maintenance", "fileName": "leak.jpg", "contentType": "image/jpeg", "size": 123456 }`
2. Response: `{ uploadUrl, objectKey, publicUrl, expiresIn, method: "PUT", headers }`
3. `PUT` the raw bytes to `uploadUrl` with the exact `Content-Type` header.
4. Reference `publicUrl` / `objectKey` in the record you create next
   (maintenance request images, message attachments, …).

Folders: `documents`, `maintenance`, `messages`, `avatars`, `tickets` for all
users; `properties`, `units`, `leases`, `inspections`, `expenses` for staff.
25MB max; images + PDF/Word allowed. 30 presigns/min per caller.

## Push notifications (native)

Register the FCM device token after login:

```
POST /api/v1/push/subscribe   { "platform": "ios" | "android", "token": "<fcm-token>" }
POST /api/v1/push/unsubscribe { "token": "<fcm-token>" }
```

Delivery is FCM HTTP v1 (APNs fronted by FCM for iOS). Server-side it needs
`FCM_SERVICE_ACCOUNT` (the Firebase service-account JSON as one env value);
without it, native sends are skipped and web push keeps working. Dead tokens
are pruned automatically on delivery failure.

## Realtime

The web app uses SSE (`/api/messages/stream` etc.), which is awkward on
mobile — prefer push notifications plus pull-to-refresh. The realtime bus is
Redis-backed when `REDIS_URL` is set, so SSE is also correct behind multiple
server instances if a mobile web view ever needs it.

## Local development

Run the web app (`pnpm dev`), point the mobile client at
`http://<lan-ip>:3000/api/v1`, and sign in with the seeded demo users
(`docs/database-structure.md`).
