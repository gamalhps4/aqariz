/**
 * PropertyPro - One payment row of an import file
 *
 * A row records money already received against an installment of an
 * existing contract: which contract (its number, or the tenant and the
 * building and unit), which installment (its invoice number, or its due
 * date), how much, when, how and with what reference.
 *
 * The money itself is recorded by `recordInstallmentPayment`
 * (lib/services/payment-invoice-linking.service.ts) — the service behind the
 * "Record payment" dialog — so the receipt, the installment's balance and the
 * office's books come out exactly as if it had been typed at the desk. What
 * is here reads the cells, picks the installment, and asks the service's
 * questions before the real run does (`installmentPaymentRefusal`, the way
 * lib/payments/payable-online.ts asks them before a card is charged), so a
 * check of the file finds the overpayment on row 400 before anything is
 * written.
 *
 * No database, so it can be tested; lib/import/importers.ts does the rest.
 */

import { InvoiceStatus, PaymentMethod } from "@/types";
import {
  MANUAL_PAYMENT_METHODS,
  isManualPaymentMethod,
} from "@/lib/payments/methods";
import { translateFor } from "@/lib/i18n/translate";
import {
  codeKey,
  nameKey,
  readAmount,
  readDay,
  type RowProblem,
} from "./cells";
import { pick } from "./csv";
import {
  hasTenantKey,
  readTenantKeys,
  readUnitKeys,
  type TenantKeys,
  type UnitKeys,
} from "./match";

export interface PaymentRowDraft {
  contractNumber: string | null;
  tenant: TenantKeys;
  unit: UnitKeys;
  invoiceNumber: string | null;
  /** The installment's due date, "YYYY-MM-DD". */
  dueDate: string | null;
  amount: number;
  /** The day the money arrived, "YYYY-MM-DD". */
  paidDate: string;
  paymentMethod: PaymentMethod;
  reference?: string;
  notes?: string;
}

export type PaymentRowResult =
  | { ok: true; value: PaymentRowDraft; warnings: RowProblem[] }
  | { ok: false; issue: RowProblem };

const MANUAL_METHOD_LIST = MANUAL_PAYMENT_METHODS.map((option) => option.value).join(", ");

/**
 * Each manual method under its stored value, its English name and the
 * Arabic the record dialog shows — read from the catalogue, so a reworded
 * label is still understood — plus "Ejar", the platform's own spelling.
 */
const METHOD_WORDS: ReadonlyMap<string, PaymentMethod> = (() => {
  const words = new Map<string, PaymentMethod>();
  for (const option of MANUAL_PAYMENT_METHODS) {
    words.set(nameKey(option.value), option.value);
    words.set(nameKey(option.fallback), option.value);
    for (const language of ["en", "ar"]) {
      words.set(nameKey(translateFor(language, option.labelKey)), option.value);
    }
  }
  words.set(nameKey("ejar"), PaymentMethod.EJARI);
  return words;
})();

/**
 * A payment method staff may record — one of MANUAL_PAYMENT_METHODS, the
 * only ones `manualPaymentMethodSchema` lets the dialog send — or null.
 * A card or gateway method is refused rather than mapped to something near
 * it: the method decides which side of the owner statement the money is on.
 */
export function readPaymentMethod(raw: string): PaymentMethod | null {
  const value = raw.trim();
  if (!value) return null;
  const key = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (isManualPaymentMethod(key)) return key;
  return METHOD_WORDS.get(nameKey(value)) ?? null;
}

