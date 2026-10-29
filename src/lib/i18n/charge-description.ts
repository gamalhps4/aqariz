/**
 * PropertyPro - What a charge is for, in the reader's language
 *
 * Installments, invoice lines and payments carry a description written by
 * whichever generator created them, always in English: "Monthly Rent",
 * "Quarterly Rent (Prorated)", "Monthly rent - September 2026",
 * "Security Deposit", "Electricity", "Advance Rent Payment - Month 2"… An
 * Arabic office read those words on its installment schedules, ledgers and
 * invoices.
 *
 * The stored text is not rewritten (the owner's decision: history stays as it
 * was recorded). Instead a description is shown through `describeCharge`,
 * which recognises the generators' own wordings and says the same thing in the
 * reader's language — built from the structured data where the row has it
 * (the charge type, its billing period, the contract's frequency) and from
 * the parts of the stored text otherwise. Anything it does not recognise is
 * a description somebody typed ("Maintenance contribution", "رسوم موقف") and
 * is shown exactly as typed.
 *
 * No React and no database: screens, PDFs and exports can all use it.
 */

import { paymentMethodLabel } from "@/lib/payments/methods";
import { formatDateFor, formatMonthFor, translateFor } from "./translate";

export interface ChargeLike {
  /** The stored description. */
  description?: string | null;
  /**
   * The charge's type as stored — a payment type ("rent",
   * "security_deposit"), an invoice line or category type ("rent",
   * "electricity", "water_sewer").
   */
  type?: string | null;
  /** The first day of the billing period, when the row has one. */
  periodStart?: string | Date | null;
  /** The last day of the billing period, when the row has one. */
  periodEnd?: string | Date | null;
  /** The contract's payment frequency ("monthly", "quarterly", …). */
  frequency?: string | null;
}

const FREQUENCIES = ["monthly", "quarterly", "four_monthly", "semi_annual", "annual"];

