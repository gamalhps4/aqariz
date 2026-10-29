/**
 * PropertyPro SaaS - The package's monthly message quota
 *
 * `plans.limitsMessagesPerMonth`: how many SMS and WhatsApp messages an office
 * on the package may send a month through the platform's default gateway
 * (null is unlimited). Messages through an office's own provider account are
 * on the office's own bill and do not count.
 *
 * Read and written with raw SQL on purpose, like the platform module switches
 * (platform-modules.ts): the column arrives with migration
 * 20261004113500_messaging and the Prisma field is `@ignore` until that
 * migration is applied everywhere. Had the client known the field, every read
 * of a plan would have selected a column the database does not have yet and
 * the entitlement gate would have fallen back to the seed plans. Here a
 * missing column reads as "unlimited" and a write to it is skipped.
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { isMissingSchemaError } from "@/lib/db/missing-schema";

/** Every plan's quota by plan key; empty when the column is not there yet. */
export async function readPlanMessageLimits(): Promise<
  Map<string, number | null>
> {
  try {
    const rows = await bypassOrgScope(() =>
      db.$queryRaw<Array<{ key: string; limit: number | null }>>`
        SELECT "key", "limitsMessagesPerMonth" AS "limit" FROM "plans"
      `,
    );
    return new Map(
      rows.map((row) => [
        row.key,
        row.limit === null || row.limit === undefined ? null : Number(row.limit),
      ]),
    );
  } catch (error) {
    if (!isMissingSchemaError(error)) {
      console.error("Failed to read plan message quotas; unlimited", error);
    }
    return new Map();
  }
}

/**
 * Store a plan's quota. Returns false when the column is not there yet, so
 * the console can say the quota was not saved.
 */
export async function writePlanMessageLimit(
  planKey: string,
  limit: number | null | undefined,
): Promise<boolean> {
  const value =
    limit === null || limit === undefined || !Number.isFinite(limit)
      ? null
      : Math.max(0, Math.floor(limit));
  try {
    await bypassOrgScope(() =>
      db.$executeRaw`
        UPDATE "plans" SET "limitsMessagesPerMonth" = ${value}
        WHERE "key" = ${planKey}
      `,
    );
    return true;
  } catch (error) {
    if (isMissingSchemaError(error)) return false;
    throw error;
  }
}
