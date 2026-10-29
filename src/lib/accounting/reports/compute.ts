/**
 * PropertyPro - The ledger's reports, worked out from journal lines
 *
 * Every figure here comes from the books alone — the lines the posting rules
 * and the accountants wrote — never from the documents behind them, so the
 * reports agree with each other and with the journal by construction:
 *
 *   statement       an account's (or a party's) opening balance, its lines in
 *                   the period with a running balance, and where it closed;
 *   trial balance   every account's opening, period movement and closing
 *                   balance — total debits equal total credits in each pair;
 *   profit & loss   income less expenses over a period, by account under its
 *                   headings;
 *   balance sheet   assets, liabilities and equity at a day. The books are
 *                   never closed into retained earnings, so the profit or loss
 *                   to date stands in equity as its own line, and
 *                   assets = liabilities + equity + that profit;
 *   VAT return      the ZATCA boxes, from the lines the rules marked with a
 *                   VAT code (S, Z, E): sales on income accounts, purchases on
 *                   cost and asset accounts, the VAT itself on the output and
 *                   input VAT accounts. A line with no code — paying the VAT
 *                   to ZATCA, an owner's money — is not in the return.
 *
 * Pure and in halalas: the service reads the sums, the routes and the
 * screens show riyals.
 */

import type { Halalas } from "../money";
import type { AccountType, VatCode } from "../types";

/** An account as the reports read it from the chart. */
export interface ReportAccount {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  normalSide: string;
  parentId: string | null;
  postable: boolean;
}

/** Debits and credits, in halalas. */
export interface Sums {
  debit: Halalas;
  credit: Halalas;
}

const ZERO: Sums = { debit: 0, credit: 0 };

/** A balance as the two columns it is printed in: on its debit or credit side. */
export function sideOf(net: Halalas): Sums {
  return net >= 0 ? { debit: net, credit: 0 } : { debit: 0, credit: -net };
}

/** +1 for an account kept on the debit side, -1 for one kept on the credit side. */
export function normalSign(normalSide: string): 1 | -1 {
  return normalSide === "credit" ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Statement of an account or a party
// ---------------------------------------------------------------------------

export interface StatementLineInput {
  id: string;
  date: Date;
  entryId: string;
  entryNumber: number;
  sourceType: string;
  sourceId: string | null;
  sourceRef: string | null;
  memo: string | null;
  accountId: string;
  partyType: string | null;
  partyId: string | null;
  propertyId: string | null;
  debit: Halalas;
  credit: Halalas;
}

export interface StatementRow extends StatementLineInput {
  /** After this line, on the statement's normal side. */
  balance: Halalas;
}

export interface Statement {
  /** Before the first day, on the statement's normal side. */
  opening: Halalas;
  rows: StatementRow[];
  totals: Sums;
  closing: Halalas;
}

/**
 * Lines in order with a running balance. `openingNet` is debits less credits
 * before the period; the balances are read on `normalSide` (a receivable's
 * balance is what is owed to the office, a payable's what the office owes).
 */
export function buildStatement(
  openingNet: Halalas,
  lines: readonly StatementLineInput[],
  normalSide: string,
): Statement {
  const sign = normalSign(normalSide);
  const ordered = [...lines].sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      a.entryNumber - b.entryNumber ||
      a.id.localeCompare(b.id),
  );
  let net = openingNet;
  const totals = { ...ZERO };
  const rows = ordered.map((line) => {
    net += line.debit - line.credit;
    totals.debit += line.debit;
    totals.credit += line.credit;
    return { ...line, balance: sign * net || 0 };
  });
  return { opening: sign * openingNet || 0, rows, totals, closing: sign * net || 0 };
}

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------

export interface TrialBalanceRow {
  account: ReportAccount;
  opening: Sums;
  period: Sums;
  closing: Sums;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totals: { opening: Sums; period: Sums; closing: Sums };
  /** Each pair of columns adds up: debits equal credits. */
  balanced: boolean;
}

/**
 * Every account with a balance or a movement (or every postable account,
 * with `includeZero`), by code. Opening and closing are balances, on the side
 * they fall; the period columns are the movement itself.
 */
