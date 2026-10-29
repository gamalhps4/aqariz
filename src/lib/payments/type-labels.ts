/**
 * PropertyPro - What a payment is for, in words
 *
 * The payments list printed the stored value with its underscore swapped for
 * a space — "security deposit", in English, whatever the reader's language.
 * One table of labels, so the list, its cards and the charge form say the
 * same thing in all five locales.
 */

import { PaymentType } from "@/types";

interface TypeLabel {
  labelKey: string;
  fallback: string;
}

const LABELS: Record<PaymentType, TypeLabel> = {
  [PaymentType.RENT]: {
    labelKey: "payments.new.form.paymentTypes.rent",
    fallback: "Rent",
  },
  [PaymentType.SECURITY_DEPOSIT]: {
    labelKey: "payments.new.form.paymentTypes.securityDeposit",
    fallback: "Security Deposit",
  },
  [PaymentType.INVOICE]: {
    labelKey: "payments.new.form.paymentTypes.invoice",
    fallback: "Invoice",
  },
  [PaymentType.LATE_FEE]: {
    labelKey: "payments.new.form.paymentTypes.lateFee",
    fallback: "Late Fee",
  },
  [PaymentType.PET_DEPOSIT]: {
    labelKey: "payments.new.form.paymentTypes.petDeposit",
    fallback: "Pet Deposit",
  },
  [PaymentType.UTILITY]: {
    labelKey: "payments.new.form.paymentTypes.utility",
    fallback: "Utility",
  },
  [PaymentType.MAINTENANCE]: {
    labelKey: "payments.new.form.paymentTypes.maintenance",
    fallback: "Maintenance",
  },
  [PaymentType.OTHER]: {
    labelKey: "payments.new.form.paymentTypes.other",
    fallback: "Other",
  },
};

/**
 * What a charge can be added as. Late fees are no longer charged, so the
 * type is shown on the rows that already carry it and never offered.
 */
export const CHARGE_TYPES: readonly PaymentType[] = [
  PaymentType.RENT,
  PaymentType.SECURITY_DEPOSIT,
  PaymentType.UTILITY,
  PaymentType.MAINTENANCE,
  PaymentType.INVOICE,
  PaymentType.PET_DEPOSIT,
  PaymentType.OTHER,
];

export function paymentTypeLabelKey(type: string): TypeLabel | undefined {
  return LABELS[type as PaymentType];
}

/** The type in the reader's language; an unknown stored value as it is. */
export function paymentTypeLabel(
  type: string | null | undefined,
  t: (key: string, options?: { defaultValue?: string }) => string,
): string {
  if (!type) return "";
  const label = LABELS[type as PaymentType];
  return label ? t(label.labelKey, { defaultValue: label.fallback }) : type;
}
