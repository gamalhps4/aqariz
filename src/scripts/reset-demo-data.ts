/**
 * PropertyPro - Guarded demo-database reset (PostgreSQL)
 *
 * Empties every application table (structure, indexes and RLS policies stay)
 * so the demo seed can run against a clean slate.
 *
 * Usage:
 *   DEMO_RESET_CONFIRM=RESET_PROPERTYPRO_DEMO_DATABASE pnpm db:reset
 *   ... -- --dry-run           (list what would be truncated)
 *
 * Refuses to run without the exact confirmation env, and refuses
 * production-looking databases unless ALLOW_PRODUCTION_DEMO_RESET=true.
 */

import "../lib/env/load-dotenv";
import { basePrisma } from "../lib/db/prisma";

const CONFIRM = "RESET_PROPERTYPRO_DEMO_DATABASE";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (process.env.DEMO_RESET_CONFIRM !== CONFIRM) {
    console.error(
      `Refusing to run: set DEMO_RESET_CONFIRM=${CONFIRM} to confirm.`,
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL ?? "";
  const looksProduction =
    /prod/i.test(url) || (!/localhost|127\.0\.0\.1/.test(url) && url !== "");
  if (looksProduction && process.env.ALLOW_PRODUCTION_DEMO_RESET !== "true") {
    console.error(
      "Refusing to reset a production-looking database. Set ALLOW_PRODUCTION_DEMO_RESET=true to override.",
    );
    process.exit(1);
  }

  const tables = await basePrisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations')
    ORDER BY tablename`;

  if (DRY_RUN) {
    console.log("DRY RUN — would truncate:");
    for (const t of tables) console.log(`  - ${t.tablename}`);
    await basePrisma.$disconnect();
    return;
  }

  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  // Table owner runs this; TRUNCATE is not subject to RLS policies.
  await basePrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  console.log(`✅ Truncated ${tables.length} tables.`);

  await basePrisma.$disconnect();
}

main().catch(async (error) => {
  console.error("Reset failed:", error);
  process.exit(1);
});
