/**
 * The chart of accounts: the template, what the office may change, and
 * setting up twice.
 *
 * The template must be a well-formed four-level tree holding an account for
 * every key a posting rule uses. An account with postings is never deleted,
 * only deactivated; an account a rule uses can be renamed and moved but not
 * deleted; and running the setup again adds nothing an office already has.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { COA_TEMPLATE } from "./coa-template";
import {
  canDeleteAccount,
  canDeactivateAccount,
  validateAccountDraft,
  type AccountDraft,
  type AccountNode,
  type AccountUsage,
} from "./coa-rules";
import { computeSeedPlan, type ExistingAccountRef } from "./seed-plan";
import {
  missingSystemKeys,
  parseStoredAccountMap,
  resolveAccountMap,
  validateMappingTarget,
} from "./account-map";
import { GROUP_KEYS, SYSTEM_KEYS, SYSTEM_KEY_TYPES } from "./system-keys";

/** The template as an office's chart, ids = codes. */
function templateChart(): Map<string, AccountNode> {
  return new Map(
    COA_TEMPLATE.map((account) => [
      account.code,
      {
        id: account.code,
        code: account.code,
        nameAr: account.nameAr,
        nameEn: account.nameEn,
        type: account.type,
        normalSide: account.normalSide,
        parentId: account.parentCode,
        postable: account.postable,
        systemKey: account.systemKey ?? null,
        active: true,
      },
    ]),
  );
}

const UNUSED: AccountUsage = { hasPostings: false, mapped: false, bankLinked: false };

function draftOf(node: AccountNode, patch: Partial<AccountDraft> = {}): AccountDraft {
  return {
    code: node.code,
    nameAr: node.nameAr,
    nameEn: node.nameEn,
    type: node.type,
    normalSide: node.normalSide,
    parentId: node.parentId,
    postable: node.postable,
    active: node.active,
    ...patch,
  };
}

describe("the Saudi template", () => {
  test("codes are unique and every parent exists", () => {
    const codes = new Set<string>();
    for (const account of COA_TEMPLATE) {
      assert.equal(codes.has(account.code), false, `duplicate ${account.code}`);
      codes.add(account.code);
    }
    for (const account of COA_TEMPLATE) {
      if (account.parentCode) assert.ok(codes.has(account.parentCode), `${account.code} has no parent`);
    }
  });

  test("four levels: class, group, account, sub-account — and only sub-accounts post", () => {
    const chart = templateChart();
    for (const account of COA_TEMPLATE) {
      let depth = 1;
      let parent = account.parentCode;
      while (parent) {
        depth += 1;
        parent = chart.get(parent)!.parentId;
      }
      assert.ok(depth >= 1 && depth <= 4, `${account.code} is at depth ${depth}`);
      assert.equal(account.postable, depth === 4, `${account.code} postable at depth ${depth}`);
      assert.equal(account.code.length, [1, 2, 4, 6][depth - 1], `${account.code} code length`);
    }
  });

  test("a child is the type of its parent and starts with its code", () => {
    const byCode = new Map(COA_TEMPLATE.map((account) => [account.code, account]));
    for (const account of COA_TEMPLATE) {
      if (!account.parentCode) continue;
      const parent = byCode.get(account.parentCode)!;
      assert.equal(account.type, parent.type, account.code);
      assert.ok(account.code.startsWith(parent.code), account.code);
    }
  });

  test("every posting key has exactly one account of an allowed type", () => {
    for (const key of SYSTEM_KEYS) {
      const holders = COA_TEMPLATE.filter((account) => account.systemKey === key);
      assert.equal(holders.length, 1, `${key} has ${holders.length} accounts`);
      assert.ok(holders[0].postable, `${key} must post`);
      assert.ok(SYSTEM_KEY_TYPES[key].includes(holders[0].type), `${key} type`);
    }
    for (const key of GROUP_KEYS) {
      const holders = COA_TEMPLATE.filter((account) => account.systemKey === key);
      assert.equal(holders.length, 1, key);
      assert.equal(holders[0].postable, false, `${key} is a heading`);
    }
  });

  test("every account has an Arabic and an English name", () => {
    for (const account of COA_TEMPLATE) {
      assert.ok(/[؀-ۿ]/.test(account.nameAr), `${account.code} Arabic`);
      assert.ok(/[A-Za-z]/.test(account.nameEn), `${account.code} English`);
    }
  });
});

