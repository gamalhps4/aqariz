/**
 * PropertyPro - Who owes whom at the close of a statement
 *
 * Every statement an owner is sent ends with the same sum, laid out as the
 * statement the client reconciles against (كشف حساب إتفاقيات الإدارة):
 *
 *   إجمالي المحصل        everything received in the period
 *   عمولة الإدارة         the office's fee
 *   ضريبة المشغل          VAT on that fee — the office's own service
 *   المصاريف              what was spent on the buildings
 *   مستلمة من قبل المالك   received straight into the owner's hands
 *   مستلمة من قبل المشغل   received by the office, on the owner's behalf
 *   مستحقات المالك        the office still owes the owner …
 *   مستحقات المشغل        … or the owner still owes the office
 *
 * The owner keeps what was collected less the expenses, the fee and the VAT
 * on it. Whether that leaves the office holding the owner's money or owed its
 * fee depends only on who actually received the rent — so exactly one of the
 * two dues carries a figure.
 *
 * It used to be written out three times — owner statement, agreement report,
 * and not at all on the compound, building and unit statements. It is pure so
 * the client's own samples can pin it (settlement.test.ts).
 */

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface SettlementInput {
  /** إجمالي المحصل — every payment received in the period. */
  collected: number;
  /**
   * Of `collected`, what reached the owner without passing through the
   * office: cash to the owner, a transfer to the owner, the Ejar platform
   * (OWNER_RECEIVED_METHODS in lib/payments/methods.ts).
   */
  collectedByOwner: number;
  /** Expenses deducted from the owner's share. */
  expenses: number;
  /** Management commission for the period. */
  commission: number;
  /** VAT on the commission, as a percentage (15 for 15%). */
  commissionTaxRate: number;
  /**
   * Fixed rent the office owes the owner for buildings it has taken on under
   * an investment agreement.
   */
  investmentRent?: number;
  /**
   * "investment" when the whole statement is one investment agreement: the
   * tenants' rent and the running costs are then the office's, and the owner
   * is owed the fixed rent and nothing else. Anything the tenants paid the
   * owner directly still counts against it.
   */
  kind?: "management" | "investment";
}

export interface Settlement {
  collected: number;
  commission: number;
  /** VAT on the commission, at `commissionTaxRate`. */
  commissionTax: number;
  commissionTaxRate: number;
  expenses: number;
  investmentRent: number;
  collectedByOwner: number;
  collectedByOperator: number;
  /** What the owner is entitled to for the period. */
  ownerShare: number;
  /** Still to be paid out to the owner by the office. */
  dueToOwner: number;
  /** Still to be paid to the office by the owner. */
  dueToOperator: number;
}

export function settle(input: SettlementInput): Settlement {
  const collected = round(input.collected);
  const collectedByOwner = round(input.collectedByOwner);
  const expenses = round(input.expenses);
  const commission = round(input.commission);
  const investmentRent = round(input.investmentRent ?? 0);

  // VAT is charged on the fee itself and kept as its own figure: the owner
  // approves the commission and the tax on it separately, and a combined
  // number could be checked against neither.
  const commissionTax = round((commission * input.commissionTaxRate) / 100);

  const ownerShare =
    input.kind === "investment"
      ? investmentRent
      : round(collected - expenses - commission - commissionTax + investmentRent);

  const balance = round(ownerShare - collectedByOwner);

  return {
    collected,
    commission,
    commissionTax,
    commissionTaxRate: input.commissionTaxRate,
    expenses,
    investmentRent,
    collectedByOwner,
    collectedByOperator: round(collected - collectedByOwner),
    ownerShare,
    // Exactly one of these is non-zero: a period either closes with the office
    // holding the owner's money or with the owner owing the office its fee.
    dueToOwner: balance > 0 ? balance : 0,
    dueToOperator: balance < 0 ? round(-balance) : 0,
  };
}
