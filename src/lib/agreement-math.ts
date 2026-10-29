/**
 * PropertyPro - Agreement arithmetic
 *
 * The parts of the agreement engine that are pure — when an agreement was in
 * force, which one governs a building and for how long, what a commission or
 * an investment rent comes to over a period, and how a flat amount is shared
 * between buildings. Kept apart from the service so they can be tested
 * without a database; the service re-exports every one of them.
 */

import {
  addMonthsUTC,
  FREQUENCY_MONTHS,
  normalizeFrequency,
  type PaymentFrequencyKey,
} from "@/lib/lease-installments";


export type AgreementKind = "management" | "investment";
export type AgreementFeeType = "percentage" | "fixed";
export type CommissionBasis = "collected" | "billed";
export type AgreementStatus = "draft" | "active" | "expired" | "terminated";

export const AGREEMENT_KINDS: readonly AgreementKind[] = [
  "management",
  "investment",
] as const;

/**
 * The agreement's kind. Anything that is not an investment agreement is a
 * management one — which is also what every row written before the field
 * meant anything was.
 */
export function agreementKind(agreement: { kind?: string | null }): AgreementKind {
  return agreement.kind === "investment" ? "investment" : "management";
}

export const AGREEMENT_FEE_TYPES: readonly AgreementFeeType[] = [
  "percentage",
  "fixed",
] as const;
export const COMMISSION_BASES: readonly CommissionBasis[] = [
  "collected",
  "billed",
] as const;
export const AGREEMENT_STATUSES: readonly AgreementStatus[] = [
  "draft",
  "active",
  "expired",
  "terminated",
] as const;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const DAY_MS = 86_400_000;

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * A stretch of time, both ends included — as every statement period is: the
 * first moment of its first day to the last moment of its last.
 */
export interface Period {
  startDate: Date;
  endDate: Date;
}

/**
 * An agreement's dates are calendar days, stored as the midnight UTC that
 * begins them (the way `<input type="date">` values parse). What was agreed
 * is the day, so an agreement is in force from the first moment of its start
 * date to the last moment of its end date.
 */
function startOfDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
}

function endOfDay(date: Date): Date {
  return new Date(startOfDay(date).getTime() + DAY_MS - 1);
}

/**
 * A fixed fee charged over a window, counting real calendar cycles.
 *
 * An average cycle length would be close but never right: a flat 3,000/month
 * came out at 3,055 for January (31 days against a 30.44-day average) and
 * 35,975 for a year. An office that agreed 3,000 a month expects 36,000, and
 * an owner would query every statement. So cycles are walked from the
 * agreement's own start date — its billing anchor — and only a genuinely
 * partial cycle at either end is prorated by day.
 *
 * `to` is the first moment after the window.
 */
