/**
 * Retired: the shared tenant Stripe webhook endpoint.
 *
 * One URL could not serve every organization. Each collects with its own
 * Stripe account and its own signing secret, and this route had no way to know
 * which organization an event belonged to before verifying it — so it fell
 * back to the platform's env secret and rejected everything else.
 *
 * Point each organization's Stripe webhook at their own URL instead. It is
 * shown to them in Settings → Payments:
 *
 *   /api/payments/webhook/stripe/<org-slug>
 */

import { NextResponse } from "next/server";

export const POST = () =>
  NextResponse.json(
    {
      success: false,
      error:
        "This endpoint is retired. Each organization now has its own webhook URL: " +
        "/api/payments/webhook/stripe/<org-slug>, shown in Settings → Payments.",
    },
    { status: 410 },
  );
