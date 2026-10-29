/**
 * PropertyPro - Digits, the way a form types them
 *
 * An office in Riyadh types a licence number or a phone number on an Arabic
 * keyboard as often as not, and gets Arabic-Indic digits (٠-٩) or Persian ones
 * (۰-۹). Everything stored and compared is Western digits. No dependencies, so
 * a screen can import it without pulling anything else in.
 */

export function toWesternDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - 0x0660),
    )
    .replace(/[۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - 0x06f0),
    );
}