describe("deleting an account", () => {
  const chart = templateChart();

  test("a system account cannot be deleted", () => {
    const result = canDeleteAccount(chart.get("110102")!, UNUSED, chart);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, "LEDGER_ACCOUNT_SYSTEM");
  });

  test("an account with postings cannot be deleted, only deactivated", () => {
    const furniture = chart.get("120101")!;
    const used: AccountUsage = { ...UNUSED, hasPostings: true };
    const deleted = canDeleteAccount(furniture, used, chart);
    assert.equal(!deleted.ok && deleted.code, "LEDGER_ACCOUNT_HAS_POSTINGS");
    assert.equal(canDeactivateAccount(furniture, used, chart).ok, true);
  });

  test("a heading with accounts under it cannot be deleted", () => {
    const result = canDeleteAccount(chart.get("1104")!, UNUSED, chart);
    assert.equal(!result.ok && result.code, "LEDGER_ACCOUNT_HAS_CHILDREN");
  });

  test("an unused ordinary account can be deleted", () => {
    assert.equal(canDeleteAccount(chart.get("120101")!, UNUSED, chart).ok, true);
  });

  test("an account the map points at cannot be deleted or deactivated", () => {
    const mapped: AccountUsage = { ...UNUSED, mapped: true };
    assert.equal(canDeleteAccount(chart.get("120101")!, mapped, chart).ok, false);
    assert.equal(canDeactivateAccount(chart.get("120101")!, mapped, chart).ok, false);
  });
});

describe("changing an account", () => {
  const chart = templateChart();

  test("a system account can be renamed and moved under another heading of its type", () => {
    const bank = chart.get("110102")!;
    const renamed = validateAccountDraft(
      bank,
      draftOf(bank, { nameAr: "مصرف الراجحي", nameEn: "Al Rajhi Bank", parentId: "1102", code: "110299" }),
      chart,
      { ...UNUSED, mapped: true, hasPostings: true },
    );
    assert.deepEqual(renamed, { ok: true });
  });

  test("an account cannot move under an account that takes postings", () => {
    const furniture = chart.get("120101")!;
    const result = validateAccountDraft(furniture, draftOf(furniture, { parentId: "120102" }), chart);
    assert.equal(!result.ok && result.code, "LEDGER_PARENT_POSTABLE");
  });

  test("an account cannot move under a heading of another type", () => {
    const furniture = chart.get("120101")!;
    const result = validateAccountDraft(furniture, draftOf(furniture, { parentId: "2101" }), chart);
    assert.equal(!result.ok && result.code, "LEDGER_PARENT_TYPE");
  });

  test("a heading cannot move under its own sub-heading", () => {
    const group = chart.get("11")!;
    const result = validateAccountDraft(group, draftOf(group, { parentId: "1101" }), chart);
    assert.equal(!result.ok && result.code, "LEDGER_PARENT_CYCLE");
  });

  test("codes stay unique", () => {
    const furniture = chart.get("120101")!;
    const result = validateAccountDraft(furniture, draftOf(furniture, { code: "120102" }), chart);
    assert.equal(!result.ok && result.code, "LEDGER_ACCOUNT_CODE_TAKEN");
  });

  test("a posting account with postings cannot become a heading", () => {
    const furniture = chart.get("120101")!;
    const result = validateAccountDraft(
      furniture,
      draftOf(furniture, { postable: false }),
      chart,
      { ...UNUSED, hasPostings: true },
    );
    assert.equal(!result.ok && result.code, "LEDGER_ACCOUNT_HAS_POSTINGS");
  });

  test("a system account keeps taking postings and keeps its type", () => {
    const bank = chart.get("110102")!;
    const heading = validateAccountDraft(bank, draftOf(bank, { postable: false }), chart);
    assert.equal(!heading.ok && heading.code, "LEDGER_ACCOUNT_SYSTEM");
    const retyped = validateAccountDraft(
      bank,
      draftOf(bank, { type: "expense", parentId: "5202" }),
      chart,
    );
    assert.equal(retyped.ok, false);
  });

  test("a new account goes under a heading of its type", () => {
    const ok = validateAccountDraft(
      null,
      {
        code: "110105",
        nameAr: "بنك الإنماء",
        nameEn: "Alinma Bank",
        type: "asset",
        normalSide: "debit",
        parentId: "1101",
        postable: true,
        active: true,
      },
      chart,
    );
    assert.deepEqual(ok, { ok: true });
  });

  test("names are required in both languages", () => {
    const furniture = chart.get("120101")!;
    const result = validateAccountDraft(furniture, draftOf(furniture, { nameEn: " " }), chart);
    assert.equal(!result.ok && result.code, "LEDGER_ACCOUNT_NAME_REQUIRED");
  });
});

