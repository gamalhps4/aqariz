/**
 * PropertyPro - Invoice numbers
 *
 * An invoice number is `PREFIX-000123`: one sequence per prefix inside an
 * organization, with the (organizationId, invoiceNumber) unique index as the
 * arbiter when two writers reach for the same number.
 *
 * The next number used to be the count of numbers already issued, plus one.
 * That is the next free number only while the sequence has no gaps, and it has
 * them: the archive's permanent delete removes invoices outright. With ten
 * numbers gone below the highest, the count pointed ten numbers back into the
 * taken range; the writer tried eight of them, found every one taken, and gave
 * up. Billing then failed for the whole organization, every time, until
 * someone noticed.
 *
 * The next number is now the highest one issued, plus one, which no gap can
 * move. Two writers racing still collide, and the loser still moves on, but it
 * reads where the winner left the sequence instead of guessing one step at a
 * time.
 *
 * Pure: the database is passed in as two functions, so the rule is tested
 * without one (see invoice-number.test.ts). The service that supplies them is
 * `services/invoice-number.service.ts`.
 */

/** Digits after the prefix; numbers past 999,999 simply grow longer. */
export const INVOICE_NUMBER_DIGITS = 6;

/** How many numbers a writer tries before it reports the failure. */
export const INVOICE_NUMBER_ATTEMPTS = 8;

export function formatInvoiceNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(INVOICE_NUMBER_DIGITS, "0")}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The sequence inside `PREFIX-000123`, or null for a number written some
 * other way — another prefix, or a scheme older than this one.
 */
export function invoiceSequence(
  invoiceNumber: string,
  prefix: string,
): number | null {
  const match = new RegExp(`^${escapeRegExp(prefix)}-(\\d{1,15})$`).exec(
    invoiceNumber,
  );
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

export interface InvoiceNumberAllocation<T> {
  prefix: string;
  /** The highest sequence issued under the prefix so far; 0 for none. */
  highest: () => Promise<number>;
  /** Write the invoice under this number. Throws whatever the write throws. */
  attempt: (invoiceNumber: string) => Promise<T>;
  /** Whether a failed write collided on the invoice number itself. */
  isNumberTaken: (error: unknown) => boolean;
  maxAttempts?: number;
}

/**
 * Write an invoice under the next free number.
 *
 * Starts one past the highest number issued. A collision means another writer
 * took that number first; the sequence is read again and the next attempt
 * starts past wherever it now stands. Any other failure is the caller's to
 * handle, and is passed on untouched.
 */
export async function allocateInvoiceNumber<T>(
  options: InvoiceNumberAllocation<T>,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? INVOICE_NUMBER_ATTEMPTS;
  let next = (await options.highest()) + 1;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await options.attempt(formatInvoiceNumber(options.prefix, next));
    } catch (error) {
      if (!options.isNumberTaken(error)) throw error;
      if (attempt >= maxAttempts) {
        throw new Error(
          `Could not allocate an invoice number for prefix ${options.prefix} after ${maxAttempts} attempts`,
        );
      }
      next = Math.max(next + 1, (await options.highest()) + 1);
    }
  }
}
