/**
 * PropertyPro - The chart of accounts, as the office edits it
 *
 * Listing (as a tree, with each account's balance and what protects it),
 * adding, changing and deleting accounts. What may change is decided by the
 * pure rules in coa-rules.ts; this gathers the facts they need — postings,
 * the account map, bank links — and writes.
 */

import { db } from "@/lib/db/prisma";
import { requireOrgId } from "@/lib/tenancy/context";
import { AuditAction, auditRecordChange, recordActivity } from "@/lib/audit-domain";
import {
  LEDGER_ACCOUNT_KEYS,
  ledgerAccountName,
  ledgerAccountSnapshot,
} from "./audit-snapshots";
import {
  accountDepth,
  canDeleteAccount,
  validateAccountDraft,
  type AccountDraft,
  type AccountNode,
  type AccountUsage,
} from "./coa-rules";
import { mappedAccountIds } from "./account-map";
import { getAccountingSettings, loadChart, resolvedMap, type ChartAccount } from "./settings.service";
import { assertRule, ledgerError } from "./errors";
import { defaultNormalSide } from "./coa-template";
import { toHalalas, fromHalalas } from "./money";
import { ACCOUNT_TYPES, NORMAL_SIDES, type AccountType, type NormalSide } from "./types";
import { purchasesAvailable } from "./purchases/availability";

export interface AccountListRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  normalSide: NormalSide;
  parentId: string | null;
  postable: boolean;
  systemKey: string | null;
  active: boolean;
  description: string | null;
  level: number;
  hasChildren: boolean;
  hasPostings: boolean;
  mapped: boolean;
  bankLinked: boolean;
  canDelete: boolean;
  debit: number;
  credit: number;
  /** In the account's own direction: a debit-normal account's debits less credits. */
  balance: number;
}

function toNode(account: ChartAccount): AccountNode {
  return {
    id: account.id,
    code: account.code,
    nameAr: account.nameAr,
    nameEn: account.nameEn,
    type: account.type,
    normalSide: account.normalSide === "credit" ? "credit" : "debit",
    parentId: account.parentId,
    postable: account.postable,
    systemKey: account.systemKey,
    active: account.active,
  };
}

/** Depth-first in code order, so a heading is followed by what sits under it. */
function treeOrder<T extends { id: string; parentId: string | null; code: string }>(rows: readonly T[]): T[] {
  const ids = new Set(rows.map((row) => row.id));
  const children = new Map<string | null, T[]>();
  for (const row of rows) {
    const parent = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), row]);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  }
  const out: T[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const row of children.get(parent) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
      walk(row.id);
    }
  };
  walk(null);
  return out;
}

