/**
 * PropertyPro - What every ledger route shares
 *
 * Who may reach the books (the rights in lib/finance-permissions.ts, staff
 * only, and never an employee narrowed to some buildings — the books are the
 * whole office's, so a partial view of them would be a wrong one), and the
 * small parsing every route repeats.
 *
 * The routes answer refusals with the ledger's machine codes
 * (`code: "LEDGER_…"`), which the screens translate; handleApiError in
 * lib/api-utils reads them off the error.
 */

import type { NextRequest, NextResponse } from "next/server";
import {
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  type AuthenticatedAccessUser,
} from "@/lib/api-utils";
import {
  LEDGER_CLOSE_PERIOD_PERMISSIONS,
  LEDGER_MANAGE_PERMISSIONS,
  LEDGER_VIEW_PERMISSIONS,
} from "@/lib/finance-permissions";
import type { ApiResponse } from "@/types";
import { ledgerError } from "./errors";

export const LEDGER_VIEW_ACCESS = { permissions: [...LEDGER_VIEW_PERMISSIONS] };
export const LEDGER_MANAGE_ACCESS = { permissions: [...LEDGER_MANAGE_PERMISSIONS] };
export const LEDGER_CLOSE_ACCESS = { permissions: [...LEDGER_CLOSE_PERIOD_PERMISSIONS] };

type Requirement = { permissions: string[] };

export interface LedgerRouteContext {
  params: Promise<Record<string, string>>;
}

type Handler = (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  context: LedgerRouteContext,
) => Promise<NextResponse<ApiResponse<unknown>> | NextResponse>;

/** The office's staff, unrestricted, holding the requirement's rights. */
export function ledgerRoute(requirement: Requirement, handler: Handler) {
  return withAccessAndDB(requirement)(
    async (user: AuthenticatedAccessUser, request: NextRequest, context: LedgerRouteContext) => {
      if (!user.isCompanyStaff) {
        return createErrorResponse("The books are for the office's staff", 403, undefined, "LEDGER_STAFF_ONLY");
      }
      if (user.scopedPropertyIds !== undefined) {
        return createErrorResponse(
          "The books cover the whole office; an employee limited to some buildings cannot open them",
          403,
          undefined,
          "LEDGER_SCOPED_EMPLOYEE",
        );
      }
      try {
        return await handler(user, request, context);
      } catch (error) {
        return handleApiError(error);
      }
    },
  );
}

export async function readJson<T = Record<string, unknown>>(request: NextRequest): Promise<T> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") throw new Error("not an object");
    return body as T;
  } catch {
    throw ledgerError("LEDGER_BAD_REQUEST", "The request body must be a JSON object");
  }
}

export function pageParams(searchParams: URLSearchParams, defaultLimit = 20) {
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit));
  return { page, limit };
}

export function pagination(page: number, limit: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
