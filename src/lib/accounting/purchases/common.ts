/**
 * PropertyPro - What the purchases services share
 *
 * The guards every write starts with (the migration is applied, accounting is
 * set up), the bill and voucher counters, day parsing, and the names a list
 * shows for the people who acted.
 */

import "server-only";

import type { z } from "zod";
import { db, type OrgTransactionClient } from "@/lib/db/prisma";
import { uniqueViolationTarget } from "@/lib/db/unique-violation";
import { requireOrgId } from "@/lib/tenancy/context";
import { parseDay } from "../dates";
import { ledgerError, NOT_SET_UP } from "../errors";
import { getAccountingSettings } from "../settings.service";
import { purchasesAvailable, PURCHASES_MISSING_MESSAGE } from "./availability";
import { issuesText } from "./schemas";
import { businessDay } from "@/lib/dates/business-day";

/** Refuse, with a clear message, while the purchases migration is not applied. */
export async function requirePurchases(): Promise<void> {
  if (!(await purchasesAvailable())) {
    throw ledgerError("PURCHASES_UNAVAILABLE", PURCHASES_MISSING_MESSAGE, 503);
  }
}

/** The office's accounting settings; refuse when it has not set accounting up. */
export async function requireBooks() {
  const settings = await getAccountingSettings();
  if (!settings) throw NOT_SET_UP();
  return settings;
}

/** A body checked against its schema, or a refusal carrying every problem found. */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw ledgerError("PURCHASE_INVALID", issuesText(parsed.error), 400);
  return parsed.data;
}

export function dayOrThrow(value: unknown, field: string): Date {
  const day = parseDay(value);
  if (!day) throw ledgerError("LEDGER_DATE_INVALID", `${field} is not a valid date`);
  return day;
}

export type CounterKey = "bill" | "voucher";

/**
 * The next bill or voucher number, taken inside the transaction that writes
 * the document: the row is locked until commit, so two writers never take the
 * same number, and a rollback gives it back.
 */
export async function nextNumber(tx: OrgTransactionClient, key: CounterKey): Promise<number> {
  const organizationId = requireOrgId();
  const rows = await tx.$queryRaw<Array<{ lastNumber: number }>>`
    INSERT INTO "purchase_counters" ("organizationId", "key", "lastNumber", "updatedAt")
    VALUES (${organizationId}, ${key}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("organizationId", "key")
    DO UPDATE SET "lastNumber" = "purchase_counters"."lastNumber" + 1,
                  "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "lastNumber"`;
  const next = Number(rows[0]?.lastNumber);
  if (!Number.isInteger(next) || next <= 0) {
    throw ledgerError("PURCHASE_NUMBER_FAILED", "A number could not be taken. Try again.", 500);
  }
  return next;
}

/** Display names for the people who acted, by user id. */
export async function userNames(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((value): value is string => Boolean(value)))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const users = await db.user.findMany({
    where: { id: { in: wanted }, deletedAt: undefined },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  for (const user of users) {
    const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
    out.set(user.id, name || user.email || "—");
  }
  return out;
}

export const money = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/** A calendar day as `YYYY-MM-DD`. */
export const dayText = (value: Date): string => businessDay(value);

export function nullable(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text ? text : null;
}

/**
 * Whether a failed write ran into this unique constraint. Under FORCE RLS
 * Postgres leaves the DETAIL line out, so the constraint is read from every
 * place Prisma may carry it (lib/db/unique-violation.ts).
 */
export function isUniqueViolation(error: unknown, constraintFragment: string): boolean {
  return uniqueViolationTarget(error).includes(constraintFragment);
}
