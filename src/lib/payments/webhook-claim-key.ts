/**
 * PropertyPro - Whose claim a gateway webhook event is
 *
 * `webhook_events` remembers each gateway event once, so a retried delivery
 * is not applied twice. It was keyed on (gateway, eventId) across every
 * office, and the per-office webhook claims an event before it has matched it
 * to a payment. PayTabs and Tap send no event id, so theirs is built from the
 * transaction (`<tran_ref>:A`, `<chg_id>:CAPTURED`), which is guessable: an
 * office that saved its own PayTabs or Tap secret could sign an event carrying
 * another office's transaction, claim it first, and that office's real
 * webhook was then dropped as a duplicate.
 *
 * The claim is the office's own now (migration
 * 20261004220000_webhook_events_by_organization). Before that migration
 * reaches a database the column is not there, and the claim stays global.
 *
 * Pure; the claim itself is in ./webhook-claims.ts.
 */

export interface WebhookClaim {
  gateway: string;
  organizationId: string;
  eventId: string;
}

/**
 * The row that claims an event, and the filter that finds it again. With
 * `perOrganization` false (the column is missing) it is the old global key.
 */
export function webhookClaimKey(
  claim: WebhookClaim,
  perOrganization: boolean,
): { gateway: string; eventId: string; organizationId?: string } {
  return perOrganization
    ? { gateway: claim.gateway, organizationId: claim.organizationId, eventId: claim.eventId }
    : { gateway: claim.gateway, eventId: claim.eventId };
}
