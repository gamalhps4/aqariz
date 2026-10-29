/**
 * PropertyPro - The office's bank, cash, POS and gateway accounts
 *
 * Each is kept in one postable ledger account; its balance is that account's
 * balance. A new one is opened beneath the cash heading with the next free
 * code (or kept in an existing account the office points it at). Transfers
 * between them post once and are only ever undone by a reversal.
 */

import { db } from "@/lib/db/prisma";
import { requireOrgId } from "@/lib/tenancy/context";
import { AuditAction, auditRecordChange, recordActivity } from "@/lib/audit-domain";
import { noteAuditEntry } from "@/lib/audit/scope";
import {
  BANK_ACCOUNT_KEYS,
  bankAccountLabel,
  bankAccountSnapshot,
  dayText,
  journalNumberLabel,
  ledgerAccountName,
  transferName,
  transferSnapshot,
} from "./audit-snapshots";
import { getAccountingSettings, loadChart, resolvedMap } from "./settings.service";
import { assertOpenDay, reverseLedgerEntry, withLedgerTransaction, writeLedgerEntry } from "./posting.service";
import { planBankTransfer } from "./posting/bank";
import { ledgerDay, parseDay, today } from "./dates";
import { ledgerError, NOT_SET_UP } from "./errors";
import { fromHalalas, toHalalas } from "./money";
import { parseAmount } from "./journal-validation";
import { BANK_ACCOUNT_KINDS, type BankAccountKind } from "./types";
import { businessDay } from "@/lib/dates/business-day";

export interface BankAccountRow {
  id: string;
  kind: BankAccountKind;
  name: string;
  bankName: string | null;
  iban: string | null;
  accountNumber: string | null;
  currency: string;
  active: boolean;
  notes: string | null;
  ledgerAccount: { id: string; code: string; nameAr: string; nameEn: string; active: boolean };
  balance: number;
  /** The account the posting rules send this kind of money to by default. */
  isDefault: boolean;
}

const KIND_KEYS: Record<BankAccountKind, "cash_on_hand" | "bank" | "pos_clearing" | "gateway_clearing"> = {
  cash: "cash_on_hand",
  bank: "bank",
  pos: "pos_clearing",
  gateway_clearing: "gateway_clearing",
};

export async function listBankAccounts(): Promise<BankAccountRow[]> {
  const [accounts, settings, chart] = await Promise.all([
    db.bankAccount.findMany({
      include: {
        ledgerAccount: { select: { id: true, code: true, nameAr: true, nameEn: true, active: true } },
      },
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    }),
    getAccountingSettings(),
    loadChart(),
  ]);
  const ledgerIds = accounts.map((account) => account.ledgerAccountId);
  const sums = ledgerIds.length
    ? await db.journalLine.groupBy({
        by: ["accountId"],
        where: { accountId: { in: ledgerIds } },
        _sum: { debit: true, credit: true },
      })
    : [];
  const balance = new Map(
    sums.map((row) => [
      row.accountId,
      toHalalas(row._sum.debit as unknown as number) - toHalalas(row._sum.credit as unknown as number),
    ]),
  );
  const map = resolvedMap(settings, chart);
  return accounts.map((account) => {
    const kind = (BANK_ACCOUNT_KINDS as readonly string[]).includes(account.kind)
      ? (account.kind as BankAccountKind)
      : "bank";
    return {
      id: account.id,
      kind,
      name: account.name,
      bankName: account.bankName,
      iban: account.iban,
      accountNumber: account.accountNumber,
      currency: account.currency,
      active: account.active,
      notes: account.notes,
      ledgerAccount: account.ledgerAccount,
      balance: fromHalalas(balance.get(account.ledgerAccountId) ?? 0),
      isDefault: map.get(KIND_KEYS[kind]) === account.ledgerAccountId,
    };
  });
}

/** Next free code under a heading: the heading's code and a two-digit number. */
function nextChildCode(parentCode: string, taken: Set<string>): string {
  for (let index = 1; index < 1000; index++) {
    const code = `${parentCode}${String(index).padStart(2, "0")}`;
    if (!taken.has(code)) return code;
  }
  throw ledgerError("LEDGER_NO_FREE_CODE", "No free account code is left under this heading", 409);
}

const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

export interface BankAccountInput {
  name?: string;
  kind?: string;
  bankName?: string | null;
  iban?: string | null;
  accountNumber?: string | null;
  currency?: string;
  notes?: string | null;
  active?: boolean;
  /** Keep it in this existing postable asset account instead of opening one. */
  ledgerAccountId?: string | null;
}

