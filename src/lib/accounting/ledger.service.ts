/**
 * PropertyPro - The ledger's verbs
 *
 *   postDocument(type, id)     bring one document's entries in step with it
 *   postDocumentSafely(…)      the same, for the write paths' hooks: never
 *                              throws, does nothing until accounting is set up
 *   postManualJournal(…)       a balanced journal typed by an accountant
 *   postOpeningBalances(…)     the books on the cut-over day (form or CSV)
 *   reverseEntry(id, …)        undo a manual journal or opening balance
 *
 * Document entries are never reversed by hand: they follow their document,
 * and a hand reversal would simply be reposted by the next sweep. To undo
 * one, cancel or correct the document.
 */

import { db } from "@/lib/db/prisma";
import { getOrgContext } from "@/lib/tenancy/context";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { applyDocumentPlans, assertOpenDay, reverseLedgerEntry, withLedgerTransaction, writeLedgerEntry, type ApplyResult, type WrittenEntryRef } from "./posting.service";
import { documentKindOf, itemsForDocument } from "./documents.service";
import { getAccountingSettings, loadChart, requireAccountingSettings } from "./settings.service";
import { planManualJournal, planOpeningBalances, type ManualLineInput } from "./posting/manual";
import { totals } from "./posting/common";
import { journalNumberLabel, journalSnapshot, reversalValues } from "./audit-snapshots";
import { parseOpeningBalancesCsv } from "./opening-csv";
import { ledgerDay, parseDay, today } from "./dates";
import { ledgerError, NOT_SET_UP } from "./errors";
import { PARTY_TYPES, type PartyType } from "./types";

export type PostDocumentResult =
  | ({ status: "posted" } & ApplyResult)
  | { status: "not_set_up" }
  | { status: "unknown_source" };

/**
 * Post one document — an installment, a payment, an expense or a security
 * deposit — as it stands now: post, replace, reverse, or nothing when the
 * books already agree. Accepts the document's kind or any of the source
 * types it posts (a payment also posts its refund, a deposit its receipt and
 * settlement).
 */
export async function postDocument(
  sourceType: string,
  sourceId: string,
  options: { userId?: string | null } = {},
): Promise<PostDocumentResult> {
  const kind = documentKindOf(sourceType);
  if (!kind) return { status: "unknown_source" };
  const settings = await getAccountingSettings();
  if (!settings) return { status: "not_set_up" };
  const items = await itemsForDocument(settings, kind, sourceId);
  const result = await applyDocumentPlans(items, options);
  return { status: "posted", ...result };
}

/**
 * For the write paths of the app (where each call goes:
 * docs/ledger-posting-hooks.md): call after the document's own transaction
 * has committed.
 * Posting must never fail the business write it follows, so errors are
 * logged and swallowed — the nightly sweep catches up anything missed.
 */
export async function postDocumentSafely(
  sourceType: string,
  sourceId: string,
  options: { userId?: string | null } = {},
): Promise<void> {
  try {
    if (!getOrgContext()?.organizationId) return;
    await postDocument(sourceType, sourceId, options);
  } catch (error) {
    console.error(`[ledger] posting ${sourceType} ${sourceId} failed; the sweep will retry`, error);
  }
}

function dayOrThrow(value: unknown, field: string): Date {
  const day = parseDay(value);
  if (!day) throw ledgerError("LEDGER_DATE_INVALID", `${field} is not a valid date`);
  return day;
}

async function assertAccountsUsable(lines: readonly ManualLineInput[]): Promise<void> {
  const chart = await loadChart();
  const byId = new Map(chart.map((account) => [account.id, account]));
  for (const line of lines) {
    if (!line.accountId) continue;
    const account = byId.get(line.accountId);
    if (!account) throw ledgerError("LEDGER_ACCOUNT_NOT_FOUND", "An account in this journal does not exist", 400);
    if (!account.postable) {
      throw ledgerError("LEDGER_ACCOUNT_NOT_POSTABLE", `Account ${account.code} is a heading and takes no postings`);
    }
    if (!account.active) throw ledgerError("LEDGER_ACCOUNT_INACTIVE", `Account ${account.code} is inactive`);
  }
}

async function assertPartiesExist(lines: readonly ManualLineInput[]): Promise<void> {
  const wanted = lines.filter((line) => line.partyType || line.partyId);
  for (const line of wanted) {
    if (!line.partyType || !line.partyId || !(PARTY_TYPES as readonly string[]).includes(line.partyType)) {
      throw ledgerError("LEDGER_PARTY_INVALID", "A party needs both its type and who it is");
    }
  }
  const userIds = [
    ...new Set(
      wanted
        .filter((line) => line.partyType === "owner" || line.partyType === "tenant")
        .map((line) => line.partyId as string),
    ),
  ];
  if (userIds.length === 0) return;
  const found = await db.user.findMany({
    where: { id: { in: userIds }, deletedAt: undefined },
    select: { id: true },
  });
  if (found.length !== userIds.length) {
    throw ledgerError("LEDGER_PARTY_NOT_FOUND", "A tenant or owner in this journal does not exist");
  }
}

export interface ManualJournalRequest {
  date: unknown;
  memo?: string | null;
  reference?: string | null;
  lines: ManualLineInput[];
}

