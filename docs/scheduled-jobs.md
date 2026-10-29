# Scheduled jobs

Every background job is an HTTP route under `/api/cron/*`, authorised with a
single shared secret. **Nothing in the app schedules itself** — pick one of the
schedulers below and point it at the deployment.

> Enable exactly **one**. Two schedulers against the same environment fire
> every job twice: duplicate reminder and dunning emails.

## The jobs

| Route | Cadence | What it does |
| --- | --- | --- |
| `/api/cron/invoice-status` | daily 01:00 | Persists `SCHEDULED→ISSUED→OVERDUE` transitions so status filters and reports stay accurate. |
| `/api/cron/payment-reminders` | daily 08:00 | Reminds tenants 3 days before rent is due, then on days 1, 7 and 14 overdue — email, in-app, and SMS/WhatsApp where the office switched them on. |
| `/api/cron/lease-expiry-notices` | daily 08:15 | Tells the tenant, owner and manager a contract ends in 90, 60, 30, 14 and 7 days (email, in-app, SMS/WhatsApp). Replaces the old in-process timer. |
| `/api/cron/check-leases` | daily 02:00 | Expires leases past their end date and raises expiry notifications. |
| `/api/cron/billing` | daily 03:00 | Trial warnings + expiry, dunning emails, and suspension of long-unpaid organizations. |
| `/api/cron/cleanup` | weekly Sun 04:00 | Purges webhook events >30d, expired invitation tokens, audit rows past their retention date, and resolved error groups. |

The jobs are independent of each other, safe in any order, and idempotent —
running a job twice by accident does not double-charge anyone.

### Retired: `/api/cron/late-fees`

Late fees were removed from the product at the client's request. The route
now answers `410 Gone` and changes nothing. If a scheduler was set up from an
earlier copy of this page, delete its late-fees entry by hand: the Dokploy
schedule named `late-fees` (`30 1 * * *`) or the matching crontab line. Until
then it shows a failed run every night. `vercel.json` and the GitHub workflow
no longer list it, so those drop it with the next deploy.

## Required environment

```
CRON_SECRET=<long random string>
```

Generate one with `openssl rand -hex 32`. Without it every cron route returns
`503`; with a wrong bearer token they return `401`.

---

## Option 1 — Dokploy (this deployment)

Dokploy runs the app on your VPS and has a built-in **Schedules** feature, so
no external service is involved and the jobs run on the same host as the app.

1. Set `CRON_SECRET` in the application's **Environment** tab and redeploy.
2. Open the application → **Schedules** → *Create Schedule*, once per job.

Use **Container** type so the request originates inside the Docker network and
never leaves the host:

| Field | Value |
| --- | --- |
| Name | `invoice-status` |
| Schedule (cron) | `0 1 * * *` |
| Command | `curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/invoice-status` |

Repeat for the remaining jobs, using the cadences in the table above. Points
worth knowing:

- **`localhost:3000` works** because a Container schedule executes inside the
  running app container, where `CRON_SECRET` is already in the environment —
  the secret never travels over the network and is not duplicated anywhere.
- If you use a **Shell** (host-level) schedule instead, call the public URL and
  pass the secret explicitly:
  `curl -fsS -H "Authorization: Bearer <secret>" https://app.example.com/api/cron/invoice-status`
- `-f` makes curl exit non-zero on an HTTP error, so a failed job shows as a
  failed run in Dokploy instead of quietly succeeding.
- Cron times use the **server's timezone**. Check it with `date` on the VPS;
  the cadences above assume you want them overnight in local time.

**`vercel.json` in the repo root is inert here.** Dokploy does not read it; it
is kept for anyone deploying the same codebase to Vercel.

## Option 2 — Vercel

`vercel.json` already declares every job. Vercel calls them with its own
`Authorization: Bearer $CRON_SECRET` header as long as `CRON_SECRET` is set in
the project's environment variables.

> Hobby projects are limited to daily cron invocations. The schedules above fit
> that limit; if you tighten a cadence, check your plan first.

## Option 3 — GitHub Actions

`.github/workflows/scheduled-jobs.yml` is a fallback for deployments with no
scheduler of their own. It is **dormant by default** — it will not run until
you set a repository *variable* `ENABLE_GITHUB_CRON=true` plus two secrets:

- `APP_BASE_URL` — e.g. `https://app.example.com`, no trailing slash
- `CRON_SECRET` — the same value as the app's env var

Leave it disabled when using Dokploy schedules. `workflow_dispatch` still lets
you run a single job on demand from the Actions tab once enabled.

## Option 4 — plain crontab on the VPS

If you would rather not use Dokploy's scheduler:

```cron
CRON_SECRET=xxxxxxxx
APP=https://app.example.com

0  1 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" $APP/api/cron/invoice-status
0  8 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" $APP/api/cron/payment-reminders
15 8 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" $APP/api/cron/lease-expiry-notices
0  2 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" $APP/api/cron/check-leases
0  3 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" $APP/api/cron/billing
0  4 * * 0  curl -fsS -H "Authorization: Bearer $CRON_SECRET" $APP/api/cron/cleanup
```

---

## Verifying

```bash
# 401 — no secret
curl -i https://app.example.com/api/cron/billing

# 200 + a JSON summary of what changed
curl -H "Authorization: Bearer $CRON_SECRET" https://app.example.com/api/cron/billing
```

Every job returns `{ success, message, data }`, where `data` carries the counts
for that run — safe to log and alert on.

## Billing lifecycle knobs

The billing job reads three optional env vars:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BILLING_TRIAL_WARNING_DAYS` | `3` | Days before trial end that the warning email goes out. |
| `BILLING_DUNNING_GRACE_DAYS` | `7` | Days a past-due organization keeps its paid entitlements. |
| `BILLING_DUNNING_SUSPEND_DAYS` | `21` | Days past due before the organization is suspended. |