function cleanIban(value: string | null | undefined): string | null {
  const iban = (value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!iban) return null;
  if (!IBAN_PATTERN.test(iban)) {
    throw ledgerError("LEDGER_IBAN_INVALID", "The IBAN does not look right (SA followed by 22 digits for a Saudi account)");
  }
  return iban;
}

export async function createBankAccount(input: BankAccountInput): Promise<{ id: string }> {
  const name = (input.name ?? "").trim();
  if (!name) throw ledgerError("LEDGER_BANK_NAME_REQUIRED", "Give the account a name");
  const kind = (BANK_ACCOUNT_KINDS as readonly string[]).includes(input.kind ?? "")
    ? (input.kind as BankAccountKind)
    : "bank";
  const iban = cleanIban(input.iban);
  const organizationId = requireOrgId();

  const opened = await withLedgerTransaction(async (tx) => {
    const chart = await loadChart(tx);
    let ledgerAccountId = input.ledgerAccountId || null;
    let ledgerLabel: string;
    if (ledgerAccountId) {
      const account = chart.find((candidate) => candidate.id === ledgerAccountId);
      if (!account || account.type !== "asset" || !account.postable || !account.active) {
        throw ledgerError(
          "LEDGER_BANK_ACCOUNT_INVALID",
          "Keep a bank account in an active asset account that takes postings",
        );
      }
      const linked = await tx.bankAccount.findFirst({ where: { ledgerAccountId }, select: { id: true } });
      if (linked) {
        throw ledgerError("LEDGER_BANK_ACCOUNT_TAKEN", "Another bank or cash account is already kept in that account", 409);
      }
      ledgerLabel = ledgerAccountName(account);
    } else {
      const heading = chart.find((account) => account.systemKey === "group_cash");
      if (!heading) {
        throw ledgerError("LEDGER_CASH_HEADING_MISSING", "The cash and banks heading is missing from the chart", 409);
      }
      const code = nextChildCode(heading.code, new Set(chart.map((account) => account.code)));
      ledgerLabel = ledgerAccountName({ code, nameAr: name, nameEn: name });
      const created = await tx.ledgerAccount.create({
        data: {
          organizationId,
          code,
          nameAr: name,
          nameEn: name,
          type: "asset",
          normalSide: "debit",
          parentId: heading.id,
          postable: true,
          active: true,
        },
        select: { id: true },
      });
      ledgerAccountId = created.id;
    }
    const bank = await tx.bankAccount.create({
      data: {
        organizationId,
        ledgerAccountId,
        kind,
        name,
        bankName: input.bankName?.trim() || null,
        iban,
        accountNumber: input.accountNumber?.trim() || null,
        currency: (input.currency ?? "SAR").trim().toUpperCase() || "SAR",
        notes: input.notes?.trim() || null,
      },
      select: { id: true },
    });
    return { bank, ledgerLabel };
  });
  const currency = (input.currency ?? "SAR").trim().toUpperCase() || "SAR";
  void recordActivity({
    action: AuditAction.CREATE,
    recordType: "bank_account",
    recordId: opened.bank.id,
    recordName: name,
    after: bankAccountSnapshot(
      {
        name,
        kind,
        bankName: input.bankName,
        iban,
        accountNumber: input.accountNumber,
        currency,
        notes: input.notes,
      },
      opened.ledgerLabel,
    ),
  });
  return opened.bank;
}