function fixedFeeOver(
  amount: number,
  frequency: PaymentFrequencyKey,
  anchor: Date,
  from: Date,
  to: Date,
): number {
  const step = FREQUENCY_MONTHS[frequency];
  if (amount <= 0 || to <= from) return 0;

  // Jump straight to the cycle containing `from` rather than walking from the
  // anchor one cycle at a time — an agreement signed years ago would
  // otherwise iterate hundreds of times per property per report.
  const monthsFromAnchor =
    (from.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (from.getUTCMonth() - anchor.getUTCMonth());
  let index = Math.floor(monthsFromAnchor / step);
  if (addMonthsUTC(anchor, (index + 1) * step) <= from) index += 1;
  // Counting months ignores the day: a window that opens earlier in its month
  // than the day the agreement started opens inside the cycle before. Without
  // the step back those days were never charged — 3,000 a month agreed from
  // the 15th came to 1,645.16 for January, and 34,645.16 for the year.
  if (addMonthsUTC(anchor, index * step) > from) index -= 1;
  if (index < 0) index = 0;

  let total = 0;
  // Bounded by the window: every step advances at least one month, and no
  // report spans more than a few decades of cycles.
  const MAX_CYCLES = 2000;

  for (let guard = 0; guard < MAX_CYCLES; guard++, index++) {
    const cycleStart = addMonthsUTC(anchor, index * step);
    const cycleEnd = addMonthsUTC(anchor, (index + 1) * step);
    if (cycleStart >= to) break;
    if (cycleEnd <= from) continue;

    const overlapStart = cycleStart > from ? cycleStart : from;
    const overlapEnd = cycleEnd < to ? cycleEnd : to;
    const cycleDays = daysBetween(cycleStart, cycleEnd);
    if (cycleDays <= 0) continue;

    const covered = daysBetween(overlapStart, overlapEnd);
    total +=
      covered >= cycleDays ? amount : (amount * covered) / cycleDays;
  }

  return round(total);
}

/** What says when an agreement was in force. */
type AgreementDates = Pick<
  AgreementRow,
  "status" | "startDate" | "endDate" | "terminatedDate"
>;

/** When an agreement was in force; `endDate` is null while it has no end. */
export interface AgreementTerm {
  startDate: Date;
  endDate: Date | null;
}

/**
 * When an agreement was in force: from its start date to its end date, or to
 * the day it was terminated where that came first — each of them a whole day.
 * Null when it never was.
 *
 * The dates decide, not the status the agreement carries today. One that has
 * since expired or been terminated was in force for the months before, and
 * earned its commission for them; judging it by today's status took that
 * commission off every past statement the day the status changed.
 *
 * The status still says two things the dates cannot. A draft was never
 * signed, so it never started. And an agreement marked expired or terminated
 * with no end or termination date on record is over without anything saying
 * since when — it earns nothing until one of the two dates is entered.
 *
 * The whole last day matters: an end date is stored as the midnight that
 * begins it, and a statement period closes at the end of its last day. A term
 * that stopped at the stored instant was already over when the end-of-term
 * statement was settled, which therefore charged no commission at all.
 */
export function agreementTerm(agreement: AgreementDates): AgreementTerm | null {
  if (agreement.status === "draft") return null;

  const startDate = startOfDay(agreement.startDate);
  const lastDay = [agreement.endDate, agreement.terminatedDate].reduce<Date | null>(
    (earliest, date) => (date && (!earliest || date < earliest) ? date : earliest),
    null,
  );
  if (!lastDay) {
    const closed =
      agreement.status === "expired" || agreement.status === "terminated";
    return closed ? null : { startDate, endDate: null };
  }

  const endDate = endOfDay(lastDay);
  return endDate < startDate ? null : { startDate, endDate };
}

/** Whether an agreement was in force at a moment — see `agreementTerm`. */
export function isAgreementInForce(agreement: AgreementDates, on: Date): boolean {
  const term = agreementTerm(agreement);
  if (!term) return false;
  return term.startDate <= on && (term.endDate === null || on <= term.endDate);
}

/** The part of a period an agreement was in force for; null when none of it. */
export function termWithin(
  agreement: AgreementDates,
  period: Period,
): Period | null {
  const term = agreementTerm(agreement);
  if (!term) return null;
  const startDate =
    term.startDate > period.startDate ? term.startDate : period.startDate;
  const endDate =
    term.endDate && term.endDate < period.endDate ? term.endDate : period.endDate;
  return endDate < startDate ? null : { startDate, endDate };
}

export interface AgreementRow {
  id: string;
  kind: string;
  agreementNumber: string | null;
  ownerId: string;
  propertyId: string | null;
  compoundId: string | null;
  feeType: string;
  feePercentage: number;
  feeAmount: number;
  feeFrequency: string;
  commissionBasis: string;
  currency: string;
  startDate: Date;
  endDate: Date | null;
  status: string;
  terminatedDate: Date | null;
}

/** What precedence needs to know about a building. */
interface GovernedProperty {
  id: string;
  ownerId: string;
  compoundId: string | null;
}

/**
 * Pick the agreement that governs one property.
 *
 * Precedence: property-specific → compound-wide → owner-blanket. Within the
 * same tier the most recently started wins, so re-signing on better terms
 * takes effect without deleting the old paper; two that started the same day
 * are settled by the later-made one, so the answer never depends on the
 * order the rows happened to be read in.
 *
 * Returns null when nothing applies — the normal case for a self-managing
 * landlord, and the reason commission defaults to zero rather than erroring.
 */
export function resolveAgreementForProperty(
  agreements: readonly AgreementRow[],
  property: GovernedProperty,
  on: Date,
  /** Which kind to resolve — the two never compete with each other. */
  kind: AgreementKind = "management",
): AgreementRow | null {
  const live = agreements.filter(
    (agreement) =>
      agreement.ownerId === property.ownerId &&
      agreementKind(agreement) === kind &&
      isAgreementInForce(agreement, on),
  );
  if (live.length === 0) return null;

  const tiers: Array<(a: AgreementRow) => boolean> = [
    (a) => a.propertyId === property.id,
    (a) =>
      Boolean(a.compoundId) &&
      a.compoundId === property.compoundId &&
      !a.propertyId,
    (a) => !a.propertyId && !a.compoundId,
  ];

  for (const matches of tiers) {
    const candidates = live.filter(matches);
    if (candidates.length > 0) {
      return candidates.reduce((best, current) => {
        const started =
          startOfDay(current.startDate).getTime() -
          startOfDay(best.startDate).getTime();
        return started > 0 || (started === 0 && current.id > best.id)
          ? current
          : best;
      });
    }
  }

  return null;
}

/** The time one agreement held a building. */
export interface GoverningSpan extends Period {
  agreement: AgreementRow;
}

/**
 * Which agreement of one kind governed a property across a period, in order:
 * each span is the time one of them held it. Time no agreement held is simply
 * absent.
 *
 * Precedence is the same rule at every moment, and it can only change hands
 * where a term begins or ends — so the period is cut there and the rule asked
 * once per piece. An agreement that ended inside the period and its renewal
 * each get their own part; so does a blanket agreement on either side of a
 * more specific one.
 */
export function governingSpans(
  agreements: readonly AgreementRow[],
  property: GovernedProperty,
  period: Period,
  kind: AgreementKind = "management",
): GoverningSpan[] {
  const open = period.startDate.getTime();
  const close = period.endDate.getTime();
  if (close < open) return [];

  const cuts = new Set<number>([open]);
  for (const agreement of agreements) {
    if (
      agreement.ownerId !== property.ownerId ||
      agreementKind(agreement) !== kind
    ) {
      continue;
    }
    const term = agreementTerm(agreement);
    if (!term) continue;
    const begins = term.startDate.getTime();
    const ended = term.endDate ? term.endDate.getTime() + 1 : null;
    if (begins > open && begins <= close) cuts.add(begins);
    if (ended !== null && ended > open && ended <= close) cuts.add(ended);
  }

  const starts = [...cuts].sort((a, b) => a - b);
  const spans: GoverningSpan[] = [];
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] - 1 : close;
    const agreement = resolveAgreementForProperty(
      agreements,
      property,
      new Date(start),
      kind,
    );
    if (!agreement) return;

    const previous = spans[spans.length - 1];
    if (
      previous &&
      previous.agreement.id === agreement.id &&
      previous.endDate.getTime() + 1 === start
    ) {
      previous.endDate = new Date(end);
    } else {
      spans.push({
        agreement,
        startDate: new Date(start),
        endDate: new Date(end),
      });
    }
  });

  return spans;
}