/** "Four-Monthly" / "semi-annual" → the catalogue's frequency code. */
function frequencyCode(word: string): string | null {
  const code = word.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return FREQUENCIES.includes(code) ? code : null;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "September 2026" (as the generators wrote it in English) → a date. */
function parseEnglishMonth(text: string): Date | null {
  const match = /^([a-z]+)\s+(\d{4})$/i.exec(text.trim());
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  return new Date(Date.UTC(Number(match[2]), month, 1));
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The billing period in words: "September 2026", or "September 2026 –
 * November 2026" for a period spanning months. Months are read in UTC — the
 * generators store each period start at midnight UTC.
 */
export function chargePeriodText(
  charge: Pick<ChargeLike, "periodStart" | "periodEnd">,
  language: string,
): string | null {
  const start = toDate(charge.periodStart);
  if (!start) return null;
  const startText = formatMonthFor(language, start, { timeZone: "UTC" });
  const end = toDate(charge.periodEnd);
  if (
    !end ||
    (end.getUTCFullYear() === start.getUTCFullYear() &&
      end.getUTCMonth() === start.getUTCMonth())
  ) {
    return startText;
  }
  return `${startText} – ${formatMonthFor(language, end, { timeZone: "UTC" })}`;
}

const t = (language: string, key: string, values?: Record<string, string | number>) =>
  translateFor(language, `leases.charge.${key}`, values);

/** "Monthly rent", "Rent", with "(prorated)" when it is. */
function rentLabel(language: string, frequency: string | null, prorated: boolean): string {
  const label = t(language, frequency ? `rent.${frequency}` : "rent");
  return prorated ? t(language, "prorated", { label }) : label;
}

/** "{label} — {period}", or the label alone when there is no period. */
function withPeriod(language: string, label: string, period: string | null): string {
  return period ? t(language, "withPeriod", { label, period }) : label;
}

/** Charge types whose stored English is only the type's own name. */
const TYPE_KEYS: Record<string, string> = {
  security_deposit: "securityDeposit",
  pet_deposit: "petDeposit",
  electricity: "electricity",
  water_sewer: "water",
  water: "water",
  utility: "utility",
  maintenance: "maintenance",
  late_fee: "lateFee",
  invoice: "invoicePayment",
  other: "additionalCharge",
};

/** The stored English names of those types, as the generators wrote them. */
const TYPE_WORDINGS: Record<string, string> = {
  "security deposit": "securityDeposit",
  "security deposit for lease": "securityDeposit",
  "security deposit payment": "securityDeposit",
  "pet deposit": "petDeposit",
  "pet deposit for lease": "petDeposit",
  electricity: "electricity",
  water: "water",
  "water / sewer": "water",
  "additional charge": "additionalCharge",
  // What the transaction list called a payment by its type.
  "rent payment": "rentPayment",
  "late fee": "lateFee",
  "utility payment": "utility",
  "maintenance payment": "maintenance",
  "invoice payment": "invoicePayment",
  "other payment": "otherPayment",
  payment: "payment",
  // The tenant ledger's own lines.
  discount: "discount",
  vat: "vat",
  "opening balance": "openingBalance",
};

/** The payment types that name a scheduled payment: "other payment - …". */
const PAYMENT_TYPE_WORDS: Record<string, string> = {
  rent: "rentPayment",
  security_deposit: "securityDeposit",
  pet_deposit: "petDeposit",
  late_fee: "lateFee",
  invoice: "invoicePayment",
  other: "otherPayment",
};

/** The map's entry for `key`, never one inherited from Object. */
function own(map: Record<string, string>, key: string | null | undefined): string | undefined {
  return key && Object.hasOwn(map, key) ? map[key] : undefined;
}

/** A stored payment method in the reader's language ("bank_transfer"). */
function methodText(language: string, code: string): string {
  const known = paymentMethodLabel(code, (key, options) =>
    translateFor(language, key, undefined, options?.defaultValue),
  );
  return translateFor(language, `exports.value.${code}`, undefined, known);
}

/** What a charge type is called, when the catalogue knows it; else null. */
function typeLabel(language: string, type: string): string | null {
  const typeKey = own(TYPE_KEYS, type);
  if (typeKey) return t(language, typeKey);
  const known = translateFor(language, `transactions.categories.${type}`, undefined, "");
  return known || null;
}

/**
 * The name of a charge type — a payment type ("late_fee") or an invoice line
 * type ("water_sewer") — in the reader's language: what a badge beside a
 * line says. Empty when the catalogue has no name for it (never the English
 * code).
 */
export function chargeTypeLabel(
  type: string | null | undefined,
  language: string,
): string {
  const code = type?.trim().toLowerCase();
  if (!code) return "";
  return (
    translateFor(language, `transactions.categories.${code}`, undefined, "") ||
    translateFor(language, `exports.value.${code}`, undefined, "")
  );
}

/**
 * The charge's description for a reader of `language` ("ar", "en", …).
 * Returns the stored description, as typed, when it is not one of the
 * generators' wordings; an empty string when there is none at all.
 */
export function describeCharge(charge: ChargeLike, language: string): string {
  const stored = (charge.description ?? "").trim();
  const period = chargePeriodText(charge, language);
  const type = charge.type?.trim().toLowerCase() || null;
  const frequency = charge.frequency ? frequencyCode(charge.frequency) : null;

  if (!stored) {
    if (type === "rent") return withPeriod(language, rentLabel(language, frequency, false), period);
    return (type && typeLabel(language, type)) || "";
  }

  // "Monthly Rent", "Quarterly Rent (Prorated)" — the installment generator.
  let match = /^(monthly|quarterly|four-monthly|semi-annual|annual) rent( \(prorated\))?$/i.exec(stored);
  if (match) {
    return withPeriod(
      language,
      rentLabel(language, frequencyCode(match[1]), Boolean(match[2])),
      period,
    );
  }

  // "Rent", "Rent (prorated)" — a planned installment not billed yet.
  match = /^rent( \(prorated\))?$/i.exec(stored);
  if (match) {
    return withPeriod(language, rentLabel(language, frequency, Boolean(match[1])), period);
  }

  // "Monthly rent - September 2026" — the payment schedulers; or
  // "Monthly Rent - Oak Towers" — the invoice builder, naming the building.
  match = /^monthly rent - (.+)$/i.exec(stored);
  if (match) {
    const month = parseEnglishMonth(match[1]);
    const rest = month
      ? formatMonthFor(language, month, { timeZone: "UTC" })
      : match[1].trim();
    return withPeriod(language, rentLabel(language, "monthly", false), rest);
  }

  if (/^monthly rent$/i.test(stored)) {
    return withPeriod(language, rentLabel(language, "monthly", false), period);
  }

  // "Monthly rent payment #3 (prorated)" — the recurring generator.
  match = /^monthly rent payment #(\d+)( \(prorated\))?$/i.exec(stored);
  if (match) {
    const label = t(language, "rentPaymentNumber", { number: match[1] });
    return match[2] ? t(language, "prorated", { label }) : label;
  }

  // "Rent payment for September 2026" — older demo data.
  match = /^rent payment for (.+)$/i.exec(stored);
  if (match) {
    const month = parseEnglishMonth(match[1]);
    if (month) {
      return withPeriod(
        language,
        t(language, "rent"),
        formatMonthFor(language, month, { timeZone: "UTC" }),
      );
    }
  }

  // "Advance Rent Payment - Month 2", "Advance rent payment (3 months)".
  match = /^advance rent payment - month (\d+)$/i.exec(stored);
  if (match) return t(language, "advanceRentMonth", { number: match[1] });
  match = /^advance rent payment \((\d+) months?\)$/i.exec(stored);
  if (match) return t(language, "advanceRentMonths", { count: match[1] });

  // "Utility payment - September 2026", "Maintenance fee - September 2026".
  match = /^(utility payment|maintenance fee) - (.+)$/i.exec(stored);
  if (match) {
    const month = parseEnglishMonth(match[2]);
    if (month) {
      return withPeriod(
        language,
        t(language, match[1].toLowerCase().startsWith("utility") ? "utility" : "maintenance"),
        formatMonthFor(language, month, { timeZone: "UTC" }),
      );
    }
  }

  // "Other payment - September 2026", "Late_fee payment - …" — a scheduled
  // payment of a type with no wording of its own.
  match = /^([a-z_]+) payment - (.+)$/i.exec(stored);
  if (match && own(PAYMENT_TYPE_WORDS, match[1].toLowerCase())) {
    const month = parseEnglishMonth(match[2]);
    if (month) {
      return withPeriod(
        language,
        t(language, PAYMENT_TYPE_WORDS[match[1].toLowerCase()]),
        formatMonthFor(language, month, { timeZone: "UTC" }),
      );
    }
  }

  // "Late Fee - 5 days overdue" — what late fees wrote before they were removed.
  match = /^late fee - (\d+) days? overdue$/i.exec(stored);
  if (match) return t(language, "lateFeeDays", { days: match[1] });

  // "Payment - bank_transfer" — the tenant ledger's line for a payment; a
  // payment without a method reads "Payment -".
  match = /^payment - ([a-z_]+)$/i.exec(stored);
  if (match) {
    return t(language, "paymentBy", { method: methodText(language, match[1].toLowerCase()) });
  }
  if (/^payment -$/i.test(stored)) return t(language, "payment");

  // "Invoice INV-2026-0001", "Credit note INV-2026-0001" — the transaction
  // list's and the tenant ledger's lines for a document.
  match = /^invoice (\S*\d\S*)$/i.exec(stored);
  if (match) return t(language, "invoiceRef", { reference: match[1] });
  match = /^credit note (\S*\d\S*)$/i.exec(stored);
  if (match) return t(language, "creditNoteRef", { reference: match[1] });

  // What the books write as a memo themselves: the opening entry's, and the
  // entry that reverses another ("Reversal of entry 12").
  if (/^opening balances$/i.test(stored)) {
    return translateFor(language, "ledger.sourceType.opening_balance");
  }
  match = /^reversal of entry (\d+)$/i.exec(stored);
  if (match) {
    return translateFor(language, "ledger.journals.reverses", { number: match[1] });
  }

  // "Payment for rent", "Payment for security deposit" — a receipt's line
  // for a payment without a description of its own.
  match = /^payment for (security[ _]deposit|pet[ _]deposit|late[ _]fee|rent|utility|maintenance|invoice|other)$/i.exec(stored);
  if (match) {
    const name = chargeTypeLabel(match[1].replace(/ /g, "_"), language);
    if (name) return t(language, "paymentFor", { reference: name });
  }

  // "Payment for INV-2026-0001".
  match = /^payment for (\S+)$/i.exec(stored);
  if (match) return t(language, "paymentFor", { reference: match[1] });

  const typeKey = own(TYPE_WORDINGS, stored.toLowerCase());
  if (typeKey) return t(language, typeKey);

  // A bare type code ("rent", "security_deposit") — the tenant ledger writes
  // an invoice's category where the invoice has no lines.
  if (stored === "rent") {
    return withPeriod(language, rentLabel(language, frequency, false), period);
  }
  if (own(TYPE_KEYS, stored) || /^[a-z]+(?:_[a-z]+)+$/.test(stored)) {
    const label = typeLabel(language, stored);
    if (label) return label;
  }

  return stored;
}

/** (catalogue key, English, values) → text: what a statement or an export has. */
export type NoteTranslate = (
  key: string,
  english: string,
  values?: Record<string, string | number>,
) => string;

/** 15/09/2026 — a day that survives being set inside right-to-left text. */
function slashDay(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

/**
 * A note the system wrote on a payment, said through `tr` — for callers that
 * hold a translator (a statement's `tr`, an export's) rather than a language.
 * Anything that is not one of the generators' own notes comes back as typed.
 */
export function describeNoteWith(
  note: string | null | undefined,
  tr: NoteTranslate,
  formatDay: (date: Date) => string = slashDay,
): string {
  const stored = (note ?? "").trim();
  if (!stored) return "";
  const n = (
    key: string,
    english: string,
    values?: Record<string, string | number>,
  ) => tr(`leases.charge.note.${key}`, english, values);

  // "<note> [REVERSED]" — a payment application that was reversed.
  let match = /^(.*?)\s*\[REVERSED\]$/.exec(stored);
  if (match) {
    const inner = match[1] ? describeNoteWith(match[1], tr, formatDay) : "";
    return `${inner ? `${inner} ` : ""}[${n("reversed", "Reversed")}]`;
  }

  match = /^cancelled due to lease (\w+)$/i.exec(stored);
  if (match) {
    const status = match[1].toLowerCase();
    return n("cancelledWithLease", "Cancelled due to contract status: {status}", {
      status: tr(`leases.status.${status}`, status),
    });
  }

  match = /^applied to (\d+) invoice\(s\)$/i.exec(stored);
  if (match) return n("appliedToInvoices", "Applied to {count} invoice(s)", { count: match[1] });

  if (/^required before lease commencement$/i.test(stored)) {
    return n("requiredBeforeStart", "Required before the contract starts");
  }
  if (/^recorded in bulk$/i.test(stored)) return n("recordedInBulk", "Recorded in bulk");
  if (/^stripe payment intent already succeeded$/i.test(stored)) {
    return n("alreadyPaidByCard", "Card payment already completed");
  }

  // "Prorated for Tue Sep 15 2026 to Wed Sep 30 2026" — Date#toDateString.
  match = /^prorated for ([A-Za-z]{3} [A-Za-z]{3} \d{1,2} \d{4}) to ([A-Za-z]{3} [A-Za-z]{3} \d{1,2} \d{4})$/i.exec(stored);
  if (match) {
    const from = new Date(match[1]);
    const to = new Date(match[2]);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      return n("proratedRange", "Prorated for {from} to {to}", {
        from: formatDay(from),
        to: formatDay(to),
      });
    }
  }

  // "Paid with mada through Moyasar", "Paid through PayTabs" — a gateway's.
  match = /^paid with (.+?) through (.+)$/i.exec(stored);
  if (match) {
    return n("paidWithThrough", "Paid with {method} through {gateway}", {
      method: match[1],
      gateway: match[2],
    });
  }
  match = /^paid through (.+)$/i.exec(stored);
  if (match) return n("paidThrough", "Paid through {gateway}", { gateway: match[1] });

  // "Payment failed at Moyasar: <the gateway's reason>"
  match = /^payment failed at ([^:]+?)(?:: (.+))?$/i.exec(stored);
  if (match) {
    const text = n("paymentFailedAt", "Payment failed at {gateway}", { gateway: match[1] });
    return match[2] ? `${text}: ${match[2]}` : text;
  }

  return stored;
}

/**
 * A note the system wrote on a payment, in the reader's language.
 *
 * Generators leave notes in English too ("Required before lease
 * commencement", "Applied to 2 invoice(s)", "Cancelled due to lease
 * terminated"). Those are recognised and said in the reader's language; a
 * note somebody typed is returned exactly as typed.
 */
export function describeChargeNote(
  note: string | null | undefined,
  language: string,
): string {
  return describeNoteWith(
    note,
    (key, english, values) => translateFor(language, key, values, english),
    (date) => formatDateFor(language, date),
  );
}
