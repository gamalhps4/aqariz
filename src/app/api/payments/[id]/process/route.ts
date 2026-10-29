import { NextResponse } from "next/server";

const retired = () =>
  NextResponse.json(
    {
      success: false,
      error:
        "The simulated payment processor is disabled. Use the Stripe invoice payment or manual payment APIs.",
    },
    { status: 410 },
  );

export const GET = retired;
export const POST = retired;
