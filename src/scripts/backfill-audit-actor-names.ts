/**
 * PropertyPro - Backfill the actor's name on existing activity entries
 *
 * Dry run (reads only):
 *   NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
 *     --env-file=.env.local --tsconfig tsconfig.json \
 *     src/scripts/backfill-audit-actor-names.ts
 * Write: the same command with `--apply`. Batch size: `--batch=500`.
 *
 * Migration 20261003120000_activity_log adds `audit_logs.userName` and
 * `platform_audit_logs.actorName`, empty on every existing row. Entries name
 * their actor by id, and an id says nothing to a reader — nor anything at all
 * once that user is deleted (the foreign key empties it). This copies the
 * name the user row holds today onto each entry that still has a user to read
 * it from:
 *
 *   audit_logs           — by `userId`; where that is empty, by `userEmail`
 *                          when exactly one user in the entry's organization
 *                          has that address.
 *   platform_audit_logs  — by `actorId` (operators; the "system" and
 *                          "anonymous" sentinels are skipped).
 *
 * Only an empty name is filled, and nothing else on the row changes — which
 * is also the only edit the migration's append-only trigger lets through
 * (it requires `app.audit_backfill = on`, set per transaction below).
 * Batched by id and resumable: a filled row is never selected again, so a
 * run that stops halfway is finished by running it again. A user with no
 * name leaves the entry empty; the screens then show the email.
 */

import { basePrisma } from "@/lib/db/prisma";
import { recordPlatformAudit, SYSTEM_ACTOR } from "@/lib/platform/audit";

const APPLY = process.argv.includes("--apply");
const BATCH = (() => {
  const arg = process.argv.find((value) => value.startsWith("--batch="));
  const size = arg ? Number(arg.slice("--batch=".length)) : 500;
  return Number.isInteger(size) && size > 0 && size <= 5000 ? size : 500;
})();

interface Candidate {
  id: string;
  name: string | null;
}

/** One transaction that may read across organizations and fill names. */
async function inBackfillTransaction<T>(
  statements: (tx: typeof basePrisma) => Promise<T>,
): Promise<T> {
  return basePrisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE), set_config('app.audit_backfill', 'on', TRUE)`;
      return statements(tx as unknown as typeof basePrisma);
    },
    { timeout: 120_000, maxWait: 60_000 },
  );
}

async function organizationBatch(after: string): Promise<Candidate[]> {
  return inBackfillTransaction((tx) =>
    tx.$queryRaw<Candidate[]>`
      SELECT a.id,
             COALESCE(
               NULLIF(btrim(concat_ws(' ', u."firstName", u."lastName")), ''),
               NULLIF(btrim(u.name), ''),
               (SELECT NULLIF(btrim(concat_ws(' ', m."firstName", m."lastName")), '')
                  FROM users m
                 WHERE a."userId" IS NULL
                   AND m.email = a."userEmail"
                   AND m."organizationId" = a."organizationId"
                   AND (SELECT count(*) FROM users c
                         WHERE c.email = a."userEmail"
                           AND c."organizationId" = a."organizationId") = 1)
             ) AS name
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a."userId"
       WHERE a."userName" IS NULL
         AND (a."userId" IS NOT NULL OR a."userEmail" IS NOT NULL)
         AND a.id > ${after}
       ORDER BY a.id
       LIMIT ${BATCH}`,
  );
}

async function platformBatch(after: string): Promise<Candidate[]> {
  return inBackfillTransaction((tx) =>
    tx.$queryRaw<Candidate[]>`
      SELECT p.id,
             COALESCE(
               NULLIF(btrim(concat_ws(' ', u."firstName", u."lastName")), ''),
               NULLIF(btrim(u.name), '')
             ) AS name
        FROM platform_audit_logs p
        LEFT JOIN users u ON u.id = p."actorId"
       WHERE p."actorName" IS NULL
         AND p."actorId" NOT IN ('system', 'anonymous')
         AND p.id > ${after}
       ORDER BY p.id
       LIMIT ${BATCH}`,
  );
}

async function fill(
  table: "audit_logs" | "platform_audit_logs",
  rows: Candidate[],
): Promise<number> {
  const named = rows.filter((row) => row.name);
  if (named.length === 0) return 0;
  return inBackfillTransaction(async (tx) => {
    let written = 0;
    for (const row of named) {
      written +=
        table === "audit_logs"
          ? await tx.$executeRaw`UPDATE audit_logs SET "userName" = ${row.name}
               WHERE id = ${row.id} AND "userName" IS NULL`
          : await tx.$executeRaw`UPDATE platform_audit_logs SET "actorName" = ${row.name}
               WHERE id = ${row.id} AND "actorName" IS NULL`;
    }
    return written;
  });
}

async function run(
  table: "audit_logs" | "platform_audit_logs",
  next: (after: string) => Promise<Candidate[]>,
): Promise<{ seen: number; named: number; written: number }> {
  let after = "";
  let seen = 0;
  let named = 0;
  let written = 0;
  const sample: Candidate[] = [];
  for (;;) {
    const rows = await next(after);
    if (rows.length === 0) break;
    seen += rows.length;
    named += rows.filter((row) => row.name).length;
    if (sample.length < 10) sample.push(...rows.slice(0, 10 - sample.length));
    if (APPLY) written += await fill(table, rows);
    after = rows[rows.length - 1].id;
    console.log(
      `${table}: ${seen} empty so far, ${named} with a name to copy${APPLY ? `, ${written} written` : ""}`,
    );
  }
  if (sample.length) {
    console.log(`${table} sample:`);
    for (const row of sample) console.log(`  ${row.id} → ${row.name ?? "(no name on the user)"}`);
  }
  return { seen, named, written };
}

async function main(): Promise<void> {
  console.log(
    APPLY
      ? `Filling actor names (batches of ${BATCH})…`
      : `DRY RUN — nothing is written. Re-run with --apply to fill names.`,
  );
  const organization = await run("audit_logs", organizationBatch);
  const platform = await run("platform_audit_logs", platformBatch);

  console.log(
    `\naudit_logs: ${organization.seen} without a name, ${organization.named} can be named` +
      `${APPLY ? `, ${organization.written} filled` : ""}.` +
      `\nplatform_audit_logs: ${platform.seen} without a name, ${platform.named} can be named` +
      `${APPLY ? `, ${platform.written} filled` : ""}.`,
  );

  if (APPLY && organization.written + platform.written > 0) {
    await recordPlatformAudit({
      actor: SYSTEM_ACTOR,
      action: "audit.actor_names_backfilled",
      targetType: "console",
      targetId: "backfill-audit-actor-names",
      targetName: "Activity log actor names",
      summary: `Filled the actor's name on ${organization.written} organization and ${platform.written} platform activity entries`,
      metadata: {
        organizationEntries: organization.written,
        platformEntries: platform.written,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await basePrisma.$disconnect();
  });
