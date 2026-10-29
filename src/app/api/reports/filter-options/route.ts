/**
 * PropertyPro - Choices for the report filter bar
 *
 * `?include=owners,compounds,buildings,units,tenants,contracts,agreements`
 * names the lists a page needs; each comes back scoped to what the caller may
 * see, so a picker only ever offers a record they could already open. See
 * lib/report-filters/load-options.ts.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { loadFilterOptions } from "@/lib/report-filters/load-options";
import {
  FILTER_OPTION_KEYS,
  isFilterOptionKey,
  type FilterOptionKey,
} from "@/lib/report-filters/options";

// Whoever can open one of the reports that has these filters — the ledger's
// reports among them. A tenant holds `lease_view` too, and is refused below:
// a tenant has no use for the lists, and the scopes would only narrow them to
// their own contract.
export const GET = withPermissionAndDB([
  "accounting_view",
  "financial_reports",
  "financial_management",
  "lease_management",
  "lease_view",
  "ledger_view",
  "ledger_manage",
  // The building and unit pickers of a purchase bill, and the registers'.
  "purchase_view",
  "purchase_create",
  "purchase_edit",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    if (user.isTenant) {
      return createErrorResponse("Access denied", 403);
    }

    const asked = (request.nextUrl.searchParams.get("include") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const unknown = asked.find((name) => !isFilterOptionKey(name));
    if (unknown) {
      return createErrorResponse(
        `Unknown list "${unknown}". Valid lists: ${FILTER_OPTION_KEYS.join(", ")}`,
        400,
      );
    }
    const include = (asked.length ? asked : ["owners", "compounds", "buildings"]) as FilterOptionKey[];

    const options = await loadFilterOptions(user, include);
    return createSuccessResponse(options, "Filter options retrieved successfully");
  } catch (error) {
    return handleApiError(error, "Failed to load filter options");
  }
});
