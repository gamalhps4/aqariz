/**
 * PropertyPro - What the office owes each owner, settled and paid out
 *
 * An owner's balance is their sub-ledger in "owners' payable": every rent
 * collected for them is credited there as it arrives, every expense on their
 * buildings debited, every payout debited. Settling a period adds the
 * office's own side of the agreement — the commission and the VAT on it, and
 * any investment rent the office owes — with the figures of the owner's
 * statement for that period, so the books and the statement the owner signs
 * agree. Paying out records the money leaving a bank or cash account.
 *
 * The commission is a sale by the office to the owner, booked by its tax
 * invoice: closing a period issues that invoice (or links the one the office
 * already issued) and pays it from the owner's balance; the settlement entry
 * keeps only the investment rent (./settlement-invoice.ts). A period is
 * settled once per owner, whichever agreement it was settled under.
 */

import { db } from "@/lib/db/prisma";
import { requireOrgId } from "@/lib/tenancy/context";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import type { ScopeActor } from "@/lib/db/scopes";
import { getOwnerStatement } from "@/lib/services/owner-statement.service";
import { runCommission } from "@/lib/services/agreement.service";
import { commissionUnderAgreement } from "@/lib/agreement-math";
import { settle } from "@/lib/statements/settlement";
import { COMMISSION_TAX_RATE, DEFAULT_CURRENCY } from "@/lib/regional/region";
import { loadChart, requireAccountingSettings, resolvedMap } from "./settings.service";
import { createWithInvoiceNumber } from "@/lib/services/invoice-number.service";
import { postAfterCommit } from "./hooks";
import {
  SETTLEMENT_INVOICE_PREFIX,
  issueSettlementInvoice,
  linkSettlementInvoice,
  openOwnerFeeInvoices,
  releaseSettlementInvoice,
  settlementInvoiceNumbers,
  settlementInvoicesAvailable,
  type LinkedFeeInvoice,
  type OpenFeeInvoice,
} from "./settlement-invoice.service";
import { settlementFeeTotal } from "./settlement-invoice";
import { assertOpenDay, reverseLedgerEntry, withLedgerTransaction, writeLedgerEntry } from "./posting.service";
import { planOwnerPayout, planSettlementClose } from "./posting/owner";
import { addDays, openDayFor, parseDay, today } from "./dates";
import { ledgerError } from "./errors";
import { fromHalalas, halalasToDecimal, toHalalas } from "./money";
import { parseAmount } from "./journal-validation";
import {
  bankAccountLabel,
  dayText,
  journalNumberLabel,
  payoutSnapshot,
  personName,
  settlementSnapshot,
} from "./audit-snapshots";
import { businessDay } from "@/lib/dates/business-day";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function ownerNames(ids: readonly string[]): Promise<Map<string, { name: string; companyName: string | null }>> {
  if (ids.length === 0) return new Map();
  const [users, profiles] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...ids] }, deletedAt: undefined },
      select: { id: true, firstName: true, lastName: true },
    }),
    db.owner.findMany({
      where: { userId: { in: [...ids] }, deletedAt: undefined },
      select: { userId: true, companyName: true },
    }),
  ]);
  const company = new Map(profiles.map((profile) => [profile.userId, profile.companyName]));
  return new Map(
    users.map((user) => [
      user.id,
      {
        name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "—",
        companyName: company.get(user.id) ?? null,
      },
    ]),
  );
}

/**
 * An owner's name for an activity entry. Read after the write has committed,
 * so a failed read costs the entry its name, never the request its answer.
 */