export async function updateBankAccount(id: string, input: BankAccountInput): Promise<void> {
  const existing = await db.bankAccount.findFirst({
    where: { id },
    select: {
      id: true,
      name: true,
      kind: true,
      bankName: true,
      iban: true,
      accountNumber: true,
      currency: true,
      notes: true,
      active: true,
      ledgerAccount: { select: { code: true, nameAr: true, nameEn: true } },
    },
  });
  if (!existing) throw ledgerError("LEDGER_BANK_NOT_FOUND", "Bank account not found", 404);
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw ledgerError("LEDGER_BANK_NAME_REQUIRED", "Give the account a name");
    data.name = name;
  }
  if (input.bankName !== undefined) data.bankName = input.bankName?.trim() || null;
  if (input.iban !== undefined) data.iban = cleanIban(input.iban);
  if (input.accountNumber !== undefined) data.accountNumber = input.accountNumber?.trim() || null;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.active !== undefined) data.active = Boolean(input.active);
  if (Object.keys(data).length === 0) {
    // Nothing to save, so nothing to record — and no basic entry in its place.
    noteAuditEntry();
    return;
  }
  await db.bankAccount.update({ where: { id }, data });
  const ledgerLabel = ledgerAccountName(existing.ledgerAccount);
  const next = { ...existing, ...data } as typeof existing;
  const switched = data.active !== undefined && next.active !== existing.active;
  auditRecordChange({
    action: switched ? AuditAction.STATUS_CHANGED : AuditAction.UPDATE,
    recordType: "bank_account",
    recordId: id,
    recordName: bankAccountLabel(next),
    before: bankAccountSnapshot(existing, ledgerLabel),
    after: bankAccountSnapshot(next, ledgerLabel),
    keys: BANK_ACCOUNT_KEYS,
    ...(switched
      ? {
          messageKey: next.active
            ? "admin.audit.msg.record_activated"
            : "admin.audit.msg.record_deactivated",
        }
      : {}),
  });
}

export interface TransferRow {
  id: string;
  date: string;
  amount: number;
  reference: string | null;
  memo: string | null;
  status: string;
  from: { id: string; name: string; ledgerAccountName: { ar: string; en: string } };
  to: { id: string; name: string; ledgerAccountName: { ar: string; en: string } };
  journalEntryId: string | null;
  journalNumber: number | null;
}

export async function listTransfers(options: { page: number; limit: number }): Promise<{ rows: TransferRow[]; total: number }> {
  const [rows, total] = await Promise.all([
    db.bankTransfer.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (options.page - 1) * options.limit,
      take: options.limit,
      include: {
        fromBankAccount: { select: { id: true, name: true, ledgerAccount: { select: { nameAr: true, nameEn: true } } } },
        toBankAccount: { select: { id: true, name: true, ledgerAccount: { select: { nameAr: true, nameEn: true } } } },
      },
    }),
    db.bankTransfer.count(),
  ]);
  const entryIds = rows.map((row) => row.journalEntryId).filter(Boolean) as string[];
  const entries = entryIds.length
    ? await db.journalEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, number: true } })
    : [];
  const numbers = new Map(entries.map((entry) => [entry.id, entry.number]));
  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      date: businessDay(row.date),
      amount: Number(row.amount),
      reference: row.reference,
      memo: row.memo,
      status: row.status,
      from: {
        id: row.fromBankAccount.id,
        name: row.fromBankAccount.name,
        ledgerAccountName: { ar: row.fromBankAccount.ledgerAccount.nameAr, en: row.fromBankAccount.ledgerAccount.nameEn },
      },
      to: {
        id: row.toBankAccount.id,
        name: row.toBankAccount.name,
        ledgerAccountName: { ar: row.toBankAccount.ledgerAccount.nameAr, en: row.toBankAccount.ledgerAccount.nameEn },
      },
      journalEntryId: row.journalEntryId,
      journalNumber: row.journalEntryId ? (numbers.get(row.journalEntryId) ?? null) : null,
    })),
  };
}

export interface TransferInput {
  fromBankAccountId: string;
  toBankAccountId: string;
  amount: unknown;
  date: unknown;
  reference?: string | null;
  memo?: string | null;
}

