/**
 * PropertyPro - Form validation messages in the reader's language
 *
 * Most form schemas were written with English messages ("First name is
 * required", "Invalid email", zod's own "String must contain at least 8
 * character(s)"), and the shared form field printed them as they were: an
 * Arabic screen showed English under every field it refused.
 *
 * `validationText` reads such a message for a reader of another language:
 * an exact catalogue entry when one exists (`validation.message.<slug of the
 * English>`), otherwise the kind of message it is — required, too short, not
 * an email, not a number… — worded generically. The message sits directly
 * under its field, so "This field is required" loses nothing by not naming
 * the field. A message that is already in the reader's language, or that
 * matches nothing, is shown as written.
 *
 * Schemas that already pass translated messages are unaffected: they are not
 * English, so nothing matches.
 */

import { hasTranslation, translateFor } from "./translate";

type Rule = {
  pattern: RegExp;
  key: string;
  /** Which capture holds the number the message names. */
  value?: { name: string; group: number };
};

/** Checked in order; the first that matches wins. */
const RULES: Rule[] = [
  { pattern: /^required\.?$/i, key: "required" },
  { pattern: /^passwords? (do not|don't|must) match\.?$/i, key: "passwordsMismatch" },
  { pattern: /^(.+ )?(is|are) required\.?$/i, key: "required" },
  { pattern: /^(.+ )?cannot be (empty|blank)\.?$/i, key: "required" },
  { pattern: /^please (enter|provide|fill in|add) (?!a valid)(.+)$/i, key: "required" },
  { pattern: /^(invalid email( address)?|(please )?enter a valid email( address)?|(.+ )?email (address )?is (invalid|not valid))\.?$/i, key: "email" },
  { pattern: /^(invalid url|(.+ )?(url|link) is (invalid|not valid)|invalid (.+ )?url)\.?$/i, key: "url" },
  { pattern: /^(invalid (phone|mobile)( number)?|(please )?enter a valid (phone|mobile)( number)?|(.+ )?phone( number)? is (invalid|not valid))\.?$/i, key: "phone" },
  { pattern: /^(invalid date|(please )?(enter|select|choose) a valid date|(.+ )?date is (invalid|not valid)|expected date, received .+)\.?$/i, key: "date" },
  { pattern: /^(expected number, received .+|(.+ )?must be a (valid )?number|(please )?enter a (valid )?number)\.?$/i, key: "number" },
  { pattern: /^(invalid enum value.*|(please )?(select|choose) (a|an|one) .+|(.+ )?must be one of .+)$/i, key: "choose" },
  { pattern: /^string must contain at least (\d+) character/i, key: "minLength", value: { name: "min", group: 1 } },
  { pattern: /^(.+ )?must (be|contain|have) at least (\d+) characters?( long)?\.?$/i, key: "minLength", value: { name: "min", group: 3 } },
  { pattern: /^string must contain at most (\d+) character/i, key: "maxLength", value: { name: "max", group: 1 } },
  { pattern: /^(.+ )?(must be|cannot exceed|cannot be more than|must not exceed|must be at most|must be less than) (\d+) characters?( long)?\.?$/i, key: "maxLength", value: { name: "max", group: 3 } },
  { pattern: /^number must be greater than or equal to (\S+?)\.?$/i, key: "min", value: { name: "min", group: 1 } },
  { pattern: /^number must be greater than (\S+?)\.?$/i, key: "greaterThan", value: { name: "min", group: 1 } },
  { pattern: /^number must be less than or equal to (\S+?)\.?$/i, key: "max", value: { name: "max", group: 1 } },
  { pattern: /^number must be less than (\S+?)\.?$/i, key: "lessThan", value: { name: "max", group: 1 } },
  { pattern: /^(.+ )?must be (positive|greater than (0|zero))\.?$/i, key: "positive" },
  { pattern: /^(.+ )?(cannot|can't|must not) be negative\.?$/i, key: "nonNegative" },
  { pattern: /^(.+ )?too long\.?$/i, key: "tooLong" },
  { pattern: /^(.+ )?too (high|large|big)\.?$/i, key: "tooHigh" },
  { pattern: /^(.+ )?too (low|small|short)\.?$/i, key: "tooLow" },
  { pattern: /^invalid( .+)?\.?$/i, key: "invalid" },
];

/** "First name is required" → "first_name_is_required". */
function slug(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const ASCII_TEXT = /^[\x20-\x7E]+$/;

/**
 * A validation message as a reader of `language` should see it. English
 * readers, and messages that are not plain English, get the message as is.
 */
export function validationText(message: string, language: string): string {
  const text = message?.trim();
  if (!text || !ASCII_TEXT.test(text)) return message;
  if (language.toLowerCase().startsWith("en")) return message;

  const exact = `validation.message.${slug(text)}`;
  if (hasTranslation(exact)) return translateFor(language, exact);

  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const values = rule.value
      ? { [rule.value.name]: match[rule.value.group] }
      : undefined;
    return translateFor(language, `validation.${rule.key}`, values);
  }
  return message;
}
