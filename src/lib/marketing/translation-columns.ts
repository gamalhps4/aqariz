/**
 * PropertyPro SaaS - Reading the Arabic and custom-section columns
 *
 * `landing_pages.translations`, `landing_pages.customSections` and
 * `plans.translations` arrive with migration
 * 20261017120000_landing_arabic_and_custom_sections, and production applies
 * migrations after the deploy. The client leaves all three out of every read
 * (src/lib/db/prisma.ts): a plain `findMany` on plans that named a missing
 * column would fail, and the plans are what every entitlement check reads.
 * What reads or writes them asks here first.
 *
 * Before the migration the Arabic pages still render, from the shipped
 * translation, and the console refuses only a save that carries Arabic text
 * or custom sections it could not store. Once the columns are there it is
 * remembered for the life of the process; while missing, asked again every
 * minute, so applying the migration needs no restart.
 */

import "server-only";

import { db } from "@/lib/db/prisma";

const RECHECK_MISSING_MS = 60_000;

let present = false;
let checkedAt = 0;

/** Whether the database has the migration's three columns yet. */
export async function translationColumnsAvailable(): Promise<boolean> {
  if (present) return true;
  if (checkedAt && Date.now() - checkedAt < RECHECK_MISSING_MS) return false;
  try {
    const rows = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT (
        SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND (
             (table_name = 'landing_pages' AND column_name IN ('translations', 'customSections'))
             OR (table_name = 'plans' AND column_name = 'translations')
           )
      ) = 3 AS present`;
    present = Boolean(rows[0]?.present);
  } catch {
    present = false;
  }
  checkedAt = Date.now();
  return present;
}

/** What a save that needs the migration answers before it is applied. */
export const TRANSLATION_COLUMNS_MISSING_MESSAGE =
  "Arabic text and custom sections need a database update that has not been applied yet.";
