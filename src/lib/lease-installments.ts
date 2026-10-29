/**
 * PropertyPro - Lease installment schedule
 *
 * The rental value now lives on the contract, and the contract decides how
 * often it falls due. This module is the single place that turns a lease
 * (rent + frequency + term) into a list of installments, so the generator,
 * the preview endpoint and the contract page all describe the same schedule.
 *
 * Rent is stored as the amount due *per installment*, not a monthly figure
 * that gets multiplied: a quarterly contract for 30,000 means 30,000 every
 * quarter. That matches how the contracts are actually written and keeps the
 * lease's `rentAmount` column meaning one unambiguous thing.
 *
 * A contract can instead state one figure for the whole term ("12,000"), in
 * `contractAmount`. The schedule then divides that figure across however many
 * installments the term produces, and `rentAmount` holds the regular share.
 */

import { leaseContractAmount, leaseRentAmount } from "@/lib/lease-money";

export const PAYMENT_FREQUENCIES = [
  "monthly",
  "quarterly",
  "four_monthly",
  "semi_annual",
  "annual",
] as const;

export type PaymentFrequencyKey = (typeof PAYMENT_FREQUENCIES)[number];

/**
 * The cycles an agreement's fee can run on. Every four months is a contract
 * cycle only: the agreements table's CHECK still allows the original four.
 */
export const AGREEMENT_FEE_FREQUENCIES = [
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
] as const satisfies readonly PaymentFrequencyKey[];

export function isPaymentFrequency(value: unknown): value is PaymentFrequencyKey {
  return PAYMENT_FREQUENCIES.includes(value as PaymentFrequencyKey);
}

/** Months between consecutive installments. */
export const FREQUENCY_MONTHS: Record<PaymentFrequencyKey, number> = {
  monthly: 1,
  quarterly: 3,
  four_monthly: 4,
  semi_annual: 6,
  annual: 12,
};

/**
 * English names, used where no translation applies (exports, generated
 * invoice lines such as "Quarterly Rent"), so each reads as an adjective.
 */
export const FREQUENCY_LABELS: Record<PaymentFrequencyKey, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  four_monthly: "Four-Monthly",
  semi_annual: "Semi-Annual",
  annual: "Annual",
};

export function normalizeFrequency(value: unknown): PaymentFrequencyKey {
  return isPaymentFrequency(value) ? value : "monthly";
}

/** Installments per year — used to annualise a contract's rent for reports. */
export function installmentsPerYear(frequency: PaymentFrequencyKey): number {
  return 12 / FREQUENCY_MONTHS[frequency];
}

export interface PlannedInstallment {
  /** 1-based position in the schedule. */
  index: number;
  /** First day of the period this installment covers. */
  periodStart: Date;
  /** Day after the last day covered — exclusive, for clean period maths. */
  periodEnd: Date;
  dueDate: Date;
  /** Rent for this period, after any proration. */
  rentAmount: number;
  /** Electricity charged for this period, after any proration. */
  electricityAmount: number;
  /** Water charged for this period, after any proration. */
  waterAmount: number;
  /** Rent plus utilities, before tax. */
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  /** True when the period is shorter than a full cycle and the charge was prorated. */
  prorated: boolean;
}

export interface InstallmentPlanInput {
  startDate: Date | string;
  endDate: Date | string;
  /** Amount due per installment, from the contract. */
  rentAmount: number;
  /**
   * The rent for the whole term, when the contract states it that way. Set,
   * it replaces `rentAmount`: the total is split across the installments by
   * `splitContractAmount`, and nothing is prorated — the office has already
   * said what the term costs, short final period included. Utilities stay
   * per installment and are charged in full. Tax is added on top, as ever.
   */
  contractAmount?: number | null;
  /**
   * Optional utility charges billed with each installment. Prorated with the
   * rent on a short final period, and taxed with it: VAT applies to the whole
   * consideration under the contract, not to the rent line alone.
   */
  electricityAmount?: number;
  waterAmount?: number;
  frequency: PaymentFrequencyKey;
  /** Day of the month rent is due; clamped to the length of each month. */
  rentDueDay?: number;
  taxEnabled?: boolean;
  /** Percentage, e.g. 15 for 15%. */
  taxRate?: number;
  /** Prorate a final partial cycle instead of billing it in full. */
  prorateFinalPeriod?: boolean;
  /**
   * Periods an amendment left billed as they were, because money was paid on
   * them, and the rent they carry (lib/lease-amendment.ts). For a contract
   * written as a total, the rest of the total is split over the other
   * periods, so the installments still add up to the amended figure; the
   * kept periods share the rent they really carry. Ignored for a contract
   * priced per installment, whose amount applies to each period as it is.
   */
  keptRent?: KeptRent | null;
}

