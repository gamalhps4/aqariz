/**
 * PropertyPro - An activity entry in the reader's language
 *
 * Entries used to carry one English sentence, written when the action
 * happened, so an Arabic office read its own activity log in English. An
 * entry now stores a catalogue key and its parameters instead
 * (`messageKey` + `messageParams`); the sentence is put together when it is
 * read, in whatever language the reader uses. The stored English description
 * stays as the fallback for entries written before, and for a key the
 * catalogue does not have.
 *
 * Parameters that are themselves vocabulary — a record type, a status, an
 * export format, a report title — are translated too, so "Changed contract
 * status from active to terminated" comes out whole in Arabic rather than
 * half.
 *
 * No React, no database: both screens and the server-side exports use it.
 */

import { AuditAction, auditMessageKey } from "./vocabulary";

export type AuditTranslate = (
  key: string,
  options?: {
    defaultValue?: string;
    values?: Record<string, string | number>;
  },
) => string;

/** "status_changed" → "Status changed" — for a key nothing more is known about. */
export function humanizeKey(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

export function auditModuleLabel(category: string, t: AuditTranslate): string {
  return t(`admin.audit.categories.${category}`, {
    defaultValue: humanizeKey(category),
  });
}

export function auditActionLabel(action: string, t: AuditTranslate): string {
  return t(`admin.audit.actions.${action}`, {
    defaultValue: humanizeKey(action),
  });
}

export function auditTypeLabel(
  recordType: string | null | undefined,
  t: AuditTranslate,
): string {
  if (!recordType) return "";
  return t(`admin.audit.types.${recordType}`, {
    defaultValue: humanizeKey(recordType),
  });
}

export function auditFieldLabel(field: string, t: AuditTranslate): string {
  return t(`admin.audit.fields.${field}`, { defaultValue: humanizeKey(field) });
}

/** Where each record type keeps its status wording in the catalogue. */
const STATUS_CATALOGUE: Record<string, string> = {
  lease: "leases.status",
  agreement: "agreements.status",
  payment: "payments.status",
  invoice: "transactions.status",
  tenant: "tenants.status",
  maintenance: "maintenance.status",
  expense: "expenses.status",
  purchase_bill: "purchases.status",
  payment_voucher: "purchases.status",
  property: "properties.status",
  unit: "units.status",
  ticket: "tickets.status",
  inspection: "inspections.status",
  announcement: "announcements.status",
  deposit: "leases.deposit.status",
  listing: "marketing.status",
  listing_inquiry: "marketing.inquiryStatus",
  user: "admin.status",
};

/** "in_progress" → "inProgress", "Pest Control" → "pestControl": how several catalogues spell a stored word. */
export function camelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+([a-z0-9])/g, (_, next: string) => next.toUpperCase());
}

/** A stored word through a catalogue prefix, as stored and then in camel case; else `fallback`. */
function catalogueWord(
  prefix: string,
  value: string,
  t: AuditTranslate,
  fallback: string,
): string {
  const camel = camelKey(value);
  const spelled =
    camel !== value
      ? t(`${prefix}.${camel}`, { defaultValue: fallback })
      : fallback;
  return t(`${prefix}.${value}`, { defaultValue: spelled });
}

/** A stored status ("terminated") in the reader's words. */
export function auditStatusLabel(
  value: string,
  recordType: string | null | undefined,
  t: AuditTranslate,
): string {
  const catalogue = recordType ? STATUS_CATALOGUE[recordType] : undefined;
  const generic = t(`admin.audit.values.${value}`, {
    defaultValue: humanizeKey(value),
  });
  return catalogue ? catalogueWord(catalogue, value, t, generic) : generic;
}

/** "Payments Report" → "payments_report", as the export catalogue files it. */
function exportLabelSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/%/g, " pct ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatAmount(value: unknown, currency?: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value ?? "");
  const text = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return typeof currency === "string" && currency ? `${text} ${currency}` : text;
}

/**
 * The name the record column shows. A report export is named by the English
 * title the route gave its file ("Buildings"); that is translated like the
 * export's own heading. Everything else is a name as stored.
 */
