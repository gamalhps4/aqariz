/**
 * PropertyPro SaaS - Plan limit column mapping (server side)
 *
 * `Plan` stores each limit in its own flat column while the rest of the app
 * consumes a nested `limits` object. Both admin write paths used to spell the
 * mapping out by hand, which is how `limitsUnits` and `limitsStorageMb` came to
 * be reset to null by a payload that simply did not mention them. Deriving the
 * column names from PLAN_LIMIT_KEYS means adding a limit to the catalog carries
 * it through create and update without a second edit.
 */

import { PLAN_LIMIT_KEYS, type PlanLimitKey } from "./plan-constants";

/**
 * Limits stored outside the Prisma model, written with raw SQL after the
 * plan's own write: `messagesPerMonth` (plan-message-limit.ts) until its
 * migration is applied everywhere.
 */
export const RAW_PLAN_LIMIT_KEYS = ["messagesPerMonth"] as const;
type RawPlanLimitKey = (typeof RAW_PLAN_LIMIT_KEYS)[number];

/** `properties` -> `limitsProperties`, `storageMb` -> `limitsStorageMb`. */
export type PlanLimitColumn = `limits${Capitalize<Exclude<PlanLimitKey, RawPlanLimitKey>>}`;

/**
 * The exact column shape, so the result spreads cleanly into either a create
 * or an update payload. Typing it as one of Prisma's input types would infect
 * every sibling field in the other.
 */
export type PlanLimitColumns = Record<PlanLimitColumn, number | null>;

export function planLimitColumn(
  key: Exclude<PlanLimitKey, RawPlanLimitKey>,
): PlanLimitColumn {
  return `limits${key.charAt(0).toUpperCase()}${key.slice(1)}` as PlanLimitColumn;
}

/** The flat column patch for a complete set of limits. */
export function planLimitColumns(
  limits: Partial<Record<PlanLimitKey, number | null>>,
): PlanLimitColumns {
  const columns = {} as PlanLimitColumns;
  for (const key of PLAN_LIMIT_KEYS) {
    if ((RAW_PLAN_LIMIT_KEYS as readonly string[]).includes(key)) continue;
    columns[planLimitColumn(key as Exclude<PlanLimitKey, RawPlanLimitKey>)] =
      limits[key] ?? null;
  }
  return columns;
}