/** See `InstallmentPlanInput.keptRent`. */
export interface KeptRent {
  /** First day of each kept period, as stored (ISO). */
  periodStarts: readonly string[];
  /** The rent those periods carry between them. */
  rent: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * All schedule arithmetic runs in UTC.
 *
 * A contract date is a *calendar day*, not an instant, and it arrives as UTC
 * midnight (that is how `<input type="date">` values parse). Doing the maths
 * with local getters made the result depend on where the server happens to
 * run: west of UTC, a contract starting 2026-01-01 read back as 31 December
 * and produced a thirteen-installment year beginning a day early. UTC in,
 * UTC out, same schedule everywhere.
 */
export function addMonthsUTC(anchor: Date, months: number): Date {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  // Day 0 of the following month is the last day of the target month.
  const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month, Math.min(anchor.getUTCDate(), daysInTarget)),
  );
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function addDaysUTC(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() + days * 86_400_000);
}

/**
 * The exclusive boundary of a contract term whose `endDate` is inclusive.
 *
 * A lease's end date is the last day the tenant holds the unit, not the day
 * after: `lease-reports.service.ts` says so outright ("a contract is only past
 * its term once its final day has fully elapsed") and the contract screen
 * labels it that way. The cycle maths below wants a half-open interval, so the
 * two meet here rather than in the loop.
 *
 * This is what the review's "the installments have not been adjusted" was
 * about. Read as exclusive, a 1 Jan - 31 Dec monthly contract at 1,000 ended
 * its twelfth cycle a day early, prorated it 30/31, and reported a contract
 * value of 11,967.74 where the office had written 12,000.
 */
function exclusiveTermEnd(endDate: Date): Date {
  return addDaysUTC(endDate, 1);
}

/**
 * A trailing period this short is a date-entry artifact, not a billing period.
 *
 * Contracts written the other way round - 1 Jan 2026 to 1 Jan 2027, meaning
 * "up to but not including" - would otherwise gain a one-day thirteenth
 * installment once the end date is read inclusively. A tail of a day or less
 * is absorbed into the installment before it instead, which bills the same
 * twelve rounds the office expects and still covers every day of the term.
 */
const NEGLIGIBLE_TAIL_DAYS = 1;

/** Tax on a rent amount for a contract, rounded to cents. */
export function taxFor(
  subtotal: number,
  taxEnabled: boolean | undefined,
  taxRate: number | undefined,
): number {
  if (!taxEnabled) return 0;
  const rate = Number(taxRate) || 0;
  if (rate <= 0) return 0;
  return round((subtotal * rate) / 100);
}

export interface ContractSplit {
  /** How many installments the total is spread over. */
  count: number;
  /** Every installment but the last. */
  share: number;
  /** The last installment: the share plus whatever the rounding left over. */
  last: number;
}

/**
 * Split a contract total into `count` installments.
 *
 * Each installment is the total divided equally and rounded down to the
 * halala; the halalas that leaves over go on the last installment, so the
 * installments add back to exactly the figure on the contract: 10,000 over
 * twelve months is 11 × 833.33 + 833.37. Rounding down rather than to nearest
 * keeps the remainder a remainder — the last installment is never the smaller
 * one.
 *
 * The arithmetic runs in whole halalas, because a contract total has to
 * reconcile to the halala and binary fractions do not.
 */
export function splitContractAmount(
  total: number,
  count: number,
): ContractSplit {
  if (!Number.isInteger(count) || count < 1) {
    return { count: 0, share: 0, last: 0 };
  }
  const totalHalalas = Math.round(total * 100);
  const shareHalalas = Math.floor(totalHalalas / count);
  const lastHalalas = totalHalalas - shareHalalas * (count - 1);
  return { count, share: shareHalalas / 100, last: lastHalalas / 100 };
}

/**
 * The rent of each period of a contract written as a total.
 *
 * Normally the total split equally (`splitContractAmount`). After an
 * amendment that kept paid periods as they were billed, those periods share
 * the rent they carry and the rest of the total is split over the others —
 * each group with its remainder on its own last period.
 */
function splitContractRent(
  total: number,
  periods: ReadonlyArray<{ start: Date }>,
  kept: KeptRent | null | undefined,
): number[] {
  const keptTimes = new Set(
    (kept?.periodStarts ?? []).map((start) => new Date(start).getTime()),
  );
  const isKept = periods.map((period) => keptTimes.has(period.start.getTime()));
  const keptCount = isKept.filter(Boolean).length;
  if (!kept || keptCount === 0) {
    const split = splitContractAmount(total, periods.length);
    return periods.map((_, position) =>
      position === periods.length - 1 ? split.last : split.share,
    );
  }

  const keptSplit = splitContractAmount(kept.rent, keptCount);
  const restSplit = splitContractAmount(
    total - kept.rent,
    periods.length - keptCount,
  );
  let keptSeen = 0;
  let restSeen = 0;
  return isKept.map((wasKept) => {
    if (wasKept) {
      keptSeen += 1;
      return keptSeen === keptCount ? keptSplit.last : keptSplit.share;
    }
    restSeen += 1;
    return restSeen === periods.length - keptCount
      ? restSplit.last
      : restSplit.share;
  });
}

