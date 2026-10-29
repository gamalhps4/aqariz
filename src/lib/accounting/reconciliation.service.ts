/**
 * PropertyPro - Reconciling a bank or cash account by hand
 *
 * The office ticks the lines of an account off against its bank statement.
 * The account's book balance (every line up to a day) is set beside its
 * reconciled balance (only the ticked lines), so what the books hold that the
 * bank has not yet cleared — a cheque not presented, a deposit in transit — is
 * the difference between the two, and the office can compare the reconciled
 * balance with the statement's own closing balance. Importing a statement is
 * not part of this.
 *
 * A tick is a row of its own (`bank_reconciled_lines`), not a column of the
 * journal line: the closed-period guard locks the lines of a closed period,
 * and ticking one off must stay possible for them. A tick goes with its line
 * when the line's document is replaced in an open period, and the new line
 * then waits to be ticked; a reversal is a new line of its own, to be ticked
 * beside the one it undoes.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/prisma";
import { requireOrgId } from "@/lib/tenancy/context";
import { AuditAction, recordActivity } from "@/lib/audit-service";
import { noteAuditEntry } from "@/lib/audit/scope";
import { formatDay, today } from "./dates";
import { ledgerError } from "./errors";
import { toHalalas } from "./money";
import { partyNames } from "./reports/service";
import { dayOrThrow, money, requirePurchases } from "./purchases/common";
import { bankAccountLabel, dayText } from "./audit-snapshots";
import {
  RECONCILIATION_STATUSES,
  type ReconciliationLine,
  type ReconciliationQuery,
  type ReconciliationView,
} from "./reconciliation-types";

export { RECONCILIATION_STATUSES };
export type { ReconciliationLine, ReconciliationQuery, ReconciliationView };

const net = (sums: { debit?: unknown; credit?: unknown } | null | undefined) =>
  (toHalalas(money(sums?.debit)) - toHalalas(money(sums?.credit))) / 100 || 0;

async function loadBank(bankAccountId: string) {
  const bank = await db.bankAccount.findFirst({
    where: { id: bankAccountId },
    select: {
      id: true,
      name: true,
      kind: true,
      currency: true,
      ledgerAccountId: true,
      ledgerAccount: { select: { id: true, code: true, nameAr: true, nameEn: true } },
    },
  });
  if (!bank) throw ledgerError("LEDGER_BANK_NOT_FOUND", "Bank account not found", 404);
  return bank;
}

export async function reconciliationView(query: ReconciliationQuery): Promise<ReconciliationView> {
  await requirePurchases();
  const bank = await loadBank(query.bankAccountId);
  const asOf = query.asOf ?? today();
  const status = query.status ?? "unreconciled";

  // The books at the day: every line booked by it. Of those, reconciled are
  // the ones the bank had cleared by it; a line cleared after it was still
  // outstanding on it — so looking back at a statement's day gives that
  // statement's figures, whatever has been ticked since.
  const atDay = { accountId: bank.ledgerAccountId, date: { lte: asOf } } satisfies Prisma.JournalLineWhereInput;
  const clearedByDay = { reconciliation: { is: { reconciledOn: { lte: asOf } } } } satisfies Prisma.JournalLineWhereInput;
  const outstandingOnDay = {
    OR: [{ reconciliation: { is: null } }, { reconciliation: { is: { reconciledOn: { gt: asOf } } } }],
  } satisfies Prisma.JournalLineWhereInput;
  const search = (query.search ?? "").trim();
  const number = /^\d{1,9}$/.test(search) ? Number(search) : null;
  const searchWhere: Prisma.JournalLineWhereInput = search
    ? {
        OR: [
          { memo: { contains: search, mode: "insensitive" } },
          { entry: { sourceRef: { contains: search, mode: "insensitive" } } },
          { entry: { memo: { contains: search, mode: "insensitive" } } },
          ...(number ? [{ entry: { number } }] : []),
        ],
      }
    : {};
  const listWhere: Prisma.JournalLineWhereInput = {
    AND: [
      {
        accountId: bank.ledgerAccountId,
        date: { lte: asOf, ...(query.from ? { gte: query.from } : {}) },
      },
      status === "unreconciled" ? outstandingOnDay : status === "reconciled" ? clearedByDay : {},
      searchWhere,
    ],
  };

  const [book, reconciled, unreconciledCount, reconciledCount, last, rows, total] = await Promise.all([
    db.journalLine.aggregate({ where: atDay, _sum: { debit: true, credit: true } }),
    db.journalLine.aggregate({
      where: { ...atDay, ...clearedByDay },
      _sum: { debit: true, credit: true },
    }),
    db.journalLine.count({ where: { AND: [atDay, outstandingOnDay] } }),
    db.journalLine.count({ where: { ...atDay, ...clearedByDay } }),
    db.bankReconciledLine.aggregate({
      where: { bankAccountId: bank.id, reconciledOn: { lte: asOf } },
      _max: { reconciledOn: true },
    }),
    db.journalLine.findMany({
      where: listWhere,
      select: {
        id: true,
        date: true,
        lineNo: true,
        debit: true,
        credit: true,
        memo: true,
        partyType: true,
        partyId: true,
        entry: {
          select: {
            id: true,
            number: true,
            sourceType: true,
            sourceId: true,
            sourceRef: true,
            memo: true,
            status: true,
            reversesId: true,
          },
        },
        reconciliation: { select: { reconciledOn: true } },
      },
      orderBy: [{ date: "asc" }, { entry: { number: "asc" } }, { lineNo: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.journalLine.count({ where: listWhere }),
  ]);

  const names = await partyNames(rows.map((row) => ({ partyType: row.partyType, partyId: row.partyId })));
  const bookBalance = net(book._sum);
  const reconciledBalance = net(reconciled._sum);
  return {
    bank: {
      id: bank.id,
      name: bank.name,
      kind: bank.kind,
      currency: bank.currency,
      ledgerAccount: bank.ledgerAccount,
    },
    asOf: formatDay(asOf),
    summary: {
      bookBalance,
      reconciledBalance,
      unreconciledBalance: (toHalalas(bookBalance) - toHalalas(reconciledBalance)) / 100 || 0,
      unreconciledCount,
      reconciledCount,
      lastReconciledOn: last._max.reconciledOn ? formatDay(last._max.reconciledOn) : null,
    },
    lines: rows.map((row) => ({
      id: row.id,
      date: formatDay(row.date),
      entryId: row.entry.id,
      entryNumber: row.entry.number,
      sourceType: row.entry.sourceType,
      sourceId: row.entry.sourceId,
      sourceRef: row.entry.sourceRef,
      memo: row.memo ?? row.entry.memo,
      partyType: row.partyType,
      partyName: row.partyType && row.partyId ? (names.get(`${row.partyType}:${row.partyId}`) ?? null) : null,
      debit: money(row.debit),
      credit: money(row.credit),
      reversed: row.entry.status === "reversed",
      isReversal: Boolean(row.entry.reversesId),
      reconciledOn: row.reconciliation ? formatDay(row.reconciliation.reconciledOn) : null,
    })),
    total,
  };
}

/** The most lines one tick or un-tick may carry. */
export const MAX_RECONCILE_LINES = 1000;

