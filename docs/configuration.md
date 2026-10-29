# Configuration

Everything that changes how PropertyPro behaves, and where it is set.

Two places, and the distinction matters:

- **Environment variables** — set once per deployment by whoever runs the
  server. Credentials, limits, integrations.
- **In-app settings** — set per office, in the interface, by an administrator.
  Branding, currency, language, their own payment gateway.

For getting the app running at all, see [installation.md](installation.md).

---

## 1. Environment variables

Every variable is documented inline in [`.env.example`](../.env.example). This
page groups them by what they do and calls out the ones with consequences.

### 1.1 Required

Without these the app does not start, or starts insecurely.

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection string | Use the internal hostname when the database is on the same private network. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Signs sessions **and** calendar RSVP links. Rotating it signs everyone out. |
| `BETTER_AUTH_URL` / `APP_URL` | Public HTTPS URL | Redirects are built from these, not from the incoming request. |
| `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32` | Encrypts gateway credentials and sensitive identity fields. **Back it up.** Changing it makes existing encrypted values permanently unreadable. |
| `CRON_SECRET` | `openssl rand -hex 32` | Authorises the scheduled jobs. Until it is set and a scheduler is pointed at the app, nothing bills, reminds or expires. |

### 1.2 Reverse proxy — security-relevant

| Variable | Default | Set it to |
| --- | --- | --- |
| `TRUSTED_PROXY_COUNT` | `0` | The number of proxies in front of the app. |

Proxies **append** to `X-Forwarded-For` rather than replacing it. With the
default `0` behind a proxy, the app reads whatever the caller put in that
header — so anyone can present a fresh fake IP on every request and walk
straight past the per-IP limits on signup, password reset and error reporting.
`1` for a single reverse proxy (Traefik, nginx); `2` if Cloudflare sits in
front of it.

### 1.3 Multi-tenancy and subdomains

| Variable | Purpose |
| --- | --- |
| `SAAS_ROOT_DOMAIN` | Apex domain. Enables `office.example.com` style workspaces. |
| `NEXT_PUBLIC_SAAS_ROOT_DOMAIN` | Same value, needed in the browser. |

Point a wildcard DNS record (`*.example.com`) at the host. Data isolation does
**not** depend on this — it is enforced by Postgres Row-Level Security on every
query regardless of how the workspace was reached. The subdomain is presentation.

### 1.4 Billing (the platform's own revenue)

This is *your* Stripe account, the one offices pay their PropertyPro
subscription into.

| Variable | Purpose |
| --- | --- |
| `PLATFORM_STRIPE_SECRET_KEY` | Platform Stripe secret. |
| `STRIPE_BILLING_WEBHOOK_SECRET` | Verifies subscription webhooks. |
| `SAAS_TRIAL_PLAN` | Plan a new signup starts on. |
| `PLAN_*_PROPERTIES` / `PLAN_*_MEMBERS` | Per-plan limits. |
| `BILLING_TRIAL_WARNING_DAYS` | Days before trial end to warn. |
| `BILLING_DUNNING_GRACE_DAYS` | Grace period after a failed payment. |
| `BILLING_DUNNING_SUSPEND_DAYS` | When an unpaid organization is suspended. |

There are no `STRIPE_PRICE_*` variables. Prices are read from Stripe and synced
with `pnpm sync:stripe-prices`.

> **Rent collection is a different rail.** Each office collects from its own
> tenants using its own Stripe/PayPal/Razorpay/Paystack credentials, entered in
> **Settings → Payments** and encrypted at rest. Platform keys are never used to
> take a tenant's rent, and `pnpm verify:saas-boundaries` checks that the two
> rails stay separate.

### 1.5 Email

| Variable | Purpose |
| --- | --- |
| `EMAIL_SERVER_HOST` / `_PORT` / `_USER` / `_PASSWORD` | SMTP transport. |
| `EMAIL_FROM` | Envelope sender. |
| `SUPPORT_EMAIL` | Shown to users as the contact address. |

### 1.6 SMS and WhatsApp

Optional per channel. Leaving a provider unset is a supported state: the
notification still goes out by email, push and in-app.

