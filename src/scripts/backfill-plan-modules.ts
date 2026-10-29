/**
 * PropertyPro - Rewrite every package's module list in the module-tree format
 *
 * Dry run (reads only):
 *   NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
 *     --env-file=.env.local --tsconfig tsconfig.json \
 *     src/scripts/backfill-plan-modules.ts
 * Write: the same command with `--apply`.
 *
 * Packages stored a flat list of the old catalog's keys ("maintenance",
 * "advanced_analytics", ...). The Super Admin now builds a package from the
 * menu's own tree (lib/navigation/menu-config.ts), one key per section and
 * per item. The code already reads an old list through each module's `legacy`
 * entry (lib/billing/modules.ts), so no office lost a screen on deploy; this
 * writes the translated list down, in the tree's shortest form:
 *
 *   - a section every item of which the package had becomes the section key
 *     alone — which also takes in items added to that section later;
 *   - otherwise the items it had, one key each;
 *   - the screens no old key ever gated (archive, feedback, the settings
 *     pages, the administration overview) are written in explicitly, since a
 *     list in the new format no longer implies them.
 *
 * What a package opens does not change: the script checks, for every package,
 * that the rewritten list resolves to exactly the modules the old one did,
 * and refuses to write one that would not.
 *
 * Idempotent and resumable: a package already in canonical form is skipped,
 * each write is conditional on the row being unchanged since it was read, and
 * a re-run picks up whatever an interrupted run left. Plans are read in
 * batches of BATCH_SIZE.
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { recordPlatformAudit, SYSTEM_ACTOR } from "@/lib/platform/audit";
import {
  enabledToggleableLeaves,
  normalizeStoredModules,
  resolveModuleState,
} from "@/lib/billing/modules";
import { isPlanFeatureKey } from "@/lib/billing/plan-constants";

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 50;

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function main(): Promise<void> {
  // `plans` is world-readable but platform-writable under FORCE RLS: without
  // the bypass an update matches no row and still reports success.
  await bypassOrgScope(async () => {
    let cursor: string | undefined;
    let seen = 0;
    let planned = 0;
    let written = 0;
    let changedSinceRead = 0;
    const rows: Array<Record<string, string | number>> = [];

    for (;;) {
      const batch = await db.plan.findMany({
        select: { id: true, key: true, name: true, features: true, updatedAt: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;

      for (const plan of batch) {
        seen += 1;
        const stored = plan.features ?? [];
        // Keys nothing recognises are dropped by the reader already.
        const known = stored.filter(isPlanFeatureKey);
        const next = normalizeStoredModules(known);
        if (sameList(stored, next)) continue;

        // The rewrite must open exactly what the old list opened.
        const before = enabledToggleableLeaves(resolveModuleState(known).planEnabled);
        const after = enabledToggleableLeaves(resolveModuleState(next).planEnabled);
        if (!sameList(before, after)) {
          throw new Error(
            `Refusing to rewrite plan "${plan.key}": the new list would open ` +
              `${after.length} module(s) where the old one opened ${before.length}.`,
          );
        }

        planned += 1;
        rows.push({
          plan: plan.key,
          before: stored.join(", ") || "(empty)",
          after: next.join(", "),
          modules: after.length,
        });

        if (!APPLY) continue;
        const result = await db.plan.updateMany({
          where: { id: plan.id, updatedAt: plan.updatedAt },
          data: { features: next },
        });
        if (result.count !== 1) {
          changedSinceRead += 1;
          continue;
        }
        written += 1;
        await recordPlatformAudit({
          actor: SYSTEM_ACTOR,
          action: "plan.updated",
          targetType: "plan",
          targetId: plan.id,
          targetName: plan.name,
          summary: `Plan "${plan.name}" (${plan.key}) module list rewritten in the module-tree format (same modules)`,
          metadata: {
            script: "src/scripts/backfill-plan-modules.ts",
            before: stored,
            after: next,
          },
        });
      }
    }

    console.log(`Plans read: ${seen}. To rewrite: ${planned}.`);
    // One block per plan: the lists are too long for a table.
    for (const row of rows) {
      console.log(
        `\n- ${row.plan} (${row.modules} module(s) open, unchanged)\n  before: ${row.before}\n  after:  ${row.after}`,
      );
    }

    if (!APPLY) {
      console.log(
        `Dry run — nothing written. Re-run with --apply to write ${planned} plan(s).`,
      );
      return;
    }
    console.log(
      `Wrote ${written} plan(s).` +
        (changedSinceRead
          ? ` ${changedSinceRead} changed since they were read and were left alone — run again to pick them up.`
          : ""),
    );
  });
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
