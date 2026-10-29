/**
 * PropertyPro - Which account does each posting job
 *
 * `AccountingSettings.accountMap` holds the office's choices (system key →
 * account id). A key the office never touched falls back to the account the
 * template created for it (the one carrying that system key). Pure.
 */

import {
  isSystemKey,
  SYSTEM_KEY_TYPES,
  SYSTEM_KEYS,
  type SystemKey,
} from "./system-keys";
import type { AccountType } from "./types";
import type { RuleResult } from "./coa-rules";

export type StoredAccountMap = Partial<Record<SystemKey, string>>;

/** The stored JSON, keeping only real keys pointing at an id. */
export function parseStoredAccountMap(value: unknown): StoredAccountMap {
  const map: StoredAccountMap = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return map;
  for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
    if (isSystemKey(key) && typeof id === "string" && id) map[key] = id;
  }
  return map;
}

export interface MappableAccount {
  id: string;
  systemKey: string | null;
  type: AccountType;
  postable: boolean;
  active: boolean;
}

/**
 * The account each key resolves to: the office's choice while that account
 * still exists, else the template's account for the key. Keys that reach
 * nothing are absent.
 */
export function resolveAccountMap(
  accounts: readonly MappableAccount[],
  stored: StoredAccountMap,
): Map<SystemKey, string> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const bySystemKey = new Map<string, MappableAccount>();
  for (const account of accounts) {
    if (account.systemKey) bySystemKey.set(account.systemKey, account);
  }

  const resolved = new Map<SystemKey, string>();
  for (const key of SYSTEM_KEYS) {
    const chosen = stored[key];
    if (chosen && byId.has(chosen)) {
      resolved.set(key, chosen);
      continue;
    }
    const own = bySystemKey.get(key);
    if (own) resolved.set(key, own.id);
  }
  return resolved;
}

export function missingSystemKeys(resolved: ReadonlyMap<SystemKey, string>): SystemKey[] {
  return SYSTEM_KEYS.filter((key) => !resolved.has(key));
}

/** Every account the map reaches — none of them may be deleted or switched off. */
export function mappedAccountIds(resolved: ReadonlyMap<SystemKey, string>): Set<string> {
  return new Set(resolved.values());
}

/** Whether a key may be pointed at an account. */
export function validateMappingTarget(
  key: SystemKey,
  account: MappableAccount | undefined,
): RuleResult {
  if (!account) {
    return { ok: false, code: "LEDGER_ACCOUNT_NOT_FOUND", message: "The account does not exist" };
  }
  if (!account.active) {
    return { ok: false, code: "LEDGER_ACCOUNT_INACTIVE", message: "Choose an active account" };
  }
  if (!account.postable) {
    return {
      ok: false,
      code: "LEDGER_ACCOUNT_NOT_POSTABLE",
      message: "Choose an account that takes postings, not a heading",
    };
  }
  if (!SYSTEM_KEY_TYPES[key].includes(account.type)) {
    return {
      ok: false,
      code: "LEDGER_MAP_TYPE",
      message: `This job needs an account of type ${SYSTEM_KEY_TYPES[key].join(" or ")}`,
    };
  }
  return { ok: true };
}
