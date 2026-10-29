/**
 * PropertyPro - The ledger's reports as files
 *
 * Each report's figures as a ReportSheet for buildReportResponse: English
 * headings the export catalogue translates (`exports.label.*`), stored codes
 * it translates as values (source types, party types, bank kinds), and the
 * block under the title saying what the file covers (`filtersSummary`).
 * Account names are written in the reader's language, from the chart.
 *
 * Pure: the routes hand in what the service read.
 */

import {
  reportSection,
  type ReportColumn,
  type ReportFiltersSummary,
  type ReportLanguage,
  type ReportSheet,
} from "@/lib/reports/export";
import { translateLabel } from "@/lib/reports/labels";
import type {
  accountStatement,
  balanceSheet,
  bankReport,
  partyStatement,
  profitAndLoss,
  trialBalance,
  vatReturn,
} from "./service";

type Awaited2<T> = T extends Promise<infer U> ? U : T;
type AccountStatementData = Awaited2<ReturnType<typeof accountStatement>>;
type PartyStatementData = Awaited2<ReturnType<typeof partyStatement>>;
type TrialBalanceData = Awaited2<ReturnType<typeof trialBalance>>;
type ProfitAndLossData = Awaited2<ReturnType<typeof profitAndLoss>>;
type BalanceSheetData = Awaited2<ReturnType<typeof balanceSheet>>;
type BankReportData = Awaited2<ReturnType<typeof bankReport>>;
type VatReturnData = Awaited2<ReturnType<typeof vatReturn>>;

/** An account as the reader reads it: its code and its name in their language. */
export function accountLabel(
  account: { code: string; nameAr: string; nameEn: string } | null | undefined,
  language: ReportLanguage,
): string {
  if (!account) return "";
  const name = language === "ar" ? account.nameAr || account.nameEn : account.nameEn || account.nameAr;
  return `${account.code} · ${name}`;
}

/** A row of an account tree, indented under its headings. */
function treeLabel(
  row: { account: { code: string; nameAr: string; nameEn: string }; depth: number },
  language: ReportLanguage,
): string {
  return `${"  ".repeat(row.depth)}${accountLabel(row.account, language)}`;
}

/** A statement line's description: its memo (the reference has its own column). */
function description(row: { memo: string | null }): string {
  return row.memo ?? "";
}

type StatementRow = AccountStatementData["rows"][number];

function statementColumns(
  language: ReportLanguage,
  options: { account: boolean; party: boolean },
): ReportColumn<StatementRow>[] {
  return [
    { header: "Date", value: (row) => row.date },
    { header: "Entry no.", value: (row) => row.entryNumber },
    ...(options.account
      ? [{ header: "Account", value: (row: StatementRow) => accountLabel(row.account, language) }]
      : []),
    { header: "Source", value: (row) => row.sourceType },
    { header: "Reference", value: (row) => row.sourceRef ?? "" },
    { header: "Description", value: (row) => description(row) },
    ...(options.party
      ? [{ header: "Party", value: (row: StatementRow) => row.partyName ?? "" }]
      : []),
    { header: "Building", value: (row) => row.propertyName ?? "" },
    { header: "Debit", value: (row) => row.debit || null },
    { header: "Credit", value: (row) => row.credit || null },
    { header: "Balance", value: (row) => row.balance },
  ];
}

const statementSummary = (data: {
  opening: number;
  closing: number;
  totals: { debit: number; credit: number };
}): Array<[string, number]> => [
  ["Opening balance", data.opening],
  ["Total debit", data.totals.debit],
  ["Total credit", data.totals.credit],
  ["Closing balance", data.closing],
];

export function accountStatementSheet(
  data: AccountStatementData,
  language: ReportLanguage,
  filters: Array<[string, string | null | undefined]>,
): ReportSheet<StatementRow> {
  return {
    title: "General account statement",
    columns: statementColumns(language, { account: false, party: true }),
    rows: data.rows,
    filtersSummary: {
      period: data.period,
      filters: [["Account", accountLabel(data.account, language)], ...filters],
      limit: 5000,
      truncated: data.truncated,
    },
    summary: statementSummary(data),
    document: {
      details: [["Account", accountLabel(data.account, language)]],
      summaryTitle: "Summary",
      tableTitle: "Movements",
      emptyText: "No entries in this period",
    },
  };
}