export interface ReconcileInput {
  bankAccountId: string;
  lineIds: string[];
  /** true ticks the lines off; false takes the tick away. */
  reconciled: boolean;
  /** The day the bank cleared them; today when left out. */
  reconciledOn?: unknown;
}

/**
 * Tick lines off against the statement, or take the tick away. Lines already
 * in the state asked for are left as they are, so the same request twice does
 * the same as once.
 */
export async function setReconciled(
  input: ReconcileInput,
  userId: string | null,
): Promise<{ changed: number; requested: number }> {
  await requirePurchases();
  const ids = [...new Set(input.lineIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) throw ledgerError("RECONCILE_NO_LINES", "Choose the lines first");
  if (ids.length > MAX_RECONCILE_LINES) {
    throw ledgerError(
      "RECONCILE_TOO_MANY",
      `Reconcile at most ${MAX_RECONCILE_LINES} lines at a time`,
    );
  }
  const bank = await loadBank(input.bankAccountId);
  const lines = await db.journalLine.findMany({
    where: { id: { in: ids }, accountId: bank.ledgerAccountId },
    select: { id: true, reconciliation: { select: { id: true } } },
  });
  if (lines.length !== ids.length) {
    throw ledgerError("RECONCILE_LINE_INVALID", "A line does not belong to this account");
  }

  let changed: number;
  let ticked: Date | null = null;
  if (input.reconciled) {
    const day = input.reconciledOn ? dayOrThrow(input.reconciledOn, "The reconciliation date") : today();
    ticked = day;
    if (day.getTime() > today().getTime()) {
      throw ledgerError("RECONCILE_DATE_FUTURE", "A line cannot be reconciled on a day that has not come");
    }
    const toTick = lines.filter((line) => !line.reconciliation).map((line) => line.id);
    if (toTick.length) {
      const organizationId = requireOrgId();
      await db.bankReconciledLine.createMany({
        data: toTick.map((journalLineId) => ({
          organizationId,
          bankAccountId: bank.id,
          journalLineId,
          reconciledOn: day,
          createdById: userId,
        })),
        skipDuplicates: true,
      });
    }
    changed = toTick.length;
  } else {
    const removed = await db.bankReconciledLine.deleteMany({
      where: { bankAccountId: bank.id, journalLineId: { in: ids } },
    });
    changed = removed.count;
  }

  if (changed > 0) {
    void recordActivity({
      action: AuditAction.UPDATE,
      recordType: "bank_reconciliation",
      recordId: bank.id,
      // A standard account starts unnamed: the screens show its ledger account's name.
      recordName: bankAccountLabel(bank),
      // The screen's own sentences ("Lines reconciled: 5" / "Lines taken off
      // the reconciliation: 5"), so the log words it as the office saw it.
      messageKey: input.reconciled
        ? "purchases.reconcile.reconciledToast"
        : "purchases.reconcile.unreconciledToast",
      messageParams: { count: changed },
      after: {
        lines: changed,
        ...(ticked ? { reconciledOn: dayText(ticked) } : {}),
      },
    });
  } else {
    // Every line was already as asked: nothing happened, so no basic entry either.
    noteAuditEntry();
  }
  return { changed, requested: ids.length };
}