export function readPaymentRow(
  row: Record<string, string>,
  today: string,
): PaymentRowResult {
  const warnings: RowProblem[] = [];

  const rawAmount = pick(row, "amount", "amountPaid", "paidAmount");
  const amount = readAmount(rawAmount);
  if (!amount.ok) {
    return {
      ok: false,
      issue: {
        message: `"${rawAmount.trim()}" in amount is not an amount`,
        code: "amountInvalid",
        values: { column: "amount", value: rawAmount.trim() },
      },
    };
  }
  if (!amount.value) {
    return {
      ok: false,
      issue: { message: "Missing required amount", code: "amountMissing" },
    };
  }

  const rawPaid = pick(row, "paidDate", "paymentDate", "datePaid", "receivedDate");
  const paid = readDay(rawPaid);
  if (!paid.ok || !paid.value) {
    // Required, unlike the dialog's default of "now": a file of past
    // collections dated today would put last year's money in this week.
    return {
      ok: false,
      issue: rawPaid.trim()
        ? {
            message: `"${rawPaid.trim()}" in paidDate is not a date — write it as YYYY-MM-DD or DD/MM/YYYY`,
            code: "dateInvalid",
            values: { column: "paidDate", value: rawPaid.trim() },
          }
        : {
            message: "Missing required paidDate",
            code: "dateMissing",
            values: { column: "paidDate" },
          },
    };
  }
  if (paid.value > today) {
    warnings.push({
      message: `The payment date ${paid.value} is in the future — check the day and month are not swapped`,
      code: "paidDateFuture",
      values: { date: paid.value },
    });
  }

  const rawMethod = pick(row, "paymentMethod", "method");
  const paymentMethod = readPaymentMethod(rawMethod);
  if (!paymentMethod) {
    return {
      ok: false,
      issue: rawMethod.trim()
        ? {
            message: `"${rawMethod.trim()}" is not a method staff can record — use ${MANUAL_METHOD_LIST}`,
            code: "methodInvalid",
            values: { value: rawMethod.trim(), methods: MANUAL_METHOD_LIST },
          }
        : {
            message: `Missing required paymentMethod — use ${MANUAL_METHOD_LIST}`,
            code: "methodMissing",
            values: { methods: MANUAL_METHOD_LIST },
          },
    };
  }

  const invoiceNumber = pick(row, "invoiceNumber", "installmentNumber", "invoice") || null;
  const rawDue = pick(row, "dueDate", "installmentDueDate", "due");
  const due = readDay(rawDue);
  if (!due.ok) {
    return {
      ok: false,
      issue: {
        message: `"${rawDue.trim()}" in dueDate is not a date — write it as YYYY-MM-DD or DD/MM/YYYY`,
        code: "dateInvalid",
        values: { column: "dueDate", value: rawDue.trim() },
      },
    };
  }
  if (!invoiceNumber && !due.value) {
    return {
      ok: false,
      issue: {
        message: "Give the installment's invoice number or its due date",
        code: "installmentKeyMissing",
      },
    };
  }

  const contractNumber = pick(row, "contractNumber", "contractNo") || null;
  const tenant = readTenantKeys(row);
  const unit = readUnitKeys(row);
  // An invoice number names one installment of one contract by itself; a due
  // date needs to be told whose.
  if (
    !invoiceNumber &&
    !contractNumber &&
    !(hasTenantKey(tenant) && unit.building && unit.unitNumber)
  ) {
    return {
      ok: false,
      issue: {
        message:
          "Give the contract number, or the tenant with the building and unit",
        code: "contractKeyMissing",
      },
    };
  }

  return {
    ok: true,
    warnings,
    value: {
      contractNumber,
      tenant,
      unit,
      invoiceNumber,
      dueDate: due.value,
      amount: amount.value,
      paidDate: paid.value,
      paymentMethod,
      reference:
        pick(row, "reference", "referenceNumber", "transactionId", "receiptNumber") ||
        undefined,
      notes: pick(row, "notes") || undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Finding the installment
// ---------------------------------------------------------------------------

/** What the importer loads about each installment it might pay. */
export interface InstallmentRecord {
  id: string;
  invoiceNumber: string;
  leaseId: string | null;
  /** The due date's calendar day, "YYYY-MM-DD". */
  dueDay: string;
  status: string;
  category: string;
  balanceRemaining: number;
  tenantId: string | null;
  propertyId: string | null;
}

export type InstallmentPick =
  | { ok: true; installment: InstallmentRecord }
  | { ok: false; issue: RowProblem };

const isOpen = (installment: InstallmentRecord) =>
  installment.status !== InvoiceStatus.CANCELLED &&
  installment.balanceRemaining > 0;

/**
 * The installment a row pays, among the installments of the contracts it
 * could mean.
 *
 * By invoice number when it has one — with its due date, if given too, as a
 * check rather than a second opinion. Otherwise by due date: where a day
 * carries two charges (the first rent and the deposit, typically), the one
 * still owing wins, then the rent; two left over are named, not guessed.
 */
export function pickInstallment(
  installments: readonly InstallmentRecord[],
  key: { invoiceNumber: string | null; dueDate: string | null },
): InstallmentPick {
  if (key.invoiceNumber) {
    const number = key.invoiceNumber.trim();
    const found = installments.filter(
      (installment) => codeKey(installment.invoiceNumber) === codeKey(number),
    );
    if (found.length !== 1) {
      return {
        ok: false,
        issue: {
          message: `No installment numbered ${number} on this contract`,
          code: "invoiceNotFound",
          values: { number },
        },
      };
    }
    if (key.dueDate && found[0].dueDay !== key.dueDate) {
      return {
        ok: false,
        issue: {
          message: `Installment ${found[0].invoiceNumber} is due on ${found[0].dueDay}, not ${key.dueDate}`,
          code: "installmentDateMismatch",
          values: {
            number: found[0].invoiceNumber,
            due: found[0].dueDay,
            date: key.dueDate,
          },
        },
      };
    }
    return { ok: true, installment: found[0] };
  }

  const date = key.dueDate ?? "";
  const onDay = installments.filter((installment) => installment.dueDay === date);
  if (onDay.length === 0) {
    return {
      ok: false,
      issue: {
        message: `The contract has no installment due on ${date}`,
        code: "installmentNotFound",
        values: { date },
      },
    };
  }

  const open = onDay.filter(isOpen);
  const pool = open.length > 0 ? open : onDay;
  const rent = pool.filter((installment) => installment.category === "rent");
  const finalists = rent.length > 0 ? rent : pool;
  if (finalists.length === 1) return { ok: true, installment: finalists[0] };

  const contracts = new Set(finalists.map((installment) => installment.leaseId));
  return {
    ok: false,
    issue:
      contracts.size > 1
        ? {
            message:
              "More than one contract of this tenant on this unit has an installment due that day — give the contract number",
            code: "contractAmbiguous",
          }
        : {
            message: `More than one installment is due on ${date} — give the invoice number`,
            code: "installmentAmbiguous",
            values: { date },
          },
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Why `recordInstallmentPayment` would refuse this amount on this
 * installment, or null — its rules, in its order, with its half-halala of
 * slack, asked before the real run so a check can say so. `planned` is what
 * earlier rows of the same file will have put on the installment by then.
 */
export function installmentPaymentRefusal(
  installment: InstallmentRecord,
  amount: number,
  planned = 0,
): RowProblem | null {
  const number = installment.invoiceNumber;
  if (!installment.tenantId || !installment.propertyId) {
    return {
      message: `${number} is not a tenant's installment`,
      code: "notTenantInstallment",
      values: { number },
    };
  }
  if (installment.status === InvoiceStatus.CANCELLED) {
    return {
      message: `Installment ${number} is cancelled and cannot take a payment`,
      code: "installmentCancelled",
      values: { number },
    };
  }

  const left = round(installment.balanceRemaining - planned);
  if (left <= 0) {
    return planned > 0
      ? {
          message: `Rows above already pay off installment ${number}`,
          code: "installmentPaidInFile",
          values: { number },
        }
      : {
          message: `Installment ${number} is already fully paid`,
          code: "installmentPaid",
          values: { number },
        };
  }
  if (amount > left + 0.005) {
    const values = { amount: amount.toFixed(2), number, balance: left.toFixed(2) };
    return planned > 0
      ? {
          message: `With the rows above, ${values.amount} is more than what is left on installment ${number} (${values.balance})`,
          code: "overpaymentInFile",
          values,
        }
      : {
          message: `${values.amount} is more than what is left on installment ${number} (${values.balance})`,
          code: "overpayment",
          values,
        };
  }
  return null;
}

/**
 * The file's own rows, as the real run will meet them: each payment lowers
 * its installment's balance before the next row is recorded, so two rows
 * that each fit can still overpay together. Also notices a row repeated
 * further down — the same installment, amount, day and reference — which is
 * usually a paste done twice; that is a warning, as two equal payments on
 * one day can be genuine.
 */
export class PaymentFilePlan {
  private readonly planned = new Map<string, number>();
  private readonly seen = new Map<string, number>();

  plannedOn(installmentId: string): number {
    return this.planned.get(installmentId) ?? 0;
  }

  /** The row an identical payment was on, or null. */
  repeats(installmentId: string, draft: PaymentRowDraft): number | null {
    return this.seen.get(signature(installmentId, draft)) ?? null;
  }

  admit(installmentId: string, draft: PaymentRowDraft, row: number): void {
    this.planned.set(
      installmentId,
      round(this.plannedOn(installmentId) + draft.amount),
    );
    const key = signature(installmentId, draft);
    if (!this.seen.has(key)) this.seen.set(key, row);
  }
}

function signature(installmentId: string, draft: PaymentRowDraft): string {
  return [
    installmentId,
    draft.amount.toFixed(2),
    draft.paidDate,
    (draft.reference ?? "").trim().toLowerCase(),
  ].join("|");
}
