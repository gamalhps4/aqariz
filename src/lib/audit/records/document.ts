/**
 * PropertyPro - A document as an activity entry holds it
 *
 * A document is named by its file name. The entry keeps what an office is
 * asked about — what the file is, its kind and category, how big, and the
 * record it belongs to (a contract's number) — and never where it is stored:
 * no URL, no storage key.
 *
 * Pure: no database, nothing server-only.
 */

import {
  clip,
  kilobytes,
  type Row,
} from "./shared";

/** The fields compared when a document's details are edited. */
export const DOCUMENT_CHANGE_KEYS = [
  "fileName",
  "description",
  "documentType",
  "category",
  "tags",
] as const;

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The document as an entry stores it. `contractNumber` is the contract the
 * document is filed under, when the route knows it.
 */
export function documentSnapshot(
  row: Row | null | undefined,
  context: { contractNumber?: string | null } = {},
): Row {
  if (!row) return {};
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
    : [];
  return {
    fileName: textOf(row.name),
    description: clip(row.description, 200),
    documentType: textOf(row.type),
    category: textOf(row.category),
    fileSizeKb: kilobytes(row.fileSize),
    tags,
    contractNumber: textOf(context.contractNumber),
  };
}

/** What a reader knows a document by: its file name. */
export function documentName(row: Row | null | undefined): string | null {
  return row ? textOf(row.name) : null;
}

/** A file's details from an uploaded `File`, for a route that stores no row. */
export function uploadedFileSnapshot(file: {
  name?: string;
  size?: number;
  type?: string;
}): Row {
  return {
    fileName: textOf(file.name),
    fileSizeKb: kilobytes(file.size),
  };
}