| Variable | Purpose |
| --- | --- |
| `DEFAULT_COUNTRY_CODE` | Country applied to a number typed without one — e.g. `966` turns `0501234567` into `+966501234567`. |
| `SMS_PROVIDER` | `unifonic` or `twilio`. Unset disables SMS. |
| `UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID` | Unifonic credentials. The local choice in Saudi Arabia — local sender IDs and Arabic bodies. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` | Twilio credentials. |
| `WHATSAPP_PROVIDER` | `meta` (WhatsApp Cloud API) or `twilio`. |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API credentials. |
| `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LOCALE` | Send an approved template instead of free text. |
| `TWILIO_WHATSAPP_FROM` | e.g. `whatsapp:+15551234567`. |

> **WhatsApp free-form text only works inside the 24-hour customer-service
> window** — that is Meta's rule, not the app's. A rent reminder to a tenant who
> has not messaged you first must use an approved template, which is what
> `WHATSAPP_TEMPLATE_NAME` switches on. Without it those sends are rejected by
> WhatsApp and logged as failures.

### 1.7 File storage

| Variable | Purpose |
| --- | --- |
| `R2_*` / `NEXT_PUBLIC_R2_PUBLIC_URL` | Cloudflare R2 bucket for uploads. |
| `UPLOAD_MAX_SIZE` | Bytes. Default 10 MB. |
| `UPLOAD_ALLOWED_TYPES` | Comma-separated MIME types. |

### 1.8 Scaling past one instance

| Variable | When |
| --- | --- |
| `REDIS_URL` | Required with more than one app instance. |

Rate limits and the realtime event bus fall back to in-process state. With two
instances and no Redis each enforces its own separate counters, so the effective
rate limit doubles and server-sent events only reach clients connected to the
same instance.

### 1.9 Push notifications

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push. Generate with `npx web-push generate-vapid-keys`. |
| `FCM_SERVICE_ACCOUNT` | Native mobile push, as one JSON value. Unset means native sends are skipped; web push is unaffected. |

### 1.10 Database pool

Defaults suit a single instance. Raise `DATABASE_POOL_MAX` only if you see
connection waits — every request holds a connection for the whole of its
RLS-scoped work, so a handler that fans out needs one connection per query.

### 1.11 Demo-data tooling — security-relevant

| Variable | Default | Set it to |
| --- | --- | --- |
| `ALLOW_PRODUCTION_DEMO_DATA_API` | unset | `true` only on a demo instance that runs a production build. |

`/api/demo-data` and `/api/seed/*` (and the same paths under `/api/v1`) write
sample records into an organization and hard-delete its data — messages,
payments, invoices, leases, tenants, buildings and users, archived rows
included. No screen calls them. In production they answer 403 unless this
variable is exactly `true`; anything that is not a development or test run
counts as production. Leave it unset on a live deployment.

Even with it set, the two deleting routes are held to the archive's rule for
destroying a record (section 2.1): the account owner or a platform super admin,
holding `permanent_delete`. The delete runs as one transaction and is written
to the audit log at high severity. On an organization that has been used the
database refuses it — notifications, documents, inspections and settings still
point at the users and buildings it would remove — and it answers 409 with
nothing deleted. To empty a demo database, `pnpm db:reset` is the tool — see
[installation.md](installation.md).

---

## 2. In-app settings

Set by an office administrator, per organization.

| Screen | What it controls |
| --- | --- |
| **Settings → Profile** | The signed-in user's own details. |
| **Settings → Security** | Password, two-factor, active sessions. |
| **Settings → Appearance** | Theme, **language**, currency, date format. |
| **Settings → Categories** | Property and unit types. This is what makes the type lists extendable without a deploy. |
| **Settings → Email** | Sender name and templates. |
| **Settings → Payments** | The office's *own* payment gateway credentials. Encrypted at rest with `DATA_ENCRYPTION_KEY`. |
| **Settings → Billing** | The office's PropertyPro subscription. |
| **Administration → Users → Roles** | Roles and what each may do — see below. |

### 2.1 Roles and permissions

Roles are per organization. Each role holds a set of permissions from one
catalogue, grouped on screen by module: users, properties, owners, tenants,
contracts, maintenance, financial, archive, reports, documents, system.

Permissions separate the actions that carry different trust:

- **view / create / edit** — everyday work.
- **delete** — moves a record to the Archive. Recoverable.
- **permanent delete** — destroys an archived record. Not recoverable.
- **export** (`data_export`) — downloading data out of the system.

**Permanent deletion has two gates and both must hold.** The role rule
(account owner or platform super-admin) is the floor and is deliberately not a
permission — an organization admin can edit their own roles, so a
permission-only check would let them grant themselves the one power the scope
reserves. The `permanent_delete` permission sits on top and can only *narrow*:
it is how an account owner withholds irreversible deletion from an
administrator who would otherwise qualify.

Adding a permission to the catalogue makes it appear on the role screen
automatically — the screen is built from the catalogue, not from its own copy.

### 2.2 Per-employee overrides

Roles remain the normal way to grant access. For the exception an office
actually has — the assistant who also reconciles payments, the agent who must
not delete contracts — an individual employee can be given extra permissions or
have some taken away, without inventing a role for each person.

Rules the server enforces:

- **Denials win.** A permission both granted and denied on the same person is
  denied. That is the safe reading of a contradiction, and it makes "revoke X
  from this employee" hold even after their role changes.
- **Nobody grants what they do not hold.** An operator can only hand out
  permissions they have themselves, so this cannot be used to climb.
- **Nobody edits their own overrides.** Widening your own access requires
  another administrator.

Every change is written to the audit log at high severity.

---

## 3. Language and Arabic

> Arabic version of this section: [configuration.ar.md](configuration.ar.md).

Five locales ship: English, Arabic, German, Spanish, French. The office's
language is set in **Settings → Appearance**; the interface switches direction
to right-to-left for Arabic automatically. A new organization starts in Arabic,
right to left, with riyals (the market defaults in `src/lib/regional/region.ts`).

**Arabic from the first paint.** The browser remembers the office's language,
direction and currency in three small cookies — `pp-locale`, `pp-dir` and
`pp-currency` — written whenever the display settings load after sign-in, are
saved, or the language is switched in the preferences drawer. The root layout
(`src/app/layout.tsx`) reads them on the server, so the very first HTML response
already carries `<html lang="ar" dir="rtl">` and the page is drawn in Arabic
before any script runs; with no cookie yet, the market default (Arabic) is used.
The public marketing pages (home, pricing, contact, privacy, terms — the
`src/app/(public)/(marketing)/` group) stay prerendered and English; they set
`dynamic = "force-static"`, so any new page added to that group stays fast too.
The logic and its reasons are in `src/lib/i18n/locale-cookie.ts` and
`src/lib/i18n/request-locale.ts`.

**Emails, notifications and SMS** are written in the language of the
recipient's organization (its display language), laid out right to left for
Arabic. Their wording lives in the same catalogue as the screens, under
`notifications.email.*`, `notifications.message.*` and `notifications.sms.*` in
`common.json`; the language is chosen by `src/lib/i18n/recipient-locale.ts`.

Two things follow the reader rather than the office:

- **Report PDFs.** Exporting while the interface is Arabic produces a mirrored
  table — columns run from the right — because the same report is sent to
  different people in different languages.
- **Excel exports** carry a UTF-8 byte-order mark, without which Excel opens
  Arabic as mojibake.

`pnpm verify:i18n` fails the build on any *new* untranslated key. Known gaps are
recorded in `src/locales/.parity-baseline.json`; after deliberately translating
a batch, re-run with `--update-baseline`.

### Where the wording lives, and how to change it

Every word the interface shows comes from one folder:

```
src/locales/
├── en/        the reference — every key exists here first
├── ar/        Arabic
├── de/  es/  fr/
└── index.ts   loads the files; you do not normally touch it
```

Each language folder holds the same seventeen files, split by the part of the
product they belong to:

| File | What it covers |
| --- | --- |
| `common.json` | The navigation menu, buttons and words shared everywhere; sign-in screens; form validation messages (`validation.*`); and the text of emails, notifications and SMS (`notifications.email.*`, `notifications.message.*`, `notifications.sms.*`) |
| `dashboard.json` | The main dashboard |
| `properties.json` | Compounds, buildings, units |
| `leases.json` | Contracts and installments, including how generated charges are named (`leases.charge.*`) |
| `payments.json` | Payments, invoices, collections |
| `accounting.json` | The books: chart of accounts, journal entries, banks and cash, owner payouts, accounting setup |
| `tenants.json` | Tenants and applications |
| `reports.json` | Reports, statements and exports |
| `maintenance.json` · `inspections.json` | Maintenance and inspections |
| `admin.json` · `settings.json` | Employees, permissions, settings |
| `messages.json` · `announcements.json` · `calendar.json` | Inbox, announcements, calendar |
| `marketing.json` | The Marketing section: property listings, inquiries, and the public listing pages |
| `platform.json` | The platform console (`/admin`): organizations, plans, the platform's own activity log |

**To change a word.** Open the file for that area under `src/locales/ar/`,
find the key, and edit the text on the right of the colon. Only the right-hand
side is the wording; the key on the left is what the code looks up, and
renaming it makes the text disappear. For example, to reword the Arabic label
on the owners menu entry, edit `src/locales/ar/common.json`:

```json
{
  "nav.clients.owners": "الملاك"
}
```

**Finding the right key.** The keys read as paths — `leases.reports.type.active`
is the "active" contract register on the leasing reports screen. If you cannot
find a phrase, search the English file for it and use the key it sits on:

```bash
grep -rn "Occupancy" src/locales/en/
```

**Placeholders.** Text in braces is filled in at runtime and must survive the
translation, spelling intact:

```json
{
  "statements.stats.units": "{occupied} من {total} وحدة مؤجّرة"
}
```

Leaving `{occupied}` out drops the number from the screen; renaming it prints
the brace text literally.

**Editing safely.**

- Change only the text on the right-hand side of the colon. Keep the quotes,
  and keep the comma at the end of every line except the last one in the file.
- Inside the text, write a double quote as `\"`; line breaks are not allowed
  (write the sentence on one line).
- Never add the same key twice in a file: JSON keeps only the last one, and
  `pnpm verify:i18n` does not notice.
- A new key goes into all five language folders, in the same file, next to a
  related key. Arabic and English are written; German, Spanish and French may
  repeat the English until translated, but the key must exist.
- Arabic numbers in a sentence: wording such as "{count} قسطًا" is grammatical
  only for 11 or more. Prefer wording that reads for any number, e.g.
  "عدد الأقساط: {count}".
- Arabic percentages are stored as `%{rate}` on purpose: placed after Arabic
  letters, `%` moves to the other side when the line is drawn, so the stored
  form is what reads as "10%".

**After editing.** Run `pnpm verify:i18n`. It reports any key that exists in
`en` but is missing from another language, which is the usual cause of a raw
key like `statements.stats.net` appearing on screen. The interface picks the
files up on the next page load in development, and at the next deploy in
production — no database change is involved, so a wording fix is a code change
and goes through the same review as any other.

### The font

One typeface is used for both scripts, set in `src/app/layout.tsx`:

```ts
const appFont = Cairo({ subsets: ["arabic", "latin"], variable: "--font-sans-app" });
```

Cairo covers Arabic and Latin in one family, so a screen mixing an Arabic name
with a Latin contract number sets both the same way. It is used by the whole
dashboard, the sign-in, sign-up, password, two-factor and onboarding screens,
the printed invoice (`src/styles/invoice-print.css`), and is offered first to
mail clients that load web fonts. To change it, swap that import and call for
another `next/font/google` family that carries both scripts — everything
downstream reads the `--font-sans` token defined in `src/app/globals.css`.

Two deliberate exceptions: the English marketing pages keep Figtree (their
Figma layout was measured against it; `src/app/(public)/(marketing)/layout.tsx`),
and report and invoice PDFs embed Amiri (see `src/lib/reports/pdf-font.ts`).
