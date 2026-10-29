/**
 * PropertyPro - Writing to the books
 *
 * Everything that reaches journal_entries goes through here, inside one
 * transaction per call that first locks the organization's settings row.
 * The lock is what keeps journal numbers in sequence with no gaps and no
 * repeats, and it serialises posting per organization, so a document posted
 * by a request and by the sweep at the same moment is decided once.
 *
 * Two kinds of writes:
 *
 *  - Document entries (installments, payments, refunds, expenses, deposits)
 *    follow their document: `applyDocumentPlans` compares what each document
 *    calls for with the entry the books hold (lib/accounting/periods.ts) and
 *    posts, replaces in place, reverses, or reverses and reposts.
 *  - Ledger entries (manual journals, opening balances, transfers,
 *    settlements, payouts) are written once by `writeLedgerEntry` and only
 *    ever undone by a reversal.
 *
 * Accounts are resolved here, from the plan's system keys through the
 * account map. Amounts are halalas until the row is built.
 */

import { db, runWithOrgTransaction, type OrgTransactionClient } from "@/lib/db/prisma";
import { requireOrgId } from "@/lib/tenancy/context";
import type { Prisma } from "@/generated/prisma/client";
import { DEFAULT_CURRENCY } from "@/lib/regional/region";
import { parseStoredAccountMap, resolveAccountMap } from "./account-map";
import { loadChart, type ChartAccount } from "./settings.service";
import { decidePostingAction, numbersNeeded, type LiveEntry, type PostingAction } from "./periods";
import { fingerprintPlan } from "./posting/fingerprint";
import { planReversal, type WrittenLine } from "./posting/manual";
import { totals } from "./posting/common";
import { formatDay, isLockedDay } from "./dates";
import { ledgerError, NOT_SET_UP } from "./errors";
import { halalasToDecimal, toHalalas } from "./money";
import { newLedgerId } from "./ids";
import type { SystemKey } from "./system-keys";
import type { AccountRef, DocumentSourceType, PostingPlan, SourceType } from "./types";

export interface LockedSettings {
  id: string;
  lastJournalNumber: number;
  closedThrough: Date | null;
  cutOverDate: Date | null;
  accountMap: unknown;
  depositHolder: string;
  vatRegistered: boolean;
}

/** Lock the organization's settings row for the rest of the transaction. */
export async function lockSettings(tx: OrgTransactionClient): Promise<LockedSettings> {
  const organizationId = requireOrgId();
  const rows = await tx.$queryRaw<LockedSettings[]>`
    SELECT "id", "lastJournalNumber", "closedThrough", "cutOverDate", "accountMap",
           "depositHolder", "vatRegistered"
      FROM "accounting_settings"
     WHERE "organizationId" = ${organizationId}
       FOR UPDATE`;
  if (!rows[0]) throw NOT_SET_UP();
  return rows[0];
}

type Resolver = (account: AccountRef, options: { requireActive: boolean }) => string;

function makeResolver(chart: readonly ChartAccount[], map: ReadonlyMap<SystemKey, string>): Resolver {
  const byId = new Map(chart.map((account) => [account.id, account]));
  return (ref, { requireActive }) => {
    const id = "key" in ref ? map.get(ref.key) : ref.id;
    if (!id) {
      throw ledgerError(
        "LEDGER_ACCOUNT_UNMAPPED",
        `No account does the posting job "${"key" in ref ? ref.key : ""}". Check the account map in Accounting setup.`,
        409,
      );
    }
    const account = byId.get(id);
    if (!account) {
      throw ledgerError("LEDGER_ACCOUNT_NOT_FOUND", "An account in this entry does not exist", 409);
    }
    if (!account.postable) {
      throw ledgerError(
        "LEDGER_ACCOUNT_NOT_POSTABLE",
        `Account ${account.code} is a heading and takes no postings`,
        409,
      );
    }
    if (requireActive && !account.active) {
      throw ledgerError("LEDGER_ACCOUNT_INACTIVE", `Account ${account.code} is inactive`, 409);
    }
    return id;
  };
}

async function resolverFor(tx: OrgTransactionClient, settings: LockedSettings): Promise<Resolver> {
  const chart = await loadChart(tx);
  return makeResolver(chart, resolveAccountMap(chart, parseStoredAccountMap(settings.accountMap)));
}

interface EntryWrite {
  id: string;
  number: number;
  plan: PostingPlan;
  date: Date;
  fingerprint: string | null;
  reversesId: string | null;
  requireActive: boolean;
}

