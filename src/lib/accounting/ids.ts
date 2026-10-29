/**
 * PropertyPro - Ids for rows the ledger writes in bulk
 *
 * The chart of accounts is seeded, and a batch of entries posted, with one
 * `createMany` each — a hundred single inserts would cost a hundred round
 * trips to a database most of a second away. `createMany` returns no ids, so
 * the ledger makes them itself: cuid-shaped (a letter, then lower-case
 * letters and digits), like every other id in the schema.
 */

import { randomBytes } from "node:crypto";

export function newLedgerId(): string {
  return `c${Date.now().toString(36)}${randomBytes(9).toString("hex")}`;
}
