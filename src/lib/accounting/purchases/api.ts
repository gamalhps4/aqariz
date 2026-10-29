/**
 * PropertyPro - What the purchases routes share
 *
 * The rights each action asks for (lib/finance-permissions.ts), the way a
 * request asks for a file instead of the figures, and the small parsing every
 * list repeats. Purchases are the whole office's books, so they take the
 * ledger's route wrapper: staff only, and never an employee narrowed to some
 * buildings.
 */

import { NextResponse } from "next/server";
import { createErrorResponse, type AuthenticatedAccessUser } from "@/lib/api-utils";
import {
  PURCHASE_APPROVE_PERMISSIONS,
  PURCHASE_CREATE_PERMISSIONS,
  PURCHASE_DELETE_PERMISSIONS,
  PURCHASE_EDIT_PERMISSIONS,
  PURCHASE_PAY_PERMISSIONS,
  PURCHASE_VIEW_PERMISSIONS,
} from "@/lib/finance-permissions";
import {
  buildReportResponse,
  canExport,
  EXPORT_DENIED_MESSAGE,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportLanguage,
  type ReportSheet,
} from "@/lib/reports/export";
import { parseDay } from "../dates";
import { ledgerError } from "../errors";
import { businessDay } from "@/lib/dates/business-day";

export { ledgerRoute, pageParams, pagination, readJson } from "../api";

export const PURCHASE_VIEW_ACCESS = { permissions: [...PURCHASE_VIEW_PERMISSIONS] };
export const PURCHASE_CREATE_ACCESS = { permissions: [...PURCHASE_CREATE_PERMISSIONS] };
export const PURCHASE_EDIT_ACCESS = { permissions: [...PURCHASE_EDIT_PERMISSIONS] };
export const PURCHASE_DELETE_ACCESS = { permissions: [...PURCHASE_DELETE_PERMISSIONS] };
export const PURCHASE_APPROVE_ACCESS = { permissions: [...PURCHASE_APPROVE_PERMISSIONS] };
export const PURCHASE_PAY_ACCESS = { permissions: [...PURCHASE_PAY_PERMISSIONS] };
/** Anyone who works in purchases, whatever part of it. */
export const PURCHASE_ANY_ACCESS = {
  permissions: [
    ...new Set([
      ...PURCHASE_VIEW_PERMISSIONS,
      ...PURCHASE_CREATE_PERMISSIONS,
      ...PURCHASE_EDIT_PERMISSIONS,
      ...PURCHASE_DELETE_PERMISSIONS,
      ...PURCHASE_APPROVE_PERMISSIONS,
      ...PURCHASE_PAY_PERMISSIONS,
    ]),
  ],
};

/** Whether the caller holds any of these rights. */
export function holdsAny(user: { permissions?: readonly string[] }, rights: readonly string[]): boolean {
  const held = user.permissions ?? [];
  return rights.some((right) => held.includes(right));
}

export interface ExportAsk {
  format: ReportFormat;
  lang: ReportLanguage;
  rtl: boolean;
}

/**
 * Whether the request asks for a file rather than the figures: null when it
 * does not, the format when it does and the caller may export, and the
 * refusal to return when it asks for what it may not have.
 */
export function exportAsk(
  user: AuthenticatedAccessUser,
  params: URLSearchParams,
  moduleExport: string,
): ExportAsk | NextResponse | null {
  const raw = params.get("format");
  if (!raw) return null;
  if (!isReportFormat(raw)) return createErrorResponse(`Unsupported export format "${raw}"`, 400);
  if (!canExport(user, moduleExport, "financial_management")) {
    return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
  }
  return { format: raw, lang: reportLanguage(params), rtl: isRtlReportRequest(params) };
}

/** The sheet as the file the request asked for. */
export async function fileResponse<T>(
  sheet: ReportSheet<T>,
  ask: ExportAsk,
  fileName: string,
  dateStamp: string,
): Promise<NextResponse> {
  const file = await buildReportResponse(sheet, {
    format: ask.format,
    rtl: ask.rtl,
    lang: ask.lang,
    fileName,
    dateStamp,
  });
  return new NextResponse(file.body, { status: file.status, headers: file.headers });
}

/** A `YYYY-MM-DD` query parameter, or null when it is absent; a refusal when it is not a day. */
export function dayParam(params: URLSearchParams, name: string): Date | null {
  const raw = params.get(name);
  if (!raw) return null;
  const day = parseDay(raw);
  if (!day) throw ledgerError("LEDGER_DATE_INVALID", `${name} is not a valid date`);
  return day;
}

/** Both ends of a period, refused when they are the wrong way round. */
export function periodParams(params: URLSearchParams, fromName = "from", toName = "to") {
  const from = dayParam(params, fromName);
  const to = dayParam(params, toName);
  if (from && to && from.getTime() > to.getTime()) {
    throw ledgerError("LEDGER_PERIOD_REVERSED", "The start date cannot be after the end date");
  }
  return { from, to };
}

export function orderParam(params: URLSearchParams): "asc" | "desc" | undefined {
  const value = params.get("order") ?? params.get("sortOrder");
  return value === "asc" || value === "desc" ? value : undefined;
}

/** A day for a file's name and period. */
export const isoDay = (date: Date | null | undefined): string | null =>
  date ? businessDay(date) : null;