async function ownerNameForAudit(ownerId: string): Promise<string | null> {
  try {
    const user = await db.user.findFirst({
      where: { id: ownerId, deletedAt: undefined },
      select: { firstName: true, lastName: true },
    });
    return personName(user);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export interface OwnerBalanceRow {
  ownerId: string;
  name: string;
  companyName: string | null;
  /** What the office owes the owner; negative when the owner owes the office. */
  balance: number;
  lastPayout: string | null;
}

export async function ownerBalances(): Promise<OwnerBalanceRow[]> {
  const [settings, chart] = await Promise.all([requireAccountingSettings(), loadChart()]);
  const payableId = resolvedMap(settings, chart).get("owner_payable");
  const [sums, owners, payouts] = await Promise.all([
    payableId
      ? db.journalLine.groupBy({
          by: ["partyId"],
          where: { accountId: payableId, partyType: "owner" },
          _sum: { debit: true, credit: true },
        })
      : Promise.resolve([]),
    db.user.findMany({ where: { role: "owner" }, select: { id: true } }),
    db.ownerPayout.groupBy({
      by: ["ownerId"],
      where: { status: "posted" },
      _max: { date: true },
    }),
  ]);
  const balance = new Map<string, number>();
  for (const row of sums) {
    if (!row.partyId) continue;
    balance.set(
      row.partyId,
      toHalalas(row._sum.credit as unknown as number) - toHalalas(row._sum.debit as unknown as number),
    );
  }
  const ids = [...new Set([...owners.map((owner) => owner.id), ...balance.keys()])];
  const names = await ownerNames(ids);
  const lastPayout = new Map(
    payouts.map((row) => [row.ownerId, row._max.date ? new Date(row._max.date as unknown as string) : null]),
  );
  return ids
    .map((ownerId) => ({
      ownerId,
      name: names.get(ownerId)?.name ?? "—",
      companyName: names.get(ownerId)?.companyName ?? null,
      balance: fromHalalas(balance.get(ownerId) ?? 0),
      lastPayout: businessDay(lastPayout.get(ownerId)) || null,
    }))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

export interface SettlementFigures {
  ownerId: string;
  agreementId: string | null;
  periodStart: string;
  periodEnd: string;
  currency: string;
  collected: number;
  ownerReceivedDirect: number;
  expenses: number;
  /** Commission charged as a percentage of rent. */
  commission: number;
  /** Commission charged as a fixed fee. */
  managementFee: number;
  commissionVat: number;
  investmentRent: number;
  /** What the period leaves the office owing the owner (negative: the owner owing). */
  netDue: number;
}

export interface SettlementPreview extends SettlementFigures {
  /**
   * The owner's open invoices that could stand as the period's tax invoice;
   * closing with none chosen issues a new one.
   */
  openInvoices: OpenFeeInvoice[];
}

function periodOf(input: { periodStart: unknown; periodEnd: unknown }): { start: Date; end: Date } {
  const start = parseDay(input.periodStart);
  const end = parseDay(input.periodEnd);
  if (!start || !end) throw ledgerError("LEDGER_DATE_INVALID", "Choose the period's first and last day");
  if (end.getTime() < start.getTime()) {
    throw ledgerError("LEDGER_PERIOD_INVALID", "The period ends before it starts");
  }
  if (end.getTime() > today().getTime()) {
    throw ledgerError("LEDGER_PERIOD_FUTURE", "A period can only be settled once it has ended, up to today");
  }
  return { start, end };
}

/**
 * The figures of the owner's statement for a period, as the books take them:
 * the commission split by fee type, and the VAT on it only when the office is
 * VAT-registered.
 */
export async function previewSettlement(
  input: { ownerId: string; periodStart: unknown; periodEnd: unknown; agreementId?: string | null },
  actor: ScopeActor,
): Promise<SettlementPreview> {
  const [{ figures }, openInvoices] = await Promise.all([
    settlementFigures(input, actor),
    openOwnerFeeInvoices(input.ownerId),
  ]);
  return { ...figures, openInvoices };
}

/** The figures with the owner's name, which the statement already carries. */
async function settlementFigures(
  input: { ownerId: string; periodStart: unknown; periodEnd: unknown; agreementId?: string | null },
  actor: ScopeActor,
): Promise<{ figures: SettlementFigures; ownerName: string | null }> {
  const { start, end } = periodOf(input);
  const settings = await requireAccountingSettings();
  // A statement period runs from the first moment of its first day to the
  // last moment of its last.
  const endInstant = new Date(addDays(end, 1).getTime() - 1);
  const statement = await getOwnerStatement(input.ownerId, {
    actor,
    startDate: start,
    endDate: endInstant,
    agreementId: input.agreementId ?? undefined,
  });
  if (!statement) throw ledgerError("LEDGER_OWNER_NOT_FOUND", "Owner not found", 404);

  // Which part of the commission was a fixed fee — from the same commission
  // run the statement reads, over the same buildings and period.
  const properties = await db.property.findMany({
    where: { ownerId: input.ownerId },
    select: { id: true },
  });
  let fixed = 0;
  if (properties.length > 0 && statement.totals.commission > 0) {
    const full = await runCommission({
      propertyIds: properties.map((property) => property.id),
      ownerId: input.ownerId,
      startDate: start,
      endDate: endInstant,
    });
    const run = input.agreementId ? commissionUnderAgreement(full, input.agreementId) : full;
    fixed = round(
      run.byProperty
        .flatMap((entry) => entry.parts)
        .filter((part) => part.agreementKind === "management" && part.feeType === "fixed")
        .reduce((sum, part) => sum + part.commission, 0),
    );
  }
  const commissionTotal = statement.totals.commission;
  const managementFee = Math.min(fixed, commissionTotal);
  const vatRate = settings.vatRegistered ? COMMISSION_TAX_RATE : 0;
  const closing = settle({
    collected: statement.totals.rentCollected,
    collectedByOwner: statement.totals.collectedByOwner,
    expenses: statement.totals.expenses,
    commission: commissionTotal,
    commissionTaxRate: vatRate,
    investmentRent: statement.totals.investmentRent,
  });

  return {
    ownerName: statement.owner.name && statement.owner.name !== "—" ? statement.owner.name : null,
    figures: {
      ownerId: input.ownerId,
      agreementId: input.agreementId ?? null,
      periodStart: businessDay(start),
      periodEnd: businessDay(end),
      currency: statement.currency || DEFAULT_CURRENCY,
      collected: closing.collected,
      ownerReceivedDirect: closing.collectedByOwner,
      expenses: closing.expenses,
      commission: round(commissionTotal - managementFee),
      managementFee,
      commissionVat: closing.commissionTax,
      investmentRent: closing.investmentRent,
      netDue: round(closing.dueToOwner - closing.dueToOperator),
    },
  };
}

export interface CloseSettlementInput {
  ownerId: string;
  periodStart: unknown;
  periodEnd: unknown;
  agreementId?: string | null;
  notes?: string | null;
  /** An invoice the office already issued the owner, to stand as the tax invoice. */
  invoiceId?: string | null;
  /** Issue a new tax invoice although the owner has open ones. */
  newInvoice?: boolean;
}

/**
 * The settlements a period would overlap: the owner's, whatever agreement
 * either was settled under. Settled once with no agreement and once under
 * one, the same commission was taken twice.
 */
export function settlementOverlapWhere(input: { ownerId: string; start: Date; end: Date }) {
  return {
    ownerId: input.ownerId,
    status: "closed",
    periodStart: { lte: input.end },
    periodEnd: { gte: input.start },
  };
}

export async function closeSettlement(
  input: CloseSettlementInput,
  actor: ScopeActor,
  userId: string | null,
): Promise<{ id: string; journalNumber: number | null; invoiceId: string | null; invoiceNumber: string | null }> {
  const { start, end } = periodOf(input);
  const overlap = settlementOverlapWhere({ ownerId: input.ownerId, start, end });
  const refuseOverlap = () =>
    ledgerError(
      "LEDGER_SETTLEMENT_OVERLAP",
      "Part of this period is already settled for this owner. Cancel that settlement first.",
      409,
    );
  // Asked before the statement is built (it is slow), and again under the
  // settings lock, which two people settling the same owner at once share.
  if (await db.ownerSettlement.findFirst({ where: overlap, select: { id: true } })) {
    throw refuseOverlap();
  }
  const { figures, ownerName } = await settlementFigures(input, actor);
  const organizationId = requireOrgId();

  // The commission's tax invoice: issued here, or the one the office chose.
  const invoiced = settlementFeeTotal(figures) > 0 && (await settlementInvoicesAvailable());
  if (input.invoiceId && !invoiced) {
    throw ledgerError(
      "LEDGER_SETTLEMENT_NO_INVOICE",
      "This period has no commission to invoice, or the books cannot take the invoice yet",
      409,
    );
  }
  if (invoiced && !input.invoiceId && !input.newInvoice) {
    const open = await openOwnerFeeInvoices(input.ownerId);
    if (open.length > 0) {
      throw ledgerError(
        "LEDGER_SETTLEMENT_OPEN_INVOICE",
        `This owner has open invoices (${open.map((invoice) => invoice.invoiceNumber).join(", ")}). Choose the one that is this period's tax invoice, or issue a new one.`,
        409,
      );
    }
  }
  const settingsRow = await requireAccountingSettings();
  const vatRate = settingsRow.vatRegistered ? COMMISSION_TAX_RATE : 0;

  const run = (invoiceNumber: string | null) => withLedgerTransaction(async (tx, settings) => {
    if (await tx.ownerSettlement.findFirst({ where: overlap, select: { id: true } })) {
      throw refuseOverlap();
    }
    const day = openDayFor(end, settings.closedThrough);
    assertOpenDay(day, settings);
    const settlement = await tx.ownerSettlement.create({
      data: {
        organizationId,
        ownerId: input.ownerId,
        agreementId: input.agreementId ?? null,
        periodStart: start,
        periodEnd: end,
        collected: halalasToDecimal(toHalalas(figures.collected)),
        ownerReceivedDirect: halalasToDecimal(toHalalas(figures.ownerReceivedDirect)),
        commission: halalasToDecimal(toHalalas(figures.commission + figures.managementFee)),
        commissionVat: halalasToDecimal(toHalalas(figures.commissionVat)),
        expenses: halalasToDecimal(toHalalas(figures.expenses)),
        investmentRent: halalasToDecimal(toHalalas(figures.investmentRent)),
        netDue: halalasToDecimal(toHalalas(figures.netDue)),
        currency: figures.currency,
        notes: input.notes?.trim() || null,
        createdById: userId,
      },
      select: { id: true },
    });
    let invoice: LinkedFeeInvoice | null = null;
    if (invoiced) {
      const context = {
        organizationId,
        ownerId: input.ownerId,
        settlementId: settlement.id,
        day,
        periodStart: figures.periodStart,
        periodEnd: figures.periodEnd,
        currency: figures.currency,
        figures,
        vatRate,
        userId,
      };
      invoice = input.invoiceId
        ? await linkSettlementInvoice(tx, input.invoiceId, context)
        : await issueSettlementInvoice(tx, invoiceNumber!, context);
    }
    const plan = planSettlementClose({
      id: settlement.id,
      date: day,
      ownerId: input.ownerId,
      agreementId: input.agreementId ?? null,
      commission: figures.commission,
      managementFee: figures.managementFee,
      commissionVat: figures.commissionVat,
      investmentRent: figures.investmentRent,
      // The invoice books the commission and its VAT; the entry, the rest.
      invoiced: Boolean(invoice),
      sourceRef: invoice?.invoiceNumber ?? `${figures.periodStart} — ${figures.periodEnd}`,
    });
    if (!plan) return { id: settlement.id, journalNumber: null, invoice };
    const entry = await writeLedgerEntry(tx, settings, plan, userId);
    await tx.ownerSettlement.update({ where: { id: settlement.id }, data: { journalEntryId: entry.id } });
    return { id: settlement.id, journalNumber: entry.number, invoice };
  });
  // A new invoice takes the next number; taken meanwhile, the whole
  // settlement is tried again under the one after.
  const done =
    invoiced && !input.invoiceId
      ? await createWithInvoiceNumber(organizationId, SETTLEMENT_INVOICE_PREFIX, (number) => run(number))
      : await run(null);
  // The invoice and its deduction from the owner's balance post as documents.
  if (done.invoice) postAfterCommit("invoice", done.invoice.id, { userId });
  void recordActivity({
    action: AuditAction.CREATE,
    recordType: "owner_settlement",
    recordId: done.id,
    recordName: ownerName,
    after: settlementSnapshot({
      periodStart: start,
      periodEnd: end,
      collected: figures.collected,
      expenses: figures.expenses,
      commission: round(figures.commission + figures.managementFee),
      commissionVat: figures.commissionVat,
      investmentRent: figures.investmentRent,
      netDue: figures.netDue,
      notes: input.notes,
      journalNumber: done.journalNumber,
    }),
    details: done.invoice
      ? { invoiceId: done.invoice.id, invoiceNumber: done.invoice.invoiceNumber, linked: Boolean(input.invoiceId) }
      : undefined,
  });
  return {
    id: done.id,
    journalNumber: done.journalNumber,
    invoiceId: done.invoice?.id ?? null,
    invoiceNumber: done.invoice?.invoiceNumber ?? null,
  };
}

export async function reverseSettlement(
  id: string,
  userId: string | null,
  actor?: ScopeActor & { id: string },
): Promise<void> {
  const cancelled = await withLedgerTransaction(async (tx, settings) => {
    const settlement = await tx.ownerSettlement.findFirst({ where: { id } });
    if (!settlement) throw ledgerError("LEDGER_SETTLEMENT_NOT_FOUND", "Settlement not found", 404);
    if (settlement.status !== "closed") {
      throw ledgerError("LEDGER_ALREADY_REVERSED", "This settlement has already been cancelled", 409);
    }
    let reversal: { number: number; date: Date } | null = null;
    if (settlement.journalEntryId) {
      const entry = await tx.journalEntry.findFirst({
        where: { id: settlement.journalEntryId },
        select: { date: true },
      });
      const day = openDayFor(entry ? laterOf(entry.date, today()) : today(), settings.closedThrough);
      assertOpenDay(day, settings);
      const written = await reverseLedgerEntry(tx, settings, settlement.journalEntryId, day, {
        memo: null,
        createdById: userId,
      });
      reversal = { number: written.number, date: day };
    }
    // Its tax invoice: the deduction from the owner's balance is put back.
    const invoice = await releaseSettlementInvoice(
      tx,
      id,
      openDayFor(laterOf(settlement.periodEnd, today()), settings.closedThrough),
      userId,
    );
    await tx.ownerSettlement.update({ where: { id }, data: { status: "reversed" } });
    return { settlement, reversal, invoice };
  });
  const { settlement, reversal, invoice } = cancelled;
  if (invoice) {
    postAfterCommit("invoice", invoice.id, { userId });
    // An invoice the settlement issued itself is withdrawn the only way a tax
    // invoice can be: a credit note for all of it. One the office linked
    // stands, owed by the owner again.
    if (invoice.issuedBySettlement && actor) {
      try {
        const { creditWholeInvoice } = await import("@/lib/invoice/custom-invoice.service");
        await creditWholeInvoice(actor, invoice.id, "Settlement cancelled");
      } catch (error) {
        console.error(
          `Settlement ${id} was cancelled but its invoice ${invoice.invoiceNumber} could not be credited; credit it by hand`,
          error,
        );
      }
    }
  }
  void recordActivity({
    action: AuditAction.REVERSE,
    recordType: "owner_settlement",
    recordId: id,
    recordName: await ownerNameForAudit(settlement.ownerId),
    before: settlementSnapshot({
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
      collected: settlement.collected,
      expenses: settlement.expenses,
      commission: settlement.commission,
      commissionVat: settlement.commissionVat,
      investmentRent: settlement.investmentRent,
      netDue: settlement.netDue,
      status: "settled",
    }),
    after: {
      status: "reversed",
      ...(reversal
        ? { reversalNumber: journalNumberLabel(reversal.number), reversalDate: dayText(reversal.date) }
        : {}),
    },
    details: invoice ? { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber } : undefined,
  });
}

function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

export interface SettlementRow {
  id: string;
  ownerId: string;
  ownerName: string;
  agreementId: string | null;
  periodStart: string;
  periodEnd: string;
  collected: number;
  ownerReceivedDirect: number;
  commission: number;
  commissionVat: number;
  expenses: number;
  investmentRent: number;
  netDue: number;
  status: string;
  journalEntryId: string | null;
  /** The period's tax invoice, once settlements carry one. */
  invoiceId: string | null;
  invoiceNumber: string | null;
  createdAt: string;
}

export async function listSettlements(options: { ownerId?: string | null; page: number; limit: number }) {
  const filters = options.ownerId ? { ownerId: options.ownerId } : {};
  const [rows, total] = await Promise.all([
    db.ownerSettlement.findMany({
      where: filters,
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
      skip: (options.page - 1) * options.limit,
      take: options.limit,
    }),
    db.ownerSettlement.count({ where: filters }),
  ]);
  const [names, invoices] = await Promise.all([
    ownerNames(rows.map((row) => row.ownerId)),
    settlementInvoiceNumbers(rows.map((row) => row.id)),
  ]);
  return {
    total,
    rows: rows.map(
      (row): SettlementRow => ({
        id: row.id,
        ownerId: row.ownerId,
        ownerName: names.get(row.ownerId)?.name ?? "—",
        agreementId: row.agreementId,
        periodStart: businessDay(row.periodStart),
        periodEnd: businessDay(row.periodEnd),
        collected: Number(row.collected),
        ownerReceivedDirect: Number(row.ownerReceivedDirect),
        commission: Number(row.commission),
        commissionVat: Number(row.commissionVat),
        expenses: Number(row.expenses),
        investmentRent: Number(row.investmentRent),
        netDue: Number(row.netDue),
        status: row.status,
        journalEntryId: row.journalEntryId,
        invoiceId: invoices.get(row.id)?.id ?? null,
        invoiceNumber: invoices.get(row.id)?.invoiceNumber ?? null,
        createdAt: row.createdAt.toISOString(),
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

export interface PayoutInput {
  ownerId: string;
  amount: unknown;
  date: unknown;
  bankAccountId: string;
  reference?: string | null;
  notes?: string | null;
}

export async function createPayout(input: PayoutInput, userId: string | null): Promise<{ id: string; journalNumber: number }> {
  const day = parseDay(input.date);
  if (!day) throw ledgerError("LEDGER_DATE_INVALID", "The date is not valid");
  const amount = parseAmount(input.amount as string | number | null);
  if (amount === null || Number.isNaN(amount) || amount <= 0) {
    throw ledgerError("LEDGER_INVALID_AMOUNT", "The amount must be above zero, with at most two decimals");
  }
  const owner = await db.user.findFirst({
    where: { id: input.ownerId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!owner) throw ledgerError("LEDGER_OWNER_NOT_FOUND", "Owner not found", 404);
  const organizationId = requireOrgId();

  const done = await withLedgerTransaction(async (tx, settings) => {
    assertOpenDay(day, settings);
    const bank = await tx.bankAccount.findFirst({
      where: { id: input.bankAccountId },
      select: {
        id: true,
        name: true,
        ledgerAccountId: true,
        active: true,
        ledgerAccount: { select: { nameAr: true, nameEn: true } },
      },
    });
    if (!bank) throw ledgerError("LEDGER_BANK_NOT_FOUND", "Bank account not found", 404);
    if (!bank.active) throw ledgerError("LEDGER_BANK_INACTIVE", "That account is inactive");
    const payout = await tx.ownerPayout.create({
      data: {
        organizationId,
        ownerId: input.ownerId,
        amount: halalasToDecimal(amount),
        date: day,
        bankAccountId: bank.id,
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        createdById: userId,
      },
      select: { id: true },
    });
    const plan = planOwnerPayout({
      id: payout.id,
      date: day,
      ownerId: input.ownerId,
      amount: amount / 100,
      paidFromAccountId: bank.ledgerAccountId,
      sourceRef: input.reference?.trim() || null,
      memo: input.notes?.trim() || null,
    });
    if (!plan) throw ledgerError("LEDGER_INVALID_AMOUNT", "The amount must be above zero");
    const entry = await writeLedgerEntry(tx, settings, plan, userId);
    await tx.ownerPayout.update({ where: { id: payout.id }, data: { journalEntryId: entry.id } });
    return { id: payout.id, journalNumber: entry.number, bankAccount: bankAccountLabel(bank) };
  });
  void recordActivity({
    action: AuditAction.CREATE,
    recordType: "owner_payout",
    recordId: done.id,
    recordName: personName(owner),
    after: payoutSnapshot({
      amount: amount / 100,
      date: day,
      bankAccount: done.bankAccount,
      reference: input.reference,
      notes: input.notes,
      journalNumber: done.journalNumber,
    }),
  });
  return { id: done.id, journalNumber: done.journalNumber };
}

export async function reversePayout(id: string, userId: string | null): Promise<void> {
  const cancelled = await withLedgerTransaction(async (tx, settings) => {
    const payout = await tx.ownerPayout.findFirst({
      where: { id },
      include: { bankAccount: { select: { name: true, ledgerAccount: { select: { nameAr: true, nameEn: true } } } } },
    });
    if (!payout) throw ledgerError("LEDGER_PAYOUT_NOT_FOUND", "Payout not found", 404);
    if (payout.status !== "posted" || !payout.journalEntryId) {
      throw ledgerError("LEDGER_ALREADY_REVERSED", "This payout has already been cancelled", 409);
    }
    const day = openDayFor(laterOf(payout.date, today()), settings.closedThrough);
    assertOpenDay(day, settings);
    const reversal = await reverseLedgerEntry(tx, settings, payout.journalEntryId, day, {
      memo: null,
      createdById: userId,
    });
    await tx.ownerPayout.update({ where: { id }, data: { status: "reversed" } });
    return { payout, reversal: { number: reversal.number, date: day } };
  });
  const { payout, reversal } = cancelled;
  void recordActivity({
    action: AuditAction.REVERSE,
    recordType: "owner_payout",
    recordId: id,
    recordName: await ownerNameForAudit(payout.ownerId),
    before: payoutSnapshot({
      amount: payout.amount,
      date: payout.date,
      bankAccount: bankAccountLabel(payout.bankAccount),
      reference: payout.reference,
      notes: payout.notes,
      status: "posted",
    }),
    after: {
      status: "reversed",
      reversalNumber: journalNumberLabel(reversal.number),
      reversalDate: dayText(reversal.date),
    },
  });
}

export interface PayoutRow {
  id: string;
  ownerId: string;
  ownerName: string;
  amount: number;
  date: string;
  bankAccount: { id: string; name: string; ledgerAccountName: { ar: string; en: string } };
  reference: string | null;
  notes: string | null;
  status: string;
  journalEntryId: string | null;
}

export async function listPayouts(options: { ownerId?: string | null; page: number; limit: number }) {
  const filters = options.ownerId ? { ownerId: options.ownerId } : {};
  const [rows, total] = await Promise.all([
    db.ownerPayout.findMany({
      where: filters,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (options.page - 1) * options.limit,
      take: options.limit,
      include: {
        bankAccount: { select: { id: true, name: true, ledgerAccount: { select: { nameAr: true, nameEn: true } } } },
      },
    }),
    db.ownerPayout.count({ where: filters }),
  ]);
  const names = await ownerNames(rows.map((row) => row.ownerId));
  return {
    total,
    rows: rows.map(
      (row): PayoutRow => ({
        id: row.id,
        ownerId: row.ownerId,
        ownerName: names.get(row.ownerId)?.name ?? "—",
        amount: Number(row.amount),
        date: businessDay(row.date),
        bankAccount: {
          id: row.bankAccount.id,
          name: row.bankAccount.name,
          ledgerAccountName: { ar: row.bankAccount.ledgerAccount.nameAr, en: row.bankAccount.ledgerAccount.nameEn },
        },
        reference: row.reference,
        notes: row.notes,
        status: row.status,
        journalEntryId: row.journalEntryId,
      }),
    ),
  };
}
