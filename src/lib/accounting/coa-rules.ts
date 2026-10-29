/**
 * PropertyPro - What the office may do to its chart of accounts
 *
 * The chart is the office's to shape: add accounts, rename them, renumber
 * them, move them under another heading, switch them off. Four rules keep
 * the books readable while it does:
 *
 *  1. An account with postings is never deleted — only deactivated. Its
 *     history has to keep reading in the reports.
 *  2. An account a posting rule uses (it carries a system key, or the
 *     account map points a key at it) is never deleted, and is not
 *     deactivated while the map still reaches it. It can be renamed and
 *     moved like any other.
 *  3. Only sub-accounts take postings; headings group them. So an account
 *     sits under a heading of its own type, and a heading with postings
 *     cannot appear — a postable account with postings stays postable.
 *  4. The tree stays a tree: no account under itself or its own
 *     descendants, and no deeper than MAX_ACCOUNT_DEPTH levels.
 *
 * Pure: the service gathers the facts (postings, the map, bank links) and
 * asks.
 */

import { isSystemKey, SYSTEM_KEY_TYPES } from "./system-keys";
import {
  ACCOUNT_TYPES,
  NORMAL_SIDES,
  type AccountType,
  type NormalSide,
} from "./types";

/** The template uses four; two more leave room for an office's own detail. */
export const MAX_ACCOUNT_DEPTH = 6;

export interface AccountNode {
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
}

export interface AccountUsage {
  hasPostings: boolean;
  /** The account map reaches it, as a key's own account or by choice. */
  mapped: boolean;
  /** A bank or cash account is kept in it. */
  bankLinked: boolean;
}

export type RuleResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

const OK: RuleResult = { ok: true };

function refuse(code: string, message: string): RuleResult {
  return { ok: false, code, message };
}

const CODE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$/;

export function childrenOf(
  id: string,
  accounts: ReadonlyMap<string, AccountNode>,
): AccountNode[] {
  return [...accounts.values()].filter((account) => account.parentId === id);
}

/** 1 for a top-level account. Stops at a broken or cyclic chain. */
export function accountDepth(
  id: string,
  accounts: ReadonlyMap<string, AccountNode>,
): number {
  let depth = 0;
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = accounts.get(cursor);
    if (!node) break;
    depth += 1;
    cursor = node.parentId;
  }
  return depth;
}

/** How many levels an account and everything under it span (1 for a leaf). */
function subtreeHeight(
  id: string,
  accounts: ReadonlyMap<string, AccountNode>,
  seen: Set<string> = new Set(),
): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const children = childrenOf(id, accounts);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => subtreeHeight(child.id, accounts, seen)));
}

function isDescendant(
  candidateId: string,
  ancestorId: string,
  accounts: ReadonlyMap<string, AccountNode>,
): boolean {
  let cursor: string | null = candidateId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true;
    seen.add(cursor);
    cursor = accounts.get(cursor)?.parentId ?? null;
  }
  return false;
}

/** Whether the system key is one a posting rule uses (not a heading's). */
function isPostingKey(systemKey: string | null): boolean {
  return isSystemKey(systemKey);
}

export function canDeleteAccount(
  account: AccountNode,
  usage: AccountUsage,
  accounts: ReadonlyMap<string, AccountNode>,
): RuleResult {
  if (account.systemKey) {
    return refuse(
      "LEDGER_ACCOUNT_SYSTEM",
      "This account is used by the automatic postings. Rename or move it instead of deleting it.",
    );
  }
  if (usage.mapped) {
    return refuse(
      "LEDGER_ACCOUNT_MAPPED",
      "The account map points at this account. Choose another account in the setup first.",
    );
  }
  if (usage.hasPostings) {
    return refuse(
      "LEDGER_ACCOUNT_HAS_POSTINGS",
      "This account has postings and cannot be deleted. Deactivate it instead.",
    );
  }
  if (childrenOf(account.id, accounts).length > 0) {
    return refuse(
      "LEDGER_ACCOUNT_HAS_CHILDREN",
      "Move or delete the accounts under this heading first.",
    );
  }
  if (usage.bankLinked) {
    return refuse(
      "LEDGER_ACCOUNT_BANK_LINKED",
      "A bank or cash account is kept in this account.",
    );
  }
  return OK;
}

export function canDeactivateAccount(
  account: AccountNode,
  usage: AccountUsage,
  accounts: ReadonlyMap<string, AccountNode>,
): RuleResult {
  if (usage.mapped) {
    return refuse(
      "LEDGER_ACCOUNT_MAPPED",
      "The automatic postings use this account. Point its key at another account in the setup first.",
    );
  }
  if (usage.bankLinked) {
    return refuse(
      "LEDGER_ACCOUNT_BANK_LINKED",
      "Deactivate the bank or cash account kept in this account first.",
    );
  }
  if (childrenOf(account.id, accounts).some((child) => child.active)) {
    return refuse(
      "LEDGER_ACCOUNT_HAS_ACTIVE_CHILDREN",
      "Deactivate the accounts under this heading first.",
    );
  }
  return OK;
}

