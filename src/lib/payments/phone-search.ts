/**
 * PropertyPro - Finding a tenant by the mobile number an office types
 *
 * Mobile numbers are stored with the country code ("+966501234567"); people
 * type them the way they dial them at home ("050 123 4567"), with spaces,
 * dashes or brackets. A plain "contains" found neither. These are the other
 * forms the same number may be stored in, for a search to try beside the
 * text as typed.
 *
 * No database here, so the tests can pin it.
 */

/**
 * The typed text without its spaces, dashes and brackets; without the
 * leading 0 of a number dialled at home ("0501234567" → "501234567"); and
 * without the 00 of an international one. Nothing for text that is not a
 * phone number.
 */
export function phoneSearchVariants(search: string): string[] {
  const digits = search.trim().replace(/[\s().-]+/g, "");
  if (!/^\+?\d{5,15}$/.test(digits)) return [];
  const variants = new Set<string>();
  if (digits !== search.trim()) variants.add(digits);
  if (digits.startsWith("00")) variants.add(digits.slice(2));
  else if (digits.startsWith("0")) variants.add(digits.slice(1));
  return [...variants];
}
