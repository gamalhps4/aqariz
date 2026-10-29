/**
 * PropertyPro - Reading the books for the ledger's reports
 *
 * Every report reads journal_lines and nothing else (names aside): sums per
 * account over a span of days, or the lines themselves for a statement. The
 * arithmetic is ./compute.ts; this gathers what it needs and resolves the
 * names the screens and the files print — accounts, parties, buildings.
 *
 * Days are the ledger's calendar days (midnight UTC, see ../dates.ts): `from`
 * and `to` are both included. All of an office's lines count — the original
 * of a reversed entry and its reversal alike, which net to nothing — because
 * that is what the books hold.
 */

import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { EXPORT_FETCH_LIMIT } from "@/lib/reports/export";
import { accountingPhase0Available } from "@/lib/invoice/phase0-columns";
import { customerPartyId } from "../documents.service";
import { loadChart, requireAccountingSettings, resolvedMap, type ChartAccount } from "../settings.service";
import { ledgerError } from "../errors";
import { toHalalas, type Halalas } from "../money";
import { formatDay } from "../dates";
import { isVatCode, type AccountType, type BankAccountKind, type PartyType, BANK_ACCOUNT_KINDS } from "../types";
import type { SystemKey } from "../system-keys";
import {
  buildStatement,
  computeBalanceSheet,
  computeProfitAndLoss,
  computeTrialBalance,
  computeVatReturn,
  type ReportAccount,
  type Statement,
  type StatementLineInput,
  type Sums,
  type VatLineSums,
} from "./compute";

export interface DayRange {
  from: Date | null;
  to: Date | null;
}

function dateWhere(range: DayRange): Prisma.JournalLineWhereInput {
  if (!range.from && !range.to) return {};
  return {
    date: {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lte: range.to } : {}),
    },
  };
}

function asReportAccount(account: ChartAccount): ReportAccount {
  return {
    id: account.id,
    code: account.code,
    nameAr: account.nameAr,
    nameEn: account.nameEn,
    type: account.type,
    normalSide: account.normalSide,
    parentId: account.parentId,
    postable: account.postable,
  };
}

/** The chart, the account map — and a refusal for an office with no books. */
async function books() {
  const [settings, chart] = await Promise.all([requireAccountingSettings(), loadChart()]);
  return { settings, chart, map: resolvedMap(settings, chart) };
}

/** Debits and credits per account over the lines `where` picks. */
async function sumsByAccount(where: Prisma.JournalLineWhereInput): Promise<Map<string, Sums>> {
  const rows = await db.journalLine.groupBy({
    by: ["accountId"],
    where,
    _sum: { debit: true, credit: true },
  });
  return new Map(
    rows.map((row) => [
      row.accountId,
      {
        debit: toHalalas(row._sum.debit as unknown as number),
        credit: toHalalas(row._sum.credit as unknown as number),
      },
    ]),
  );
}

