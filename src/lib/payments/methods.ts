/**
 * PropertyPro - Payment methods
 *
 * One list, so a method added here reaches every screen that records, filters
 * or shows a payment. Each of those screens used to carry its own hardcoded
 * `<SelectItem>` block and they had already drifted apart — some offered ACH,
 * some did not, and none could gain a method without editing all of them.
 *
 * Two lists live here, and the difference matters:
 *
 * - `MANUAL_PAYMENT_METHODS` — the six the office records with. Nothing else
 *   can be picked, and the recording routes refuse anything else.
 * - Every stored value has a label, including methods no longer offered
 *   (older rows keep theirs) and gateway-set ones. Stripe stores its card
 *   payments as `credit_card`, PayPal as `paypal`; those are written by the
 *   code that captured the money and are never picked by hand.
 */

import { PaymentMethod } from "@/types";

export interface PaymentMethodOption {
  value: PaymentMethod;
  /**
   * Translation key. `payments.record.paymentMethods.*` is the canonical
   * namespace — it is the one present in all five locales.
   */
  labelKey: string;
  /** English text, used when a locale has not translated the key yet. */
  fallback: string;
}

type MethodLabel = Omit<PaymentMethodOption, "value">;

const LABELS: Record<PaymentMethod, MethodLabel> = {
  [PaymentMethod.CASH]: {
    labelKey: "payments.record.paymentMethods.cash",
    fallback: "Cash",
  },
  [PaymentMethod.POS]: {
    labelKey: "payments.record.paymentMethods.pos",
    fallback: "POS",
  },
  [PaymentMethod.BANK_TRANSFER]: {
    labelKey: "payments.record.paymentMethods.bankTransfer",
    fallback: "Bank Transfer",
  },
  [PaymentMethod.OWNER_CASH]: {
    labelKey: "payments.record.paymentMethods.ownerCash",
    fallback: "Cash to Owner",
  },
  [PaymentMethod.OWNER_ACCOUNT]: {
    labelKey: "payments.record.paymentMethods.ownerAccount",
    fallback: "Transfer to Owner",
  },
  [PaymentMethod.EJARI]: {
    labelKey: "payments.record.paymentMethods.ejari",
    fallback: "Ejar Platform",
  },
  // No longer offered. Older payments still carry them, and `credit_card` is
  // also how a Stripe payment is stored.
  [PaymentMethod.CREDIT_CARD]: {
    labelKey: "payments.record.paymentMethods.creditCard",
    fallback: "Credit Card",
  },
  [PaymentMethod.DEBIT_CARD]: {
    labelKey: "payments.record.paymentMethods.debitCard",
    fallback: "Debit Card",
  },
  [PaymentMethod.ACH]: {
    labelKey: "payments.record.paymentMethods.ach",
    fallback: "ACH Transfer",
  },
  [PaymentMethod.CHECK]: {
    labelKey: "payments.record.paymentMethods.check",
    fallback: "Check",
  },
  [PaymentMethod.MONEY_ORDER]: {
    labelKey: "payments.record.paymentMethods.moneyOrder",
    fallback: "Money Order",
  },
  [PaymentMethod.OTHER]: {
    labelKey: "payments.record.paymentMethods.other",
    fallback: "Other",
  },
  // Written by the gateway that captured the money.
  [PaymentMethod.PAYPAL]: {
    labelKey: "payments.record.paymentMethods.paypal",
    fallback: "PayPal",
  },
  [PaymentMethod.RAZORPAY]: {
    labelKey: "payments.record.paymentMethods.razorpay",
    fallback: "Razorpay",
  },
  [PaymentMethod.PAYSTACK]: {
    labelKey: "payments.record.paymentMethods.paystack",
    fallback: "Paystack",
  },
};

/**
 * Every stored value that has a label: the enum, plus two placeholders older
 * routes stored before the enum was enforced — the bulk "record as paid"
 * defaulted to "manual", and a gateway flow sent "online".
 */
const LABELS_BY_VALUE = new Map<string, MethodLabel>([
  ...Object.entries(LABELS),
  ["manual", { labelKey: "exports.value.manual", fallback: "Manual" }],
  ["online", { labelKey: "exports.value.online", fallback: "Online" }],
]);

/**
 * The office's own collection channels, in the order the client listed them.
 *
 * The last three never pass through the office account: the tenant pays the
 * owner in cash, transfers to the owner's bank, or settles on the Ejar
 * platform. They are recorded all the same, because the installment is
 * genuinely paid and the owner statement has to say so — what differs is that
 * the office holds nothing to remit afterwards (see OWNER_RECEIVED_METHODS).
 */
export const MANUAL_PAYMENT_METHODS: readonly PaymentMethodOption[] = [
  PaymentMethod.CASH,
  PaymentMethod.POS,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.OWNER_CASH,
  PaymentMethod.OWNER_ACCOUNT,
  PaymentMethod.EJARI,
].map((value) => ({ value, ...LABELS[value] }));

const MANUAL_VALUES: ReadonlySet<string> = new Set(
  MANUAL_PAYMENT_METHODS.map((option) => option.value),
);

/** Whether staff may record a payment with this method. */
export function isManualPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && MANUAL_VALUES.has(value);
}

/** Said the same way by every route that refuses a method. */
export const MANUAL_PAYMENT_METHOD_ERROR = `Choose how the payment was made: ${MANUAL_PAYMENT_METHODS.map(
  (option) => option.value,
).join(", ")}`;

/**
 * Methods whose money reached the owner, not the office: cash handed to the
 * owner, a transfer into the owner's account, and Ejar. Every agreement and
 * owner report counts these as received by the owner — which is why they flip
 * a settlement from "the office owes the owner" to "the owner owes the office
 * its fee". Everything else, gateway payments included, was received by the
 * office.
 */
export const OWNER_RECEIVED_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.OWNER_CASH,
  PaymentMethod.OWNER_ACCOUNT,
  PaymentMethod.EJARI,
];

export function isReceivedByOwner(method: string | null | undefined): boolean {
  return OWNER_RECEIVED_METHODS.some((owner) => owner === method);
}

/**
 * Label for a stored `paymentMethod` value — including ones no longer offered
 * and gateway-written ones. Returns the raw value when the method is unknown,
 * which is what an old row with a free-text method needs.
 */
export function paymentMethodLabel(
  method: string | null | undefined,
  t: (key: string, options?: { defaultValue?: string }) => string,
): string {
  if (!method) return "";
  const label = LABELS_BY_VALUE.get(method);
  if (!label) return method;
  return t(label.labelKey, { defaultValue: label.fallback });
}