function buildRows(
  organizationId: string,
  writes: readonly EntryWrite[],
  resolve: Resolver,
  createdById: string | null,
): { entries: Prisma.JournalEntryCreateManyInput[]; lines: Prisma.JournalLineCreateManyInput[] } {
  const now = new Date();
  const entries: Prisma.JournalEntryCreateManyInput[] = [];
  const lines: Prisma.JournalLineCreateManyInput[] = [];
  for (const write of writes) {
    const sum = totals(write.plan.lines);
    if (sum.debit !== sum.credit || sum.debit <= 0) {
      throw ledgerError("LEDGER_UNBALANCED", "The entry does not balance", 500);
    }
    entries.push({
      id: write.id,
      organizationId,
      number: write.number,
      date: write.date,
      sourceType: write.plan.sourceType,
      sourceId: write.plan.sourceId,
      sourceRef: write.plan.sourceRef ?? null,
      memo: write.plan.memo ?? null,
      status: "posted",
      reversesId: write.reversesId,
      totalAmount: halalasToDecimal(sum.debit),
      currency: DEFAULT_CURRENCY,
      fingerprint: write.fingerprint,
      createdById,
      updatedAt: now,
    });
    write.plan.lines.forEach((line, index) => {
      lines.push({
        id: newLedgerId(),
        organizationId,
        entryId: write.id,
        lineNo: index,
        accountId: resolve(line.account, { requireActive: write.requireActive }),
        date: write.date,
        debit: halalasToDecimal(line.debit),
        credit: halalasToDecimal(line.credit),
        partyType: line.partyType && line.partyId ? line.partyType : null,
        partyId: line.partyType && line.partyId ? line.partyId : null,
        propertyId: line.propertyId ?? null,
        unitId: line.unitId ?? null,
        leaseId: line.leaseId ?? null,
        agreementId: line.agreementId ?? null,
        vatCode: line.vatCode ?? null,
        memo: line.memo ?? null,
      });
    });
  }
  return { entries, lines };
}

async function writeRows(
  tx: OrgTransactionClient,
  rows: ReturnType<typeof buildRows>,
): Promise<void> {
  if (rows.entries.length > 0) await tx.journalEntry.createMany({ data: rows.entries });
  if (rows.lines.length > 0) await tx.journalLine.createMany({ data: rows.lines });
}

async function reserveNumbers(
  tx: OrgTransactionClient,
  settings: LockedSettings,
  count: number,
): Promise<() => number> {
  let next = settings.lastJournalNumber;
  if (count > 0) {
    await tx.accountingSettings.update({
      where: { id: settings.id },
      data: { lastJournalNumber: { increment: count } },
    });
  }
  return () => {
    next += 1;
    return next;
  };
}

function writtenLines(
  rows: ReadonlyArray<{
    accountId: string;
    debit: unknown;
    credit: unknown;
    partyType: string | null;
    partyId: string | null;
    propertyId: string | null;
    unitId: string | null;
    leaseId: string | null;
    agreementId: string | null;
    vatCode: string | null;
    memo: string | null;
  }>,
): WrittenLine[] {
  return rows.map((row) => ({
    accountId: row.accountId,
    debit: toHalalas(row.debit as number),
    credit: toHalalas(row.credit as number),
    partyType: row.partyType,
    partyId: row.partyId,
    propertyId: row.propertyId,
    unitId: row.unitId,
    leaseId: row.leaseId,
    agreementId: row.agreementId,
    vatCode: row.vatCode,
    memo: row.memo,
  }));
}

// ---------------------------------------------------------------------------
// Document entries
// ---------------------------------------------------------------------------

export interface DocumentPlanItem {
  sourceType: DocumentSourceType;
  sourceId: string;
  /** What the document calls for now; null when it should post nothing. */
  plan: PostingPlan | null;
}

export interface ApplyResult {
  created: number;
  replaced: number;
  reversed: number;
  unchanged: number;
}

const sourceKey = (sourceType: string, sourceId: string | null) => `${sourceType}:${sourceId ?? ""}`;

/**
 * Bring the books in step with these documents, in one transaction.
 *
 * Each document gets the action periods.ts decides; an unchanged one is left
 * alone, so calling this again with the same documents writes nothing.
 */
