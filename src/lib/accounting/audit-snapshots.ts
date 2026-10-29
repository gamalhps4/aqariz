/**
 * PropertyPro - What the books' activity entries say
 *
 * The values an activity entry keeps about a ledger account, a bank account, a
 * journal, an owner's payout or settlement, a transfer, the period lock and
 * the accounting settings — the same shapes whichever service writes the entry,
 * so the log reads alike. Pure: no database, no server-only import; the
 * services call these after the write, the tests read them directly.
 *
 * Rules the shapes keep (the Arabic office reads this log):
 *  - a name is what the screens call the record, never words made up here;
 *  - an account number or IBAN keeps its last four digits at most;
 *  - money is a number of riyals, a day is `YYYY-MM-DD`;
 *  - a field a reader would not look for (ids, bookkeeping) is left out.
 */

import { AuditSeverity } from "@/lib/audit/vocabulary";

const text = (value: string | null | undefined): string => (value ?? "").trim();

/** `YYYY-MM-DD` for a day, or null for no day. */
export function dayText(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Halalas (or a numeric(14,2) value) as riyals, for an entry. */
export function riyals(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

/**
 * An account number as an entry keeps it: its last four digits when it is long
 * enough for those to say little, else only that one is set. Null for none.
 */
export function maskTail(value: string | null | undefined, keep = 4): string | null {
  const compact = text(value).replace(/\s+/g, "");
  if (!compact) return null;
  return compact.length > keep * 2 ? `••••${compact.slice(-keep)}` : "••••";
}

/** The number a journal is known by on the screens ("#12"). */
export function journalNumberLabel(number: number | null | undefined): string | null {
  return typeof number === "number" && Number.isFinite(number) ? `#${number}` : null;
}

/**
 * A ledger account as its entry names it: the code and the name. The Arabic
 * name leads — the office keeps its books in Arabic — and the English one
 * stands in when the Arabic is empty.
 */
export function ledgerAccountName(account: {
  code: string;
  nameAr?: string | null;
  nameEn?: string | null;
}): string {
  const name = text(account.nameAr) || text(account.nameEn);
  return name ? `${account.code} - ${name}` : account.code;
}

/**
 * A bank or cash account as the screens name it: its own name, or — for the
 * standard accounts, which start unnamed — its ledger account's.
 */
export function bankAccountLabel(bank: {
  name?: string | null;
  ledgerAccount?: { nameAr?: string | null; nameEn?: string | null } | null;
}): string | null {
  return (
    text(bank.name) ||
    text(bank.ledgerAccount?.nameAr) ||
    text(bank.ledgerAccount?.nameEn) ||
    null
  );
}

/** Two accounts of a transfer, as one name: neither arrow direction survives right-to-left text. */
export function transferName(
  from: string | null | undefined,
  to: string | null | undefined,
): string | null {
  const parts = [text(from), text(to)].filter(Boolean);
  return parts.length ? parts.join(" - ") : null;
}

/** A person's name from the parts of a user row. */
export function personName(
  person: { firstName?: string | null; lastName?: string | null } | null | undefined,
): string | null {
  const name = [text(person?.firstName), text(person?.lastName)].filter(Boolean).join(" ");
  return name || null;
}

// ---------------------------------------------------------------------------
// Ledger accounts
// ---------------------------------------------------------------------------

export interface LedgerAccountValues {
  code: string;
  nameAr: string;
  nameEn: string;
  type: string;
  normalSide: string;
  postable: boolean;
  active?: boolean;
  description?: string | null;
}

/** The fields of a chart account an entry compares. */
export const LEDGER_ACCOUNT_KEYS = [
  "code",
  "nameAr",
  "nameEn",
  "accountType",
  "normalSide",
  "parentAccount",
  "postable",
  "isActive",
] as const;

export function ledgerAccountSnapshot(
  account: LedgerAccountValues,
  parentLabel: string | null,
): Record<string, unknown> {
  return {
    code: account.code,
    nameAr: account.nameAr,
    nameEn: account.nameEn,
    accountType: account.type,
    normalSide: account.normalSide,
    parentAccount: parentLabel,
    postable: account.postable,
    ...(account.active === undefined ? {} : { isActive: account.active }),
    ...(text(account.description) ? { description: text(account.description) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Bank and cash accounts
// ---------------------------------------------------------------------------

export interface BankAccountValues {
  name: string;
  kind: string;
  bankName?: string | null;
  iban?: string | null;
  accountNumber?: string | null;
  currency?: string | null;
  notes?: string | null;
  active?: boolean;
}

export const BANK_ACCOUNT_KEYS = [
  "name",
  "bankKind",
  "bankName",
  "iban",
  "accountNumber",
  "currency",
  "ledgerAccount",
  "notes",
  "isActive",
] as const;

export function bankAccountSnapshot(
  bank: BankAccountValues,
  ledgerLabel: string | null,
): Record<string, unknown> {
  return {
    name: text(bank.name) || ledgerLabel,
    bankKind: bank.kind,
    bankName: text(bank.bankName) || null,
    iban: maskTail(bank.iban),
    accountNumber: maskTail(bank.accountNumber),
    currency: text(bank.currency) || null,
    ledgerAccount: ledgerLabel,
    notes: text(bank.notes) || null,
    ...(bank.active === undefined ? {} : { isActive: bank.active }),
  };
}

// ---------------------------------------------------------------------------
// Journals
// ---------------------------------------------------------------------------

/** A journal written by hand, or the opening balances: what it holds, not its lines. */
export function journalSnapshot(input: {
  date: Date | string | null;
  totalHalalas: number;
  lines: number;
  memo?: string | null;
  reference?: string | null;
}): Record<string, unknown> {
  return {
    date: dayText(input.date),
    totalAmount: riyals(input.totalHalalas / 100),
    lines: input.lines,
    memo: text(input.memo) || null,
    reference: text(input.reference) || null,
  };
}

/** What a reversal says about the entry it turned around, and about the new one. */
export function reversalValues(input: {
  entryDate: Date | string | null;
  totalAmount: unknown;
  reversalNumber: number | null;
  reversalDate: Date | string | null;
  memo?: string | null;
}): { before: Record<string, unknown>; after: Record<string, unknown> } {
  return {
    before: {
      status: "posted",
      date: dayText(input.entryDate),
      totalAmount: riyals(input.totalAmount),
    },
    after: {
      status: "reversed",
      reversalNumber: journalNumberLabel(input.reversalNumber),
      reversalDate: dayText(input.reversalDate),
      memo: text(input.memo) || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Owners: payouts and settlements; transfers between accounts
// ---------------------------------------------------------------------------

export function payoutSnapshot(input: {
  amount: unknown;
  date: Date | string | null;
  bankAccount: string | null;
  reference?: string | null;
  notes?: string | null;
  journalNumber?: number | null;
  status?: string;
}): Record<string, unknown> {
  return {
    amount: riyals(input.amount),
    date: dayText(input.date),
    bankAccount: input.bankAccount,
    reference: text(input.reference) || null,
    notes: text(input.notes) || null,
    ...(input.journalNumber ? { journalNumber: journalNumberLabel(input.journalNumber) } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
}

export function transferSnapshot(input: {
  amount: unknown;
  date: Date | string | null;
  fromAccount: string | null;
  toAccount: string | null;
  reference?: string | null;
  memo?: string | null;
  journalNumber?: number | null;
  status?: string;
}): Record<string, unknown> {
  return {
    fromAccount: input.fromAccount,
    toAccount: input.toAccount,
    amount: riyals(input.amount),
    date: dayText(input.date),
    reference: text(input.reference) || null,
    memo: text(input.memo) || null,
    ...(input.journalNumber ? { journalNumber: journalNumberLabel(input.journalNumber) } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
}

export function settlementSnapshot(input: {
  periodStart: Date | string | null;
  periodEnd: Date | string | null;
  collected: unknown;
  expenses: unknown;
  /** The commission with any fixed management fee. */
  commission: unknown;
  commissionVat: unknown;
  investmentRent: unknown;
  netDue: unknown;
  notes?: string | null;
  journalNumber?: number | null;
  status?: string;
}): Record<string, unknown> {
  return {
    periodStart: dayText(input.periodStart),
    periodEnd: dayText(input.periodEnd),
    collected: riyals(input.collected),
    expenseAmount: riyals(input.expenses),
    commission: riyals(input.commission),
    commissionVat: riyals(input.commissionVat),
    investmentRent: riyals(input.investmentRent),
    netDue: riyals(input.netDue),
    notes: text(input.notes) || null,
    ...(input.journalNumber ? { journalNumber: journalNumberLabel(input.journalNumber) } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
}

// ---------------------------------------------------------------------------
// The period lock
// ---------------------------------------------------------------------------

export type PeriodMove = "closed" | "reopened" | "moved_back" | "unchanged";

export interface PeriodChange {
  move: PeriodMove;
  /** The sentence's catalogue key; null when nothing moved. */
  messageKey: string | null;
  /** The day the sentence names: the new closing day, or the one that was lifted. */
  date: string | null;
  severity: AuditSeverity;
}

/**
 * What a change of the closing day is: closing (or closing further), reopening
 * everything, or reopening the later part. Lifting the lock is what lets the
 * books be changed again, so it weighs more than closing does.
 */
export function periodChange(
  before: Date | string | null | undefined,
  after: Date | string | null | undefined,
): PeriodChange {
  const was = dayText(before);
  const now = dayText(after);
  if (was === now) {
    return { move: "unchanged", messageKey: null, date: now, severity: AuditSeverity.LOW };
  }
  if (!now) {
    return {
      move: "reopened",
      messageKey: "admin.audit.msg.period_reopened",
      date: was,
      severity: AuditSeverity.HIGH,
    };
  }
  if (was && now < was) {
    return {
      move: "moved_back",
      messageKey: "admin.audit.msg.period_moved_back",
      date: now,
      severity: AuditSeverity.HIGH,
    };
  }
  return {
    move: "closed",
    messageKey: "admin.audit.msg.period_closed",
    date: now,
    severity: AuditSeverity.MEDIUM,
  };
}

// ---------------------------------------------------------------------------
// Accounting settings, set-up and the catch-up sweep
// ---------------------------------------------------------------------------

export const ACCOUNTING_SETTINGS_KEYS = [
  "cutOverDate",
  "vatRegistered",
  "vatNumber",
  "depositHolder",
  "accountMap",
] as const;

/**
 * The posting jobs the office pointed at an account of its own, one line each
 * ("bank: 1102 - Main account"), in the order of the jobs. The map is a
 * document; these lines are what a reader can compare.
 */
export function accountMapLines(
  stored: Record<string, unknown> | null | undefined,
  accounts: ReadonlyArray<{ id: string; code: string; nameAr?: string | null; nameEn?: string | null }>,
): string[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return Object.entries(stored ?? {})
    .filter(([, id]) => typeof id === "string" && id)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, id]) => {
      const account = byId.get(id as string);
      return `${key}: ${account ? ledgerAccountName(account) : "?"}`;
    });
}

export function accountingSettingsSnapshot(
  row: {
    cutOverDate?: Date | string | null;
    vatRegistered?: boolean;
    vatNumber?: string | null;
    depositHolder?: string;
  },
  mapLines: readonly string[],
): Record<string, unknown> {
  return {
    cutOverDate: dayText(row.cutOverDate),
    vatRegistered: row.vatRegistered ?? false,
    vatNumber: text(row.vatNumber) || null,
    depositHolder: row.depositHolder === "office" ? "office" : "owner",
    accountMap: [...mapLines],
  };
}

/** What setting accounting up changed — null when it changed nothing (it is safe to repeat). */
export function setupSnapshot(result: {
  createdSettings: boolean;
  accountsCreated: number;
  bankAccountsCreated: number;
  cutOverDate?: Date | string | null;
  vatRegistered?: boolean;
  vatNumber?: string | null;
}): Record<string, unknown> | null {
  if (!result.createdSettings && result.accountsCreated === 0 && result.bankAccountsCreated === 0) {
    return null;
  }
  return {
    accountsCreated: result.accountsCreated,
    bankAccountsCreated: result.bankAccountsCreated,
    ...(result.createdSettings
      ? {
          cutOverDate: dayText(result.cutOverDate),
          vatRegistered: result.vatRegistered ?? false,
          vatNumber: text(result.vatNumber) || null,
        }
      : {}),
  };
}

/** What a run of the sweep did — null when it did nothing at all. */
export function sweepSnapshot(result: {
  created: number;
  replaced: number;
  reversed: number;
  failed: number;
  remaining: number;
}): Record<string, unknown> | null {
  if (
    result.created + result.replaced + result.reversed + result.failed + result.remaining ===
    0
  ) {
    return null;
  }
  return {
    entriesCreated: result.created,
    entriesReplaced: result.replaced,
    entriesReversed: result.reversed,
    entriesFailed: result.failed,
    documentsRemaining: result.remaining,
  };
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export const SUPPLIER_AUDIT_KEYS = [
  "name",
  "vatNumber",
  "crNumber",
  "phone",
  "contactName",
  "email",
  "city",
  "address",
  "bankName",
  "iban",
  "paymentTermsDays",
  "notes",
  "isActive",
] as const;

/** A snapshot without the fields nothing was written to — for a record's creation or removal. */
export function withoutEmpty(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") continue;
    out[key] = value;
  }
  return out;
}

/** A supplier's fields as an entry keeps them: its IBAN as its last four digits only. */
export function supplierSnapshot(
  supplier: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!supplier) return out;
  for (const key of SUPPLIER_AUDIT_KEYS) {
    if (!(key in supplier)) continue;
    out[key] = key === "iban" ? maskTail(supplier[key] as string | null) : supplier[key];
  }
  return out;
}