async function netBefore(where: Prisma.JournalLineWhereInput, from: Date | null): Promise<Halalas> {
  if (!from) return 0;
  const sums = await db.journalLine.aggregate({
    where: { ...where, date: { lt: from } },
    _sum: { debit: true, credit: true },
  });
  return (
    toHalalas(sums._sum.debit as unknown as number) - toHalalas(sums._sum.credit as unknown as number)
  );
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const partyKey = (type: string | null, id: string | null) => `${type ?? ""}:${id ?? ""}`;

function personName(user: { firstName?: string | null; lastName?: string | null; email?: string | null }) {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || "—";
}

/** The name of every party named, keyed `type:id`. */
export async function partyNames(
  parties: ReadonlyArray<{ partyType: string | null; partyId: string | null }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = (type: string) => [
    ...new Set(parties.filter((party) => party.partyType === type && party.partyId).map((party) => party.partyId!)),
  ];
  const people = [...ids("tenant"), ...ids("owner")];
  const suppliers = ids("supplier");
  const customers = ids("customer");
  const phase0 = suppliers.length > 0 || customers.length > 0 ? await accountingPhase0Available() : false;

  const [users, owners, supplierRows, customerRows] = await Promise.all([
    people.length
      ? db.user.findMany({
          where: { id: { in: [...new Set(people)] }, deletedAt: undefined },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : Promise.resolve([]),
    ids("owner").length
      ? db.owner.findMany({
          where: { userId: { in: ids("owner") }, deletedAt: undefined },
          select: { userId: true, companyName: true },
        })
      : Promise.resolve([]),
    phase0 && suppliers.length
      ? db.supplier.findMany({
          where: { id: { in: suppliers }, deletedAt: undefined },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    phase0 && customers.length
      ? db.invoice.findMany({
          where: { customerType: "customer", deletedAt: undefined },
          select: { customerName: true, customerVatNumber: true },
          distinct: ["customerName", "customerVatNumber"],
          orderBy: { createdAt: "desc" },
          take: 5000,
        })
      : Promise.resolve([]),
  ]);
  const company = new Map(owners.map((owner) => [owner.userId, owner.companyName?.trim() || null]));
  for (const user of users) {
    const name = personName(user);
    out.set(partyKey("tenant", user.id), name);
    out.set(partyKey("owner", user.id), company.get(user.id) || name);
  }
  for (const supplier of supplierRows) out.set(partyKey("supplier", supplier.id), supplier.name);
  for (const row of customerRows) {
    const id = customerPartyId(row.customerName, row.customerVatNumber);
    if (id && !out.has(partyKey("customer", id)) && row.customerName) {
      out.set(partyKey("customer", id), row.customerName.trim());
    }
  }
  return out;
}

async function propertyNames(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const rows = await db.property.findMany({
    where: { id: { in: wanted }, deletedAt: undefined },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export interface StatementView {
  opening: number;
  closing: number;
  totals: { debit: number; credit: number };
  /** The list stopped at the export limit. */
  truncated: boolean;
  rows: Array<{
    id: string;
    date: string;
    entryId: string;
    entryNumber: number;
    sourceType: string;
    sourceId: string | null;
    sourceRef: string | null;
    memo: string | null;
    account: { id: string; code: string; nameAr: string; nameEn: string } | null;
    partyType: string | null;
    partyId: string | null;
    partyName: string | null;
    propertyId: string | null;
    propertyName: string | null;
    debit: number;
    credit: number;
    balance: number;
  }>;
}

const riyals = (halalas: Halalas) => halalas / 100;

async function statementLines(where: Prisma.JournalLineWhereInput, range: DayRange) {
  const rows = await db.journalLine.findMany({
    where: { ...where, ...dateWhere(range) },
    orderBy: [{ date: "asc" }, { entry: { number: "asc" } }, { lineNo: "asc" }],
    take: EXPORT_FETCH_LIMIT,
    select: {
      id: true,
      date: true,
      entryId: true,
      accountId: true,
      partyType: true,
      partyId: true,
      propertyId: true,
      memo: true,
      debit: true,
      credit: true,
      entry: { select: { number: true, sourceType: true, sourceId: true, sourceRef: true, memo: true } },
    },
  });
  const truncated = rows.length >= EXPORT_FETCH_LIMIT;
  const lines: StatementLineInput[] = rows.slice(0, EXPORT_FETCH_LIMIT - 1).map((row) => ({
    id: row.id,
    date: row.date,
    entryId: row.entryId,
    entryNumber: row.entry.number,
    sourceType: row.entry.sourceType,
    sourceId: row.entry.sourceId,
    sourceRef: row.entry.sourceRef,
    memo: row.memo || row.entry.memo,
    accountId: row.accountId,
    partyType: row.partyType,
    partyId: row.partyId,
    propertyId: row.propertyId,
    debit: toHalalas(row.debit as unknown as number),
    credit: toHalalas(row.credit as unknown as number),
  }));
  return { lines, truncated };
}

/**
 * A statement whose lines stopped at the limit still closes on the real
 * balance: the period's totals are read whole.
 */
async function completeStatement(
  statement: Statement,
  truncated: boolean,
  where: Prisma.JournalLineWhereInput,
  range: DayRange,
  normalSide: string,
): Promise<Statement> {
  if (!truncated) return statement;
  const sums = await db.journalLine.aggregate({
    where: { ...where, ...dateWhere(range) },
    _sum: { debit: true, credit: true },
  });
  const debit = toHalalas(sums._sum.debit as unknown as number);
  const credit = toHalalas(sums._sum.credit as unknown as number);
  const sign = normalSide === "credit" ? -1 : 1;
  return {
    ...statement,
    totals: { debit, credit },
    closing: statement.opening + sign * (debit - credit) || 0,
  };
}

async function statementView(
  statement: Statement,
  truncated: boolean,
  chart: readonly ChartAccount[],
): Promise<StatementView> {
  const accounts = new Map(chart.map((account) => [account.id, account]));
  const [names, buildings] = await Promise.all([
    partyNames(statement.rows),
    propertyNames(statement.rows.map((row) => row.propertyId)),
  ]);
  return {
    opening: riyals(statement.opening),
    closing: riyals(statement.closing),
    totals: { debit: riyals(statement.totals.debit), credit: riyals(statement.totals.credit) },
    truncated,
    rows: statement.rows.map((row) => {
      const account = accounts.get(row.accountId);
      return {
        id: row.id,
        date: formatDay(row.date),
        entryId: row.entryId,
        entryNumber: row.entryNumber,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        sourceRef: row.sourceRef,
        memo: row.memo,
        account: account
          ? { id: account.id, code: account.code, nameAr: account.nameAr, nameEn: account.nameEn }
          : null,
        partyType: row.partyType,
        partyId: row.partyId,
        partyName: row.partyId ? (names.get(partyKey(row.partyType, row.partyId)) ?? null) : null,
        propertyId: row.propertyId,
        propertyName: row.propertyId ? (buildings.get(row.propertyId) ?? null) : null,
        debit: riyals(row.debit),
        credit: riyals(row.credit),
        balance: riyals(row.balance),
      };
    }),
  };
}

export interface AccountStatementRequest extends DayRange {
  accountId: string;
  propertyId?: string | null;
}

/** كشف حساب عام: one account's lines over the period, with a running balance. */
export async function accountStatement(request: AccountStatementRequest) {
  const { chart } = await books();
  const account = chart.find((candidate) => candidate.id === request.accountId);
  if (!account) throw ledgerError("LEDGER_ACCOUNT_NOT_FOUND", "Account not found", 404);
  const where: Prisma.JournalLineWhereInput = {
    accountId: account.id,
    ...(request.propertyId ? { propertyId: request.propertyId } : {}),
  };
  const [openingNet, { lines, truncated }] = await Promise.all([
    netBefore(where, request.from),
    statementLines(where, request),
  ]);
  const statement = await completeStatement(
    buildStatement(openingNet, lines, account.normalSide),
    truncated,
    where,
    request,
    account.normalSide,
  );
  return {
    account: asReportAccount(account),
    period: { from: request.from ? formatDay(request.from) : null, to: request.to ? formatDay(request.to) : null },
    ...(await statementView(statement, truncated, chart)),
  };
}

/** The accounts a party's statement reads by default: their sub-ledger. */
export const PARTY_CONTROL_KEYS: Readonly<Record<PartyType, readonly SystemKey[]>> = {
  tenant: ["tenant_receivables"],
  customer: ["customer_receivables"],
  // What the office owes them, less what they owe on invoices raised to them.
  owner: ["owner_payable", "customer_receivables"],
  supplier: ["supplier_payables"],
};

/** A receivable reads as what they owe; a payable as what the office owes them. */
export const PARTY_NORMAL_SIDE: Readonly<Record<PartyType, "debit" | "credit">> = {
  tenant: "debit",
  customer: "debit",
  owner: "credit",
  supplier: "credit",
};

export interface PartyStatementRequest extends DayRange {
  partyType: PartyType;
  partyId: string;
  /** One account instead of the party's sub-ledger accounts. */
  accountId?: string | null;
}

/** كشف حساب: a tenant's, an owner's, a customer's or a supplier's account. */
export async function partyStatement(request: PartyStatementRequest) {
  const { chart, map } = await books();
  const accountIds = request.accountId
    ? [request.accountId]
    : PARTY_CONTROL_KEYS[request.partyType]
        .map((key) => map.get(key))
        .filter((id): id is string => Boolean(id));
  const where: Prisma.JournalLineWhereInput = {
    partyType: request.partyType,
    partyId: request.partyId,
    accountId: { in: accountIds },
  };
  const [openingNet, { lines, truncated }, names] = await Promise.all([
    netBefore(where, request.from),
    statementLines(where, request),
    partyNames([{ partyType: request.partyType, partyId: request.partyId }]),
  ]);
  const normalSide = PARTY_NORMAL_SIDE[request.partyType];
  const statement = await completeStatement(
    buildStatement(openingNet, lines, normalSide),
    truncated,
    where,
    request,
    normalSide,
  );
  const accounts = new Map(chart.map((account) => [account.id, account]));
  return {
    party: {
      type: request.partyType,
      id: request.partyId,
      name: names.get(partyKey(request.partyType, request.partyId)) ?? null,
    },
    normalSide,
    accounts: accountIds
      .map((id) => accounts.get(id))
      .filter((account): account is ChartAccount => Boolean(account))
      .map(asReportAccount),
    period: { from: request.from ? formatDay(request.from) : null, to: request.to ? formatDay(request.to) : null },
    ...(await statementView(statement, truncated, chart)),
  };
}

export interface PartyOptionRow {
  id: string;
  name: string;
  /** Their balance on the sub-ledger accounts, on the party's normal side. */
  balance: number;
}

/** Everyone of a kind the books hold lines for, with their balance — the party picker. */
export async function partyOptions(partyType: PartyType): Promise<PartyOptionRow[]> {
  const { map } = await books();
  const accountIds = PARTY_CONTROL_KEYS[partyType]
    .map((key) => map.get(key))
    .filter((id): id is string => Boolean(id));
  const rows = await db.journalLine.groupBy({
    by: ["partyId"],
    where: { partyType, partyId: { not: null }, accountId: { in: accountIds } },
    _sum: { debit: true, credit: true },
  });
  const names = await partyNames(rows.map((row) => ({ partyType, partyId: row.partyId })));
  const sign = PARTY_NORMAL_SIDE[partyType] === "credit" ? -1 : 1;
  return rows
    .filter((row): row is typeof row & { partyId: string } => Boolean(row.partyId))
    .map((row) => ({
      id: row.partyId,
      name: names.get(partyKey(partyType, row.partyId)) ?? row.partyId,
      balance: riyals(
        sign *
          (toHalalas(row._sum.debit as unknown as number) - toHalalas(row._sum.credit as unknown as number)) || 0,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Trial balance, profit and loss, balance sheet
// ---------------------------------------------------------------------------

const sumsView = (sums: Sums) => ({ debit: riyals(sums.debit), credit: riyals(sums.credit) });

export async function trialBalance(request: DayRange & { includeZero?: boolean }) {
  const { chart } = await books();
  const [opening, period] = await Promise.all([
    request.from ? sumsByAccount({ date: { lt: request.from } }) : Promise.resolve(new Map<string, Sums>()),
    sumsByAccount(dateWhere(request)),
  ]);
  const result = computeTrialBalance(chart.map(asReportAccount), opening, period, {
    includeZero: request.includeZero,
  });
  return {
    period: { from: request.from ? formatDay(request.from) : null, to: request.to ? formatDay(request.to) : null },
    balanced: result.balanced,
    totals: {
      opening: sumsView(result.totals.opening),
      period: sumsView(result.totals.period),
      closing: sumsView(result.totals.closing),
    },
    rows: result.rows.map((row) => ({
      account: row.account,
      opening: sumsView(row.opening),
      period: sumsView(row.period),
      closing: sumsView(row.closing),
    })),
  };
}

const treeView = (rows: ReturnType<typeof computeProfitAndLoss>["income"]) =>
  rows.map((row) => ({
    account: row.account,
    depth: row.depth,
    heading: row.heading,
    amount: riyals(row.amount),
  }));

export async function profitAndLoss(request: DayRange & { propertyId?: string | null }) {
  const { chart } = await books();
  const period = await sumsByAccount({
    ...dateWhere(request),
    ...(request.propertyId ? { propertyId: request.propertyId } : {}),
  });
  const result = computeProfitAndLoss(chart.map(asReportAccount), period);
  return {
    period: { from: request.from ? formatDay(request.from) : null, to: request.to ? formatDay(request.to) : null },
    income: treeView(result.income),
    expenses: treeView(result.expenses),
    totalIncome: riyals(result.totalIncome),
    totalExpenses: riyals(result.totalExpenses),
    netProfit: riyals(result.netProfit),
  };
}

export async function balanceSheet(asOf: Date) {
  const { chart } = await books();
  const sums = await sumsByAccount({ date: { lte: asOf } });
  const result = computeBalanceSheet(chart.map(asReportAccount), sums);
  return {
    asOf: formatDay(asOf),
    assets: treeView(result.assets),
    liabilities: treeView(result.liabilities),
    equity: treeView(result.equity),
    totalAssets: riyals(result.totalAssets),
    totalLiabilities: riyals(result.totalLiabilities),
    totalEquity: riyals(result.totalEquity),
    profitToDate: riyals(result.profitToDate),
    totalLiabilitiesAndEquity: riyals(result.totalLiabilitiesAndEquity),
    balanced: result.balanced,
  };
}

// ---------------------------------------------------------------------------
// Banks
// ---------------------------------------------------------------------------

export interface BankReportRow {
  id: string;
  kind: BankAccountKind;
  name: string;
  bankName: string | null;
  iban: string | null;
  active: boolean;
  ledgerAccount: { id: string; code: string; nameAr: string; nameEn: string };
  opening: number;
  /** Money in over the period (debits). */
  moneyIn: number;
  /** Money out over the period (credits). */
  moneyOut: number;
  closing: number;
}

/** Each bank, cash, POS and gateway account: opening, in, out, closing. */
export async function bankReport(request: DayRange & { bankAccountId?: string | null }) {
  await books();
  const accounts = await db.bankAccount.findMany({
    include: { ledgerAccount: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
  });
  const ledgerIds = accounts.map((account) => account.ledgerAccountId);
  const [opening, period] = ledgerIds.length
    ? await Promise.all([
        request.from
          ? sumsByAccount({ accountId: { in: ledgerIds }, date: { lt: request.from } })
          : Promise.resolve(new Map<string, Sums>()),
        sumsByAccount({ accountId: { in: ledgerIds }, ...dateWhere(request) }),
      ])
    : [new Map<string, Sums>(), new Map<string, Sums>()];

  const rows: BankReportRow[] = accounts.map((account) => {
    const open = opening.get(account.ledgerAccountId) ?? { debit: 0, credit: 0 };
    const moved = period.get(account.ledgerAccountId) ?? { debit: 0, credit: 0 };
    const openNet = open.debit - open.credit;
    return {
      id: account.id,
      kind: (BANK_ACCOUNT_KINDS as readonly string[]).includes(account.kind)
        ? (account.kind as BankAccountKind)
        : "bank",
      name: account.name,
      bankName: account.bankName,
      iban: account.iban,
      active: account.active,
      ledgerAccount: account.ledgerAccount,
      opening: riyals(openNet),
      moneyIn: riyals(moved.debit),
      moneyOut: riyals(moved.credit),
      closing: riyals(openNet + moved.debit - moved.credit),
    };
  });
  const total = (pick: (row: BankReportRow) => number) =>
    riyals(rows.reduce((sum, row) => sum + toHalalas(pick(row)), 0));

  const selected = request.bankAccountId
    ? accounts.find((account) => account.id === request.bankAccountId)
    : null;
  if (request.bankAccountId && !selected) {
    throw ledgerError("LEDGER_BANK_NOT_FOUND", "Bank account not found", 404);
  }
  const movements = selected
    ? await accountStatement({ accountId: selected.ledgerAccountId, from: request.from, to: request.to })
    : null;

  return {
    period: { from: request.from ? formatDay(request.from) : null, to: request.to ? formatDay(request.to) : null },
    rows,
    totals: {
      opening: total((row) => row.opening),
      moneyIn: total((row) => row.moneyIn),
      moneyOut: total((row) => row.moneyOut),
      closing: total((row) => row.closing),
    },
    movements: movements
      ? { bankAccountId: selected!.id, ...movements }
      : null,
  };
}

// ---------------------------------------------------------------------------
// VAT return
// ---------------------------------------------------------------------------

/** The VAT-coded lines over a period, per account and code, as the return reads them. */
export async function vatLineSums(range: DayRange): Promise<VatLineSums[]> {
  const { chart, map } = await books();
  const types = new Map<string, AccountType>(chart.map((account) => [account.id, account.type]));
  const outputId = map.get("output_vat");
  const inputId = map.get("input_vat");
  const rows = await db.journalLine.groupBy({
    by: ["accountId", "vatCode"],
    where: { ...dateWhere(range), vatCode: { not: null } },
    _sum: { debit: true, credit: true },
  });
  return rows
    .filter((row) => isVatCode(row.vatCode))
    .map((row) => ({
      accountType: types.get(row.accountId) ?? "asset",
      role:
        row.accountId === outputId ? "output_vat" : row.accountId === inputId ? "input_vat" : null,
      vatCode: row.vatCode as VatLineSums["vatCode"],
      debit: toHalalas(row._sum.debit as unknown as number),
      credit: toHalalas(row._sum.credit as unknown as number),
    }));
}

export async function vatReturn(range: DayRange) {
  const [settings, lines] = await Promise.all([requireAccountingSettings(), vatLineSums(range)]);
  const result = computeVatReturn(lines);
  const box = (row: (typeof result.sales)[number]) => ({
    box: row.box,
    label: row.label,
    amount: riyals(row.amount),
    vat: riyals(row.vat),
  });
  return {
    period: { from: range.from ? formatDay(range.from) : null, to: range.to ? formatDay(range.to) : null },
    vatRegistered: settings.vatRegistered,
    vatNumber: settings.vatNumber,
    sales: result.sales.map(box),
    purchases: result.purchases.map(box),
    totalOutputVat: riyals(result.totalOutputVat),
    totalInputVat: riyals(result.totalInputVat),
    netVatDue: riyals(result.netVatDue),
  };
}
