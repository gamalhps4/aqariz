/**
 * PropertyPro - Posting an installment (an invoice falling due)
 *
 * An installment is posted on its due date: the day it is owed and the day
 * the rent period it covers begins — the same day the owner statement counts
 * rent as billed. (Rent paid before that day sits as a credit on the tenant's
 * account until it is due, which is what rent received in advance is.)
 *
 * Whose money it is decides the credit:
 *
 *  - An owner's building: the whole installment, VAT included, is the
 *    owner's. The owner is the one supplying the rent and accounts for any
 *    VAT on it; the office only holds the money for them. Until it is
 *    collected it sits in "owners' uncollected rent", the counterpart of the
 *    tenant's debt:
 *        Dr tenant receivable / Cr owners' uncollected rent
 *  - The office's own building, or one it holds under an investment
 *    agreement: the rent is the office's income, any VAT on it is the
 *    office's output VAT, and other charges (utilities, fees) are other
 *    income:
 *        Dr tenant receivable / Cr rent income, other income, output VAT
 *
 * A security deposit is never income. On the office's buildings, or where
 * the office keeps deposits itself, it is held as a liability to the tenant;
 * on an owner's building whose deposits go to the owner it is the owner's,
 * like the rent.
 *
 * Pure: the posting service gathers the facts and hands them in.
 */

import {
  allocateProportionally,
  proportionOf,
  toHalalas,
  type Halalas,
} from "../money";
import type { DepositHolder, Ownership, PartyType, PostingPlan, VatCode } from "../types";
import type { SystemKey } from "../system-keys";
import { credit, debit, finishPlan } from "./common";
import { receiptAccountKey } from "./methods";

export const DEPOSIT_TYPES: ReadonlySet<string> = new Set([
  "security_deposit",
  "pet_deposit",
]);

const RENT_TYPES: ReadonlySet<string> = new Set(["rent", "pet_rent"]);

export type ChargeKind = "rent" | "deposit" | "other";

/** What a line, a payment or an invoice category is a charge for. */
export function chargeKind(type: string | null | undefined): ChargeKind {
  const value = (type ?? "").trim().toLowerCase();
  if (DEPOSIT_TYPES.has(value)) return "deposit";
  if (RENT_TYPES.has(value)) return "rent";
  return "other";
}

/**
 * Whose money a charge is, once collected: the owner's, or the office's
 * (its income, its VAT, or a deposit it holds).
 */
export function chargeBeneficiary(
  kind: ChargeKind,
  ownership: Ownership,
  depositHolder: DepositHolder,
): "owner" | "office" {
  if (ownership !== "owner") return "office";
  return kind === "deposit" && depositHolder === "office" ? "office" : "owner";
}

export interface InvoiceLineInput {
  type: string | null;
  amount: number;
}

export interface InvoiceDoc {
  id: string;
  number?: string | null;
  /** The due day. */
  date: Date;
  category?: string | null;
  total: number;
  tax: number;
  lines: readonly InvoiceLineInput[];
  tenantId: string;
  /** The building's owner; the party of the owner's lines. */
  ownerId: string | null;
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  ownership: Ownership;
  depositHolder: DepositHolder;
  /**
   * Whose receivable it is: a tenant's (every installment today) or a
   * customer's — an invoice raised to someone who rents nothing.
   */
  receivable?: "tenant" | "customer";
}

/**
 * The day an invoice posts on: an installment on its due day (the day it is
 * owed, as the owner statement counts it); a custom invoice or a credit note,
 * written line by line, on the day it was issued, its tax point. The VAT
 * summary dates invoices by the same rule, so it and the ledger's VAT return
 * agree for any period.
 */
export function invoicePostingDate(
  invoice: { issueDate: Date; dueDate: Date },
  lined: boolean,
): Date {
  return lined ? invoice.issueDate : invoice.dueDate;
}

/** An invoice split by whose money each part of it is, in halalas. */
export interface InvoiceSplit {
  total: Halalas;
  /** The owner's part, VAT included. */
  owner: Halalas;
  /** The office's rent income, before VAT. */
  officeRent: Halalas;
  /** The office's other income (utilities, fees), before VAT. */
  officeOther: Halalas;
  /** Deposits the office holds. */
  officeDeposit: Halalas;
  /** VAT on the office's own income. */
  officeVat: Halalas;
}

const EMPTY_SPLIT: InvoiceSplit = {
  total: 0,
  owner: 0,
  officeRent: 0,
  officeOther: 0,
  officeDeposit: 0,
  officeVat: 0,
};

/**
 * Split an invoice by whose money each part of it is.
 *
 * The total is what is owed; VAT is its own figure on the invoice and the
 * rest is shared over the lines in proportion to what each line bills (so a
 * discount falls on every line alike). VAT is shared over the lines that are
 * not deposits — a deposit carries none.
 */