export function partyStatementSheet(
  data: PartyStatementData,
  language: ReportLanguage,
): ReportSheet<StatementRow> {
  const filters: ReportFiltersSummary["filters"] = [
    ["Party type", data.party.type],
    ["Party", data.party.name ?? data.party.id],
    ["Accounts", data.accounts.map((account) => accountLabel(account, language)).join(" / ")],
  ];
  return {
    title: "Party statement",
    columns: statementColumns(language, { account: data.accounts.length > 1, party: false }),
    rows: data.rows,
    filtersSummary: { period: data.period, filters, limit: 5000, truncated: data.truncated },
    summary: statementSummary(data),
    document: {
      details: [
        ["Party type", data.party.type],
        ["Party", data.party.name ?? data.party.id],
      ],
      summaryTitle: "Summary",
      tableTitle: "Movements",
      emptyText: "No entries in this period",
    },
  };
}

type TrialBalanceRow = {
  code: string;
  account: string;
  openingDebit: number | null;
  openingCredit: number | null;
  periodDebit: number | null;
  periodCredit: number | null;
  closingDebit: number | null;
  closingCredit: number | null;
};

export function trialBalanceSheet(
  data: TrialBalanceData,
  language: ReportLanguage,
): ReportSheet<TrialBalanceRow> {
  const cell = (value: number) => value || null;
  const rows: TrialBalanceRow[] = data.rows.map((row) => ({
    code: row.account.code,
    account: language === "ar" ? row.account.nameAr || row.account.nameEn : row.account.nameEn || row.account.nameAr,
    openingDebit: cell(row.opening.debit),
    openingCredit: cell(row.opening.credit),
    periodDebit: cell(row.period.debit),
    periodCredit: cell(row.period.credit),
    closingDebit: cell(row.closing.debit),
    closingCredit: cell(row.closing.credit),
  }));
  rows.push({
    code: "",
    account: translateLabel("Total", language),
    openingDebit: data.totals.opening.debit,
    openingCredit: data.totals.opening.credit,
    periodDebit: data.totals.period.debit,
    periodCredit: data.totals.period.credit,
    closingDebit: data.totals.closing.debit,
    closingCredit: data.totals.closing.credit,
  });
  return {
    title: "Trial balance",
    columns: [
      { header: "Code", value: (row) => row.code },
      { header: "Account", value: (row) => row.account },
      { header: "Opening debit", value: (row) => row.openingDebit },
      { header: "Opening credit", value: (row) => row.openingCredit },
      { header: "Period debit", value: (row) => row.periodDebit },
      { header: "Period credit", value: (row) => row.periodCredit },
      { header: "Closing debit", value: (row) => row.closingDebit },
      { header: "Closing credit", value: (row) => row.closingCredit },
    ],
    rows,
    filtersSummary: { period: data.period, filters: [], rows: data.rows.length },
    summary: [["Balanced", data.balanced ? "yes" : "no"]],
  };
}

type TreeSheetRow = { label: string; amount: number };

const treeColumns: ReportColumn<TreeSheetRow>[] = [
  { header: "Account", value: (row) => row.label },
  { header: "Amount", value: (row) => row.amount },
];

function treeRows(
  rows: ProfitAndLossData["income"],
  language: ReportLanguage,
): TreeSheetRow[] {
  return rows.map((row) => ({ label: treeLabel(row, language), amount: row.amount }));
}

export function profitAndLossSheet(
  data: ProfitAndLossData,
  language: ReportLanguage,
  filters: Array<[string, string | null | undefined]>,
): ReportSheet<TreeSheetRow> {
  return {
    title: "Profit and loss",
    columns: treeColumns,
    rows: treeRows(data.income, language),
    filtersSummary: { period: data.period, filters },
    summary: [
      ["Total income", data.totalIncome],
      ["Total expenses", data.totalExpenses],
      ["Net profit", data.netProfit],
    ],
    document: {
      summaryTitle: "Summary",
      tableTitle: "Income",
      emptyText: "No entries in this period",
      sections: [
        reportSection("Expenses", treeColumns, treeRows(data.expenses, language), "No entries in this period"),
      ],
    },
  };
}