export async function applyDocumentPlans(
  items: readonly DocumentPlanItem[],
  options: { userId?: string | null } = {},
): Promise<ApplyResult> {
  const result: ApplyResult = { created: 0, replaced: 0, reversed: 0, unchanged: 0 };
  if (items.length === 0) return result;
  const organizationId = requireOrgId();

  return runWithOrgTransaction(async (tx) => {
    const settings = await lockSettings(tx);

    const idsByType = new Map<string, string[]>();
    for (const item of items) {
      idsByType.set(item.sourceType, [...(idsByType.get(item.sourceType) ?? []), item.sourceId]);
    }
    const lives = await tx.journalEntry.findMany({
      where: {
        status: "posted",
        reversesId: null,
        OR: [...idsByType.entries()].map(([sourceType, ids]) => ({
          sourceType,
          sourceId: { in: ids },
        })),
      },
      select: { id: true, number: true, date: true, fingerprint: true, sourceType: true, sourceId: true, sourceRef: true },
    });
    const liveBySource = new Map(lives.map((entry) => [sourceKey(entry.sourceType, entry.sourceId), entry]));

    const decided: Array<{ item: DocumentPlanItem; action: PostingAction; fingerprint: string | null }> = [];
    for (const item of items) {
      const live = liveBySource.get(sourceKey(item.sourceType, item.sourceId)) ?? null;
      const fingerprint = item.plan ? fingerprintPlan(item.plan) : null;
      const action = decidePostingAction({
        live: live as LiveEntry | null,
        desired: item.plan ? { date: item.plan.date, fingerprint: fingerprint! } : null,
        closedThrough: settings.closedThrough,
      });
      if (action.kind === "noop") {
        result.unchanged += 1;
        continue;
      }
      decided.push({ item, action, fingerprint });
    }
    if (decided.length === 0) return result;

    const toReverse = decided
      .map(({ action }) =>
        action.kind === "reverse" || action.kind === "reverse_and_create" ? action.entry.id : null,
      )
      .filter((id): id is string => Boolean(id));
    const reverseLines = toReverse.length
      ? await tx.journalLine.findMany({
          where: { entryId: { in: toReverse } },
          orderBy: [{ entryId: "asc" }, { lineNo: "asc" }],
        })
      : [];
    const linesByEntry = new Map<string, typeof reverseLines>();
    for (const line of reverseLines) {
      linesByEntry.set(line.entryId, [...(linesByEntry.get(line.entryId) ?? []), line]);
    }

    const resolve = await resolverFor(tx, settings);
    const nextNumber = await reserveNumbers(
      tx,
      settings,
      decided.reduce((sum, { action }) => sum + numbersNeeded(action), 0),
    );

    const writes: EntryWrite[] = [];
    const deleteIds: string[] = [];
    const reversedIds: string[] = [];

    const reversalOf = (entry: LiveEntry & { sourceRef?: string | null }, item: DocumentPlanItem, date: Date) => {
      const lines = linesByEntry.get(entry.id) ?? [];
      reversedIds.push(entry.id);
      writes.push({
        id: newLedgerId(),
        number: nextNumber(),
        plan: planReversal(
          {
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            sourceRef: entry.sourceRef ?? null,
            number: entry.number,
            lines: writtenLines(lines),
          },
          date,
        ),
        date,
        fingerprint: null,
        reversesId: entry.id,
        requireActive: false,
      });
    };

    for (const { item, action, fingerprint } of decided) {
      switch (action.kind) {
        case "create":
          writes.push({
            id: newLedgerId(),
            number: nextNumber(),
            plan: item.plan!,
            date: action.date,
            fingerprint,
            reversesId: null,
            requireActive: true,
          });
          result.created += 1;
          break;
        case "replace":
          deleteIds.push(action.entry.id);
          writes.push({
            id: action.entry.id,
            number: action.entry.number,
            plan: item.plan!,
            date: action.date,
            fingerprint,
            reversesId: null,
            requireActive: true,
          });
          result.replaced += 1;
          break;
        case "reverse":
          reversalOf(action.entry, item, action.date);
          result.reversed += 1;
          break;
        case "reverse_and_create":
          reversalOf(action.entry, item, action.reverseDate);
          writes.push({
            id: newLedgerId(),
            number: nextNumber(),
            plan: item.plan!,
            date: action.createDate,
            fingerprint,
            reversesId: null,
            requireActive: true,
          });
          result.reversed += 1;
          result.created += 1;
          break;
      }
    }

    if (deleteIds.length > 0) {
      await tx.journalEntry.deleteMany({ where: { id: { in: deleteIds } } });
    }
    if (reversedIds.length > 0) {
      await tx.journalEntry.updateMany({
        where: { id: { in: reversedIds } },
        data: { status: "reversed" },
      });
    }
    await writeRows(tx, buildRows(organizationId, writes, resolve, options.userId ?? null));
    return result;
  });
}