/** What an account would become — every field, after the change. */
export interface AccountDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  normalSide: NormalSide;
  parentId: string | null;
  postable: boolean;
  active: boolean;
}

/**
 * Check a new account (`current` null) or a change to one.
 *
 * `accounts` is the whole chart as it stands; `usage` is the current
 * account's (ignored for a new one).
 */
export function validateAccountDraft(
  current: AccountNode | null,
  draft: AccountDraft,
  accounts: ReadonlyMap<string, AccountNode>,
  usage: AccountUsage = { hasPostings: false, mapped: false, bankLinked: false },
): RuleResult {
  const code = draft.code.trim();
  if (!CODE_PATTERN.test(code)) {
    return refuse(
      "LEDGER_ACCOUNT_CODE_INVALID",
      "An account code is up to 20 letters, digits, dots or dashes",
    );
  }
  const taken = [...accounts.values()].some(
    (account) => account.code === code && account.id !== current?.id,
  );
  if (taken) {
    return refuse("LEDGER_ACCOUNT_CODE_TAKEN", `Code ${code} is already used by another account`);
  }
  if (!draft.nameAr.trim() || !draft.nameEn.trim()) {
    return refuse("LEDGER_ACCOUNT_NAME_REQUIRED", "Give the account an Arabic and an English name");
  }
  if (draft.nameAr.length > 120 || draft.nameEn.length > 120) {
    return refuse("LEDGER_ACCOUNT_NAME_TOO_LONG", "Account names are at most 120 characters");
  }
  if (!(ACCOUNT_TYPES as readonly string[]).includes(draft.type)) {
    return refuse("LEDGER_ACCOUNT_TYPE_INVALID", "Choose a valid account type");
  }
  if (!(NORMAL_SIDES as readonly string[]).includes(draft.normalSide)) {
    return refuse("LEDGER_ACCOUNT_SIDE_INVALID", "Choose debit or credit as the normal side");
  }

  // The type of an account that already carries history, structure or a
  // posting rule's job does not change.
  if (current && current.type !== draft.type) {
    if (usage.hasPostings || childrenOf(current.id, accounts).length > 0) {
      return refuse(
        "LEDGER_ACCOUNT_TYPE_LOCKED",
        "The type of an account with postings or sub-accounts cannot change",
      );
    }
  }
  if (current?.systemKey && isSystemKey(current.systemKey)) {
    const allowed = SYSTEM_KEY_TYPES[current.systemKey];
    if (!allowed.includes(draft.type)) {
      return refuse(
        "LEDGER_ACCOUNT_TYPE_LOCKED",
        "This account is used by the automatic postings and must keep its type",
      );
    }
  }

  if (draft.parentId) {
    const parent = accounts.get(draft.parentId);
    if (!parent) {
      return refuse("LEDGER_PARENT_NOT_FOUND", "The parent account does not exist");
    }
    if (current && (parent.id === current.id || isDescendant(parent.id, current.id, accounts))) {
      return refuse("LEDGER_PARENT_CYCLE", "An account cannot sit under itself or its own sub-accounts");
    }
    if (parent.postable) {
      return refuse(
        "LEDGER_PARENT_POSTABLE",
        "Accounts can only sit under a heading account, not under an account that takes postings",
      );
    }
    if (parent.type !== draft.type) {
      return refuse("LEDGER_PARENT_TYPE", "An account must sit under a heading of its own type");
    }
    if (draft.active && !parent.active) {
      return refuse("LEDGER_PARENT_INACTIVE", "The parent heading is inactive");
    }
    const height = current ? subtreeHeight(current.id, accounts) : 1;
    if (accountDepth(parent.id, accounts) + height > MAX_ACCOUNT_DEPTH) {
      return refuse(
        "LEDGER_TOO_DEEP",
        `The chart goes at most ${MAX_ACCOUNT_DEPTH} levels deep`,
      );
    }
  }

  if (current && current.postable && !draft.postable) {
    if (usage.hasPostings) {
      return refuse(
        "LEDGER_ACCOUNT_HAS_POSTINGS",
        "An account with postings cannot become a heading",
      );
    }
    if (isPostingKey(current.systemKey) || usage.mapped) {
      return refuse(
        "LEDGER_ACCOUNT_SYSTEM",
        "The automatic postings use this account, so it must keep taking postings",
      );
    }
    if (usage.bankLinked) {
      return refuse("LEDGER_ACCOUNT_BANK_LINKED", "A bank or cash account is kept in this account");
    }
  }
  if (current && !current.postable && draft.postable) {
    if (childrenOf(current.id, accounts).length > 0) {
      return refuse(
        "LEDGER_ACCOUNT_HAS_CHILDREN",
        "A heading with sub-accounts cannot take postings",
      );
    }
  }

  if (current && current.active && !draft.active) {
    const result = canDeactivateAccount(current, usage, accounts);
    if (!result.ok) return result;
  }

  return OK;
}
