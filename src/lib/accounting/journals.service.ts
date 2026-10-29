/**
 * PropertyPro - Reading the books
 *
 * The journal list and an entry's detail for the screens, and the balances
 * every report starts from: each account's debits and credits up to a day,
 * and the check that holds the whole ledger together — total debits equal
 * total credits.
 */

import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { fromHalalas, toHalalas } from "./money";
import { SOURCE_TYPES, type SourceType } from "./types";
import { businessDay } from "@/lib/dates/business-day";

export interface JournalListFilters {
  page: number;
  limit: number;
  from?: Date | null;
  to?: Date | null;
  sourceType?: string | null;
  accountId?: string | null;
  status?: string | null;
  search?: string | null;
}

export interface JournalListRow {
  id: string;
  number: number;
  date: string;
  sourceType: SourceType;
  sourceId: string | null;
  sourceRef: string | null;
  memo: string | null;
  status: string;
  totalAmount: number;
  reversesId: string | null;
  reversesNumber: number | null;
  reversedByNumber: number | null;
  lineCount: number;
}

function journalConditions(filters: JournalListFilters): Prisma.JournalEntryWhereInput {
  const conditions: Prisma.JournalEntryWhereInput[] = [];
  if (filters.from || filters.to) {
    conditions.push({
      date: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
    });
  }
  if (filters.sourceType && (SOURCE_TYPES as readonly string[]).includes(filters.sourceType)) {
    conditions.push({ sourceType: filters.sourceType });
  }
  if (filters.status === "posted" || filters.status === "reversed") {
    conditions.push({ status: filters.status });
  }
  if (filters.accountId) {
    conditions.push({ lines: { some: { accountId: filters.accountId } } });
  }
  const search = filters.search?.trim();
  if (search) {
    const number = Number(search.replace(/^#/, ""));
    conditions.push({
      OR: [
        ...(Number.isInteger(number) && number > 0 ? [{ number }] : []),
        { memo: { contains: search, mode: "insensitive" as const } },
        { sourceRef: { contains: search, mode: "insensitive" as const } },
      ],
    });
  }
  return conditions.length > 0 ? { AND: conditions } : {};
}

export async function listJournals(filters: JournalListFilters): Promise<{ rows: JournalListRow[]; total: number }> {
  const conditions = journalConditions(filters);
  const [entries, total] = await Promise.all([
    db.journalEntry.findMany({
      where: conditions,
      orderBy: [{ date: "desc" }, { number: "desc" }],
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
      select: {
        id: true,
        number: true,
        date: true,
        sourceType: true,
        sourceId: true,
        sourceRef: true,
        memo: true,
        status: true,
        totalAmount: true,
        reversesId: true,
        reverses: { select: { number: true } },
        reversedBy: { select: { number: true }, take: 1 },
        _count: { select: { lines: true } },
      },
    }),
    db.journalEntry.count({ where: conditions }),
  ]);
  return {
    total,
    rows: entries.map((entry) => ({
      id: entry.id,
      number: entry.number,
      date: businessDay(entry.date),
      sourceType: entry.sourceType as SourceType,
      sourceId: entry.sourceId,
      sourceRef: entry.sourceRef,
      memo: entry.memo,
      status: entry.status,
      totalAmount: Number(entry.totalAmount),
      reversesId: entry.reversesId,
      reversesNumber: entry.reverses?.number ?? null,
      reversedByNumber: entry.reversedBy[0]?.number ?? null,
      lineCount: entry._count.lines,
    })),
  };
}

export interface JournalDetail extends JournalListRow {
  createdAt: string;
  createdBy: string | null;
  reversedById: string | null;
  lines: Array<{
    id: string;
    lineNo: number;
    account: { id: string; code: string; nameAr: string; nameEn: string };
    debit: number;
    credit: number;
    partyType: string | null;
    partyId: string | null;
    partyName: string | null;
    propertyId: string | null;
    propertyName: string | null;
    unitId: string | null;
    leaseId: string | null;
    agreementId: string | null;
    vatCode: string | null;
    memo: string | null;
  }>;
}

export async function getJournal(id: string): Promise<JournalDetail | null> {
  const entry = await db.journalEntry.findFirst({
    where: { id },
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: { account: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
      },
      reverses: { select: { number: true } },
      reversedBy: { select: { id: true, number: true }, take: 1 },
    },
  });
  if (!entry) return null;

  const userIds = [
    ...new Set(
      [
        entry.createdById,
        ...entry.lines
          .filter((line) => line.partyType === "tenant" || line.partyType === "owner")
          .map((line) => line.partyId),
      ].filter(Boolean) as string[],
    ),
  ];
  const propertyIds = [...new Set(entry.lines.map((line) => line.propertyId).filter(Boolean) as string[])];
  const [users, properties] = await Promise.all([
    userIds.length
      ? db.user.findMany({
          where: { id: { in: userIds }, deletedAt: undefined },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    propertyIds.length
      ? db.property.findMany({
          where: { id: { in: propertyIds }, deletedAt: undefined },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const userName = new Map(
    users.map((user) => [user.id, `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "—"]),
  );
  const propertyName = new Map(properties.map((property) => [property.id, property.name]));

  return {
    id: entry.id,
    number: entry.number,
    date: businessDay(entry.date),
    sourceType: entry.sourceType as SourceType,
    sourceId: entry.sourceId,
    sourceRef: entry.sourceRef,
    memo: entry.memo,
    status: entry.status,
    totalAmount: Number(entry.totalAmount),
    reversesId: entry.reversesId,
    reversesNumber: entry.reverses?.number ?? null,
    reversedByNumber: entry.reversedBy[0]?.number ?? null,
    reversedById: entry.reversedBy[0]?.id ?? null,
    lineCount: entry.lines.length,
    createdAt: entry.createdAt.toISOString(),
    createdBy: entry.createdById ? (userName.get(entry.createdById) ?? null) : null,
    lines: entry.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      account: line.account,
      debit: Number(line.debit),
      credit: Number(line.credit),
      partyType: line.partyType,
      partyId: line.partyId,
      partyName: line.partyId ? (userName.get(line.partyId) ?? null) : null,
      propertyId: line.propertyId,
      propertyName: line.propertyId ? (propertyName.get(line.propertyId) ?? null) : null,
      unitId: line.unitId,
      leaseId: line.leaseId,
      agreementId: line.agreementId,
      vatCode: line.vatCode,
      memo: line.memo,
    })),
  };
}

export interface LedgerBalances {
  asOf: string | null;
  totalDebit: number;
  totalCredit: number;
  /** Total debits equal total credits — the identity every entry keeps. */
  balanced: boolean;
  entries: number;
  accounts: Array<{ accountId: string; debit: number; credit: number }>;
}

/** Each account's debits and credits up to a day, and the ledger's totals. */
export async function ledgerBalances(asOf?: Date | null): Promise<LedgerBalances> {
  const filters = asOf ? { date: { lte: asOf } } : {};
  const [sums, entries] = await Promise.all([
    db.journalLine.groupBy({
      by: ["accountId"],
      where: filters,
      _sum: { debit: true, credit: true },
    }),
    db.journalEntry.count({ where: filters }),
  ]);
  let debit = 0;
  let credit = 0;
  const accounts = sums.map((row) => {
    const rowDebit = toHalalas(row._sum.debit as unknown as number);
    const rowCredit = toHalalas(row._sum.credit as unknown as number);
    debit += rowDebit;
    credit += rowCredit;
    return { accountId: row.accountId, debit: fromHalalas(rowDebit), credit: fromHalalas(rowCredit) };
  });
  return {
    asOf: asOf ? businessDay(asOf) : null,
    totalDebit: fromHalalas(debit),
    totalCredit: fromHalalas(credit),
    balanced: debit === credit,
    entries,
    accounts,
  };
}
