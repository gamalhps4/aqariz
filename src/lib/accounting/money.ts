/**
 * PropertyPro - Ledger money arithmetic
 *
 * The books are kept in halalas — whole hundredths of a riyal — as integers.
 * Every posting rule works in them, so a split of 1,000.00 three ways comes
 * back as 333.34 + 333.33 + 333.33 and never as three floats that add up to
 * 999.9999999. The database stores numeric(14,2); the conversion happens once
 * on the way in (`toHalalas`) and once on the way out (`halalasToDecimal`).
 *
 * Pure, so the posting rules and their tests can use it without a database.
 */

/** An amount in hundredths of the currency unit, as an integer. */
export type Halalas = number;

/**
 * Halalas from anything money-shaped: a number, a numeric string, or a
 * Prisma Decimal (whose `toString()` is exact). Garbage reads as zero, which
 * the callers' "nothing to post" checks then treat as nothing.
 */
export function toHalalas(
  value: number | string | null | undefined | { toString(): string },
): Halalas {
  if (value === null || value === undefined) return 0;
  const parsed =
    typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) return 0;
  // `|| 0` folds the -0 that Math.round(-0.4) gives back into a plain zero.
  return Math.round(parsed * 100) || 0;
}

/** Halalas as a plain number of riyals, for JSON and the screens. */
export function fromHalalas(amount: Halalas): number {
  return amount / 100;
}

/** Halalas as an exact decimal string — what a numeric(14,2) column takes. */
export function halalasToDecimal(amount: Halalas): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(amount));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}${whole}.${String(cents).padStart(2, "0")}`;
}

export function sumHalalas(values: readonly Halalas[]): Halalas {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Split an amount across weights, to the halala, so the parts always add
 * back up to the amount.
 *
 * Each part gets its exact share rounded down; the halalas left over go one
 * at a time to the parts with the largest remainders (the earlier part on a
 * tie), the same "largest remainder" method the agreement engine uses for a
 * flat fee shared between buildings. All-zero weights share equally. A
 * negative amount is split as its absolute value and negated back.
 */
export function allocateProportionally(
  amount: Halalas,
  weights: readonly number[],
): Halalas[] {
  if (weights.length === 0) return [];
  if (amount === 0) return weights.map(() => 0);
  if (amount < 0) {
    return allocateProportionally(-amount, weights).map((part) => -part || 0);
  }

  const cleaned = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  );
  const totalWeight = cleaned.reduce((sum, weight) => sum + weight, 0);
  const effective =
    totalWeight > 0 ? cleaned : weights.map(() => 1);
  const effectiveTotal = totalWeight > 0 ? totalWeight : weights.length;

  const exact = effective.map((weight) => (amount * weight) / effectiveTotal);
  const parts = exact.map((share) => Math.floor(share));
  let remainder = amount - parts.reduce((sum, part) => sum + part, 0);

  const order = exact
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let cursor = 0; remainder > 0 && order.length > 0; cursor++) {
    parts[order[cursor % order.length].index] += 1;
    remainder -= 1;
  }
  return parts;
}

/**
 * The part of `amount` that `numerator / denominator` of it comes to, to the
 * halala — how much of a payment belongs to an owner when the installment it
 * paid was partly the owner's. Zero when there is nothing to divide by.
 */
export function proportionOf(
  amount: Halalas,
  numerator: Halalas,
  denominator: Halalas,
): Halalas {
  if (denominator === 0 || numerator === 0 || amount === 0) return 0;
  if (numerator === denominator) return amount;
  return Math.round((amount * numerator) / denominator) || 0;
}
