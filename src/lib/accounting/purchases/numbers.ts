/**
 * PropertyPro - The numbers a bill and a voucher print under
 *
 * Each office numbers its purchase bills (BILL-000123) and its payment
 * vouchers (PV-000045) in sequence, from one counter each
 * (`purchase_counters`, taken in the transaction that writes the document).
 * Kept as plain integers in the database and formatted here, the way payment
 * numbers are (lib/payments/receipt-number.ts), so a number sorts as a number
 * and a search for "12" finds BILL-000012.
 *
 * No database: the screens and the exports import it too.
 */

export const BILL_NUMBER_PREFIX = "BILL-";
export const VOUCHER_NUMBER_PREFIX = "PV-";

/** Digits a number is padded to; longer numbers print in full. */
const DIGITS = 6;

function format(prefix: string, number: number | null | undefined): string | null {
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) return null;
  return `${prefix}${String(number).padStart(DIGITS, "0")}`;
}

/** BILL-000123, or null for no number. */
export function formatBillNumber(number: number | null | undefined): string | null {
  return format(BILL_NUMBER_PREFIX, number);
}

/** PV-000045, or null for no number. */
export function formatVoucherNumber(number: number | null | undefined): string | null {
  return format(VOUCHER_NUMBER_PREFIX, number);
}

function parse(prefixes: readonly string[], text: string | null | undefined): number | null {
  if (!text) return null;
  const pattern = new RegExp(`^\\s*(?:(?:${prefixes.join("|")})[\\s-]*|#)?0*(\\d{1,9})\\s*$`, "i");
  const match = pattern.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The bill a search names: "BILL-000012", "bill 12", "#12", "12" all mean bill 12. */
export function parseBillNumber(text: string | null | undefined): number | null {
  return parse(["bill"], text);
}

/** The voucher a search names: "PV-000045", "pv 45", "#45", "45". */
export function parseVoucherNumber(text: string | null | undefined): number | null {
  return parse(["pv"], text);
}