/**
 * Who held one building across a period, in order.
 *
 * Agreements take turns: each holds the building for the time it had
 * precedence, so one that started, ended or was renewed inside the period is
 * charged — or owes its rent — for its own part and no more.
 *
 * Investment wins over management wherever it is in force: a building the
 * office has taken on is not also under management, and its tenants' rent is
 * the office's for as long as that lasts. So the investment agreements are
 * placed first, and management holds only the time they leave.
 */
export function governanceOf(
  agreements: readonly AgreementRow[],
  property: GovernedProperty,
  period: Period,
): GoverningSpan[] {
  const investment = governingSpans(agreements, property, period, "investment");
  const spans = [...investment];

  for (const span of governingSpans(agreements, property, period, "management")) {
    const close = span.endDate.getTime();
    let open = span.startDate.getTime();
    for (const taken of investment) {
      if (open > close) break;
      const begins = taken.startDate.getTime();
      const ends = taken.endDate.getTime();
      if (ends < open || begins > close) continue;
      if (begins > open) {
        spans.push({
          agreement: span.agreement,
          startDate: new Date(open),
          endDate: new Date(begins - 1),
        });
      }
      open = ends + 1;
    }
    if (open <= close) {
      spans.push({
        agreement: span.agreement,
        startDate: new Date(open),
        endDate: new Date(close),
      });
    }
  }

  return spans.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

/** An amount and the day it belongs to — when a payment was received, or an invoice fell due. */
export interface DatedAmount {
  date: Date;
  amount: number;
}

function isWithin(date: Date, period: Period): boolean {
  return date >= period.startDate && date <= period.endDate;
}

/** What of a list of dated amounts falls inside a period. */
export function amountWithin(
  entries: readonly DatedAmount[],
  period: Period,
): number {
  return round(
    entries
      .filter((entry) => isWithin(entry.date, period))
      .reduce((sum, entry) => sum + entry.amount, 0),
  );
}

/**
 * A flat amount — a fixed fee, an investment agreement's rent — over the part
 * of a period its agreement was in force: real cycles from the agreement's
 * own start, a cycle only partly inside prorated by day.
 */
function flatAmountFor(agreement: AgreementRow, period: Period): number {
  const inForce = termWithin(agreement, period);
  if (!inForce) return 0;
  return fixedFeeOver(
    agreement.feeAmount,
    normalizeFrequency(agreement.feeFrequency),
    startOfDay(agreement.startDate),
    inForce.startDate,
    new Date(inForce.endDate.getTime() + 1),
  );
}

/**
 * Commission owed under one agreement for a period.
 *
 * Only the part of the period the agreement was in force earns anything.
 *
 * Percentage: a share of the rent dated inside that part (collected or
 * billed, per the agreement). Rent received before the agreement started, or
 * after it ended, is not its to charge — which is why the rent comes dated
 * rather than as one figure for the period.
 *
 * Fixed: the flat fee once per cycle, prorated by day across that part — so
 * an agreement signed mid-quarter does not charge a full quarter.
 */
export function commissionFor(
  agreement: AgreementRow,
  rent: readonly DatedAmount[],
  period: Period,
): number {
  if (agreement.feeType === "fixed") return flatAmountFor(agreement, period);

  const inForce = termWithin(agreement, period);
  const percentage = agreement.feePercentage;
  if (!inForce || percentage <= 0) return 0;
  return round((amountWithin(rent, inForce) * percentage) / 100);
}

/**
 * What an investment agreement owes the owner for a period: its fixed rent,
 * walked by real cycles from the agreement's own start and prorated only
 * where a cycle is partly inside the period — the same arithmetic as a fixed
 * management fee, over the overlap with the agreement's term.
 */
export function investmentRentFor(
  agreement: AgreementRow,
  period: Period,
): number {
  return flatAmountFor(agreement, period);
}

/**
 * One building's part of an amount that belongs to a whole agreement.
 *
 * A flat fee, or an investment rent, is agreed once for everything the
 * agreement covers — it is not charged again for every building. It is shared
 * equally between the buildings, to the cent: the remainder goes one cent at
 * a time to the first buildings in `governed` order, so the parts always add
 * back up to the amount agreed.
 */
export function shareOfAgreementAmount(
  amount: number,
  governed: readonly string[],
  propertyId: string,
): number {
  const index = governed.indexOf(propertyId);
  if (governed.length === 0 || index < 0) return round(amount);
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / governed.length);
  const remainder = cents - base * governed.length;
  return (base + (index < remainder ? 1 : 0)) / 100;
}

