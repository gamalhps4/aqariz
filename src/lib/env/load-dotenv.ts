/**
 * Env loading for the CLI side of the app — Prisma's config and the tsx
 * scripts in src/scripts.
 *
 * `dotenv/config` reads only `.env`, but Next.js also reads `.env.local` and
 * lets it win. With the connection string in `.env.local` the dev server
 * worked while `pnpm db:deploy` failed with "Connection url is empty".
 *
 * Load both, in Next.js precedence order: dotenv keeps the first value it
 * sees for a key, so `.env.local` overrides `.env`, and anything already
 * exported in the shell overrides both.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
