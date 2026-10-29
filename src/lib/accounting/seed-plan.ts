/**
 * PropertyPro - Which template accounts an office still needs
 *
 * Setting up accounting is safe to run any number of times:
 *
 *  - An office with no accounts gets the whole template.
 *  - An office that already has a chart keeps it exactly as it shaped it —
 *    renamed, renumbered, moved — and only gains the accounts a posting rule
 *    needs and it does not have yet (a system key added to the template since
 *    it was set up). Those are matched by system key, never by code or name,
 *    so an office that renumbered "1101" is not given a second one.
 *
 * Each new account goes under the heading the template puts it under: found
 * by that heading's system key, else by its code, else under the office's
 * top-level heading of the same type. A code the office has already used is
 * stepped to the next free one.
 *
 * Pure, so "run it twice, get the template once" is pinned by a test.
 */

import { COA_TEMPLATE, type TemplateAccount } from "./coa-template";
import type { AccountType } from "./types";

export interface ExistingAccountRef {
  id: string;
  code: string;
  systemKey: string | null;
  parentId: string | null;
  type: AccountType;
  postable: boolean;
}

export type SeedParent =
  | { kind: "existing"; id: string }
  | { kind: "new"; code: string }
  | null;

export interface SeedPlanItem {
  template: TemplateAccount;
  /** The code it is created with — the template's, unless that is taken. */
  code: string;
  parent: SeedParent;
}

function nextFreeCode(code: string, taken: Set<string>): string {
  if (!taken.has(code)) return code;
  if (/^\d+$/.test(code)) {
    let candidate = Number(code);
    for (let attempt = 0; attempt < 1000; attempt++) {
      candidate += 1;
      const text = String(candidate).padStart(code.length, "0");
      if (!taken.has(text)) return text;
    }
  }
  for (let suffix = 1; ; suffix++) {
    const text = `${code}-${suffix}`;
    if (!taken.has(text)) return text;
  }
}

export function computeSeedPlan(
  existing: readonly ExistingAccountRef[],
  template: readonly TemplateAccount[] = COA_TEMPLATE,
): SeedPlanItem[] {
  const taken = new Set(existing.map((account) => account.code));

  if (existing.length === 0) {
    return template.map((account) => {
      taken.add(account.code);
      return {
        template: account,
        code: account.code,
        parent: account.parentCode ? { kind: "new", code: account.parentCode } : null,
      };
    });
  }

  const presentKeys = new Set(
    existing.map((account) => account.systemKey).filter(Boolean) as string[],
  );
  const missing = template.filter(
    (account) => account.systemKey && !presentKeys.has(account.systemKey),
  );
  if (missing.length === 0) return [];

  const templateByCode = new Map(template.map((account) => [account.code, account]));
  const bySystemKey = new Map(
    existing
      .filter((account) => account.systemKey)
      .map((account) => [account.systemKey as string, account]),
  );
  const byCode = new Map(existing.map((account) => [account.code, account]));
  const creating = new Map<string, SeedPlanItem>(); // template code → item

  const plan: SeedPlanItem[] = [];
  for (const account of missing) {
    const parent = resolveParent(account);
    const code = nextFreeCode(account.code, taken);
    taken.add(code);
    const item: SeedPlanItem = { template: account, code, parent };
    creating.set(account.code, item);
    plan.push(item);
  }
  return plan;

  function resolveParent(account: TemplateAccount): SeedParent {
    if (!account.parentCode) return null;
    const templateParent = templateByCode.get(account.parentCode);

    if (templateParent?.systemKey) {
      const keyed = bySystemKey.get(templateParent.systemKey);
      if (keyed && !keyed.postable && keyed.type === account.type) {
        return { kind: "existing", id: keyed.id };
      }
    }
    const coded = byCode.get(account.parentCode);
    if (coded && !coded.postable && coded.type === account.type) {
      return { kind: "existing", id: coded.id };
    }
    const planned = creating.get(account.parentCode);
    if (planned) return { kind: "new", code: planned.code };

    const root = existing.find(
      (candidate) =>
        candidate.parentId === null && !candidate.postable && candidate.type === account.type,
    );
    return root ? { kind: "existing", id: root.id } : null;
  }
}
