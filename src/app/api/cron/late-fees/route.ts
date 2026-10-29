/**
 * PropertyPro SaaS - Late fee cron (retired)
 *
 * Late fees were removed at the client's request, so this job has nothing left
 * to do. It answers 410 Gone rather than disappearing: a scheduler still
 * calling it then fails with the reason in its log instead of a bare 404.
 * Delete this file once no scheduler calls it (docs/scheduled-jobs.md).
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      success: false,
      error:
        "Late fees were removed. Delete the late-fees schedule; see docs/scheduled-jobs.md.",
    },
    { status: 410 },
  );
}
