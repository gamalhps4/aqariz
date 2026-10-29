/**
 * PropertyPro - Reading and writing the gateway reference columns
 *
 * `payments.gatewayProvider` / `payments.gatewayPaymentId` arrive with
 * migration 20261004140000_payment_gateway_reference, and production applies
 * migrations after the deploy. The client leaves both columns out of every
 * read (src/lib/db/prisma.ts), so the app works on a database the migration
 * has not reached; what reads or writes them asks here first.
 *
 * Before the migration: online checkout answers "being upgraded" rather than
 * charging a payer it could not record, and the reports fall back on the
 * Stripe/PayPal columns. Once the columns are there it is remembered for the
 * life of the process; while missing, asked again every minute, so applying
 * the migration needs no restart.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import type { GatewayReference } from "@/lib/payments/gateway-reference";

const RECHECK_MISSING_MS = 60_000;

let present = false;
let checkedAt = 0;

/** Whether the database has the gateway reference columns yet. */
export async function gatewayColumnsAvailable(): Promise<boolean> {
  if (present) return true;
  if (checkedAt && Date.now() - checkedAt < RECHECK_MISSING_MS) return false;
  try {
    const rows = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'payments'
           AND column_name = 'gatewayPaymentId'
      ) AS present`;
    present = Boolean(rows[0]?.present);
  } catch {
    present = false;
  }
  checkedAt = Date.now();
  return present;
}

/** Online checkout cannot be recorded until the migration has run. */
export class GatewayColumnsMissingError extends Error {
  statusCode = 503;
  code = "MIGRATION_REQUIRED";
  constructor() {
    super(
      "Online payments are being upgraded. Try again in a few minutes, or pay the office directly.",
    );
    this.name = "GatewayColumnsMissingError";
  }
}

export async function requireGatewayColumns(): Promise<void> {
  if (!(await gatewayColumnsAvailable())) throw new GatewayColumnsMissingError();
}

/** The `omit` that brings both columns into a payment read — or leaves them out while missing. */
export async function gatewayColumnsOmit(): Promise<{
  gatewayProvider: boolean;
  gatewayPaymentId: boolean;
}> {
  const missing = !(await gatewayColumnsAvailable());
  return { gatewayProvider: missing, gatewayPaymentId: missing };
}

/** Spread into a payment `select` that reads the reference: both columns, once they exist. */
export async function gatewayReferenceSelect(): Promise<{
  gatewayProvider: boolean;
  gatewayPaymentId: boolean;
}> {
  const on = await gatewayColumnsAvailable();
  return { gatewayProvider: on, gatewayPaymentId: on };
}

/**
 * The gateway references of these payments, keyed by payment id. Empty before
 * the migration — the callers then read the Stripe/PayPal columns they
 * already selected (lib/payments/gateway-reference.ts).
 */
export async function loadGatewayReferences(
  paymentIds: readonly string[],
): Promise<Map<string, GatewayReference>> {
  const out = new Map<string, GatewayReference>();
  const ids = [...new Set(paymentIds.filter(Boolean))];
  if (ids.length === 0 || !(await gatewayColumnsAvailable())) return out;
  const rows = await db.payment.findMany({
    // Archived payments too: a report may still list them.
    where: { id: { in: ids }, gatewayPaymentId: { not: null }, deletedAt: undefined },
    select: { id: true, gatewayProvider: true, gatewayPaymentId: true },
  });
  for (const row of rows) {
    if (row.gatewayProvider && row.gatewayPaymentId) {
      out.set(row.id, { provider: row.gatewayProvider, id: row.gatewayPaymentId });
    }
  }
  return out;
}

/** The generic columns merged onto rows that selected the old ones. */
export async function withGatewayReferences<T extends { id: string }>(
  rows: T[],
): Promise<Array<T & { gatewayProvider: string | null; gatewayPaymentId: string | null }>> {
  const references = await loadGatewayReferences(rows.map((row) => row.id));
  return rows.map((row) => {
    const reference = references.get(row.id);
    return {
      ...row,
      gatewayProvider: reference?.provider ?? null,
      gatewayPaymentId: reference?.id ?? null,
    };
  });
}
