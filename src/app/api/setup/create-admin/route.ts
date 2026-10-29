import { createErrorResponse } from "@/lib/api-utils";

/**
 * Public HTTP bootstrapping is intentionally disabled. Platform super-admins
 * are created out-of-band with `pnpm create:super-admin`.
 */
export async function POST() {
  return createErrorResponse(
    "HTTP admin setup is disabled. Use the create:super-admin CLI command.",
    410,
  );
}
