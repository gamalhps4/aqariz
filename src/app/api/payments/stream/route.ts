import { NextResponse } from "next/server";

export function triggerPaymentUpdate(_paymentData: unknown): void {}
export function triggerPaymentCreated(_paymentData: unknown): void {}
export function triggerPaymentDeleted(_paymentData: unknown): void {}

export function GET() {
  return NextResponse.json(
    {
      success: false,
      error: "The mock global payment stream is disabled.",
    },
    { status: 410 },
  );
}