export function auditRecordName(
  entry: { resourceType?: string | null; resourceName?: string | null },
  t: AuditTranslate,
): string | null {
  const name = entry.resourceName ?? null;
  // A settings save is named by its area code ("display", "email"), worded
  // here in the reader's language.
  if (name && entry.resourceType === "settings" && /^[a-z_]+$/.test(name)) {
    return t(`admin.audit.settingsAreas.${name}`, { defaultValue: name });
  }
  if (!name || entry.resourceType !== "report" || !/^[\x20-\x7E]+$/.test(name)) {
    return name;
  }
  return t(`exports.label.${exportLabelSlug(name)}`, { defaultValue: name });
}

export interface RenderableEntry {
  action: string;
  messageKey?: string | null;
  messageParams?: unknown;
  description?: string | null;
  resourceType?: string | null;
}

/** The parameters, with the vocabulary among them put in the reader's words. */
function renderParams(
  entry: RenderableEntry,
  t: AuditTranslate,
): Record<string, string | number> {
  const raw =
    entry.messageParams && typeof entry.messageParams === "object"
      ? (entry.messageParams as Record<string, unknown>)
      : {};
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) {
      out[key] = "";
      continue;
    }
    const text = String(value);
    switch (key) {
      case "type":
        out[key] = auditTypeLabel(text, t);
        break;
      case "from":
      case "to":
      case "status":
        out[key] = auditStatusLabel(text, entry.resourceType, t);
        break;
      case "area":
        out[key] = t(`admin.audit.settingsAreas.${text}`, {
          defaultValue: humanizeKey(text),
        });
        break;
      case "format":
        out[key] = t(`admin.audit.formats.${text}`, {
          defaultValue: text.toUpperCase(),
        });
        break;
      case "report":
        out[key] = /^[\x20-\x7E]+$/.test(text)
          ? t(`exports.label.${exportLabelSlug(text)}`, { defaultValue: text })
          : text;
        break;
      case "amount":
        out[key] = formatAmount(value, raw.currency);
        break;
      default:
        // A hyphenated ISO date inside Arabic text reads back to front.
        out[key] =
          typeof value === "number"
            ? value
            : /^\d{4}-\d{2}-\d{2}$/.test(text)
              ? text.replace(/-/g, "/")
              : text;
    }
  }
  return out;
}

/**
 * The entry's sentence in the reader's language.
 *
 * Its own key when it has one the catalogue knows; else the stored English
 * description (entries written before keys existed); else the action's
 * generic sentence, so nothing ever renders as a bare key.
 */
export function renderActivityMessage(
  entry: RenderableEntry,
  t: AuditTranslate,
): string {
  const params = renderParams(entry, t);
  if (!("type" in params) && entry.resourceType) {
    params.type = auditTypeLabel(entry.resourceType, t);
  }

  const MISSING = "\u0000missing";
  if (entry.messageKey) {
    const rendered = t(entry.messageKey, {
      defaultValue: MISSING,
      values: params,
    });
    if (rendered !== MISSING && rendered !== entry.messageKey) {
      return tidy(rendered);
    }
  }
  if (entry.description && entry.description.trim()) {
    return entry.description.trim();
  }
  const generic = t(auditMessageKey(entry.action), {
    defaultValue: MISSING,
    values: params,
  });
  if (generic !== MISSING && generic !== auditMessageKey(entry.action)) {
    return tidy(generic);
  }
  return auditActionLabel(entry.action, t);
}

