/**
 * PropertyPro - Claiming a gateway webhook event for one office
 *
 * See ./webhook-claim-key.ts for why the claim is per office. The column
 * arrives with migration 20261004220000_webhook_events_by_organization, and
 * production applies migrations after the deploy: until it is there the claim
 * is the old global one. Once present it is remembered for the life of the
 * process; while missing, asked again every minute, so applying the migration
 * needs no restart.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { webhookClaimKey, type WebhookClaim } from "./webhook-claim-key";

const RECHECK_MISSING_MS = 60_000;

let present = false;
let checkedAt = 0;

/** Whether `webhook_events.organizationId` exists yet. */
async function claimsPerOrganization(): Promise<boolean> {
  if (present) return true;
  if (checkedAt && Date.now() - checkedAt < RECHECK_MISSING_MS) return false;
  try {
    const rows = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'webhook_events'
           AND column_name = 'organizationId'
      ) AS present`;
    present = Boolean(rows[0]?.present);
  } catch {
    present = false;
  }
  checkedAt = Date.now();
  return present;
}

/**
 * Claim an event for this office. Returns false when a delivery of the same
 * event to the same office already claimed it.
 */
export async function claimWebhookEvent(
  claim: WebhookClaim,
  eventType: string,
): Promise<boolean> {
  const key = webhookClaimKey(claim, await claimsPerOrganization());
  try {
    // webhook_events is an infrastructure table (bypass-only RLS policy).
    await bypassOrgScope(() => db.webhookEvent.create({ data: { ...key, eventType } }));
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return false;
    throw error;
  }
}

/**
 * Give the claim back so the gateway's retry is processed rather than being
 * waved through as a duplicate.
 */
export async function releaseWebhookEvent(claim: WebhookClaim): Promise<void> {
  const key = webhookClaimKey(claim, await claimsPerOrganization());
  await bypassOrgScope(() => db.webhookEvent.deleteMany({ where: key }));
}
