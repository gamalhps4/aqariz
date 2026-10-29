/**
 * PropertyPro - Delivery reports for the platform's messaging gateway
 *
 *   POST /api/messaging/webhook/twilio   Twilio status callbacks (the send
 *                                        names this URL per message)
 *   GET  /api/messaging/webhook/meta     Meta's subscription handshake
 *   POST /api/messaging/webhook/meta     WhatsApp Cloud API status webhooks
 *
 * For messages that went through the Super Admin's default gateway (or the
 * environment's). Authenticated by the provider's signature against the
 * platform's stored secret — see lib/messaging/webhook-handler.ts. An
 * office's own account reports to /api/messaging/webhook/<provider>/<slug>.
 */

import {
  handleDeliveryWebhook,
  handleWebhookHandshake,
} from "@/lib/messaging/webhook-handler";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

export async function GET(request: Request, { params }: Params) {
  const { provider } = await params;
  return handleWebhookHandshake(request, provider, "platform");
}

export async function POST(request: Request, { params }: Params) {
  const { provider } = await params;
  // No organization context: the settings singleton is read, and matching
  // messages updated, under their own narrow bypasses (store.ts, log.ts).
  return handleDeliveryWebhook(request, provider, "platform");
}
