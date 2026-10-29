/**
 * PropertyPro - Owner client types
 *
 * Mirrors `/api/owners` and `/api/owners/[id]/statement`. Kept out of the
 * service modules so client components do not pull the Prisma client into the
 * browser bundle through a type import.
 */

export interface OwnerSummary {
  /** The user id — an owner's identity everywhere, profile or not. */
  userId: string;
  /** Null when this owner has no profile row yet. That is a valid state. */
  ownerProfileId: string | null;
  name: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  isActive: boolean;
  /** True when the owner is the signed-in user — a self-managing landlord. */
  isSelf: boolean;
  /**
   * True for an owner account the office keeps for a client. False for a
   * member of staff who owns buildings: their name and email are their
   * sign-in, edited under Employees rather than here.
   */
  isOwnerAccount: boolean;
  propertyCount: number;
  unitCount: number;
  occupiedUnits: number;
  occupancyRate: number;
  activeLeases: number;
  monthlyRent: number;
  outstandingBalance: number;
}

export interface OwnerProfileFields {
  id: string;
  companyName: string | null;
  nationalId: string | null;
  taxNumber: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressDistrict: string | null;
  addressCountry: string | null;
  payoutMethod: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankIban: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface OwnerProperty {
  id: string;
  name: string;
  type: string;
  status: string;
  city: string;
  totalUnits: number;
  compoundName: string | null;
}

export interface OwnerDetail extends OwnerSummary {
  profile: OwnerProfileFields | null;
  properties: OwnerProperty[];
}

/** One contract on the owner's buildings, as the statement lists them. */
export interface StatementContractRow {
  leaseId: string;
  date: string;
  contractNumber: string | null;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  durationMonths: number;
  /** What the contract bills over its whole term. */
  contractTotal: number;
  /** Still owed at the end of the period. */
  due: number;
  /** Received in the period. */
  paid: number;
  item: string;
  notes: string;
}

/**
 * One payment received in the period, laid out as the statement the client
 * reconciles against lists them: التاريخ، المستأجر، الوحدة، العقد، دورة
 * الإيجار، إجمالي العقد، المستلم، المبلغ، ملاحظة، السند. Each payment is its
 * own row — the client asked for every payment, its note and its date, not a
 * total per contract.
 */
export interface StatementPaymentRow {
  paymentId: string;
  /** التاريخ — when the money was received. */
  date: string;
  /** المستأجر */
  tenantName: string;
  propertyId: string;
  propertyName: string;
  /** The unit its contract is written on; null without a contract. */
  unitId: string | null;
  /** الوحدة — the unit within the building; null without a contract. */
  unitNumber: string | null;
  leaseId: string | null;
  /** العقد */
  contractNumber: string | null;
  /** دورة الإيجار — the contract's payment frequency ("monthly"). */
  frequency: string | null;
  /** إجمالي العقد — what the contract bills over its whole term. */
  contractTotal: number | null;
  /** المستلم — who the money reached (see OWNER_RECEIVED_METHODS). */
  receivedBy: "owner" | "office";
  paymentMethod: string | null;
  /** "rent", "security_deposit"… — only rent is charged commission. */
  paymentType: string;
  /** المبلغ */
  amount: number;
  currency: string;
  /** ملاحظة — what the office typed when recording it. */
  notes: string | null;
  /** السند — the receipt number (lib/payments/receipt-number.ts). */
  receiptNumber: string;
}

/** One expense deducted from the owner's share. */
export interface StatementExpenseRow {
  expenseId: string;
  date: string;
  propertyId: string | null;
  /** The unit it was spent on; null for the building's own. */
  unitId: string | null;
  propertyName: string;
  category: string;
  description: string;
  /** The supplier's invoice or the office's own expense number. */
  reference: string | null;
  amount: number;
}

/**
 * Who issued the statement: the office's name, commercial registration and
 * logo, from the same branding the PDF letterhead is drawn from.
 */
export interface StatementLetterhead {
  companyName: string;
  commercialRegistration: string | null;
  taxNumber: string | null;
  logoUrl: string | null;
}

export interface OwnerStatementTotals {
  /** إجمالي المحصل — everything received, deposits and VAT included. */
  rentCollected: number;
  rentBilled: number;
  outstanding: number;
  expenses: number;
  /**
   * What the commission was charged on: rent, before VAT (see
   * lib/statements/commission-base.ts).
   */
  commissionBase: number;
  commission: number;
  /** VAT on the commission, charged at `commissionTaxRate`. */
  commissionTax: number;
  commissionTaxRate: number;
  /**
   * Fixed rent the office owes the owner for buildings it has taken on
   * under an investment agreement.
   */
  investmentRent: number;
  /** Rent that reached the owner's own hands without passing the office. */
  collectedByOwner: number;
  collectedByOperator: number;
  /** collected − expenses − commission − VAT + investment rent. */
  ownerShare: number;
  /** Exactly one of these two carries a figure. */
  dueToOwner: number;
  dueToOperator: number;
}

export interface OwnerStatement {
  owner: {
    userId: string;
    name: string;
    email: string | null;
    companyName: string | null;
    isSelf: boolean;
  };
  period: { startDate: string; endDate: string };
  currency: string;
  propertyCount: number;
  /** "none" when no management agreement applied — including every landlord. */
  commissionSource: "none" | "agreements";
  /**
   * The one percentage every management agreement in the statement charges —
   * printed in the summary's commission label ("عمولة الإدارة 2%") and
   * nowhere else. Null for a flat fee, or when agreements differ.
   */
  commissionPercentage: number | null;
  totals: OwnerStatementTotals;
  /** Every payment received in the period. */
  payments: StatementPaymentRow[];
  /** Every expense deducted in the period. */
  expenses: StatementExpenseRow[];
  /** The rent roll — one row per contract on the owner's buildings. */
  contracts: StatementContractRow[];
  byProperty: Array<{
    propertyId: string;
    propertyName: string;
    rentCollected: number;
    collectedByOwner: number;
    expenses: number;
    commission: number;
    commissionTax: number;
    investmentRent: number;
    /** This building's part of what the owner keeps. */
    ownerShare: number;
  }>;
  /** Sent by the statement routes; absent when the office has no branding. */
  letterhead?: StatementLetterhead | null;
}