export function computeTrialBalance(
  chart: readonly ReportAccount[],
  openingSums: ReadonlyMap<string, Sums>,
  periodSums: ReadonlyMap<string, Sums>,
  options: { includeZero?: boolean } = {},
): TrialBalance {
  const totals = { opening: { ...ZERO }, period: { ...ZERO }, closing: { ...ZERO } };
  const rows: TrialBalanceRow[] = [];
  const known = new Set(chart.map((account) => account.id));
  // Lines on an account the chart no longer lists (it cannot be deleted
  // while it has lines, but be safe) still count towards the totals.
  const accounts = [
    ...chart,
    ...[...new Set([...openingSums.keys(), ...periodSums.keys()])]
      .filter((id) => !known.has(id))
      .map(
        (id): ReportAccount => ({
          id,
          code: "?",
          nameAr: id,
          nameEn: id,
          type: "asset",
          normalSide: "debit",
          parentId: null,
          postable: true,
        }),
      ),
  ].sort((a, b) => a.code.localeCompare(b.code));

  for (const account of accounts) {
    const open = openingSums.get(account.id) ?? ZERO;
    const moved = periodSums.get(account.id) ?? ZERO;
    const openNet = open.debit - open.credit;
    const opening = sideOf(openNet);
    const closing = sideOf(openNet + moved.debit - moved.credit);
    const empty =
      openNet === 0 && moved.debit === 0 && moved.credit === 0;
    if (empty && !(options.includeZero && account.postable)) continue;
    rows.push({ account, opening, period: { ...moved }, closing });
    totals.opening.debit += opening.debit;
    totals.opening.credit += opening.credit;
    totals.period.debit += moved.debit;
    totals.period.credit += moved.credit;
    totals.closing.debit += closing.debit;
    totals.closing.credit += closing.credit;
  }
  return {
    rows,
    totals,
    balanced:
      totals.opening.debit === totals.opening.credit &&
      totals.period.debit === totals.period.credit &&
      totals.closing.debit === totals.closing.credit,
  };
}

// ---------------------------------------------------------------------------
// Accounts under their headings
// ---------------------------------------------------------------------------

export interface TreeRow {
  account: ReportAccount;
  /** 0 for a top heading. */
  depth: number;
  /** Its own amount, or a heading's total of everything under it. */
  amount: Halalas;
  heading: boolean;
}

/**
 * The accounts of these types with an amount, each under its headings, the
 * headings carrying the totals of what is beneath them; depth-first by code.
 * A heading with nothing under it is left out.
 */
export function accountTree(
  chart: readonly ReportAccount[],
  amounts: ReadonlyMap<string, Halalas>,
  types: readonly AccountType[],
): TreeRow[] {
  const ofType = chart.filter((account) => types.includes(account.type));
  const ids = new Set(ofType.map((account) => account.id));
  const children = new Map<string | null, ReportAccount[]>();
  for (const account of ofType) {
    // A parent of another type (or none) makes this a top of its own tree.
    const parent = account.parentId && ids.has(account.parentId) ? account.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), account]);
  }
  for (const list of children.values()) list.sort((a, b) => a.code.localeCompare(b.code));

  const rows: TreeRow[] = [];
  const walk = (account: ReportAccount, depth: number): { amount: Halalas; any: boolean } => {
    const at = rows.length;
    const own = amounts.get(account.id) ?? 0;
    let total = own;
    let any = own !== 0;
    const kids = children.get(account.id) ?? [];
    const placeholder: TreeRow = { account, depth, amount: 0, heading: kids.length > 0 || !account.postable };
    rows.push(placeholder);
    for (const child of kids) {
      const result = walk(child, depth + 1);
      total += result.amount;
      any = any || result.any;
    }
    if (!any) {
      rows.length = at;
      return { amount: 0, any: false };
    }
    placeholder.amount = total;
    return { amount: total, any };
  };
  for (const root of children.get(null) ?? []) walk(root, 0);
  return rows;
}

// ---------------------------------------------------------------------------
// Profit and loss
// ---------------------------------------------------------------------------

export interface ProfitAndLoss {
  income: TreeRow[];
  expenses: TreeRow[];
  totalIncome: Halalas;
  totalExpenses: Halalas;
  /** Income less expenses: a loss is negative. */
  netProfit: Halalas;
}

/** Income is what was credited (net), an expense what was debited (net). */
export function computeProfitAndLoss(
  chart: readonly ReportAccount[],
  periodSums: ReadonlyMap<string, Sums>,
): ProfitAndLoss {
  const byType = new Map(chart.map((account) => [account.id, account.type]));
  const income = new Map<string, Halalas>();
  const expenses = new Map<string, Halalas>();
  let totalIncome = 0;
  let totalExpenses = 0;
  for (const [id, sums] of periodSums) {
    const type = byType.get(id);
    if (type === "income") {
      const amount = sums.credit - sums.debit;
      income.set(id, amount);
      totalIncome += amount;
    } else if (type === "expense") {
      const amount = sums.debit - sums.credit;
      expenses.set(id, amount);
      totalExpenses += amount;
    }
  }
  return {
    income: accountTree(chart, income, ["income"]),
    expenses: accountTree(chart, expenses, ["expense"]),
    totalIncome,
    totalExpenses,
    netProfit: totalIncome - totalExpenses,
  };
}

// ---------------------------------------------------------------------------
// Balance sheet
// ---------------------------------------------------------------------------

export interface BalanceSheet {
  assets: TreeRow[];
  liabilities: TreeRow[];
  equity: TreeRow[];
  totalAssets: Halalas;
  totalLiabilities: Halalas;
  /** The equity accounts, before the profit to date. */
  totalEquity: Halalas;
  /** Income less expenses on the books up to the day: not closed anywhere yet. */
  profitToDate: Halalas;
  /** totalLiabilities + totalEquity + profitToDate. */
  totalLiabilitiesAndEquity: Halalas;
  /** Assets equal liabilities plus equity (with the profit to date). */
  balanced: boolean;
}