export async function listAccounts(options: { asOf?: Date | null } = {}): Promise<AccountListRow[]> {
  const [chart, settings, sums, banks, billed] = await Promise.all([
    loadChart(),
    getAccountingSettings(),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: options.asOf ? { date: { lte: options.asOf } } : {},
      _sum: { debit: true, credit: true },
      _count: { _all: true },
    }),
    db.bankAccount.findMany({ select: { ledgerAccountId: true } }),
    // An account a purchase bill is charged to is in use, posted or not yet.
    purchasesAvailable().then((available) =>
      available
        ? db.purchaseBillLine.groupBy({ by: ["accountId"], _count: { _all: true } })
        : [],
    ),
  ]);
  const onBills = new Set(billed.map((row) => row.accountId));
  const mapped = mappedAccountIds(resolvedMap(settings, chart));
  const bankLinked = new Set(banks.map((bank) => bank.ledgerAccountId));
  const totalsById = new Map(
    sums.map((row) => [
      row.accountId,
      {
        debit: toHalalas(row._sum.debit as unknown as number),
        credit: toHalalas(row._sum.credit as unknown as number),
        count: row._count._all,
      },
    ]),
  );
  const nodes = new Map(chart.map((account) => [account.id, toNode(account)]));
  const parents = new Set(chart.map((account) => account.parentId).filter(Boolean) as string[]);

  // A heading's balance is what sits under it.
  const rollup = new Map<string, { debit: number; credit: number }>();
  for (const account of chart) {
    const own = totalsById.get(account.id);
    if (!own) continue;
    let cursor: string | null = account.id;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const entry = rollup.get(cursor) ?? { debit: 0, credit: 0 };
      entry.debit += own.debit;
      entry.credit += own.credit;
      rollup.set(cursor, entry);
      cursor = nodes.get(cursor)?.parentId ?? null;
    }
  }

  const rows = chart.map((account): AccountListRow => {
    const node = nodes.get(account.id)!;
    const usage: AccountUsage = {
      hasPostings: (totalsById.get(account.id)?.count ?? 0) > 0 || onBills.has(account.id),
      mapped: mapped.has(account.id),
      bankLinked: bankLinked.has(account.id),
    };
    const sum = rollup.get(account.id) ?? { debit: 0, credit: 0 };
    const balance = node.normalSide === "credit" ? sum.credit - sum.debit : sum.debit - sum.credit;
    return {
      id: account.id,
      code: account.code,
      nameAr: account.nameAr,
      nameEn: account.nameEn,
      type: node.type,
      normalSide: node.normalSide,
      parentId: account.parentId,
      postable: account.postable,
      systemKey: account.systemKey,
      active: account.active,
      description: null,
      level: accountDepth(account.id, nodes),
      hasChildren: parents.has(account.id),
      hasPostings: usage.hasPostings,
      mapped: usage.mapped,
      bankLinked: usage.bankLinked,
      canDelete: canDeleteAccount(node, usage, nodes).ok,
      debit: fromHalalas(sum.debit),
      credit: fromHalalas(sum.credit),
      balance: fromHalalas(balance),
    };
  });
  return treeOrder(rows);
}

async function usageOf(accountId: string, chart: readonly ChartAccount[]): Promise<AccountUsage> {
  const [settings, posting, bank, billed] = await Promise.all([
    getAccountingSettings(),
    db.journalLine.findFirst({ where: { accountId }, select: { id: true } }),
    db.bankAccount.findFirst({ where: { ledgerAccountId: accountId }, select: { id: true } }),
    // An account a purchase bill is charged to is in use, posted or not yet.
    purchasesAvailable().then((available) =>
      available ? db.purchaseBillLine.findFirst({ where: { accountId }, select: { id: true } }) : null,
    ),
  ]);
  return {
    hasPostings: Boolean(posting) || Boolean(billed),
    mapped: mappedAccountIds(resolvedMap(settings, chart)).has(accountId),
    bankLinked: Boolean(bank),
  };
}

export interface AccountInput {
  code?: string;
  nameAr?: string;
  nameEn?: string;
  type?: string;
  normalSide?: string;
  parentId?: string | null;
  postable?: boolean;
  active?: boolean;
  description?: string | null;
}

function asType(value: unknown, fallback?: AccountType): AccountType {
  if ((ACCOUNT_TYPES as readonly unknown[]).includes(value)) return value as AccountType;
  if (fallback) return fallback;
  throw ledgerError("LEDGER_ACCOUNT_TYPE_INVALID", "Choose a valid account type");
}

function asSide(value: unknown, fallback: NormalSide): NormalSide {
  return (NORMAL_SIDES as readonly unknown[]).includes(value) ? (value as NormalSide) : fallback;
}