/**
 * Build the full installment schedule for a contract term.
 *
 * Every period is anchored to the contract's start date, so a contract
 * running 15 Mar → 15 Mar bills whole cycles rather than calendar-month stubs.
 * A contract priced per installment prorates a genuinely short final period
 * by day count; one written as a total divides the total instead and
 * prorates nothing.
 */
export function planInstallments(
  input: InstallmentPlanInput,
): PlannedInstallment[] {
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  const frequency = normalizeFrequency(input.frequency);
  const step = FREQUENCY_MONTHS[frequency];
  const rent = Number(input.rentAmount) || 0;
  const electricity = Number(input.electricityAmount) || 0;
  const water = Number(input.waterAmount) || 0;
  const dueDay = Math.min(Math.max(input.rentDueDay ?? 1, 1), 31);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return [];
  }
  if (end < start) return [];

  // Half-open from here on: `termEnd` is the first instant NOT covered.
  const termEnd = exclusiveTermEnd(end);

  // The periods first and the money second: a contract written as a total
  // cannot price any installment until it knows how many there are.
  const periods: Array<{ start: Date; end: Date; fullCycleDays: number }> = [];

  // A term is finite and every step advances by >= 1 month, so this
  // terminates; the cap is a defence against a corrupted lease row (e.g. an
  // endDate centuries out) turning generation into a hang.
  const MAX_INSTALLMENTS = 600;

  while (periods.length < MAX_INSTALLMENTS) {
    const index = periods.length;
    // Periods are anchored to the contract's start date, not to the 1st of
    // its month: a 3-year annual contract starting 15 March bills three full
    // years, not two prorated stubs around calendar years.
    const cycleStart = addMonthsUTC(start, index * step);
    if (cycleStart >= termEnd) break;

    const fullCycleEnd = addMonthsUTC(start, (index + 1) * step);
    const cycleEnd = fullCycleEnd < termEnd ? fullCycleEnd : new Date(termEnd);

    const daysInCycle = daysBetween(cycleStart, cycleEnd);
    if (daysInCycle <= 0) break;

    // Absorb a day-or-less tail into the installment before it rather than
    // billing it on its own - see NEGLIGIBLE_TAIL_DAYS.
    const previous = periods[periods.length - 1];
    if (
      previous &&
      daysInCycle <= NEGLIGIBLE_TAIL_DAYS &&
      cycleEnd >= termEnd
    ) {
      previous.end = new Date(termEnd);
      break;
    }

    periods.push({
      start: cycleStart,
      end: cycleEnd,
      fullCycleDays: daysBetween(cycleStart, fullCycleEnd),
    });
  }

  const contractAmount = leaseContractAmount(input);
  const contractRent =
    contractAmount === null
      ? null
      : splitContractRent(contractAmount, periods, input.keptRent);

  return periods.map((period, position) => {
    const daysInCycle = daysBetween(period.start, period.end);
    const isShort = daysInCycle < period.fullCycleDays;

    const shouldProrate =
      !contractRent && isShort && input.prorateFinalPeriod !== false;
    const prorate = (amount: number) =>
      shouldProrate
        ? round((amount * daysInCycle) / Math.max(period.fullCycleDays, 1))
        : amount;

    const rentPortion = contractRent ? contractRent[position] : prorate(rent);
    const electricityPortion = prorate(electricity);
    const waterPortion = prorate(water);
    const subtotal = round(rentPortion + electricityPortion + waterPortion);

    // An installment falls due when its period opens. `rentDueDay` shifts it
    // within that month for offices that bill on a fixed calendar day, but it
    // can never pull the charge before the period it covers.
    let dueDate = new Date(period.start);
    if (input.rentDueDay) {
      const dueMonthDays = new Date(
        Date.UTC(
          period.start.getUTCFullYear(),
          period.start.getUTCMonth() + 1,
          0,
        ),
      ).getUTCDate();
      const shifted = new Date(
        Date.UTC(
          period.start.getUTCFullYear(),
          period.start.getUTCMonth(),
          Math.min(dueDay, dueMonthDays),
        ),
      );
      if (shifted > period.start) dueDate = shifted;
    }

    const taxAmount = taxFor(subtotal, input.taxEnabled, input.taxRate);

    return {
      index: position + 1,
      periodStart: period.start,
      periodEnd: period.end,
      dueDate,
      rentAmount: rentPortion,
      electricityAmount: electricityPortion,
      waterAmount: waterPortion,
      subtotal,
      taxAmount,
      totalAmount: round(subtotal + taxAmount),
      prorated: shouldProrate,
    };
  });
}