describe("setting up accounting", () => {
  /** Apply a plan the way the service does: ids = final codes. */
  function apply(
    existing: ExistingAccountRef[],
    plan: ReturnType<typeof computeSeedPlan>,
  ): ExistingAccountRef[] {
    const out = [...existing];
    for (const item of plan) {
      const parentId =
        item.parent === null
          ? null
          : item.parent.kind === "existing"
            ? item.parent.id
            : item.parent.code;
      out.push({
        id: item.code,
        code: item.code,
        systemKey: item.template.systemKey ?? null,
        parentId,
        type: item.template.type,
        postable: item.template.postable,
      });
    }
    return out;
  }

  test("an office with no accounts gets the whole template", () => {
    const plan = computeSeedPlan([]);
    assert.equal(plan.length, COA_TEMPLATE.length);
  });

  test("running it again adds nothing", () => {
    const first = apply([], computeSeedPlan([]));
    assert.deepEqual(computeSeedPlan(first), []);
  });

  test("an office's own changes survive and only a missing system account is added", () => {
    const seeded = apply([], computeSeedPlan([]));
    // The office renumbered the bank, and lost the POS clearing account.
    const shaped = seeded
      .map((account) => (account.code === "110102" ? { ...account, code: "11010201" } : account))
      .filter((account) => account.systemKey !== "pos_clearing");
    const plan = computeSeedPlan(shaped);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].template.systemKey, "pos_clearing");
    assert.deepEqual(plan[0].parent, { kind: "existing", id: "1101" });
    assert.deepEqual(computeSeedPlan(apply(shaped, plan)), []);
  });

  test("a code the office has used for something else is stepped to the next free one", () => {
    const seeded = apply([], computeSeedPlan([]))
      .filter((account) => account.systemKey !== "pos_clearing")
      .map((account) =>
        account.code === "110104" ? account : account,
      );
    // Someone else took 110103 for their own account.
    seeded.push({ id: "own", code: "110103", systemKey: null, parentId: "1101", type: "asset", postable: true });
    const plan = computeSeedPlan(seeded);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].code, "110105");
  });
});

describe("the account map", () => {
  const accounts = COA_TEMPLATE.map((account) => ({
    id: account.code,
    systemKey: account.systemKey ?? null,
    type: account.type,
    postable: account.postable,
    active: true,
  }));

  test("every key resolves to the template's account until the office chooses", () => {
    const resolved = resolveAccountMap(accounts, {});
    assert.deepEqual(missingSystemKeys(resolved), []);
    assert.equal(resolved.get("bank"), "110102");
  });

  test("the office's choice wins while that account exists", () => {
    const withMine = [...accounts, { id: "mine", systemKey: null, type: "asset" as const, postable: true, active: true }];
    assert.equal(resolveAccountMap(withMine, { bank: "mine" }).get("bank"), "mine");
    assert.equal(resolveAccountMap(accounts, { bank: "gone" }).get("bank"), "110102");
  });

  test("a key only takes an active posting account of its kind", () => {
    const income = accounts.find((account) => account.id === "410101")!;
    assert.equal(validateMappingTarget("bank", income).ok, false);
    const heading = accounts.find((account) => account.id === "1101")!;
    assert.equal(validateMappingTarget("bank", heading).ok, false);
    const otherBank = accounts.find((account) => account.id === "110203")!;
    assert.equal(validateMappingTarget("bank", otherBank).ok, true);
  });

  test("stored junk is ignored", () => {
    assert.deepEqual(parseStoredAccountMap({ bank: "x", nope: "y", cash_on_hand: 5 }), { bank: "x" });
    assert.deepEqual(parseStoredAccountMap(null), {});
  });
});