export function balanceSheetSheet(
  data: BalanceSheetData,
  language: ReportLanguage,
): ReportSheet<TreeSheetRow> {
  const equity = [
    ...treeRows(data.equity, language),
    { label: translateLabel("Profit and loss to date", language), amount: data.profitToDate },
  ];
  return {
    title: "Balance sheet",
    columns: treeColumns,
    rows: treeRows(data.assets, language),
    filtersSummary: { asAt: data.asOf, filters: [] },
    summary: [
      ["Total assets", data.totalAssets],
      ["Total liabilities", data.totalLiabilities],
      ["Total equity", data.totalEquity],
      ["Profit and loss to date", data.profitToDate],
      ["Total liabilities and equity", data.totalLiabilitiesAndEquity],
      ["Balanced", data.balanced ? "yes" : "no"],
    ],
    document: {
      summaryTitle: "Summary",
      tableTitle: "Assets",
      emptyText: "No entries in this period",
      sections: [
        reportSection("Liabilities", treeColumns, treeRows(data.liabilities, language)),
        reportSection("Equity", treeColumns, equity),
      ],
    },
  };
}

type BankRow = BankReportData["rows"][number];

export function bankReportSheet(
  data: BankReportData,
  language: ReportLanguage,
): ReportSheet<BankRow> {
  const name = (row: BankRow) =>
    row.name ||
    (language === "ar"
      ? row.ledgerAccount.nameAr || row.ledgerAccount.nameEn
      : row.ledgerAccount.nameEn || row.ledgerAccount.nameAr);
  const movements = data.movements;
  const selected = movements ? data.rows.find((row) => row.id === movements.bankAccountId) : null;
  return {
    title: "Banks report",
    columns: [
      { header: "Account", value: (row) => `${row.ledgerAccount.code} · ${name(row)}` },
      { header: "Kind", value: (row) => row.kind },
      { header: "Bank", value: (row) => row.bankName ?? "" },
      { header: "IBAN", value: (row) => row.iban ?? "" },
      { header: "Opening balance", value: (row) => row.opening },
      { header: "Money in", value: (row) => row.moneyIn },
      { header: "Money out", value: (row) => row.moneyOut },
      { header: "Closing balance", value: (row) => row.closing },
    ],
    rows: data.rows,
    filtersSummary: {
      period: data.period,
      filters: selected ? [["Account", `${selected.ledgerAccount.code} · ${name(selected)}`]] : [],
    },
    summary: [
      ["Opening balance", data.totals.opening],
      ["Money in", data.totals.moneyIn],
      ["Money out", data.totals.moneyOut],
      ["Closing balance", data.totals.closing],
    ],
    ...(movements
      ? {
          document: {
            summaryTitle: "Summary",
            tableTitle: "Accounts",
            sections: [
              reportSection(
                "Movements",
                statementColumns(language, { account: false, party: true }),
                movements.rows,
                "No entries in this period",
              ),
            ],
          },
        }
      : {}),
  };
}

type VatBoxRow = VatReturnData["sales"][number];

export function vatReturnSheet(data: VatReturnData, language: ReportLanguage): ReportSheet<VatBoxRow> {
  const columns: ReportColumn<VatBoxRow>[] = [
    { header: "Box", value: (row) => row.box },
    { header: "Description", value: (row) => translateLabel(row.label, language) },
    { header: "Amount", value: (row) => row.amount },
    { header: "VAT", value: (row) => row.vat },
  ];
  return {
    title: "VAT return",
    columns,
    rows: data.sales,
    filtersSummary: { period: data.period, filters: [] },
    summary: [
      ["Total output VAT", data.totalOutputVat],
      ["Total input VAT", data.totalInputVat],
      ["Net VAT due", data.netVatDue],
    ],
    document: {
      details: data.vatNumber ? [["VAT number", data.vatNumber]] : [],
      summaryTitle: "Summary",
      tableTitle: "Sales",
      sections: [reportSection("Purchases", columns, data.purchases)],
    },
  };
}
