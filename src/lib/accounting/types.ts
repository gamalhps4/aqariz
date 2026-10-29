/**
 * PropertyPro - Ledger vocabulary
 *
 * The closed sets the ledger tables store as strings (the schema keeps status
 * and kind columns as String, see prisma/schema.prisma), and the shapes the
 * posting rules hand to the posting service. Pure: the screens import these
 * too.
 */

import type { Halalas } from "./money";
import type { SystemKey } from "./system-keys";

export const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const NORMAL_SIDES = ["debit", "credit"] as const;
export type NormalSide = (typeof NORMAL_SIDES)[number];

/** Whose account a line is kept in — the sub-ledger it belongs to. */
export const PARTY_TYPES = ["tenant", "owner", "supplier", "customer"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const ENTRY_STATUSES = ["posted", "reversed"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/**
 * What an entry was posted from. The first group follow a document of the
 * app and are kept in step with it by the posting service; the rest are
 * written through the ledger's own screens.
 */
export const DOCUMENT_SOURCE_TYPES = [
  "invoice",
  "invoice_settlement",
  "payment",
  "payment_refund",
  "expense",
  "deposit_receipt",
  "deposit_settlement",
  // Purchases and payments (migration 20261004190000_purchases).
  "purchase_bill",
  "payment_voucher",
] as const;
export type DocumentSourceType = (typeof DOCUMENT_SOURCE_TYPES)[number];

export const LEDGER_SOURCE_TYPES = [
  "manual",
  "opening_balance",
  "bank_transfer",
  "owner_settlement",
  "owner_payout",
] as const;
export type LedgerSourceType = (typeof LEDGER_SOURCE_TYPES)[number];

export type SourceType = DocumentSourceType | LedgerSourceType;

export const SOURCE_TYPES: readonly SourceType[] = [
  ...DOCUMENT_SOURCE_TYPES,
  ...LEDGER_SOURCE_TYPES,
];

export function isDocumentSourceType(value: unknown): value is DocumentSourceType {
  return (
    typeof value === "string" &&
    (DOCUMENT_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * How a line stands for VAT, for the VAT return built on top of the ledger:
 * S standard-rated (15%), Z zero-rated, E exempt (residential rent), O out of
 * scope (money that is not the office's own supply — an owner's rent, a
 * deposit).
 */
export const VAT_CODES = ["S", "Z", "E", "O"] as const;
export type VatCode = (typeof VAT_CODES)[number];

export function isVatCode(value: unknown): value is VatCode {
  return typeof value === "string" && (VAT_CODES as readonly string[]).includes(value);
}

export const BANK_ACCOUNT_KINDS = ["bank", "cash", "pos", "gateway_clearing"] as const;
export type BankAccountKind = (typeof BANK_ACCOUNT_KINDS)[number];

/**
 * Whose building a document belongs to, which decides whose money it is:
 * an owner's (the office holds it for them), the office's own, or one the
 * office has taken on under an investment agreement (its rent is the
 * office's, and the owner is owed the agreed investment rent instead).
 */
export type Ownership = "owner" | "office" | "investment";

/**
 * Who holds a tenant's security deposit on an owner's building: the owner
 * (it is passed on with the rent, as the owner statement counts it) or the
 * office (kept as a liability until it is refunded or deducted). On the
 * office's own buildings the office always holds it.
 */
export const DEPOSIT_HOLDERS = ["owner", "office"] as const;
export type DepositHolder = (typeof DEPOSIT_HOLDERS)[number];

/** A line's account: by the job it does (resolved through the map) or by id. */
export type AccountRef = { key: SystemKey } | { id: string };

export interface PlannedLine {
  account: AccountRef;
  debit: Halalas;
  credit: Halalas;
  partyType?: PartyType | null;
  partyId?: string | null;
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  agreementId?: string | null;
  vatCode?: VatCode | null;
  memo?: string | null;
}

/** One journal entry as a rule wants it written. */
export interface PostingPlan {
  sourceType: SourceType;
  /** The document's id; null for an entry that follows no document. */
  sourceId: string | null;
  /** What the screens show for the document — an invoice or payment number. */
  sourceRef?: string | null;
  /** The calendar day the entry belongs to (midnight UTC). */
  date: Date;
  memo?: string | null;
  lines: PlannedLine[];
}
