/**
 * PropertyPro - Reading the payment number
 *
 * `payments.number` arrives with migration 20261003100001_payment_numbers.
 * The client leaves the column out of every read (src/lib/db/prisma.ts), so
 * a page that does not show the number works whether or not the migration
 * has been applied; the screens that show it ask for it here first.
 *
 * Before the migration they get no number — the column reads "—" and a
 * search by number finds nothing — instead of failing: selecting a column
 * the database does not have fails the whole query. Once the column is
 * there it is remembered for the life of the process; while it is missing,
 * the answer is asked again every minute, so applying the migration needs
 * no restart.
 */

import "server-only";

import { db } from "@/lib/db/prisma";

const RECHECK_MISSING_MS = 60_000;

let present = false;
let checkedAt = 0;

/** Whether the database has `payments.number` yet. */
export async function paymentNumbersAvailable(): Promise<boolean> {
  if (present) return true;
  if (checkedAt && Date.now() - checkedAt < RECHECK_MISSING_MS) return false;
  try {
    const rows = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'payments'
           AND column_name = 'number'
      ) AS present`;
    present = Boolean(rows[0]?.present);
  } catch {
    present = false;
  }
  checkedAt = Date.now();
  return present;
}

/**
 * The `omit` that brings the number into a payment read that also uses
 * `include` — or leaves it out while the column does not exist.
 */
export async function paymentNumberOmit(): Promise<{ number: boolean }> {
  return { number: !(await paymentNumbersAvailable()) };
}