export async function postManualJournal(
  request: ManualJournalRequest,
  userId: string | null,
): Promise<WrittenEntryRef> {
  const date = dayOrThrow(request.date, "The date");
  const plan = planManualJournal({
    date,
    memo: request.memo,
    reference: request.reference,
    lines: request.lines,
  });
  await assertAccountsUsable(request.lines);
  await assertPartiesExist(request.lines);
  const entry = await withLedgerTransaction(async (tx, settings) => {
    assertOpenDay(date, settings);
    return writeLedgerEntry(tx, settings, plan, userId);
  });
  void recordActivity({
    action: AuditAction.CREATE,
    recordType: "journal_entry",
    recordId: entry.id,
    recordName: journalNumberLabel(entry.number),
    after: journalSnapshot({
      date,
      totalHalalas: totals(plan.lines).debit,
      lines: plan.lines.length,
      memo: request.memo,
      reference: request.reference,
    }),
  });
  return entry;
}

export async function postOpeningBalances(
  request: { lines: ManualLineInput[]; memo?: string | null },
  userId: string | null,
): Promise<WrittenEntryRef> {
  const settings = await requireAccountingSettings();
  if (!settings.cutOverDate) {
    throw ledgerError("LEDGER_CUTOVER_REQUIRED", "Set the cut-over date before entering opening balances", 409);
  }
  const date = ledgerDay(settings.cutOverDate);
  const plan = planOpeningBalances({
    date,
    memo: request.memo ?? "Opening balances",
    lines: request.lines,
  });
  await assertAccountsUsable(request.lines);
  await assertPartiesExist(request.lines);
  const entry = await withLedgerTransaction(async (tx, locked) => {
    assertOpenDay(date, locked);
    return writeLedgerEntry(tx, locked, plan, userId);
  });
  // The memo the office typed; the "Opening balances" the entry carries
  // without one is not worth repeating.
  void recordActivity({
    action: AuditAction.CREATE,
    recordType: "opening_balance",
    recordId: entry.id,
    recordName: journalNumberLabel(entry.number),
    after: journalSnapshot({
      date,
      totalHalalas: totals(plan.lines).debit,
      lines: plan.lines.length,
      memo: request.memo,
    }),
  });
  return entry;
}

export interface CsvProblem {
  line: number;
  code: string;
  detail?: string;
}

/**
 * Opening balances from a CSV (see opening-csv.ts for the columns). Every
 * row is checked before anything is posted; a file with a problem posts
 * nothing and says which lines.
 */
export async function postOpeningBalancesCsv(
  csv: string,
  memo: string | null,
  userId: string | null,
): Promise<{ entry: WrittenEntryRef | null; problems: CsvProblem[] }> {
  const parsed = parseOpeningBalancesCsv(csv);
  const problems: CsvProblem[] = parsed.errors.map((error) => ({ line: error.line, code: error.code }));
  const chart = await loadChart();
  const byCode = new Map(chart.map((account) => [account.code, account]));
  const lines: ManualLineInput[] = [];
  for (const row of parsed.rows) {
    const account = byCode.get(row.code);
    if (!account) {
      problems.push({ line: row.line, code: "UNKNOWN_ACCOUNT", detail: row.code });
      continue;
    }
    if (row.partyType && !(PARTY_TYPES as readonly string[]).includes(row.partyType)) {
      problems.push({ line: row.line, code: "BAD_PARTY", detail: row.partyType });
      continue;
    }
    lines.push({
      accountId: account.id,
      debit: row.debit || null,
      credit: row.credit || null,
      memo: row.memo || null,
      partyType: (row.partyType || null) as PartyType | null,
      partyId: row.partyId || null,
    });
  }
  if (lines.length === 0 && problems.length === 0) {
    problems.push({ line: 0, code: "EMPTY" });
  }
  if (problems.length > 0) return { entry: null, problems };
  const entry = await postOpeningBalances({ lines, memo }, userId);
  return { entry, problems: [] };
}

const HAND_REVERSIBLE = new Set(["manual", "opening_balance"]);

export async function reverseEntry(
  entryId: string,
  request: { date?: unknown; memo?: string | null },
  userId: string | null,
): Promise<WrittenEntryRef> {
  const entry = await db.journalEntry.findFirst({
    where: { id: entryId },
    select: { id: true, number: true, sourceType: true, status: true, reversesId: true, date: true, totalAmount: true },
  });
  if (!entry) throw ledgerError("LEDGER_ENTRY_NOT_FOUND", "Journal entry not found", 404);
  if (!HAND_REVERSIBLE.has(entry.sourceType)) {
    throw ledgerError(
      "LEDGER_REVERSE_DOCUMENT",
      "This entry follows a document. Cancel or correct the document, or the transfer, settlement or payout it came from, instead.",
      409,
    );
  }
  const date = request.date ? dayOrThrow(request.date, "The reversal date") : today();
  const reversal = await withLedgerTransaction(async (tx, settings) => {
    if (!settings) throw NOT_SET_UP();
    assertOpenDay(date, settings);
    return reverseLedgerEntry(tx, settings, entry.id, date, {
      memo: request.memo ?? null,
      createdById: userId,
    });
  });
  const values = reversalValues({
    entryDate: entry.date,
    totalAmount: entry.totalAmount,
    reversalNumber: reversal.number,
    reversalDate: date,
    memo: request.memo,
  });
  void recordActivity({
    action: AuditAction.REVERSE,
    recordType: entry.sourceType === "opening_balance" ? "opening_balance" : "journal_entry",
    recordId: entry.id,
    recordName: journalNumberLabel(entry.number),
    before: values.before,
    after: values.after,
  });
  return reversal;
}
