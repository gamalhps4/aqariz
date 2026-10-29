/**
 * PropertyPro - Management agreements & commission
 *
 * A management agreement says what the office keeps out of what an owner's
 * buildings earn. This module resolves which agreement applies to a property
 * and turns it into a commission figure for a period.
 *
 * An investment agreement (عقد استثمار) is the other kind: the office rents
 * the building from the owner for a fixed amount, lets the units itself and
 * keeps the rent. The owner is owed that fixed amount — nothing else — and no
 * management commission applies to the building while it is in force.
 *
 * Three rules govern everything here:
 *
 *  1. NO AGREEMENT MEANS NO COMMISSION. Never an error, never a blocked
 *     report. A landlord managing their own buildings has no agreement and
 *     never will, and their statement must still work — see
 *     `getOwnerStatement`.
 *
 *  2. MOST SPECIFIC SCOPE WINS. A blanket agreement over an owner's whole
 *     portfolio can be overridden for one compound, and that in turn for one
 *     property, without unpicking the blanket one.
 *
 *  3. AN AGREEMENT EARNS FOR ITS OWN TERM. For the part of a period it was in
 *     force — its start date to its end or termination date, both days whole,
 *     whatever its status has become since — and at its own rate. A period
 *     that takes in an agreement and its renewal charges each for its part.
 */

import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { InvoiceStatus, PaymentStatus } from "@/types";
import {
  agreementKind,
  computeCommissionRun,
  resolveAgreementForProperty,
  type AgreementRow,
  type CommissionRun,
  type RentEntry,
} from "@/lib/agreement-math";

import {
  billedRentBase,
  paymentCommissionBase,
  type BaseInvoice,
} from "@/lib/statements/commission-base";

// The pure half of the engine lives in lib/agreement-math.ts (so it can be
// tested without a database); everything that imported it from here still can.
export * from "@/lib/agreement-math";

/** What `commission-base.ts` reads from an invoice. */
const BASE_INVOICE_SELECT = {
  category: true,
  taxAmount: true,
  discountAmount: true,
  totalAmount: true,
  lineItems: true,
} as const;

/** A contract's terms, for a rent payment linked to no invoice. */
const BASE_LEASE_SELECT = {
  rentAmount: true,
  electricityAmount: true,
  waterAmount: true,
  taxEnabled: true,
  taxRate: true,
} as const;

/** The invoices a payment's `allocations` JSON applied money to. */
function allocatedInvoiceIds(allocations: unknown): string[] {
  if (!Array.isArray(allocations)) return [];
  return allocations
    .map((item) => String((item as { invoiceId?: unknown })?.invoiceId ?? ""))
    .filter(Boolean);
}

const AGREEMENT_SELECT = {
  id: true,
  kind: true,
  agreementNumber: true,
  ownerId: true,
  propertyId: true,
  compoundId: true,
  feeType: true,
  feePercentage: true,
  feeAmount: true,
  feeFrequency: true,
  commissionBasis: true,
  currency: true,
  startDate: true,
  endDate: true,
  status: true,
  terminatedDate: true,
} as const;

/** Every agreement for an owner (or the whole organization when omitted). */
export async function loadAgreements(options: {
  ownerId?: string;
  activeOnly?: boolean;
} = {}): Promise<AgreementRow[]> {
  const rows = await db.agreement.findMany({
    where: {
      deletedAt: null,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      ...(options.activeOnly ? { status: "active" } : {}),
    },
    select: AGREEMENT_SELECT,
  });
  return rows as AgreementRow[];
}

export interface CommissionRunOptions {
  propertyIds: readonly string[];
  ownerId?: string;
  startDate: Date;
  endDate: Date;
}

/** A payment received, or an invoice that fell due, and the unit it was for. */
export interface RunRentEntry extends RentEntry {
  /** The unit a payment's contract is written on, or an invoice bills. */
  unitId: string | null;
}

/**
 * A commission run with the rows it was charged from — every payment and
 * every invoice, dated and with the rent before VAT in each — and the
 * agreements it read. Enough to say which unit of a building brought in the
 * rent a percentage was charged on (lib/statements/subject-account.ts).
 */
export interface CommissionRunDetail {
  run: CommissionRun;
  received: RunRentEntry[];
  billed: RunRentEntry[];
  agreements: AgreementRow[];
}

/**
 * Commission across a set of properties for a period.
 *
 * The rent figures come from the same payment and invoice rows the owner
 * statement and collection views read, so a commission can never be charged
 * against money the ledger does not show. Who is charged what, and for which
 * part of the period, is `computeCommissionRun` in lib/agreement-math.ts.
 */
export async function runCommission(
  options: CommissionRunOptions,
): Promise<CommissionRun> {
  return (await runCommissionDetailed(options)).run;
}

