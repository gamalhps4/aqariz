# PropertyPro SaaS

Property management platform for real-estate offices in Saudi Arabia:
contracts and installments, payments and collection, owner statements,
double-entry accounting with VAT, marketing listings, SMS and WhatsApp, and a
Super Admin console for plans and offices. Arabic and English, prices in SAR.

Source code as of 29 October 2026 (revision `b1387b80`).

## Requirements

- Node.js 24 (see `.nvmrc`)
- pnpm 11 (`corepack enable` installs the version pinned in `package.json`)
- PostgreSQL 14 or newer
- Cloudflare R2 or another S3-compatible bucket for uploads, and an SMTP account for email

## Quick start

```bash
corepack enable
pnpm install
pnpm db:generate                # generate the database client
cp .env.example .env.local      # then fill in the values
pnpm db:deploy                  # create or upgrade the database schema
pnpm create:super-admin --email you@example.com --password 'a-strong-password'
pnpm dev                        # http://localhost:3000
```

For production: `pnpm build`, then `pnpm start`.

## Documentation

| Guide | File |
| --- | --- |
| Installation and deployment | `docs/installation.md` |
| Deployment on Dokploy | `docs/deployment-dokploy.md` |
| Configuration (environment variables) | `docs/configuration.md`, Arabic: `docs/configuration.ar.md` |
| Scheduled jobs | `docs/scheduled-jobs.md` |
| User manual | `docs/user-manual.md`, Arabic: `docs/user-manual.ar.md` |
| Database structure | `docs/database-structure.md` |
| API for mobile apps | `docs/mobile-api.md` |
| Accounting posting rules | `docs/ledger-posting-hooks.md` |

## Checks

```bash
pnpm test          # unit tests
pnpm lint          # code checks
pnpm verify:i18n   # Arabic and English translations in step
```

## Not included

The server's secrets (database password, storage, email and payment keys) are
not part of this package. `.env.example` lists every setting; your own values go
in `.env.local` on the server.