/**
 * Every balance up to a day: an asset as debits less credits (a contra asset
 * such as accumulated depreciation comes out negative), a liability and
 * equity as credits less debits.
 */
export function computeBalanceSheet(
  chart: readonly ReportAccount[],
  sumsToDate: ReadonlyMap<string, Sums>,
): BalanceSheet {
  const byType = new Map(chart.map((account) => [account.id, account.type]));
  const amounts = { asset: new Map<string, Halalas>(), liability: new Map<string, Halalas>(), equity: new Map<string, Halalas>() };
  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;
  let profitToDate = 0;
  for (const [id, sums] of sumsToDate) {
    const type = byType.get(id) ?? "asset";
    const debitNet = sums.debit - sums.credit;
    switch (type) {
      case "asset":
        amounts.asset.set(id, debitNet);
        totalAssets += debitNet;
        break;
      case "liability":
        amounts.liability.set(id, -debitNet);
        totalLiabilities += -debitNet;
        break;
      case "equity":
        amounts.equity.set(id, -debitNet);
        totalEquity += -debitNet;
        break;
      case "income":
      case "expense":
        profitToDate += -debitNet;
        break;
    }
  }
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity + profitToDate;
  return {
    assets: accountTree(chart, amounts.asset, ["asset"]),
    liabilities: accountTree(chart, amounts.liability, ["liability"]),
    equity: accountTree(chart, amounts.equity, ["equity"]),
    totalAssets,
    totalLiabilities,
    totalEquity,
    profitToDate,
    totalLiabilitiesAndEquity,
    balanced: totalAssets === totalLiabilitiesAndEquity,
  };
}

// ---------------------------------------------------------------------------
// VAT return (ZATCA)
// ---------------------------------------------------------------------------

/** Sums of the lines in the period that carry a VAT code, per account and code. */
export interface VatLineSums {
  accountType: AccountType;
  /** The account the output or input VAT is kept in, by the account map. */
  role: "output_vat" | "input_vat" | null;
  vatCode: VatCode;
  debit: Halalas;
  credit: Halalas;
}

export interface VatBox {
  /** The box's number on the ZATCA form. */
  box: number;
  /** What it is, as the export catalogue names it. */
  label: string;
  amount: Halalas;
  vat: Halalas;
}

export interface VatReturn {
  /** Boxes 1, 3, 5 and their total, 6. */
  sales: VatBox[];
  /** Boxes 7, 10, 11 and their total, 12. */
  purchases: VatBox[];
  /** Box 13: output VAT less input VAT for the period. */
  netVatDue: Halalas;
  totalOutputVat: Halalas;
  totalInputVat: Halalas;
}

/**
 * The boxes the office's books fill. Sales on the income accounts by code
 * (credits less debits — a credit note comes off), the VAT on them from the
 * output VAT account; purchases on the cost and asset accounts by code
 * (debits less credits), the VAT on them from the input VAT account.
 *
 * The boxes the books cannot tell apart — sales to GCC customers (2), exports
 * (4), imports (8, 9) — are not recorded by the app and are left out rather
 * than shown as zero.
 */
export function computeVatReturn(lines: readonly VatLineSums[]): VatReturn {
  const sales = { S: 0, Z: 0, E: 0 } as Record<"S" | "Z" | "E", Halalas>;
  const purchases = { S: 0, Z: 0, E: 0 } as Record<"S" | "Z" | "E", Halalas>;
  let outputVat = 0;
  let inputVat = 0;
  for (const line of lines) {
    if (line.role === "output_vat") {
      if (line.vatCode === "S") outputVat += line.credit - line.debit;
      continue;
    }
    if (line.role === "input_vat") {
      if (line.vatCode === "S") inputVat += line.debit - line.credit;
      continue;
    }
    if (line.vatCode === "O") continue;
    if (line.accountType === "income") {
      sales[line.vatCode] += line.credit - line.debit;
    } else if (line.accountType === "expense" || line.accountType === "asset") {
      purchases[line.vatCode] += line.debit - line.credit;
    }
  }
  const salesTotal = sales.S + sales.Z + sales.E;
  const purchasesTotal = purchases.S + purchases.Z + purchases.E;
  return {
    sales: [
      { box: 1, label: "Standard-rated sales", amount: sales.S, vat: outputVat },
      { box: 3, label: "Zero-rated domestic sales", amount: sales.Z, vat: 0 },
      { box: 5, label: "Exempt sales", amount: sales.E, vat: 0 },
      { box: 6, label: "Total sales", amount: salesTotal, vat: outputVat },
    ],
    purchases: [
      { box: 7, label: "Standard-rated domestic purchases", amount: purchases.S, vat: inputVat },
      { box: 10, label: "Zero-rated purchases", amount: purchases.Z, vat: 0 },
      { box: 11, label: "Exempt purchases", amount: purchases.E, vat: 0 },
      { box: 12, label: "Total purchases", amount: purchasesTotal, vat: inputVat },
    ],
    netVatDue: outputVat - inputVat,
    totalOutputVat: outputVat,
    totalInputVat: inputVat,
  };
}
