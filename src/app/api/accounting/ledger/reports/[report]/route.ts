/**
 * PropertyPro - The ledger's reports
 *
 * GET /api/accounting/ledger/reports/<report>[?format=xlsx|pdf|csv]
 *
 *   account-statement  ?accountId&from&to[&propertyId]   كشف حساب عام
 *   party-statement    ?partyType&partyId&from&to[&accountId]
 *   parties            ?partyType            the party picker, with balances
 *   trial-balance      ?from&to[&includeZero=true]
 *   profit-loss        ?from&to[&propertyId]
 *   balance-sheet      ?asOf
 *   banks              ?from&to[&bankAccountId]
 *   vat-return         ?from&to              the ZATCA boxes
 *
 * Everything is read from journal lines (lib/accounting/reports). Days are
 * YYYY-MM-DD, both ends included; without them a report covers this month
 * so far (the VAT return this quarter, the balance sheet today). Exports
 * need the accounting export right, as every finance report does.
 */

import { NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_VIEW_ACCESS, ledgerRoute } from "@/lib/accounting/api";
import { parseDay, today } from "@/lib/accounting/dates";
import { ledgerError } from "@/lib/accounting/errors";
import { PARTY_TYPES, type PartyType } from "@/lib/accounting/types";
import {
  accountStatement,
  balanceSheet,
  bankReport,
  partyOptions,
  partyStatement,
  profitAndLoss,
  trialBalance,
  vatReturn,
  type DayRange,
} from "@/lib/accounting/reports/service";
import {
  accountStatementSheet,
  balanceSheetSheet,
  bankReportSheet,
  partyStatementSheet,
  profitAndLossSheet,
  trialBalanceSheet,
  vatReturnSheet,
} from "@/lib/accounting/reports/sheets";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import {
  buildReportResponse,
  canExport,
  EXPORT_DENIED_MESSAGE,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";

export const dynamic = "force-dynamic";

const FILE_NAMES: Record<string, string> = {
  "account-statement": "General account statement",
  "party-statement": "Party statement",
  "trial-balance": "Trial balance",
  "profit-loss": "Profit and loss",
  "balance-sheet": "Balance sheet",
  banks: "Banks report",
  "vat-return": "VAT return",
};

function dayParam(params: URLSearchParams, name: string): Date | null {
  const raw = params.get(name);
  if (!raw) return null;
  const day = parseDay(raw);
  if (!day) throw ledgerError("LEDGER_DATE_INVALID", `${name} is not a valid date`);
  return day;
}

/** The period asked for; this month so far (or this quarter) when none was. */
function rangeOf(params: URLSearchParams, opening: "month" | "quarter"): DayRange {
  const now = today();
  const from =
    dayParam(params, "from") ??
    new Date(
      Date.UTC(
        now.getUTCFullYear(),
        opening === "quarter" ? Math.floor(now.getUTCMonth() / 3) * 3 : now.getUTCMonth(),
        1,
      ),
    );
  const to = dayParam(params, "to") ?? now;
  if (from.getTime() > to.getTime()) {
    throw ledgerError("LEDGER_PERIOD_REVERSED", "The start date cannot be after the end date");
  }
  return { from, to };
}

function partyTypeParam(params: URLSearchParams): PartyType {
  const value = params.get("partyType");
  if (!(PARTY_TYPES as readonly string[]).includes(value ?? "")) {
    throw ledgerError("LEDGER_PARTY_INVALID", "Choose tenants, owners, customers or suppliers");
  }
  return value as PartyType;
}

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (user, request, context) => {
  const { report } = await context.params;
  const params = request.nextUrl.searchParams;
  const rawFormat = params.get("format");
  let format: ReportFormat | null = null;
  if (rawFormat) {
    if (!isReportFormat(rawFormat)) {
      return createErrorResponse(`Unsupported export format "${rawFormat}"`, 400);
    }
    if (!canExport(user, "accounting_export", "financial_management")) {
      return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
    }
    format = rawFormat;
  }
  const lang = reportLanguage(params);
  const propertyId = params.get("propertyId") || null;
  const buildingFilter = async (): Promise<Array<[string, string]>> =>
    propertyId ? await describeAppliedFilters(user, { propertyId }) : [];
  const period = (range: { from: string | null; to: string | null }) => `${range.from}_${range.to}`;
  /** The figures, or the file when one was asked for. */
  const answer = async <T,>(
    result: unknown,
    sheet: () => ReportSheet<T> | Promise<ReportSheet<T>>,
    stamp: string,
  ) => {
    if (!format) return createSuccessResponse(result);
    const file = await buildReportResponse(await sheet(), {
      format,
      rtl: isRtlReportRequest(params),
      lang,
      fileName: FILE_NAMES[report],
      dateStamp: stamp,
    });
    return new NextResponse(file.body, { status: file.status, headers: file.headers });
  };

  switch (report) {
    case "account-statement": {
      const accountId = params.get("accountId");
      if (!accountId) throw ledgerError("LEDGER_ACCOUNT_REQUIRED", "Choose an account");
      const result = await accountStatement({ ...rangeOf(params, "month"), accountId, propertyId });
      return answer(
        result,
        async () => accountStatementSheet(result, lang, await buildingFilter()),
        period(result.period),
      );
    }
    case "party-statement": {
      const partyType = partyTypeParam(params);
      const partyId = params.get("partyId");
      if (!partyId) throw ledgerError("LEDGER_PARTY_REQUIRED", "Choose whose statement to show");
      const result = await partyStatement({
        ...rangeOf(params, "month"),
        partyType,
        partyId,
        accountId: params.get("accountId") || null,
      });
      return answer(result, () => partyStatementSheet(result, lang), period(result.period));
    }
    case "parties": {
      if (format) return createErrorResponse("The party list has no export", 400);
      return createSuccessResponse({ parties: await partyOptions(partyTypeParam(params)) });
    }
    case "trial-balance": {
      const result = await trialBalance({
        ...rangeOf(params, "month"),
        includeZero: params.get("includeZero") === "true",
      });
      return answer(result, () => trialBalanceSheet(result, lang), period(result.period));
    }
    case "profit-loss": {
      const result = await profitAndLoss({ ...rangeOf(params, "month"), propertyId });
      return answer(
        result,
        async () => profitAndLossSheet(result, lang, await buildingFilter()),
        period(result.period),
      );
    }
    case "balance-sheet": {
      const result = await balanceSheet(dayParam(params, "asOf") ?? today());
      return answer(result, () => balanceSheetSheet(result, lang), result.asOf);
    }
    case "banks": {
      const result = await bankReport({
        ...rangeOf(params, "month"),
        bankAccountId: params.get("bankAccountId") || null,
      });
      return answer(result, () => bankReportSheet(result, lang), period(result.period));
    }
    case "vat-return": {
      const result = await vatReturn(rangeOf(params, "quarter"));
      return answer(result, () => vatReturnSheet(result, lang), period(result.period));
    }
    default:
      return createErrorResponse("Unknown report", 404);
  }
});
