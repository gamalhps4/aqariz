/**
 * PropertyPro - The ZATCA phase-1 QR code
 *
 * Every tax invoice issued in Saudi Arabia carries a QR code holding five
 * fields, each written as tag–length–value and the whole encoded in base64:
 *
 *   1 the seller's name   2 its VAT registration number
 *   3 when the invoice was issued (ISO 8601)
 *   4 the invoice total, VAT included   5 the VAT total
 *
 * That is phase 1 ("generation"). Phase 2 — the signed XML invoice cleared
 * through ZATCA's platform — is out of scope.
 *
 * The symbol is drawn as vector squares, the same in the browser and on the
 * server, and straight onto the document: an Arabic page is drawn through a
 * mirror (pdf-i18n.ts), and a mirrored QR code does not scan.
 */

import type jsPDF from "jspdf";
import { create as createQrSymbol } from "qrcode/lib/core/qrcode";
import { businessDay } from "@/lib/dates/business-day";

export interface ZatcaQrFields {
  sellerName: string;
  vatNumber: string;
  /** When the invoice was issued. */
  timestamp: Date;
  /** The total, VAT included. A credit note's is given as it prints: positive. */
  total: number;
  vatTotal: number;
}

/** A field holds at most 255 bytes: its length is one byte. */
const MAX_FIELD_BYTES = 255;

function utf8(value: string): Uint8Array {
  const encoder = new TextEncoder();
  let text = value;
  let bytes = encoder.encode(text);
  // Cut whole characters, never half of an Arabic letter's two bytes.
  while (bytes.length > MAX_FIELD_BYTES) {
    text = Array.from(text).slice(0, -1).join("");
    bytes = encoder.encode(text);
  }
  return bytes;
}

/** "1150.00": two decimals, no grouping, the sign left off. */
export function formatZatcaAmount(amount: number): string {
  const value = Math.abs(Math.round(Number(amount) * 100) / 100);
  return value.toFixed(2);
}

/** "2026-10-03T14:25:09Z" — UTC, to the second. */
export function formatZatcaTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * When an invoice counts as issued, to the second. Its issue date is a day;
 * the moment it was written on that day is when it was created. An invoice
 * dated another day than it was written on is dated the start of that day.
 * "That day" is the one on Riyadh's calendar: an invoice written at 01:30 on
 * the 4th is the 4th's, although the server's clock still says the 3rd.
 */
export function zatcaIssueMoment(
  issueDate: Date,
  createdAt?: Date | null,
): Date {
  if (
    createdAt &&
    !Number.isNaN(createdAt.getTime()) &&
    businessDay(createdAt) === businessDay(issueDate)
  ) {
    return createdAt;
  }
  return issueDate;
}

/** The five fields as tag–length–value bytes. */
export function zatcaTlv(fields: ZatcaQrFields): Uint8Array {
  const values = [
    fields.sellerName.trim(),
    fields.vatNumber.replace(/\s+/g, ""),
    formatZatcaTimestamp(fields.timestamp),
    formatZatcaAmount(fields.total),
    formatZatcaAmount(fields.vatTotal),
  ].map(utf8);
  const length = values.reduce((sum, value) => sum + 2 + value.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  values.forEach((value, index) => {
    out[offset] = index + 1;
    out[offset + 1] = value.length;
    out.set(value, offset + 2);
    offset += 2 + value.length;
  });
  return out;
}

/** What the QR code holds: the TLV bytes in base64. */
export function zatcaQrPayload(fields: ZatcaQrFields): string {
  const bytes = zatcaTlv(fields);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Whether a document can carry the QR code: the seller is registered (has a
 * VAT number) and has a name.
 */
export function canCarryZatcaQr(
  sellerName: string | null | undefined,
  vatNumber: string | null | undefined,
): boolean {
  return Boolean(sellerName?.trim()) && Boolean(vatNumber?.replace(/\s+/g, ""));
}

/**
 * Draw `text` as a QR code `size` millimetres square with its top-left corner
 * at (x, y) on the document itself — pass the jsPDF instance, not a mirrored
 * proxy. Light modules are left as the page; each row's dark runs are one
 * rectangle.
 */
export function drawQrCode(
  pdf: jsPDF,
  text: string,
  x: number,
  y: number,
  size: number,
): void {
  const { modules } = createQrSymbol(text, { errorCorrectionLevel: "M" });
  const count = modules.size;
  const cell = size / count;
  pdf.setFillColor(0, 0, 0);
  for (let row = 0; row < count; row += 1) {
    let col = 0;
    while (col < count) {
      if (!modules.get(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < count && modules.get(row, col)) col += 1;
      // A hair wider than the run so neighbouring rows leave no seams.
      pdf.rect(x + start * cell, y + row * cell, (col - start) * cell + 0.01, cell + 0.01, "F");
    }
  }
}
