/**
 * PropertyPro - What makes two postings of a document the same
 *
 * A digest of the entry a rule asks for — its day, reference and every line,
 * with accounts named by their job (system key) rather than resolved to an
 * id. Re-posting an unchanged document therefore finds the same fingerprint
 * on the entry already held and does nothing; and pointing a key at another
 * account later changes what new entries post to without rewriting every old
 * one.
 *
 * The day is the one the document calls for, not the one the entry ended up
 * on: a document dated inside a closed period is posted on the first open
 * day, and must not look changed — and be reposted — on every later run.
 *
 * Server-side (node:crypto); the screens never need it.
 */

import { createHash } from "node:crypto";
import { formatDay } from "../dates";
import type { PlannedLine, PostingPlan } from "../types";

function lineText(line: PlannedLine): string {
  const account = "key" in line.account ? `k:${line.account.key}` : `i:${line.account.id}`;
  return [
    account,
    line.debit,
    line.credit,
    line.partyType ?? "",
    line.partyId ?? "",
    line.propertyId ?? "",
    line.unitId ?? "",
    line.leaseId ?? "",
    line.agreementId ?? "",
    line.vatCode ?? "",
    line.memo ?? "",
  ].join("|");
}

export function fingerprintPlan(plan: PostingPlan): string {
  const text = [
    plan.sourceType,
    plan.sourceId ?? "",
    plan.sourceRef ?? "",
    formatDay(plan.date),
    plan.memo ?? "",
    ...plan.lines.map(lineText),
  ].join("\n");
  return createHash("sha256").update(text).digest("hex").slice(0, 40);
}
