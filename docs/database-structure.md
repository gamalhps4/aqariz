# PropertyPro Database Structure (PostgreSQL / Prisma)

PropertyPro runs on **PostgreSQL** with **Prisma 7**. The schema lives in
`prisma/schema.prisma` (46 models); migrations in `prisma/migrations/`.

## Tenant isolation

Every organization-owned table carries `organizationId` and is protected by
**row-level security** policies (created in the initial migration) keyed on two
transaction-local settings: `app.current_org_id` and `app.bypass_rls`. The
Prisma client wrapper in `src/lib/db/prisma.ts` stamps them per query from the
request's AsyncLocalStorage context (`runWithOrgContext` /
`bypassOrgScope` in `src/lib/tenancy/context.ts`), throws
`MissingOrganizationContextError` when tenant data is touched with no context,
and auto-filters soft-deleted rows (`deletedAt`) on list reads.

The isolation contract is executable: `pnpm verify:isolation` proves 14
properties against the live database (fail-closed, RLS on raw SQL, cross-tenant
write rejection, bulk-op scoping, bypass, soft-delete filtering).

## Clients

- `db` — org-aware client for application code
- `authDb` — bypass client for Better Auth + credential plumbing
- `runWithOrgTransaction(fn)` — multi-statement atomicity (settlements,
  provisioning) with the RLS settings stamped once

## Highlights of the Mongo → Postgres mapping

- ids are `String @id @default(cuid())`
- `properties.units[]` (embedded) became the **`units` table**; property
  `status/totalUnits/isMultiUnit` are derived via
  `syncPropertyDerivedState()` in `property-status-sync.service`
- deep subdocument trees that were never queried relationally ride as `Json`
  (lease `terms`, invoice `lineItems`, payment histories, ticket `comments`,
  conversation `participants` + a queryable `participantIds String[]` mirror,
  event `attendees` + `attendeeIds`, …)
- the five gateway webhook-idempotency collections collapsed into one
  `webhook_events` table (`unique(gateway, eventId)`)
- Better Auth owns `users` / `user_sessions` / `auth_accounts` /
  `auth_verifications` / `auth_rate_limits` through its Prisma adapter
- partial unique indexes: role names per org among non-deleted rows; one rent
  payment per lease per due date

## Local development

```bash
createdb propertypro_saas                  # once (role: propertypro_app)
pnpm db:migrate                            # apply migrations (+ generate)
DEMO_RESET_CONFIRM=RESET_PROPERTYPRO_DEMO_DATABASE pnpm db:reset
pnpm db:seed                               # full demo portfolio
pnpm verify:isolation                      # tenant-isolation acceptance test
pnpm create:super-admin -- --email you@x.com --password 'Secret123'
```

Demo logins (org `propertypro-demo`): `admin@propertypro.com / Admin123$`,
`manager@propertypro.com / Manager123$`, `tenant@propertypro.com / Tenant123$`.

## Operational TODOs (Mongo TTL replacements)

Postgres has no TTL indexes; these need a scheduled job (pg_cron or app cron):
`webhook_events` (30-day purge), `typing_indicators` / `online_statuses`
(stale presence rows), `invitation_tokens` (expired), `audit_logs`
(`retentionDate` — `auditService.cleanupExpiredLogs()` exists).