export async function createTransfer(input: TransferInput, userId: string | null): Promise<{ id: string; journalNumber: number }> {
  const day = parseDay(input.date);
  if (!day) throw ledgerError("LEDGER_DATE_INVALID", "The date is not valid");
  const amount = parseAmount(input.amount as string | number | null);
  if (amount === null || Number.isNaN(amount) || amount <= 0) {
    throw ledgerError("LEDGER_INVALID_AMOUNT", "The amount must be above zero, with at most two decimals");
  }
  // Refused here rather than by planBankTransfer: the transfer row is written
  // first, and its check constraint would answer with a database error.
  if (input.fromBankAccountId === input.toBankAccountId) {
    throw ledgerError("LEDGER_SAME_ACCOUNT", "Choose two different accounts to transfer between");
  }
  const organizationId = requireOrgId();
  const done = await withLedgerTransaction(async (tx, settings) => {
    assertOpenDay(day, settings);
    const banks = await tx.bankAccount.findMany({
      where: { id: { in: [input.fromBankAccountId, input.toBankAccountId] } },
      select: {
        id: true,
        name: true,
        ledgerAccountId: true,
        active: true,
        ledgerAccount: { select: { nameAr: true, nameEn: true } },
      },
    });
    const from = banks.find((bank) => bank.id === input.fromBankAccountId);
    const to = banks.find((bank) => bank.id === input.toBankAccountId);
    if (!from || !to) throw ledgerError("LEDGER_BANK_NOT_FOUND", "Bank account not found", 404);
    if (!from.active || !to.active) {
      throw ledgerError("LEDGER_BANK_INACTIVE", "Both accounts must be active");
    }
    const transfer = await tx.bankTransfer.create({
      data: {
        organizationId,
        fromBankAccountId: from.id,
        toBankAccountId: to.id,
        amount: (amount / 100).toFixed(2),
        date: day,
        reference: input.reference?.trim() || null,
        memo: input.memo?.trim() || null,
        createdById: userId,
      },
      select: { id: true },
    });
    const plan = planBankTransfer({
      id: transfer.id,
      date: day,
      amount: amount / 100,
      fromAccountId: from.ledgerAccountId,
      toAccountId: to.ledgerAccountId,
      reference: input.reference?.trim() || null,
      memo: input.memo?.trim() || null,
    });
    const entry = await writeLedgerEntry(tx, settings, plan, userId);
    await tx.bankTransfer.update({ where: { id: transfer.id }, data: { journalEntryId: entry.id } });
    return {
      id: transfer.id,
      journalNumber: entry.number,
      fromAccount: bankAccountLabel(from),
      toAccount: bankAccountLabel(to),
    };
  });
  void recordActivity({
    action: AuditAction.CREATE,
    recordType: "bank_transfer",
    recordId: done.id,
    recordName: transferName(done.fromAccount, done.toAccount),
    after: transferSnapshot({
      amount: amount / 100,
      date: day,
      fromAccount: done.fromAccount,
      toAccount: done.toAccount,
      reference: input.reference,
      memo: input.memo,
      journalNumber: done.journalNumber,
    }),
  });
  return { id: done.id, journalNumber: done.journalNumber };
}

/** Cancel a transfer: reverse its entry, dated today unless a day is given. */
export async function reverseTransfer(
  id: string,
  options: { date?: unknown; userId: string | null },
): Promise<void> {
  const day = options.date ? parseDay(options.date) : today();
  if (!day) throw ledgerError("LEDGER_DATE_INVALID", "The date is not valid");
  const cancelled = await withLedgerTransaction(async (tx, settings) => {
    if (!settings) throw NOT_SET_UP();
    const transfer = await tx.bankTransfer.findFirst({
      where: { id },
      include: {
        fromBankAccount: { select: { name: true, ledgerAccount: { select: { nameAr: true, nameEn: true } } } },
        toBankAccount: { select: { name: true, ledgerAccount: { select: { nameAr: true, nameEn: true } } } },
      },
    });
    if (!transfer) throw ledgerError("LEDGER_TRANSFER_NOT_FOUND", "Transfer not found", 404);
    if (transfer.status !== "posted" || !transfer.journalEntryId) {
      throw ledgerError("LEDGER_ALREADY_REVERSED", "This transfer has already been cancelled", 409);
    }
    const reverseOn = ledgerDay(day).getTime() < transfer.date.getTime() ? transfer.date : ledgerDay(day);
    assertOpenDay(reverseOn, settings);
    const reversal = await reverseLedgerEntry(tx, settings, transfer.journalEntryId, reverseOn, {
      memo: null,
      createdById: options.userId,
    });
    await tx.bankTransfer.update({ where: { id }, data: { status: "reversed" } });
    return {
      amount: transfer.amount,
      date: transfer.date,
      reference: transfer.reference,
      memo: transfer.memo,
      fromAccount: bankAccountLabel(transfer.fromBankAccount),
      toAccount: bankAccountLabel(transfer.toBankAccount),
      reversalNumber: reversal.number,
      reversedOn: reverseOn,
    };
  });
  void recordActivity({
    action: AuditAction.REVERSE,
    recordType: "bank_transfer",
    recordId: id,
    recordName: transferName(cancelled.fromAccount, cancelled.toAccount),
    before: transferSnapshot({ ...cancelled, status: "posted" }),
    after: {
      status: "reversed",
      reversalNumber: journalNumberLabel(cancelled.reversalNumber),
      reversalDate: dayText(cancelled.reversedOn),
    },
  });
}