/** How many installments a term produces; the amounts play no part in it. */
export function installmentCount(term: {
  startDate: Date | string;
  endDate: Date | string;
  frequency: PaymentFrequencyKey;
}): number {
  return planInstallments({ ...term, rentAmount: 0 }).length;
}

/**
 * The regular installment of a contract written as a total — the figure its
 * `rentAmount` column holds, so every reader that knows nothing of totals
 * (lists, exports, the rent roll) still shows what the tenant pays on all but
 * the last installment.
 */
export function contractInstallmentShare(term: {
  startDate: Date | string;
  endDate: Date | string;
  frequency: PaymentFrequencyKey;
  contractAmount: number;
}): number {
  return splitContractAmount(term.contractAmount, installmentCount(term))
    .share;
}

/**
 * Build the schedule straight from a lease row.
 *
 * This is the accessor every caller should use — it reads the contract's own
 * rent, frequency and tax settings, so nothing downstream has to remember
 * which of those live in columns and which in the legacy `terms` JSON.
 */
export function leaseInstallmentPlan(lease: {
  startDate: Date | string;
  endDate: Date | string;
  rentAmount?: unknown;
  contractAmount?: unknown;
  electricityAmount?: unknown;
  waterAmount?: unknown;
  paymentFrequency?: unknown;
  taxEnabled?: unknown;
  taxRate?: unknown;
  terms?: unknown;
}): PlannedInstallment[] {
  const terms = (lease.terms as Record<string, any>) ?? {};

  return planInstallments({
    startDate: lease.startDate,
    endDate: lease.endDate,
    rentAmount: leaseRentAmount(lease),
    contractAmount: leaseContractAmount(lease),
    electricityAmount: Number(lease.electricityAmount) || 0,
    waterAmount: Number(lease.waterAmount) || 0,
    frequency: normalizeFrequency(lease.paymentFrequency),
    rentDueDay: terms.paymentConfig?.rentDueDay,
    taxEnabled: Boolean(lease.taxEnabled),
    taxRate: Number(lease.taxRate) || 0,
    keptRent: keptRentOf(terms),
  });
}

/** What an amendment kept billed as it was (lib/lease-amendment.ts), if anything. */
export function keptRentOf(terms: unknown): KeptRent | null {
  const kept = (
    terms as { amendment?: { kept?: { periodStarts?: unknown; rent?: unknown } | null } } | null
  )?.amendment?.kept;
  if (!kept || !Array.isArray(kept.periodStarts) || kept.periodStarts.length === 0) {
    return null;
  }
  const rent = Number(kept.rent);
  return Number.isFinite(rent)
    ? { periodStarts: kept.periodStarts.map(String), rent }
    : null;
}

/**
 * A contract's rent over a year, so registers can add up contracts that bill
 * on different cycles.
 *
 * Rent per installment × installments per year. A contract written as a total
 * uses its average installment rather than the regular share, which is rounded
 * down with the remainder on the last installment: 10,000 over twelve months
 * is 10,000 a year, not 12 × 833.33 = 9,999.96.
 */
export function leaseAnnualRent(lease: {
  startDate: Date | string;
  endDate: Date | string;
  rentAmount?: unknown;
  contractAmount?: unknown;
  paymentFrequency?: unknown;
  terms?: unknown;
}): number {
  const frequency = normalizeFrequency(lease.paymentFrequency);
  const perYear = installmentsPerYear(frequency);
  const total = leaseContractAmount(lease);
  if (total !== null) {
    const count = installmentCount({
      startDate: lease.startDate,
      endDate: lease.endDate,
      frequency,
    });
    if (count > 0) return round((total / count) * perYear);
  }
  return round(leaseRentAmount(lease) * perYear);
}

export interface InstallmentTotals {
  count: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
}

export function summarizeInstallments(
  installments: readonly PlannedInstallment[],
): InstallmentTotals {
  return installments.reduce<InstallmentTotals>(
    (acc, installment) => ({
      count: acc.count + 1,
      subtotal: round(acc.subtotal + installment.subtotal),
      taxAmount: round(acc.taxAmount + installment.taxAmount),
      totalAmount: round(acc.totalAmount + installment.totalAmount),
    }),
    { count: 0, subtotal: 0, taxAmount: 0, totalAmount: 0 },
  );
}
