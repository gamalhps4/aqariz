/**
 * PropertyPro - Which document a journal entry follows
 *
 * A document entry names its source (`sourceType`, `sourceId`); this says
 * which document that is, so the posting can read it again. An invoice's
 * settlements are `<invoice id>:<n>` and follow the invoice.
 *
 * Pure: the posting service, the sweep and their tests share it.
 */

export type DocumentKind =
  | "invoice"
  | "payment"
  | "expense"
  | "security_deposit"
  | "purchase_bill"
  | "payment_voucher";

/** A source type, or the document it follows, as the document. */
export function documentKindOf(value: string): DocumentKind | null {
  switch (value) {
    case "invoice":
    case "invoice_settlement":
      return "invoice";
    case "payment":
    case "payment_refund":
      return "payment";
    case "expense":
      return "expense";
    case "security_deposit":
    case "deposit_receipt":
    case "deposit_settlement":
      return "security_deposit";
    case "purchase_bill":
      return "purchase_bill";
    case "payment_voucher":
      return "payment_voucher";
    default:
      return null;
  }
}

/** The document's own id: an invoice settlement's is its invoice's. */
export function documentIdOf(sourceType: string, sourceId: string): string {
  return sourceType === "invoice_settlement" && sourceId.includes(":")
    ? sourceId.slice(0, sourceId.indexOf(":"))
    : sourceId;
}

const sourceKey = (sourceType: string, sourceId: string | null) => `${sourceType}:${sourceId ?? ""}`;

/**
 * The documents behind live entries that a sweep's date filters did not
 * select, by kind — to read again before anything is reversed.
 *
 * The sweep reverses what "nothing asks for any more", which is only true of
 * documents it has read. One it never selected — an owner's invoice whose
 * latest recorded receipt was back-dated before the cut-over, a payment
 * refunded long after it was received — would have its entries reversed,
 * and the next write's hook would post them again: books that flip-flopped
 * every night. Read again, a document that still calls for its entry keeps
 * it; one that is gone or cancelled is reversed as before.
 */
export function sourcesToReread(
  live: ReadonlyArray<{ sourceType: string; sourceId: string | null }>,
  wanted: ReadonlySet<string>,
): Map<DocumentKind, string[]> {
  const out = new Map<DocumentKind, Set<string>>();
  for (const entry of live) {
    if (!entry.sourceId || wanted.has(sourceKey(entry.sourceType, entry.sourceId))) continue;
    const kind = documentKindOf(entry.sourceType);
    if (!kind) continue;
    const ids = out.get(kind) ?? new Set<string>();
    ids.add(documentIdOf(entry.sourceType, entry.sourceId));
    out.set(kind, ids);
  }
  return new Map([...out.entries()].map(([kind, ids]) => [kind, [...ids]]));
}
