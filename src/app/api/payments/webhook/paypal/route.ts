/**
 * Retired: the shared tenant PayPal webhook endpoint. See the Stripe note in
 * ../route.ts — each organization verifies against its own PayPal webhook ID.
 *
 *   /api/payments/webhook/paypal/<org-slug>
 */

import { NextResponse } from "next/server";

export const POST = () =>
  NextResponse.json(
    {
      success: false,
      error:
        "This endpoint is retired. Each organization now has its own webhook URL: " +
        "/api/payments/webhook/paypal/<org-slug>, shown in Settings → Payments.",
    },
    { status: 410 },
  );
