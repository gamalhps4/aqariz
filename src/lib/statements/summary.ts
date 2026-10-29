/**
 * PropertyPro - A statement's summary (الملخص), in the reader's language
 *
 * The screen and the exported PDF, Excel and CSV print the summary from this
 * one list, worded from the same catalogue keys — they used to be worded
 * twice, from two catalogues, and had drifted apart ("المحصّل لدى المكتب" in the
 * export, "مستلمة من قبل المشغّل" on screen).
 *
 * The rows are the client's sample, in its order and its words:
 *
 *   إجمالي المحصل · عمولة الإدارة 2% · ضريبة المشغل · المصاريف ·
 *   مستلمة من قبل المالك · مستلمة من قبل المشغل · مستحقات المالك · مستحقات المشغل
 *
 * The commission's percentage is printed here, in its label, and nowhere
 * else — the client asked for it in the details at the top, never in the
 * table below. An investment agreement's rent, when there is one, is the only
 * row the sample does not have.
 */

import type { LineTranslate } from "@/lib/statements/line-text";

/** The catalogue key of the summary's heading — "الملخص". */
export const SUMMARY_TITLE_KEY = "clients.statement.settlement.title";

export interface SummaryFigures {
  /** Everything received in the period. */
  collected: number;
  commission: number;
  commissionTax: number;
  expenses: number;
  investmentRent: number;
  collectedByOwner: number;
  collectedByOperator: number;
  dueToOwner: number;
  dueToOperator: number;
}

export type SummaryRowKey =
  | "collected"
  | "commission"
  | "commissionTax"
  | "expenses"
  | "investmentRent"
  | "byOwner"
  | "byOperator"
  | "dueToOwner"
  | "dueToOperator";

export interface SummaryRow {
  key: SummaryRowKey;
  label: string;
  amount: number;
}

/** What the commission label needs from each building of a commission run. */
export interface CommissionEntryFacts {
  agreementKind: "management" | "investment" | null;
  fee: { type: string; percentage: number } | null;
  commission: number;
}

/**
 * The one percentage every management agreement in a commission run charges,
 * for the summary's label ("عمولة الإدارة 2%"). Null for a flat fee, for
 * agreements that differ, or when none applied. Buildings that earned nothing
 * in the period do not make the label ambiguous.
 */
export function uniformCommissionPercentage(
  entries: readonly CommissionEntryFacts[],
): number | null {
  const managed = entries.filter(
    (entry) => entry.agreementKind === "management" && entry.fee,
  );
  const charged = managed.filter((entry) => entry.commission > 0);
  const fees = (charged.length > 0 ? charged : managed).map((entry) => entry.fee!);
  if (fees.length === 0) return null;
  if (fees.some((fee) => fee.type !== "percentage")) return null;
  const percentages = new Set(fees.map((fee) => fee.percentage));
  return percentages.size === 1 ? fees[0].percentage : null;
}

/** 2 → "2", 2.5 → "2.5": a rate as the agreement states it. */
export function formatRate(rate: number): string {
  return String(Math.round(rate * 100) / 100);
}

export function statementSummaryRows(
  figures: SummaryFigures,
  commissionPercentage: number | null,
  tr: LineTranslate,
): SummaryRow[] {
  const rows: SummaryRow[] = [
    {
      key: "collected",
      label: tr("clients.statement.settlement.collected", "Total collected"),
      amount: figures.collected,
    },
    {
      key: "commission",
      // The Arabic entry stores "%{rate}": after Arabic letters, "2%" is laid
      // out as "%2" by every bidi engine — the browser's and jsPDF's alike —
      // so the sign is written first to read "2%" on the page.
      label:
        commissionPercentage === null
          ? tr("clients.statement.settlement.commission", "Management commission")
          : tr(
              "clients.statement.settlement.commissionRate",
              "Management commission {rate}%",
              { rate: formatRate(commissionPercentage) },
            ),
      amount: figures.commission,
    },
    {
      key: "commissionTax",
      label: tr("clients.statement.settlement.commissionTax", "VAT on commission"),
      amount: figures.commissionTax,
    },
    {
      key: "expenses",
      label: tr("clients.statement.settlement.expenses", "Expenses"),
      amount: figures.expenses,
    },
  ];

  if (figures.investmentRent > 0) {
    rows.push({
      key: "investmentRent",
      label: tr(
        "clients.statement.settlement.investmentRent",
        "Investment rent owed to the owner",
      ),
      amount: figures.investmentRent,
    });
  }

  rows.push(
    {
      key: "byOwner",
      label: tr("clients.statement.settlement.byOwner", "Received by the owner"),
      amount: figures.collectedByOwner,
    },
    {
      key: "byOperator",
      label: tr("clients.statement.settlement.byOperator", "Received by the office"),
      amount: figures.collectedByOperator,
    },
    {
      key: "dueToOwner",
      label: tr("clients.statement.settlement.dueToOwner", "Due to the owner"),
      amount: figures.dueToOwner,
    },
    {
      key: "dueToOperator",
      label: tr("clients.statement.settlement.dueToOperator", "Due to the office"),
      amount: figures.dueToOperator,
    },
  );

  return rows;
}