/** A payment received, or an invoice that fell due, on one building. */
export interface RentEntry {
  propertyId: string;
  /** The payment's paid date; the invoice's due date. */
  date: Date;
  /** Everything in it — deposits, utilities and VAT included. */
  amount: number;
  /** Of that, what a commission is charged on (lib/statements/commission-base.ts). */
  base: number;
}

/**
 * What one agreement charged a building — or, under investment, owes for it —
 * for the part of a period it held it. The dates say which payments and
 * expenses fall to that agreement.
 */
export interface CommissionPart extends Period {
  agreementId: string;
  agreementNumber: string | null;
  agreementKind: AgreementKind;
  feeType: string;
  feeLabel: string;
  fee: FeeParts;
  /** Everything received, and everything billed, inside the part. */
  rentCollected: number;
  rentBilled: number;
  /** Rent before VAT the commission was charged on — zero under investment. */
  commissionBase: number;
  commission: number;
  investmentRent: number;
}

/**
 * No single fee to name: the building was charged under more than one inside
 * the period. Carried in place of a fee so that whatever prints a rate sees
 * there is not one — a missing fee would simply be left out of the question.
 */
export const SEVERAL_FEES = {
  type: "several",
  percentage: 0,
  amount: 0,
  frequency: "",
} as const;