export function splitInvoice(
  doc: Pick<InvoiceDoc, "total" | "tax" | "lines" | "category" | "ownership" | "depositHolder">,
): InvoiceSplit {
  const total = toHalalas(doc.total);
  if (total <= 0) return { ...EMPTY_SPLIT };
  const tax = Math.min(Math.max(toHalalas(doc.tax), 0), total);
  const net = total - tax;

  let lines = doc.lines
    .map((line) => ({
      kind: chargeKind(line.type ?? doc.category),
      weight: Math.max(0, Number(line.amount) || 0),
    }))
    .filter((line) => line.weight > 0);
  if (lines.length === 0) {
    lines = [{ kind: chargeKind(doc.category), weight: 1 }];
  }

  const netParts = allocateProportionally(
    net,
    lines.map((line) => line.weight),
  );
  const taxable = lines.some((line) => line.kind !== "deposit");
  const taxParts = allocateProportionally(
    tax,
    lines.map((line) => (!taxable || line.kind !== "deposit" ? line.weight : 0)),
  );

  const split: InvoiceSplit = { ...EMPTY_SPLIT, total };
  lines.forEach((line, index) => {
    const lineNet = netParts[index];
    const lineTax = taxParts[index];
    const beneficiary = chargeBeneficiary(line.kind, doc.ownership, doc.depositHolder);
    if (beneficiary === "owner") {
      split.owner += lineNet + lineTax;
    } else if (line.kind === "deposit") {
      split.officeDeposit += lineNet + lineTax;
    } else {
      if (line.kind === "rent") split.officeRent += lineNet;
      else split.officeOther += lineNet;
      split.officeVat += lineTax;
    }
  });
  return split;
}

/** The owner's part of an amount collected against an invoice. */
export function ownerShareOf(split: InvoiceSplit, collected: Halalas): Halalas {
  return proportionOf(collected, split.owner, split.total);
}

export function planInvoice(doc: InvoiceDoc): PostingPlan | null {
  const split = splitInvoice(doc);
  if (split.total <= 0) return null;

  const dims = {
    propertyId: doc.propertyId ?? null,
    unitId: doc.unitId ?? null,
    leaseId: doc.leaseId ?? null,
  };
  const customer = doc.receivable === "customer";
  const tenantParty = {
    partyType: (customer ? "customer" : "tenant") as PartyType,
    partyId: doc.tenantId,
  };
  const ownerParty = doc.ownerId
    ? { partyType: "owner" as PartyType, partyId: doc.ownerId }
    : {};
  // Residential rent is exempt in Saudi Arabia; an installment that carries
  // VAT is a standard-rated supply.
  const incomeVat: VatCode = split.officeVat > 0 ? "S" : "E";
  const rentKey =
    doc.ownership === "investment" ? "investment_rent_income" : "rent_income";

  return finishPlan({
    sourceType: "invoice",
    sourceId: doc.id,
    sourceRef: doc.number ?? null,
    date: doc.date,
    lines: [
      debit(customer ? "customer_receivables" : "tenant_receivables", split.total, {
        ...tenantParty,
        ...dims,
      }),
      credit("owner_uncollected_rent", split.owner, {
        ...ownerParty,
        ...dims,
        vatCode: "O",
      }),
      credit("security_deposits", split.officeDeposit, {
        ...tenantParty,
        ...dims,
        vatCode: "O",
      }),
      credit(rentKey, split.officeRent, { ...dims, vatCode: incomeVat }),
      credit("other_income", split.officeOther, { ...dims, vatCode: incomeVat }),
      credit("output_vat", split.officeVat, { ...dims, vatCode: "S" }),
    ],
  });
}

// ---------------------------------------------------------------------------
// An invoice written line by line (accounting phase 0)
// ---------------------------------------------------------------------------

/**
 * One line of a custom invoice or a credit note, as invoice_lines stores it:
 * after the invoice's discount, signed (a credit note's lines are negative).
 */
export interface LinedInvoiceLine {
  /** The charge (InvoiceType): rent, management_fee, maintenance, … */
  category: string | null;
  net: number;
  vat: number;
  /** The line's own treatment. */
  vatCategory: VatCode;
}

/** Whose receivable an invoice is, and in which account it is kept. */
export interface InvoiceReceivable {
  account: "tenant_receivables" | "customer_receivables";
  partyType: PartyType;
  partyId: string;
}

export interface LinedInvoiceDoc {
  id: string;
  number?: string | null;
  /** The day it was issued: a tax invoice's (and a credit note's) date. */
  date: Date;
  lines: readonly LinedInvoiceLine[];
  receivable: InvoiceReceivable;
  /** The building's owner, for an invoice on an owner's building. */
  ownerId: string | null;
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  /** Whose building; "office" for an invoice filed under no building. */
  ownership: Ownership;
  depositHolder: DepositHolder;
}

