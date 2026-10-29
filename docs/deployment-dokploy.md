# Deploying on Dokploy

This project runs on a VPS managed by [Dokploy](https://dokploy.com). Dokploy
builds the repo (Nixpacks detects Next.js and runs `pnpm build` / `pnpm start`),
serves it through Traefik, and can run the scheduled jobs on the same host.

There is no `Dockerfile` in the repo — Nixpacks does not need one. `vercel.json`
is present for anyone deploying the same codebase to Vercel and is **ignored**
here.

## Environment

Set these in the application's **Environment** tab. Everything is documented
inline in [`.env.example`](../.env.example); the entries below are the ones
whose correct value depends on running behind Dokploy specifically.

| Variable | Value here | Why |
| --- | --- | --- |
| `TRUSTED_PROXY_COUNT` | `1` | **Security-relevant.** Traefik *appends* to `X-Forwarded-For` instead of replacing it, so with the default `0` the app reads whatever the caller put there — letting anyone bypass the per-IP limits on signup, password reset and error reporting by sending a fake header. `1` tells the app to count one hop back from the right. Use `2` if Cloudflare sits in front of Traefik. |
| `APP_URL` | your public HTTPS URL | Required in production. Stripe redirect URLs are built from it rather than the request, which behind a proxy would otherwise resolve to the container's internal address. |
| `SAAS_ROOT_DOMAIN` | your apex domain | Enables per-organization subdomains and the shared session cookie. Point a wildcard DNS record at the VPS and add the wildcard domain in Dokploy. |
| `CRON_SECRET` | `openssl rand -hex 32` | Authorises the scheduled jobs. Nothing runs until a scheduler calls them. |
| `REDIS_URL` | set it if you scale past one replica | Rate limits fall back to an in-memory window per instance. With two replicas and no Redis, each enforces its own separate counters — so the effective limit doubles. |

`DATABASE_URL` points at the Postgres service you create in Dokploy. Use the
internal service hostname, not a public address.

## Deploy

Migrations are **not** run by the build. Add them as a pre-deploy command in
the application settings, or run once after each deploy:

```bash
pnpm db:deploy
```

`db:deploy` runs `prisma migrate deploy`, which applies pending migrations and
never resets anything — it is the production-safe command. Do not use
`db:migrate` (that is `migrate dev`) on a live database.

## Scheduled jobs

Use Dokploy's **Schedules** tab — see [scheduled-jobs.md](scheduled-jobs.md)
for the six jobs, their cadences and the exact commands. Enable **exactly one**
scheduler; the GitHub Actions workflow in this repo is dormant unless you set
`ENABLE_GITHUB_CRON=true`, and `vercel.json` does nothing here.

## Health and rollout

- `GET /api/health` returns a service-level summary (database, email, payment
  gateways) — a reasonable healthcheck target.
- `GET /api/platform/status` is public and unauthenticated by design; it
  reports maintenance mode and the platform name.
- Security headers (CSP, HSTS, frame protection) are emitted by the app itself,
  so no Traefik middleware is needed for them. HSTS is only sent in production.

## After the first deploy

1. Create the platform operator:
   `pnpm tsx src/scripts/create-super-admin.ts --email you@example.com --password '…' --first … --last …`
2. Set the units and storage limits on each plan in **Plans** — they default to
   `NULL` (unlimited) on plan rows that predate those columns.
3. Fill the three `NEXT_PUBLIC_LEGAL_*` variables and have the `/terms` and
   `/privacy` copy reviewed by counsel before taking real payments.