/**
 * One building over the period, read whole — for the statements that take a
 * building as one thing (compound, building, unit, the property's own page).
 * `parts` is the exact account: what each agreement that held it charged, and
 * when. The owner's statement, an agreement's own and the agreement report
 * are built from the parts.
 *
 * Read whole, a building is the office's when an investment agreement holds
 * it at the close of the period: it then carries the investment rent of the
 * period and no commission. Otherwise it is read as managed: it carries the
 * commission of the management agreements that held it, and no investment
 * rent. Only a period in which it passed from one kind to the other leaves
 * anything out, and that is what the parts are for.
 */
export interface PropertyCommission {
  propertyId: string;
  propertyName: string;
  /**
   * The agreement the building is read under: the one that held it at the
   * close of the period — or, where none of that kind did by then, the last
   * that had.
   */
  agreementId: string | null;
  agreementNumber: string | null;
  /** Which kind of agreement governs the building, if any. */
  agreementKind: AgreementKind | null;
  /**
   * The fee the building was charged under: its type, its label, and the same
   * fee as data so statements can word it per language. Where the fee changed
   * inside the period — a renewal on new terms — the label lists each, the
   * type is null unless they share one, and the data is `SEVERAL_FEES`, so
   * that no single rate is printed against a commission charged at two.
   */
  feeType: string | null;
  feeLabel: string | null;
  fee: FeeParts | typeof SEVERAL_FEES | null;
  /** Everything received in the period — deposits, utilities and VAT included. */
  rentCollected: number;
  rentBilled: number;
  /**
   * What the agreements charged against: the rent in those figures, before
   * VAT — received or billed, per each one's `commissionBasis`, and only for
   * the part of the period it held the building. See
   * lib/statements/commission-base.ts.
   */
  commissionBase: number;
  commission: number;
  /**
   * This building's part of an investment agreement's rent for the period —
   * what the office owes the owner for it. Zero for every other building.
   */
  investmentRent: number;
  netToOwner: number;
  /** One per agreement that held the building, in order of time. */
  parts: CommissionPart[];
}

/** The buildings read whole, and what they add up to — see PropertyCommission. */
export interface CommissionRun {
  /** True when at least one management agreement applied to a property. */
  hasAgreements: boolean;
  /** True when at least one building is let to the office under investment. */
  hasInvestment: boolean;
  totals: {
    rentCollected: number;
    rentBilled: number;
    commission: number;
    investmentRent: number;
    netToOwner: number;
  };
  byProperty: PropertyCommission[];
}

export interface CommissionRunInput {
  /** The buildings the run is about. */
  properties: ReadonlyArray<GovernedProperty & { name: string }>;
  /**
   * Every building of the same owners, in a fixed order. A flat amount is
   * shared over all of them an agreement governs, not only the ones asked
   * about.
   */
  portfolio: readonly GovernedProperty[];
  agreements: readonly AgreementRow[];
  period: Period;
  /** Every payment received in the period. */
  received: readonly RentEntry[];
  /** Every invoice that fell due in it. */
  billed: readonly RentEntry[];
}

/** A flat amount is one figure for everything its agreement covers. */
function isFlat(agreement: AgreementRow): boolean {
  return agreementKind(agreement) === "investment" || agreement.feeType === "fixed";
}

/** A stretch of a period over which one agreement held the same buildings. */
interface SharedStretch extends Period {
  governed: string[];
  amount: number;
}

/**
 * A flat amount across the buildings its agreement held, stretch by stretch.
 *
 * The buildings an agreement covers can change inside a period — one gets an
 * agreement of its own, another's ends — and an amount agreed for the whole
 * lot is shared between whichever it covered at the time.
 */
function sharedStretches(
  agreement: AgreementRow,
  held: ReadonlyArray<{ propertyId: string; span: Period }>,
): SharedStretch[] {
  const cuts = [
    ...new Set(
      held.flatMap(({ span }) => [
        span.startDate.getTime(),
        span.endDate.getTime() + 1,
      ]),
    ),
  ].sort((a, b) => a - b);

  const stretches: SharedStretch[] = [];
  for (let index = 0; index + 1 < cuts.length; index++) {
    const startDate = new Date(cuts[index]);
    const endDate = new Date(cuts[index + 1] - 1);
    const governed = held
      .filter(({ span }) => span.startDate <= startDate && span.endDate >= endDate)
      .map(({ propertyId }) => propertyId);
    if (governed.length === 0) continue;

    const previous = stretches[stretches.length - 1];
    if (
      previous &&
      previous.endDate.getTime() + 1 === startDate.getTime() &&
      previous.governed.join() === governed.join()
    ) {
      previous.endDate = endDate;
    } else {
      stretches.push({ startDate, endDate, governed, amount: 0 });
    }
  }

  for (const stretch of stretches) {
    stretch.amount = flatAmountFor(agreement, stretch);
  }
  return stretches;
}

