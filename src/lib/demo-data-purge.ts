/**
 * PropertyPro - Emptying an organization through the demo-data tool
 *
 * The statements behind DELETE /api/demo-data, kept apart from the service so
 * they can be read — and tested — without a database behind them. Who may run
 * them, and where, is lib/demo-data-access.ts.
 */

import type { OrgTransactionClient } from "@/lib/db/prisma";

/** How many rows went from each table — what the audit entry records. */
export interface DemoDataPurgeCounts {
  messages: number;
  conversations: number;
  announcements: number;
  eventReminders: number;
  eventInvitations: number;
  events: number;
  workOrders: number;
  maintenanceRequests: number;
  paymentReceipts: number;
  payments: number;
  invoices: number;
  recurringPayments: number;
  securityDeposits: number;
  leases: number;
  applications: number;
  tenants: number;
  units: number;
  properties: number;
  users: number;
}

/**
 * Hard-delete the organization's records, archived rows included.
 *
 * Every statement runs on the transaction it is handed, so a foreign key that
 * refuses a late delete — an inspection still pointing at a building, a
 * notification at a user — undoes the early ones too. They used to run one at
 * a time, and a refusal at the end left the organization without its
 * payments, invoices and leases, and with no way back.
 *
 * Children go before parents so foreign keys are satisfied; the order of the
 * properties below is the order the statements run in. A transaction client
 * has no soft-delete filter, so archived rows need no opting in. Row-level
 * security already confines each statement to the caller's organization; the
 * filter says so again, because nothing else in the product deletes this
 * much.
 */
export async function purgeOrganizationData(
  tx: OrgTransactionClient,
  organizationId: string,
): Promise<DemoDataPurgeCounts> {
  if (!organizationId) {
    throw new Error("An organization is required to clear demo data");
  }
  const where = { organizationId };

  return {
    messages: (await tx.message.deleteMany({ where })).count,
    conversations: (await tx.conversation.deleteMany({ where })).count,
    announcements: (await tx.announcement.deleteMany({ where })).count,
    eventReminders: (await tx.eventReminder.deleteMany({ where })).count,
    eventInvitations: (await tx.eventInvitation.deleteMany({ where })).count,
    events: (await tx.event.deleteMany({ where })).count,
    workOrders: (await tx.workOrder.deleteMany({ where })).count,
    maintenanceRequests: (await tx.maintenanceRequest.deleteMany({ where }))
      .count,
    paymentReceipts: (await tx.paymentReceipt.deleteMany({ where })).count,
    payments: (await tx.payment.deleteMany({ where })).count,
    invoices: (await tx.invoice.deleteMany({ where })).count,
    recurringPayments: (await tx.recurringPayment.deleteMany({ where })).count,
    securityDeposits: (await tx.securityDeposit.deleteMany({ where })).count,
    leases: (await tx.lease.deleteMany({ where })).count,
    applications: (await tx.application.deleteMany({ where })).count,
    tenants: (await tx.tenant.deleteMany({ where })).count,
    units: (await tx.unit.deleteMany({ where })).count,
    properties: (await tx.property.deleteMany({ where })).count,
    users: (await tx.user.deleteMany({ where })).count,
  };
}

/**
 * What the caller is told when a foreign key refused the clear.
 *
 * It is the expected outcome on any organization that has been used: the
 * tables the clear leaves alone — notifications, documents, inspections,
 * expenses, tickets, settings — still point at the users and buildings it
 * ends with.
 */
export const DEMO_DATA_PURGE_REFUSED_MESSAGE =
  "Nothing was deleted. This organization holds records the demo-data tool does not clear, and they still point at its users or buildings. To empty a demo database, run pnpm db:reset.";

/** Whether the database refused a delete because other rows still point at it. */
export function isForeignKeyRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2003"
  );
}