export async function createAccount(input: AccountInput): Promise<{ id: string }> {
  const chart = await loadChart();
  const nodes = new Map(chart.map((account) => [account.id, toNode(account)]));
  const parent = input.parentId ? nodes.get(input.parentId) : undefined;
  const type = asType(input.type, parent?.type);
  const draft: AccountDraft = {
    code: (input.code ?? "").trim(),
    nameAr: (input.nameAr ?? "").trim(),
    nameEn: (input.nameEn ?? "").trim(),
    type,
    normalSide: asSide(input.normalSide, parent?.normalSide ?? defaultNormalSide(type)),
    parentId: input.parentId || null,
    postable: input.postable ?? true,
    active: true,
  };
  assertRule(validateAccountDraft(null, draft, nodes), 400);
  const created = await db.ledgerAccount.create({
    data: {
      organizationId: requireOrgId(),
      code: draft.code,
      nameAr: draft.nameAr,
      nameEn: draft.nameEn,
      type: draft.type,
      normalSide: draft.normalSide,
      parentId: draft.parentId,
      postable: draft.postable,
      active: true,
      description: input.description?.trim() || null,
    },
    select: { id: true },
  });
  void recordActivity({
    action: AuditAction.CREATE,
    recordType: "ledger_account",
    recordId: created.id,
    recordName: ledgerAccountName(draft),
    after: ledgerAccountSnapshot(
      { ...draft, description: input.description?.trim() || null },
      parent ? ledgerAccountName(parent) : null,
    ),
  });
  return created;
}

export async function updateAccount(id: string, input: AccountInput): Promise<void> {
  const chart = await loadChart();
  const nodes = new Map(chart.map((account) => [account.id, toNode(account)]));
  const current = nodes.get(id);
  if (!current) throw ledgerError("LEDGER_ACCOUNT_NOT_FOUND", "Account not found", 404);
  const usage = await usageOf(id, chart);
  const type = input.type === undefined ? current.type : asType(input.type);
  const draft: AccountDraft = {
    code: input.code === undefined ? current.code : input.code.trim(),
    nameAr: input.nameAr === undefined ? current.nameAr : input.nameAr.trim(),
    nameEn: input.nameEn === undefined ? current.nameEn : input.nameEn.trim(),
    type,
    normalSide: input.normalSide === undefined ? current.normalSide : asSide(input.normalSide, current.normalSide),
    parentId: input.parentId === undefined ? current.parentId : input.parentId || null,
    postable: input.postable === undefined ? current.postable : input.postable,
    active: input.active === undefined ? current.active : input.active,
  };
  assertRule(validateAccountDraft(current, draft, nodes, usage), 409);
  await db.ledgerAccount.update({
    where: { id },
    data: {
      code: draft.code,
      nameAr: draft.nameAr,
      nameEn: draft.nameEn,
      type: draft.type,
      normalSide: draft.normalSide,
      parentId: draft.parentId,
      postable: draft.postable,
      active: draft.active,
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    },
  });
  const parentName = (parentId: string | null) => {
    const parent = parentId ? nodes.get(parentId) : undefined;
    return parent ? ledgerAccountName(parent) : null;
  };
  // Switching an account on or off is the move a reader looks for, whatever
  // else the save carried.
  const switched = current.active !== draft.active;
  auditRecordChange({
    action: switched ? AuditAction.STATUS_CHANGED : AuditAction.UPDATE,
    recordType: "ledger_account",
    recordId: id,
    recordName: ledgerAccountName(draft),
    before: ledgerAccountSnapshot(current, parentName(current.parentId)),
    after: ledgerAccountSnapshot(draft, parentName(draft.parentId)),
    keys: LEDGER_ACCOUNT_KEYS,
    ...(switched
      ? {
          messageKey: draft.active
            ? "admin.audit.msg.record_activated"
            : "admin.audit.msg.record_deactivated",
        }
      : {}),
  });
}

export async function deleteAccount(id: string): Promise<void> {
  const chart = await loadChart();
  const nodes = new Map(chart.map((account) => [account.id, toNode(account)]));
  const current = nodes.get(id);
  if (!current) throw ledgerError("LEDGER_ACCOUNT_NOT_FOUND", "Account not found", 404);
  assertRule(canDeleteAccount(current, await usageOf(id, chart), nodes), 409);
  await db.ledgerAccount.delete({ where: { id } });
  const parent = current.parentId ? nodes.get(current.parentId) : undefined;
  void recordActivity({
    action: AuditAction.DELETE,
    recordType: "ledger_account",
    recordId: id,
    recordName: ledgerAccountName(current),
    before: ledgerAccountSnapshot(current, parent ? ledgerAccountName(parent) : null),
  });
}