/**
 * The line category of the office's commission charged as a percentage of
 * rent, on its tax invoice to an owner (a fixed fee is "management_fee").
 */
export const COMMISSION_LINE_CATEGORY = "commission";

/** The office's income account for what a line charges. */
function incomeKeyFor(kind: ChargeKind, category: string | null, ownership: Ownership): SystemKey {
  if (kind === "rent") return ownership === "investment" ? "investment_rent_income" : "rent_income";
  switch ((category ?? "").trim().toLowerCase()) {
    case "management_fee":
      return "management_fee_income";
    case COMMISSION_LINE_CATEGORY:
      return "commission_income";
    default:
      return "other_income";
  }
}

/**
 * A custom invoice or a credit note, line by line.
 *
 * Each line goes where its money belongs, as an installment's does (an
 * owner's building's charges are the owner's, deposits are held) — but with
 * the line's own VAT treatment rather than one for the whole invoice, so the
 * VAT return finds standard-rated, zero-rated and exempt sales apart. A
 * credit note's negative lines turn every side around: income and output VAT
 * are debited and the receivable credited.
 *
 * Posted on the day it was issued: an invoice to an owner or a customer is
 * the office's tax invoice, whose date is its tax point.
 */
export function planLinedInvoice(doc: LinedInvoiceDoc): PostingPlan | null {
  const dims = {
    propertyId: doc.propertyId ?? null,
    unitId: doc.unitId ?? null,
    leaseId: doc.leaseId ?? null,
  };
  const receivableParty = { partyType: doc.receivable.partyType, partyId: doc.receivable.partyId };
  const ownerParty = doc.ownerId ? { partyType: "owner" as PartyType, partyId: doc.ownerId } : {};

  let total = 0;
  const credits = doc.lines.flatMap((line) => {
    const net = toHalalas(line.net);
    const vat = toHalalas(line.vat);
    total += net + vat;
    const kind = chargeKind(line.category);
    const beneficiary = chargeBeneficiary(kind, doc.ownership, doc.depositHolder);
    if (beneficiary === "owner") {
      return [credit("owner_uncollected_rent", net + vat, { ...ownerParty, ...dims, vatCode: "O" })];
    }
    if (kind === "deposit") {
      return [credit("security_deposits", net + vat, { ...receivableParty, ...dims, vatCode: "O" })];
    }
    return [
      credit(incomeKeyFor(kind, line.category, doc.ownership), net, { ...dims, vatCode: line.vatCategory }),
      credit("output_vat", vat, { ...dims, vatCode: "S" }),
    ];
  });
  if (total === 0) return null;

  return finishPlan({
    sourceType: "invoice",
    sourceId: doc.id,
    sourceRef: doc.number ?? null,
    date: doc.date,
    lines: [debit(doc.receivable.account, total, { ...receivableParty, ...dims }), ...credits],
  });
}

/**
 * An owner's invoice paid out of what the office holds for them — the
 * commission on its tax invoice, deducted when the period is settled.
 */
export const OWNER_BALANCE_METHOD = "owner_balance";

/**
 * Money an owner or a customer paid on their invoice (kept on the invoice
 * itself: they have no tenant record for a payment row to hang on).
 *     Dr cash / bank / POS (by method) / Cr their receivable
 * Paid from the owner's balance, the money never moves:
 *     Dr owners' payable / Cr the owner's receivable
 * A negative amount is money going back — a refund paid to the customer, or
 * a deduction undone when its settlement is cancelled — and turns the entry
 * around.
 */
export function planInvoiceSettlement(doc: {
  /** `<invoice id>:<n>`, the n-th settlement recorded on it. */
  id: string;
  number?: string | null;
  date: Date;
  amount: number;
  method: string | null;
  receivable: InvoiceReceivable;
}): PostingPlan | null {
  const amount = toHalalas(doc.amount);
  if (amount === 0) return null;
  const party = { partyType: doc.receivable.partyType, partyId: doc.receivable.partyId };
  const fromOwner = doc.method === OWNER_BALANCE_METHOD && doc.receivable.partyType === "owner";
  return finishPlan({
    sourceType: "invoice_settlement",
    sourceId: doc.id,
    sourceRef: doc.number ?? null,
    date: doc.date,
    lines: [
      fromOwner
        ? debit("owner_payable", amount, { partyType: "owner", partyId: doc.receivable.partyId })
        : debit(receiptAccountKey(doc.method), amount),
      credit(doc.receivable.account, amount, party),
    ],
  });
}