function total<K extends "amount" | "base">(
  entries: readonly RentEntry[],
  key: K,
): number {
  return round(entries.reduce((sum, entry) => sum + entry[key], 0));
}

/**
 * One building read whole, from the parts each agreement charged it — read as
 * under investment or as managed, see PropertyCommission.
 */
function commissionEntry(
  property: { id: string; name: string },
  parts: CommissionPart[],
  rent: { collected: number; billed: number; base: number },
  readAs: AgreementKind,
): PropertyCommission {
  const counted = parts.filter((part) => part.agreementKind === readAs);
  const last = counted[counted.length - 1];
  if (!last) {
    return {
      propertyId: property.id,
      propertyName: property.name,
      agreementId: null,
      agreementNumber: null,
      agreementKind: null,
      feeType: null,
      feeLabel: null,
      fee: null,
      rentCollected: rent.collected,
      rentBilled: rent.billed,
      commissionBase: rent.base,
      commission: 0,
      investmentRent: 0,
      netToOwner: rent.collected,
      parts,
    };
  }

  const sum = (key: "commission" | "investmentRent" | "commissionBase") =>
    round(counted.reduce((total, part) => total + part[key], 0));
  const commission = sum("commission");
  const investmentRent = sum("investmentRent");
  const labels = [...new Set(counted.map((part) => part.feeLabel))];

  return {
    propertyId: property.id,
    propertyName: property.name,
    agreementId: last.agreementId,
    agreementNumber: last.agreementNumber,
    agreementKind: readAs,
    feeType: counted.every((part) => part.feeType === last.feeType)
      ? last.feeType
      : null,
    feeLabel: labels.join(", "),
    fee: labels.length === 1 ? last.fee : SEVERAL_FEES,
    rentCollected: rent.collected,
    rentBilled: rent.billed,
    commissionBase: sum("commissionBase"),
    commission,
    investmentRent,
    netToOwner:
      readAs === "investment"
        ? investmentRent
        : // Net is always measured against cash in — an owner cannot be paid
          // out of rent that has only been invoiced.
          round(rent.collected - commission),
    parts,
  };
}

function summarize(byProperty: PropertyCommission[]): CommissionRun {
  const totals = byProperty.reduce(
    (acc, entry) => ({
      rentCollected: round(acc.rentCollected + entry.rentCollected),
      rentBilled: round(acc.rentBilled + entry.rentBilled),
      commission: round(acc.commission + entry.commission),
      investmentRent: round(acc.investmentRent + entry.investmentRent),
      netToOwner: round(acc.netToOwner + entry.netToOwner),
    }),
    {
      rentCollected: 0,
      rentBilled: 0,
      commission: 0,
      investmentRent: 0,
      netToOwner: 0,
    },
  );

  return {
    hasAgreements: byProperty.some(
      (entry) => entry.agreementKind === "management",
    ),
    hasInvestment: byProperty.some(
      (entry) => entry.agreementKind === "investment",
    ),
    totals,
    byProperty,
  };
}

/**
 * Commission across a set of properties for a period, from rows already read.
 *
 * Each building is charged by every agreement that held it, for the part of
 * the period it held it and on its own terms: a percentage of the rent dated
 * inside that part, or its share of a flat fee over it. While an investment
 * agreement holds it, it earns no management commission — it is owed its
 * share of that agreement's rent instead.
 */
