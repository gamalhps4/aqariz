import "server-only";

/**
 * PropertyPro - Small helpers the Marketing routes share
 */

import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-utils";
import { ListingError } from "./errors";

/**
 * A refusal the listing services threw, as the response — with the codes the
 * screens say in the reader's language (`code`, and for a publish refusal the
 * list of `problems`) — or, for anything else, the app's own error handling.
 */
export function listingFailure(error: unknown, fallback: string): NextResponse {
  if (error instanceof ListingError) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
        ...(error.problems ? { problems: error.problems } : {}),
        ...(error.existingId ? { existingId: error.existingId } : {}),
      },
      { status: error.statusCode },
    );
  }
  return handleApiError(error, fallback) as NextResponse;
}

/** `page` and `limit` from a query string, in range. */
export function pageParams(
  searchParams: URLSearchParams,
  defaultLimit = 12,
): { page: number; limit: number } {
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit),
  );
  return { page, limit };
}

/** The first non-empty value of a query parameter, trimmed, or undefined. */
export function queryText(
  searchParams: URLSearchParams,
  name: string,
): string | undefined {
  const value = searchParams.get(name)?.trim();
  return value ? value : undefined;
}