// ---------------------------------------------------------------------------
// Ledger entries
// ---------------------------------------------------------------------------

/**
 * Refuse a day the books cannot take: inside the closed period, or before
 * the cut-over (the opening balances stand for everything before it).
 */
export function assertOpenDay(
  day: Date,
  settings: { closedThrough: Date | null; cutOverDate: Date | null },
): void {
  if (isLockedDay(day, settings.closedThrough)) {
    throw ledgerError(
      "LEDGER_PERIOD_LOCKED",
      `The books are closed through ${formatDay(settings.closedThrough!)}. Choose a later date.`,
      409,
    );
  }
  if (settings.cutOverDate && day.getTime() < settings.cutOverDate.getTime()) {
    throw ledgerError(
      "LEDGER_BEFORE_CUTOVER",
      `The books start on ${formatDay(settings.cutOverDate)}. Choose that day or later.`,
      409,
    );
  }
}

export interface WrittenEntryRef {
  id: string;
  number: number;
}

/**
 * Write one ledger entry inside the caller's transaction. The caller has
 * checked the day; accounts must be active and postable.
 */
export async function writeLedgerEntry(
  tx: OrgTransactionClient,
  settings: LockedSettings,
  plan: PostingPlan,
  createdById: string | null,
): Promise<WrittenEntryRef> {
  const resolve = await resolverFor(tx, settings);
  const nextNumber = await reserveNumbers(tx, settings, 1);
  const write: EntryWrite = {
    id: newLedgerId(),
    number: nextNumber(),
    plan,
    date: plan.date,
    fingerprint: null,
    reversesId: null,
    requireActive: true,
  };
  await writeRows(tx, buildRows(requireOrgId(), [write], resolve, createdById));
  // The settings row is updated in place, so a second entry in the same
  // transaction numbers on from here.
  settings.lastJournalNumber = write.number;
  return { id: write.id, number: write.number };
}

/**
 * Reverse one entry inside the caller's transaction, dated `day` (the caller
 * has checked it is open). The original is marked reversed.
 */
export async function reverseLedgerEntry(
  tx: OrgTransactionClient,
  settings: LockedSettings,
  entryId: string,
  day: Date,
  options: { memo?: string | null; createdById: string | null },
): Promise<WrittenEntryRef> {
  const entry = await tx.journalEntry.findFirst({
    where: { id: entryId },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!entry) throw ledgerError("LEDGER_ENTRY_NOT_FOUND", "Journal entry not found", 404);
  if (entry.status !== "posted" || entry.reversesId) {
    throw ledgerError(
      "LEDGER_ALREADY_REVERSED",
      "This entry has already been reversed, or is itself a reversal",
      409,
    );
  }
  if (day.getTime() < entry.date.getTime()) {
    throw ledgerError(
      "LEDGER_REVERSE_BEFORE_ENTRY",
      "A reversal cannot be dated before the entry it reverses",
    );
  }
  const plan = planReversal(
    {
      sourceType: entry.sourceType as SourceType,
      sourceId: entry.sourceId,
      sourceRef: entry.sourceRef,
      number: entry.number,
      lines: writtenLines(entry.lines),
    },
    day,
    options.memo ?? `Reversal of entry ${entry.number}`,
  );
  const resolve = await resolverFor(tx, settings);
  const nextNumber = await reserveNumbers(tx, settings, 1);
  const write: EntryWrite = {
    id: newLedgerId(),
    number: nextNumber(),
    plan,
    date: day,
    fingerprint: null,
    reversesId: entry.id,
    requireActive: false,
  };
  await tx.journalEntry.update({ where: { id: entry.id }, data: { status: "reversed" } });
  await writeRows(tx, buildRows(requireOrgId(), [write], resolve, options.createdById));
  settings.lastJournalNumber = write.number;
  return { id: write.id, number: write.number };
}

/** Run `fn` in a transaction holding the settings lock. */
export function withLedgerTransaction<T>(
  fn: (tx: OrgTransactionClient, settings: LockedSettings) => Promise<T>,
): Promise<T> {
  return runWithOrgTransaction(async (tx) => fn(tx, await lockSettings(tx)));
}

/** Whether the organization has set accounting up — cheap, for the hooks. */
export async function isLedgerSetUp(): Promise<boolean> {
  return Boolean(await db.accountingSettings.findFirst({ select: { id: true } }));
}
