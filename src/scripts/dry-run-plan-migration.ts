/**
 * Applies the plan-entitlement migration inside a transaction and ROLLS IT
 * BACK, printing what it would do. The feature remap rewrites a column on
 * every plan row, so it is worth seeing the before/after on real data before
 * committing to it.
 */

import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const MIGRATION =
  "prisma/migrations/20260823120000_plan_module_entitlements/migration.sql";


/**
 * Split a migration into executable statements.
 *
 * Comments go first: a `;` inside one would otherwise start a bogus statement.
 * `$$ ... $$` bodies are then kept whole, since a DO block is full of
 * semicolons that are not statement boundaries.
 */
function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .map((line) => (line.trimStart().startsWith("--") ? "" : line))
    .join("\n");

  const statements: string[] = [];
  let buffer = "";
  let inDollarBlock = false;
  for (const chunk of withoutComments.split(/(\$\$)/)) {
    if (chunk === "$$") {
      inDollarBlock = !inDollarBlock;
      buffer += chunk;
      continue;
    }
    if (inDollarBlock) {
      buffer += chunk;
      continue;
    }
    const parts = chunk.split(";");
    for (let i = 0; i < parts.length; i++) {
      buffer += parts[i];
      if (i < parts.length - 1) {
        if (buffer.trim()) statements.push(buffer.trim());
        buffer = "";
      }
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const before = await prisma.$queryRawUnsafe<
    Array<{ key: string; features: string[]; highlights: string[] }>
  >(`SELECT "key", "features", "highlights" FROM "plans" ORDER BY "sortOrder"`);

  console.log("=== BEFORE ===");
  for (const row of before) {
    console.log(`  ${row.key}: [${row.features.join(", ")}]`);
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const statement of splitStatements(readFileSync(MIGRATION, "utf8"))) {
        await tx.$executeRawUnsafe(statement);
      }

      const after = await tx.$queryRawUnsafe<
        Array<{ key: string; features: string[]; highlights: string[] }>
      >(`SELECT "key", "features", "highlights" FROM "plans" ORDER BY "sortOrder"`);

      console.log("\n=== AFTER (in-transaction) ===");
      for (const row of after) {
        console.log(`  ${row.key}: [${row.features.sort().join(", ")}]`);
      }

      const cols = await tx.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'plans' AND column_name LIKE 'limits%'
         ORDER BY column_name`,
      );
      console.log(
        "\n=== limit columns after migration ===\n  " +
          cols.map((c) => c.column_name).join("\n  "),
      );

      throw new Error("__ROLLBACK__");
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("__ROLLBACK__")) {
      console.log("\n=== ROLLED BACK - database is unchanged ===");
    } else {
      throw error;
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Dry run failed:", error);
  process.exitCode = 1;
});