export function computeCommissionRun(input: CommissionRunInput): CommissionRun {
  const { agreements, period } = input;

  // A flat amount — a fixed fee, an investment rent — is agreed once for
  // everything its agreement covers, so it is shared over every building the
  // agreement held across the owners' whole portfolios rather than only the
  // buildings this run was asked about: one building's statement must carry
  // its part, not the whole. It used to be charged again for every building —
  // a compound-wide 3,000 a month over four buildings came to 12,000.
  const held = new Map<string, Array<{ propertyId: string; span: Period }>>();
  for (const building of input.portfolio) {
    for (const span of governanceOf(agreements, building, period)) {
      if (!isFlat(span.agreement)) continue;
      const list = held.get(span.agreement.id) ?? [];
      list.push({ propertyId: building.id, span });
      held.set(span.agreement.id, list);
    }
  }
  const stretchesOf = new Map<string, SharedStretch[]>();
  const flatShare = (
    agreement: AgreementRow,
    span: Period,
    propertyId: string,
  ): number => {
    let stretches = stretchesOf.get(agreement.id);
    if (!stretches) {
      stretches = sharedStretches(agreement, held.get(agreement.id) ?? []);
      stretchesOf.set(agreement.id, stretches);
    }
    const mine = stretches.filter(
      (stretch) =>
        stretch.governed.includes(propertyId) &&
        stretch.startDate >= span.startDate &&
        stretch.endDate <= span.endDate,
    );
    // A building outside the portfolio read above shares with no other.
    if (mine.length === 0) return flatAmountFor(agreement, span);
    return round(
      mine.reduce(
        (sum, stretch) =>
          sum +
          shareOfAgreementAmount(stretch.amount, stretch.governed, propertyId),
        0,
      ),
    );
  };

  const entriesOf = (entries: readonly RentEntry[]) => {
    const byId = new Map<string, RentEntry[]>();
    for (const entry of entries) {
      const list = byId.get(entry.propertyId) ?? [];
      list.push(entry);
      byId.set(entry.propertyId, list);
    }
    return byId;
  };
  const receivedOf = entriesOf(input.received);
  const billedOf = entriesOf(input.billed);

  const byProperty = input.properties.map((property) => {
    const received = receivedOf.get(property.id) ?? [];
    const billed = billedOf.get(property.id) ?? [];

    const parts = governanceOf(agreements, property, period).map(
      (span): CommissionPart => {
        const { agreement } = span;
        const receivedInside = received.filter((entry) =>
          isWithin(entry.date, span),
        );
        const billedInside = billed.filter((entry) => isWithin(entry.date, span));
        const figures = {
          agreementId: agreement.id,
          agreementNumber: agreement.agreementNumber,
          feeType: agreement.feeType,
          feeLabel: feeLabel(agreement),
          fee: feeParts(agreement),
          startDate: span.startDate,
          endDate: span.endDate,
          rentCollected: total(receivedInside, "amount"),
          rentBilled: total(billedInside, "amount"),
        };

        if (agreementKind(agreement) === "investment") {
          return {
            ...figures,
            agreementKind: "investment",
            // The tenants' rent is the office's under an investment
            // agreement; it is reported, never charged against.
            commissionBase: 0,
            commission: 0,
            investmentRent: flatShare(agreement, span, property.id),
          };
        }

        // Rent before VAT, received or billed as the agreement says — never
        // the deposits, utilities or VAT that arrive with it.
        const charged =
          agreement.commissionBasis === "billed" ? billedInside : receivedInside;
        return {
          ...figures,
          agreementKind: "management",
          commissionBase: total(charged, "base"),
          // A percentage is already this building's own; a flat fee is the
          // whole agreement's, and each building carries its part.
          commission:
            agreement.feeType === "fixed"
              ? flatShare(agreement, span, property.id)
              : commissionFor(
                  agreement,
                  charged.map((entry) => ({
                    date: entry.date,
                    amount: entry.base,
                  })),
                  span,
                ),
          investmentRent: 0,
        };
      },
    );

    // Read whole, the building is the office's only if an investment
    // agreement still holds it as the period closes.
    const closing = parts[parts.length - 1];
    const underInvestment =
      closing?.agreementKind === "investment" &&
      closing.endDate.getTime() >= period.endDate.getTime();

    return commissionEntry(
      property,
      parts,
      {
        collected: total(received, "amount"),
        billed: total(billed, "amount"),
        base: total(received, "base"),
      },
      underInvestment ? "investment" : "management",
    );
  });

  return summarize(byProperty);
}

/**
 * A commission run as one agreement's own statement reads it: only what that
 * agreement charged, on its own terms, for the time it held each building.
 * What another agreement charged the same buildings — the one it replaced, or
 * the one that replaced it — belongs to that agreement's statement.
 */
