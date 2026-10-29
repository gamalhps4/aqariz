/**
 * PropertyPro - The inquiry form's field names and error codes
 *
 * Shared by the public form (a client component, which must not import the
 * guard — that reads the phone-number library and node:crypto) and by the
 * guard that judges what the form sends. Names and types only.
 */

/** The name of the hidden field. A person never sees it. */
export const HONEYPOT_FIELD = "website";

export type InquiryField = "name" | "phone" | "email" | "message";

export type InquiryErrorCode =
  | "name_required"
  | "name_too_long"
  | "phone_invalid"
  | "email_invalid"
  | "message_too_long";
