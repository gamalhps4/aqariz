/**
 * PropertyPro - The printable payment voucher (سند صرف)
 *
 * GET `?lang=ar|en|de|es|fr` — the voucher as a PDF, in the language asked for
 * (the office's own when none is), shown in the browser so it can be printed
 * or saved. A cancelled voucher prints marked cancelled.
 */

import { NextResponse } from "next/server";
import { createErrorResponse } from "@/lib/api-utils";
import { PURCHASE_VIEW_ACCESS, ledgerRoute } from "@/lib/accounting/purchases/api";
import { generateVoucherPdf } from "@/lib/accounting/purchases/voucher-pdf.service";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(PURCHASE_VIEW_ACCESS, async (_user, request, context) => {
  const { id } = await context.params;
  const made = await generateVoucherPdf(id, request.nextUrl.searchParams.get("lang"));
  if (!made) {
    return createErrorResponse("Payment voucher not found", 404, undefined, "PURCHASE_VOUCHER_NOT_FOUND");
  }
  return new NextResponse(new Uint8Array(made.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${made.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
});
