/**
 * PropertyPro - Invoice numbers, against the database
 *
 * Supplies `allocateInvoiceNumber` (lib/invoice-number.ts) with the two things
 * it needs from the database: where a prefix's sequence stands, and a way to
 * recognise a collision on the number itself.
 */

import { db } from "@/lib/db/prisma";
import { uniqueViolationTarget } from "@/lib/db/unique-violation";
import { allocateInvoiceNumber } from "@/lib/invoice-number";

/**
 * The highest sequence issued under a prefix, deleted invoices included.
 *
 * Read in SQL because the highest *number* is not the highest *string* once a
 * sequence outgrows its padding, and counting rows is what broke on gaps. A
 * soft-deleted invoice keeps its number, so it counts; a hard-deleted one left
 * a gap, which no longer matters. Numbers written another way (an older
 * scheme, a longer prefix sharing this one's start) match no digits and are
 * ignored. The org filter is written out although row-level security applies
 * it as well.
 */
export async function highestInvoiceSequence(
  organizationId: string,
  prefix: string,
): Promise<number> {
  const pattern = `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-([0-9]{1,15})$`;
  const rows = await db.$queryRaw<Array<{ highest: bigint | number | null }>>`
    SELECT MAX(CAST(SUBSTRING("invoiceNumber" FROM ${pattern}::text) AS BIGINT)) AS highest
    FROM invoices
    WHERE "organizationId" = ${organizationId}
      AND "invoiceNumber" LIKE ${`${prefix}-%`}::text
  `;
  const highest = rows[0]?.highest;
  return highest === null || highest === undefined ? 0 : Number(highest);
}

/** Whether a failed insert collided on (organizationId, invoiceNumber). */
export function isInvoiceNumberTaken(error: unknown): boolean {
  return uniqueViolationTarget(error).includes("invoiceNumber");
}

/**
 * Insert an invoice under the next free `PREFIX-000123` number.
 *
 * `create` receives the number and performs the insert. A collision on the
 * number is retried here; every other failure — a billing period that is
 * already invoiced, above all — reaches the caller as the database raised it.
 */
export function createWithInvoiceNumber<T>(
  organizationId: string,
  prefix: string,
  create: (invoiceNumber: string) => Promise<T>,
): Promise<T> {
  return allocateInvoiceNumber({
    prefix,
    highest: () => highestInvoiceSequence(organizationId, prefix),
    attempt: create,
    isNumberTaken: isInvoiceNumberTaken,
  });
}
