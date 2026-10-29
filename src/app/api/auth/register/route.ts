import { createErrorResponse } from "@/lib/api-utils";

/**
 * Legacy single-company registration endpoint.
 *
 * Organization accounts must be created through /api/auth/signup-organization
 * so an unbound admin/manager account can never be introduced.
 */
export async function POST() {
  return createErrorResponse(
    "This registration endpoint has been retired. Use organization signup.",
    410,
  );
}

export async function GET() {
  return createErrorResponse(
    "This registration endpoint has been retired. Use organization signup.",
    410,
  );
}