/** Drop the gaps an empty parameter leaves ("Created  " → "Created"). */
function tidy(text: string): string {
  return text
    .replace(/\{[a-zA-Z]+\}/g, "")
    .replace(/\s+([,.:؛،)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Field names whose values are money. */
const MONEY_FIELDS = new Set([
  "amount",
  "amountPaid",
  "balanceRemaining",
  "rentAmount",
  "contractAmount",
  "securityDepositAmount",
  "electricityAmount",
  "waterAmount",
  "total",
  "subtotal",
  "taxAmount",
  "lateFee",
  // Agreements, deposits, maintenance, listings.
  "feeAmount",
  "deductionsTotal",
  "deductionAmount",
  "estimatedCost",
  "actualCost",
  "price",
  "refundAmount",
  // The books: bills, vouchers, journals, owner settlements.
  "totalAmount",
  "vatAmount",
  "collected",
  "expenseAmount",
  "commission",
  "commissionVat",
  "investmentRent",
  "netDue",
]);

/**
 * Fields whose stored value is a word of a closed set ("asset", "pos"):
 * where the catalogue words each one, as `<prefix>.<value>`.
 */
const VALUE_CATALOGUE: Record<string, string> = {
  // `<record type>.<field>` where one field name means different words on
  // different records (a category), else just `<field>`. Spelled as stored or
  // in camel case ("semi_annual" / "generalRepair"); a word the catalogue lacks
  // falls through to `admin.audit.values.<word>`, then `exports.value.<word>`.
  "expense.category": "expenses.categories",
  "expense.paymentMethod": "exports.value",
  "maintenance.category": "maintenance.categories",
  "maintenance.priority": "maintenance.priority",
  "document.category": "leases.documents.categories",
  "document.documentType": "leases.documents.types",
  "agreement.kind": "agreements.kind",
  "agreement.feeType": "agreements.feeType",
  "agreement.feeFrequency": "leases.contract.frequency",
  "agreement.commissionBasis": "agreements.basis",
  "deposit.refundMethod": "leases.deposit.methods",
  "deposit.deductionCategory": "leases.deposit.categories",
  "listing.listingType": "marketing.type",
  "listing.pricePeriod": "leases.contract.frequency",
  // A listing for a property not in the system: a unit type slug.
  "listing.propertyType": "marketing.unitType",
  "maintenance.contactMethod": "admin.audit.values",
  "maintenance.urgencyLevel": "admin.audit.values",
  accountType: "ledger.accountType",
  bankKind: "ledger.bankKind",
  normalSide: "ledger.side",
  depositHolder: "admin.audit.values",
};

/**
 * One before-or-after value for the detail panel: a status in the reader's
 * words, money to two places, a date as a day, a list as a list.
 */
export function formatAuditValue(
  field: string,
  value: unknown,
  options: {
    t: AuditTranslate;
    recordType?: string | null;
    formatDate?: (value: string) => string;
  },
): string {
  const { t, recordType, formatDate } = options;
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") {
    return value
      ? t("admin.audit.values.yes", { defaultValue: "Yes" })
      : t("admin.audit.values.no", { defaultValue: "No" });
  }
  if (typeof value === "number") {
    return MONEY_FIELDS.has(field) ? formatAmount(value) : String(value);
  }
  if (typeof value === "string") {
    if (field === "status" || field.endsWith("Status")) {
      return auditStatusLabel(value, recordType, t);
    }
    const valueCatalogue =
      (recordType ? VALUE_CATALOGUE[`${recordType}.${field}`] : undefined) ??
      VALUE_CATALOGUE[field];
    if (valueCatalogue) {
      const fallback = t(`exports.value.${value}`, {
        defaultValue: humanizeKey(value),
      });
      return catalogueWord(valueCatalogue, value, t, fallback);
    }
    if (ISO_DATE.test(value)) {
      return formatDate ? formatDate(value) : value.slice(0, 10);
    }
    if (MONEY_FIELDS.has(field) && Number.isFinite(Number(value))) {
      return formatAmount(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value
      .map((item) =>
        item !== null && typeof item === "object"
          ? JSON.stringify(item)
          : String(item),
      )
      .join(", ");
  }
  return JSON.stringify(value);
}

/**
 * The fields worth showing for a change: every key on either side, a field
 * that was only set or only cleared included, in a stable order.
 */
export function changedFields(
  before: unknown,
  after: unknown,
): string[] {
  const keys = new Set<string>();
  for (const side of [before, after]) {
    if (side && typeof side === "object" && !Array.isArray(side)) {
      for (const key of Object.keys(side as Record<string, unknown>)) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

/** True for actions that say nothing about a record ("Signed in"). */
export function isAccountEvent(action: string): boolean {
  return (
    action === AuditAction.LOGIN ||
    action === AuditAction.LOGOUT ||
    action === AuditAction.LOGIN_FAILED ||
    action === AuditAction.PASSWORD_CHANGED ||
    action === AuditAction.PASSWORD_RESET ||
    action === AuditAction.PASSWORD_RESET_REQUESTED ||
    action === AuditAction.PASSWORD_SETUP
  );
}
