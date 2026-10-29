/**
 * PropertyPro - Delivery reports for an office's own messaging account
 *
 *   POST /api/messaging/webhook/twilio/<org-slug>
 *   GET  /api/messaging/webhook/meta/<org-slug>    (subscription handshake)
 *   POST /api/messaging/webhook/meta/<org-slug>
 *
 * The office's account has its own secrets, so its reports cannot share the
 * platform's URL: the slug picks whose stored secret to verify against. The
 * slug is not trusted for anything else — a report whose signature does not
 * match that office's secret is refused — and everything after resolution
 * runs inside `runWithOrgContext`, so a report can only touch that office's
 * messages (lib/messaging/webhook-handler.ts).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import {
  handleDeliveryWebhook,
  handleWebhookHandshake,
} from "@/lib/messaging/webhook-handler";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string; orgSlug: string }> };

async function organizationFor(slug: string): Promise<string | null> {
  if (!/^[a-z0-9-]{1,100}$/i.test(slug)) return null;
  const organization = await bypassOrgScope(() =>
    db.organization.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true },
    }),
  );
  return organization?.id ?? null;
}

export async function GET(request: Request, { params }: Params) {
  const { provider, orgSlug } = await params;
  const organizationId = await organizationFor(orgSlug);
  if (!organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return runWithOrgContext({ organizationId, isPlatformAdmin: false }, () =>
    handleWebhookHandshake(request, provider, "office"),
  );
}

export async function POST(request: Request, { params }: Params) {
  const { provider, orgSlug } = await params;
  const organizationId = await organizationFor(orgSlug);
  if (!organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return runWithOrgContext({ organizationId, isPlatformAdmin: false }, () =>
    handleDeliveryWebhook(request, provider, "office"),
  );
}
