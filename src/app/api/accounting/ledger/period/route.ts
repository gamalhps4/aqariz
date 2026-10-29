/**
 * PropertyPro - Closing (or reopening) an accounting period
 *
 * PUT { closedThrough: "YYYY-MM-DD" | null } — nothing can be posted on or
 * before that day once it is closed; null reopens everything. Its own right
 * (`ledger_close_period`): only someone trusted with that decision takes it.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_CLOSE_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/api";
import { setClosedThrough, settingsView } from "@/lib/accounting/settings.service";
import { parseDay } from "@/lib/accounting/dates";
import { ledgerError } from "@/lib/accounting/errors";

export const dynamic = "force-dynamic";

export const PUT = ledgerRoute(LEDGER_CLOSE_ACCESS, async (_user, request) => {
  const body = await readJson(request);
  if (body.closedThrough === null || body.closedThrough === "") {
    await setClosedThrough(null);
  } else {
    const day = parseDay(body.closedThrough);
    if (!day) throw ledgerError("LEDGER_DATE_INVALID", "Choose the last day of the closed period");
    await setClosedThrough(day);
  }
  return createSuccessResponse(await settingsView(), "Period lock saved");
});