export function commissionUnderAgreement(
  run: CommissionRun,
  agreementId: string,
): CommissionRun {
  return summarize(
    run.byProperty.map((entry) => {
      const parts = entry.parts.filter((part) => part.agreementId === agreementId);
      return commissionEntry(
        { id: entry.propertyId, name: entry.propertyName },
        parts,
        {
          collected: round(parts.reduce((sum, part) => sum + part.rentCollected, 0)),
          billed: round(parts.reduce((sum, part) => sum + part.rentBilled, 0)),
          base: 0,
        },
        // Its own kind: everything it charged counts, whenever it ended.
        parts[0]?.agreementKind ?? "management",
      );
    }),
  );
}

/**
 * The time in a period whose rows a statement carries for one building — its
 * payments, its expenses, its contracts.
 *
 * The owner's statement carries all of it but the time the building was under
 * an investment agreement: the tenants' rent and the running costs of that
 * time are the office's, and the owner is owed the agreement's rent instead.
 * An agreement's own statement carries only the time that agreement held the
 * building under management.
 */
export function statementTime(
  parts: readonly CommissionPart[],
  period: Period,
  agreementId?: string,
): Period[] {
  if (agreementId) {
    return parts
      .filter(
        (part) =>
          part.agreementId === agreementId &&
          part.agreementKind === "management",
      )
      .map((part) => ({ startDate: part.startDate, endDate: part.endDate }));
  }

  const spans: Period[] = [];
  let open = period.startDate.getTime();
  for (const part of parts) {
    if (part.agreementKind !== "investment") continue;
    const begins = part.startDate.getTime();
    if (begins > open) {
      spans.push({ startDate: new Date(open), endDate: new Date(begins - 1) });
    }
    open = Math.max(open, part.endDate.getTime() + 1);
  }
  if (open <= period.endDate.getTime()) {
    spans.push({ startDate: new Date(open), endDate: period.endDate });
  }
  return spans;
}

/**
 * What one agreement held inside a period: each building with the time it
 * held it, and the stretch of the period the whole of it spans — null when it
 * held nothing. A draft held nothing; nor did an agreement whose term the
 * period does not touch, or one that another agreement had precedence over
 * throughout.
 *
 * An agreement's own statement is read over that stretch and no further, which
 * is what settles an agreement that has ended: read to the close of a longer
 * period, its buildings are the next agreement's, or nobody's.
 */
export function heldUnder(
  agreementId: string,
  agreements: readonly AgreementRow[],
  buildings: readonly GovernedProperty[],
  period: Period,
): {
  held: Array<{ propertyId: string; spans: GoverningSpan[] }>;
  covered: Period | null;
} {
  const held = buildings
    .map((building) => ({
      propertyId: building.id,
      spans: governanceOf(agreements, building, period).filter(
        (span) => span.agreement.id === agreementId,
      ),
    }))
    .filter(({ spans }) => spans.length > 0);

  const all = held.flatMap(({ spans }) => spans);
  return {
    held,
    covered: all.length
      ? {
          startDate: new Date(
            Math.min(...all.map((span) => span.startDate.getTime())),
          ),
          endDate: new Date(
            Math.max(...all.map((span) => span.endDate.getTime())),
          ),
        }
      : null,
  };
}

/**
 * The part a date falls in — the agreement a payment received, or an expense
 * spent, on that day belongs to. Undefined when no agreement held the
 * building then.
 */
export function partOn(
  parts: readonly CommissionPart[],
  date: Date,
): CommissionPart | undefined {
  return parts.find((part) => isWithin(date, part));
}


/** Human-readable fee, e.g. "5%" or "3,000 / monthly". */
/** An agreement's fee as data, for wording it in the reader's language. */
export interface FeeParts {
  type: "fixed" | "percentage";
  percentage: number;
  amount: number;
  frequency: string;
}

export function feeParts(agreement: AgreementRow): FeeParts {
  return {
    type: agreement.feeType === "fixed" ? "fixed" : "percentage",
    percentage: agreement.feePercentage,
    amount: agreement.feeAmount,
    frequency: agreement.feeFrequency,
  };
}

export function feeLabel(agreement: AgreementRow): string {
  return agreement.feeType === "fixed"
    ? `${agreement.feeAmount} / ${agreement.feeFrequency.replace(/_/g, "-")}`
    : `${agreement.feePercentage}%`;
}
