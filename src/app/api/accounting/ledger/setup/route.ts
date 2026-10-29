/**
 * PropertyPro - Accounting setup
 *
 * GET  — how the books are kept (cut-over, period lock, VAT, deposits, the
 *        account map), or that they are not set up yet. Reads only.
 * POST — set up accounting: seed the Saudi chart of accounts, create the
 *        settings and the office's money accounts. Safe to repeat.
 * PUT  — change the settings.
 */

import type { NextRequest } from "next/server";
import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, LEDGER_VIEW_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/api";
import { setupLedger, settingsView, updateAccountingSettings } from "@/lib/accounting/settings.service";
import { parseDay } from "@/lib/accounting/dates";
import { ledgerError } from "@/lib/accounting/errors";
import { DEPOSIT_HOLDERS, type DepositHolder } from "@/lib/accounting/types";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async () =>
  createSuccessResponse(await settingsView()),
);

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, request) => {
  const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
  const cutOverDate = body.cutOverDate ? parseDay(body.cutOverDate) : null;
  if (body.cutOverDate && !cutOverDate) {
    throw ledgerError("LEDGER_DATE_INVALID", "The cut-over date is not valid");
  }
  const result = await setupLedger({
    userId: user.id,
    cutOverDate,
    vatRegistered: typeof body.vatRegistered === "boolean" ? body.vatRegistered : undefined,
    vatNumber: typeof body.vatNumber === "string" ? body.vatNumber : null,
  });
  return createSuccessResponse({ ...result, view: await settingsView() }, "Accounting is set up");
});

export const PUT = ledgerRoute(LEDGER_MANAGE_ACCESS, async (_user, request: NextRequest) => {
  const body = await readJson(request);
  let cutOverDate: Date | null | undefined;
  if (body.cutOverDate !== undefined) {
    cutOverDate = body.cutOverDate ? parseDay(body.cutOverDate) : null;
    if (body.cutOverDate && !cutOverDate) {
      throw ledgerError("LEDGER_DATE_INVALID", "The cut-over date is not valid");
    }
  }
  if (
    body.depositHolder !== undefined &&
    !(DEPOSIT_HOLDERS as readonly unknown[]).includes(body.depositHolder)
  ) {
    throw ledgerError("LEDGER_DEPOSIT_HOLDER_INVALID", "Choose who holds deposits");
  }
  const depositHolder = body.depositHolder as DepositHolder | undefined;
  const accountMap =
    body.accountMap && typeof body.accountMap === "object" && !Array.isArray(body.accountMap)
      ? (body.accountMap as Record<string, string | null>)
      : undefined;

  await updateAccountingSettings({
    cutOverDate,
    vatRegistered: typeof body.vatRegistered === "boolean" ? body.vatRegistered : undefined,
    vatNumber:
      body.vatNumber === undefined ? undefined : typeof body.vatNumber === "string" ? body.vatNumber : null,
    depositHolder,
    accountMap,
  });
  return createSuccessResponse(await settingsView(), "Settings saved");
});
