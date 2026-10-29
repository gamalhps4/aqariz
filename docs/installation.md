# Installation & Deployment

How to get PropertyPro running, from an empty machine to a live deployment.

For the settings themselves see [configuration.md](configuration.md); for how
the office uses the result see [user-manual.md](user-manual.md).

---

## 1. Requirements

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | 24 (see [`.nvmrc`](../.nvmrc)) | `nvm use` picks it up automatically. |
| pnpm | 11.10.0 | Pinned in `package.json` as `packageManager`. `corepack enable` installs the right one. |
| PostgreSQL | 14 or newer | Row-Level Security is used for tenant isolation, so a managed Postgres that forbids `ALTER TABLE … FORCE ROW LEVEL SECURITY` will not work. |

Optional, and only for the features that need them:

- **Cloudflare R2** (or any S3-compatible bucket) — uploaded images, documents
  and branding. Without it, uploads fail; nothing else does.
- **Redis** — only when running more than one app instance. See
  [configuration.md](configuration.md#scaling-past-one-instance).
- **SMTP** — outbound email (invitations, reminders, receipts).

---

## 2. Local setup

```bash
git clone <your-repo-url> propertypro
cd propertypro

corepack enable          # gets the pinned pnpm
pnpm install

cp .env.example .env.local
```

Now open `.env.local` and fill in, at minimum:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`
- `BETTER_AUTH_URL` / `APP_URL` — `http://localhost:3000` for local work
- `DATA_ENCRYPTION_KEY` — `openssl rand -base64 32`

> **`DATA_ENCRYPTION_KEY` is not recoverable.** It encrypts stored payment-gateway
> credentials and sensitive identity fields. Back it up the moment you generate
> it: changing it later does not re-encrypt anything, it just makes the existing
> values unreadable.

Create the schema and start:

```bash
pnpm db:deploy        # applies prisma/migrations to the database
pnpm db:generate      # generates the Prisma client
pnpm dev
```

The app is on <http://localhost:3000>.

### Creating the first account

Two different things, and it matters which you want:

**A platform super-admin** operates *above* every organization and runs the
`/admin` console. It cannot be created through signup — bootstrap it once:

```bash
pnpm create:super-admin \
  --email you@example.com \
  --password 'a-strong-password' \
  --first Platform --last Admin
```

**An office (organization)** signs up normally at `/auth/signup`, which creates
the organization, its first admin, and that organization's system roles.

### Demo data (optional)

```bash
pnpm seed:demo         # demo login accounts
pnpm seed:demo-data    # properties, tenants, leases, payments
pnpm db:reset          # removes what the two above created
```

Never run these against production.

The `/api/demo-data` and `/api/seed/*` routes do similar work over HTTP. They
are switched off in production unless `ALLOW_PRODUCTION_DEMO_DATA_API=true` is
set — see [configuration.md](configuration.md).

---

## 3. Production deployment

The repo deploys as a standard Next.js app. There is no `Dockerfile` —
[Nixpacks](https://nixpacks.com) detects Next.js and runs `pnpm build` /
`pnpm start` on its own.

[deployment-dokploy.md](deployment-dokploy.md) covers the VPS/Dokploy setup this
project actually uses, including the reverse-proxy settings. The steps below are
the parts that apply wherever you host it.

### 3.1 Build

```bash
pnpm install --frozen-lockfile
pnpm build      # runs `prisma generate` first, then `next build`
pnpm start
```

### 3.2 Migrations run separately from the build

`pnpm build` does **not** touch the database. Run migrations as a pre-deploy
step, so a failed migration stops the release instead of leaving a running app
against a half-updated schema:

```bash
pnpm db:deploy
```

Never use `pnpm db:migrate` (that is `prisma migrate dev`) against production —
it is interactive and can reset data.

### 3.3 Set the environment

Everything is documented inline in [`.env.example`](../.env.example) and grouped
in [configuration.md](configuration.md). The variables that are wrong most often
in a first production deploy:

| Variable | Why it bites |
| --- | --- |
| `TRUSTED_PROXY_COUNT` | **Security-relevant.** Behind a proxy the default `0` lets a caller forge `X-Forwarded-For` and bypass every per-IP rate limit. Set it to the number of proxies in front of the app. |
| `APP_URL` | Payment redirect URLs are built from it, not from the request. Behind a proxy an unset value resolves to the container's internal address. |
| `CRON_SECRET` | Without it none of the scheduled jobs can be authorised, so nothing bills, reminds or expires. |
| `SAAS_ROOT_DOMAIN` | Required for per-organization subdomains. Needs a wildcard DNS record pointing at the host. |

### 3.4 Schedule the background jobs

**Nothing in the app schedules itself.** Rent reminders, overdue transitions,
contract expiry and billing all run as HTTP routes that something external has
to call. Set exactly one scheduler — two against the same environment send
every reminder twice.

See [scheduled-jobs.md](scheduled-jobs.md) for the routes and their cadence.

### 3.5 Fonts for PDF export

Report PDFs embed `src/assets/fonts/Amiri-Regular.ttf` so Arabic renders with
real glyphs instead of blank boxes. It is read from disk at request time, which
the Next.js tracer cannot see, so `next.config.ts` lists it under
`outputFileTracingIncludes`. If you change how the app is bundled, keep that
entry — without it PDF export works locally and fails in production.

---

## 4. Verifying a deployment

Run these after any significant change. All of them are safe.

```bash
pnpm verify:isolation         # proves no query crosses between organizations
pnpm verify:saas-boundaries   # platform vs per-organization payment rails
pnpm verify:plan-gates        # every route is gated by the right plan feature
pnpm verify:plan-nav          # navigation matches the plan modules
pnpm verify:i18n              # no untranslated key has slipped in
```

Then check by hand:

1. `/api/health` answers.
2. Sign in as a platform super-admin and open `/admin`.
3. Sign up a second organization and confirm its dashboard shows none of the
   first one's data.
4. Trigger one cron route with its secret and confirm it reports work done:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/invoice-status
   ```

---

## 5. Upgrading

```bash
git pull
pnpm install --frozen-lockfile
pnpm db:deploy
pnpm build
```

Migrations are additive and ordered; applying them to a database that has
already had some is a no-op for those. Check `prisma/migrations/` in the diff
before deploying — a migration that adds a `NOT NULL` column to a large table
will lock it for the duration.

---

## 6. Backups

Two things must be backed up, and one of them is not in the database:

1. **The Postgres database** — everything the office has entered.
2. **`DATA_ENCRYPTION_KEY`** — without it, the encrypted columns in that backup
   cannot be read. A database backup alone is not a complete backup.

Restore is a plain `pg_restore` followed by `pnpm db:deploy` to apply any
migrations newer than the dump.