/** `runCommission`, with the rows it was charged from — see CommissionRunDetail. */
export async function runCommissionDetailed(
  options: CommissionRunOptions,
): Promise<CommissionRunDetail> {
  const empty: CommissionRun = {
    hasAgreements: false,
    hasInvestment: false,
    totals: {
      rentCollected: 0,
      rentBilled: 0,
      commission: 0,
      investmentRent: 0,
      netToOwner: 0,
    },
    byProperty: [],
  };
  if (options.propertyIds.length === 0) {
    return { run: empty, received: [], billed: [], agreements: [] };
  }

  const propertyIds = [...options.propertyIds];
  const period = { gte: options.startDate, lte: options.endDate };

  const [properties, agreements, received, billed] = await Promise.all([
    db.property.findMany({
      where: { id: { in: propertyIds } },
      select: { id: true, name: true, ownerId: true, compoundId: true },
    }),
    loadAgreements({ ownerId: options.ownerId }),
    db.payment.findMany({
      where: {
        propertyId: { in: propertyIds },
        deletedAt: null,
        status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
        paidDate: period,
      },
      select: {
        propertyId: true,
        paidDate: true,
        createdAt: true,
        type: true,
        amount: true,
        amountPaid: true,
        invoiceId: true,
        allocations: true,
        invoice: { select: BASE_INVOICE_SELECT },
        lease: { select: { ...BASE_LEASE_SELECT, unitId: true } },
      },
    }),
    db.invoice.findMany({
      where: {
        propertyId: { in: propertyIds },
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
        // By due date, not issue date. This figure is the base for a
        // `commissionBasis: "billed"` agreement, so an invoice printed a
        // week early would otherwise be charged in the wrong period.
        dueDate: period,
      },
      select: {
        propertyId: true,
        unitId: true,
        dueDate: true,
        ...BASE_INVOICE_SELECT,
      },
    }),
  ]);

  // The commission is charged on rent before VAT (lib/statements/
  // commission-base.ts), which needs the invoices each payment settled. Its
  // own invoice comes with it; money spread over further installments needs
  // those too — rare, so usually no second read.
  const invoicesById = new Map<string, BaseInvoice>();
  for (const payment of received) {
    if (payment.invoiceId && payment.invoice) {
      invoicesById.set(payment.invoiceId, payment.invoice);
    }
  }
  const missing = [
    ...new Set(
      received.flatMap((payment) =>
        allocatedInvoiceIds(payment.allocations).filter(
          (id) => !invoicesById.has(id),
        ),
      ),
    ),
  ];
  if (missing.length > 0) {
    const extra = await db.invoice.findMany({
      where: { id: { in: missing } },
      select: { id: true, ...BASE_INVOICE_SELECT },
    });
    for (const invoice of extra) invoicesById.set(invoice.id, invoice);
  }

  // Each payment and each invoice keeps its date: an agreement charges only
  // the rent of the part of the period it held the building, so one figure
  // for the whole period would let an agreement that started or ended inside
  // it charge rent that was never its own.
  const receivedRent: RunRentEntry[] = received.map((payment) => {
    const collected = Number(payment.amountPaid) || Number(payment.amount) || 0;
    return {
      propertyId: payment.propertyId,
      unitId: payment.lease?.unitId ?? null,
      date: payment.paidDate ?? payment.createdAt,
      amount: collected,
      base: paymentCommissionBase(
        {
          type: payment.type,
          collected,
          invoiceId: payment.invoiceId,
          allocations: payment.allocations,
        },
        invoicesById,
        payment.lease,
      ),
    };
  });
  // Read by building, so every row has one; the type cannot know that.
  const billedRent: RunRentEntry[] = billed.flatMap((invoice) =>
    invoice.propertyId
      ? [
          {
            propertyId: invoice.propertyId,
            unitId: invoice.unitId,
            date: invoice.dueDate,
            amount: Number(invoice.totalAmount) || 0,
            base: billedRentBase(invoice),
          },
        ]
      : [],
  );

  // Every building of the owners concerned, rather than only the buildings
  // this run was asked about — a flat amount is shared over all of them an
  // agreement governs, so one building's statement must carry its part, not
  // the whole.
  const ownerIds = [...new Set(properties.map((property) => property.ownerId))];
  const portfolio = await db.property.findMany({
    where: { ownerId: { in: ownerIds }, deletedAt: null },
    select: { id: true, ownerId: true, compoundId: true },
    orderBy: { id: "asc" },
  });

  const run = computeCommissionRun({
    properties,
    portfolio,
    agreements,
    period: { startDate: options.startDate, endDate: options.endDate },
    received: receivedRent,
    billed: billedRent,
  });
  return { run, received: receivedRent, billed: billedRent, agreements };
}

/**
 * Properties an agreement governs right now — the set its commission is
 * computed over. Mirrors `resolveAgreementForProperty`'s precedence, so an
 * agreement does not claim a property that a more specific one has taken.
 */
export async function propertiesUnderAgreement(
  agreementId: string,
  on: Date = new Date(),
): Promise<Array<{ id: string; name: string }>> {
  const agreement = await db.agreement.findFirst({
    where: { id: agreementId },
    select: AGREEMENT_SELECT,
  });
  if (!agreement) return [];

  const where: Prisma.PropertyWhereInput = {
    deletedAt: null,
    ownerId: agreement.ownerId,
    ...(agreement.propertyId ? { id: agreement.propertyId } : {}),
    ...(agreement.compoundId ? { compoundId: agreement.compoundId } : {}),
  };

  const candidates = await db.property.findMany({
    where,
    select: { id: true, name: true, ownerId: true, compoundId: true },
    orderBy: { name: "asc" },
  });

  const all = await loadAgreements({ ownerId: agreement.ownerId });
  const kind = agreementKind(agreement);

  return candidates
    .filter((property) => {
      // A building let to the office under investment is not also under
      // management, whatever a management agreement's scope says.
      if (
        kind === "management" &&
        resolveAgreementForProperty(all, property, on, "investment")
      ) {
        return false;
      }
      return (
        resolveAgreementForProperty(all, property, on, kind)?.id === agreement.id
      );
    })
    .map((property) => ({ id: property.id, name: property.name }));
}
