/**
 * The module tree a package is built from, and what it opens.
 *
 * One config (lib/navigation/menu-config.ts) drives the sidebar, the ⌘K
 * palette, the page guard, the API gate and the Super Admin's package form,
 * so these hold it to what each of them relies on: every entry has a key and
 * a label in every language, every old flat key still opens what it opened
 * (no office loses a screen on deploy), a section switched off takes its
 * items with it, the mobile app's /api/v1 paths are gated like the web's, and
 * each report with its own menu entry is its own module.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_MODULE_KEYS,
  ALWAYS_ON_MODULE_KEYS,
  LEGACY_FEATURE_KEYS,
  MODULE_FORMAT_MARKER,
  TOGGLEABLE_LEAF_KEYS,
  allModuleChecks,
  allModulesState,
  apiModuleCandidates,
  effectiveModuleLeaves,
  toggleModuleCheck,
  decideModuleAccess,
  encodeModuleSelection,
  enabledToggleableLeaves,
  isLegacyFeatureList,
  isModuleOn,
  moduleCandidatesForKey,
  moduleDescendants,
  moduleEntry,
  normalizeApiPath,
  normalizeStoredModules,
  pageModuleCandidates,
  pageNeedsQuery,
  resolveModuleState,
  satisfiedLegacyKeys,
  toggleableLeavesUnder,
  withModulesAddedLater,
  type ModuleState,
} from "@/lib/billing/modules";
import {
  LEGACY_PLAN_FEATURES,
  PLAN_FEATURE_KEYS,
  isPlanFeatureKey,
} from "@/lib/billing/plan-constants";
import {
  CAPABILITY_NODES,
  NAV_SECTIONS,
  type MenuNode,
} from "@/lib/navigation/menu-config";
import { canAccessNavItem, createAccessProfile } from "@/lib/role-utils";

const keysOf = (nodes: readonly MenuNode[] | null) =>
  (nodes ?? []).map((node) => node.key).sort();

const allNodes = (): MenuNode[] => {
  const out: MenuNode[] = [];
  const walk = (node: MenuNode) => {
    out.push(node);
    node.children?.forEach(walk);
  };
  NAV_SECTIONS.forEach((section) => section.items.forEach(walk));
  CAPABILITY_NODES.forEach(walk);
  return out;
};

const leaves = () =>
  allNodes().filter((node) => !node.children || node.children.length === 0);

function readCatalog(locale: string): Record<string, string> {
  const dir = join(process.cwd(), "src", "locales", locale);
  return Object.assign(
    {},
    ...["common.json", "platform.json", "marketing.json"].map((file) =>
      JSON.parse(readFileSync(join(dir, file), "utf8")),
    ),
  );
}

/** The API routes the app serves, as URL paths ("[id]" as "x"). */
function apiRoutes(): string[] {
  const appDir = join(process.cwd(), "src", "app");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") {
        out.push(
          full
            .replace(appDir, "")
            .replace(/\/route\.ts$/, "")
            .replace(/\/\([^)]+\)/g, "")
            .replace(/\[\.\.\.[^\]]+\]/g, "x")
            .replace(/\[[^\]]+\]/g, "x"),
        );
      }
    }
  };
  walk(join(appDir, "api"));
  return out.sort();
}

/** The old gate: the flat catalog's prefixes, longest match, query ignored. */
function legacyResolve(
  path: string,
  pick: "apiPrefixes" | "appPrefixes",
): string | null {
  const bare = path.split(/[?#]/, 1)[0];
  let match: { key: string; length: number } | null = null;
  for (const feature of LEGACY_PLAN_FEATURES) {
    for (const prefix of feature[pick]) {
      if (!bare.startsWith(prefix)) continue;
      const rest = bare.slice(prefix.length);
      if (rest !== "" && !rest.startsWith("/")) continue;
      if (!match || prefix.length > match.length) {
        match = { key: feature.key, length: prefix.length };
      }
    }
  }
  return match?.key ?? null;
}

const staff = createAccessProfile("admin", []);
const tenant = createAccessProfile("tenant", []);
const owner = createAccessProfile("owner", []);

function decidePage(
  href: string,
  state: ModuleState,
  profile = staff,
) {
  return decideModuleAccess(
    pageModuleCandidates(href),
    (key) => state.enabled.has(key),
    {
      applies: (node) => canAccessNavItem(profile, node),
      isPlatformOff: (key) => state.platformOff.has(key),
    },
  );
}

function decideApi(
  path: string,
  state: ModuleState,
  profile = staff,
) {
  return decideModuleAccess(
    apiModuleCandidates(path),
    (key) => state.enabled.has(key),
    {
      applies: (node) => canAccessNavItem(profile, node),
      isPlatformOff: (key) => state.platformOff.has(key),
    },
  );
}

// The four tiers the default seeds were designed with (lib/billing/plans.ts).
const LEGACY_TIERS: Record<string, string[]> = {
  free: ["properties", "tenants", "leases", "maintenance", "messaging"],
  starter: [
    "properties", "tenants", "leases", "applications", "maintenance",
    "tickets", "accounting", "payments", "messaging", "announcements",
    "data_export",
  ],
  professional: [
    "properties", "tenants", "leases", "applications", "agreements",
    "owner_portal", "maintenance", "inspections", "tickets", "calendar",
    "accounting", "payments", "security_deposits", "messaging",
    "announcements", "data_export", "advanced_analytics", "bulk_import",
  ],
  business: LEGACY_PLAN_FEATURES.map((feature) => feature.key),
};

describe("the menu config and the module catalog agree", () => {
  test("every section and item has a unique module key with a dot", () => {
    const keys = allNodes().map((node) => node.key);
    const sectionKeys = NAV_SECTIONS.flatMap((section) =>
      section.key ? [section.key] : [],
    );
    for (const key of [...keys, ...sectionKeys]) {
      assert.ok(key.includes("."), `${key} must contain a dot`);
    }
    assert.equal(new Set(keys).size, keys.length, "item keys are unique");
    for (const key of sectionKeys) {
      assert.ok(key.startsWith("section."), key);
    }
    for (const key of keys) {
      assert.ok(!key.startsWith("section."), key);
    }
    assert.equal(ALL_MODULE_KEYS.length, keys.length + sectionKeys.length);
  });

  test("every titled section has a key, every untitled one holds standalone entries", () => {
    for (const section of NAV_SECTIONS) {
      if (section.title) assert.ok(section.key, section.title);
      assert.ok(section.items.length > 0);
    }
  });

  test("every module has a label in every locale", () => {
    for (const locale of ["en", "ar"]) {
      const catalog = readCatalog(locale);
      for (const key of ALL_MODULE_KEYS) {
        const title = moduleEntry(key)!.title;
        assert.ok(
          typeof catalog[title] === "string" && catalog[title].length > 0,
          `${locale}: ${title} (${key})`,
        );
      }
    }
  });

  test("every menu entry leads to a dashboard page that resolves to itself", () => {
    for (const node of leaves()) {
      if (node.hidden && !node.href) continue;
      assert.ok(node.href.startsWith("/dashboard"), `${node.key}: ${node.href}`);
      assert.ok(
        keysOf(pageModuleCandidates(node.href)).includes(node.key),
        `${node.href} should resolve to ${node.key}, got ${keysOf(pageModuleCandidates(node.href)).join(",")}`,
      );
    }
  });

  test("prefixes are API and page paths", () => {
    for (const node of allNodes()) {
      for (const prefix of node.apis ?? []) {
        assert.ok(prefix.startsWith("/api/"), `${node.key}: ${prefix}`);
      }
      for (const page of node.pages ?? []) {
        assert.ok(page.startsWith("/dashboard"), `${node.key}: ${page}`);
      }
    }
  });

  test("old keys named in the tree are the old catalog's, and every one is still answered", () => {
    const catalog = new Set(LEGACY_PLAN_FEATURES.map((feature) => feature.key));
    for (const node of allNodes()) {
      for (const legacy of node.legacy ?? []) {
        assert.ok(legacy === "*" || catalog.has(legacy), `${node.key}: ${legacy}`);
      }
    }
    assert.deepEqual([...LEGACY_FEATURE_KEYS].sort(), [...catalog].sort());
  });

  test("the package form's keys pass the plan validation", () => {
    for (const key of ALL_MODULE_KEYS) {
      assert.ok(PLAN_FEATURE_KEYS.includes(key), key);
      assert.ok(isPlanFeatureKey(key), key);
    }
    for (const key of normalizeStoredModules(LEGACY_TIERS.business)) {
      assert.ok(isPlanFeatureKey(key), key);
    }
  });

  test("the owner's always-on list is always on, and nothing else is", () => {
    assert.deepEqual([...ALWAYS_ON_MODULE_KEYS].sort(), [
      "administration.users",
      "communication.notifications",
      "employees.list",
      "home.dashboard",
      "settings.billing",
      "settings.display",
      "settings.profile",
      "settings.security",
    ]);
    assert.ok(ALWAYS_ON_MODULE_KEYS.includes(MODULE_FORMAT_MARKER));
  });

  test("the final review's menu: Payments and Payment report under Collections, an Accounting section", () => {
    const collections = NAV_SECTIONS.find((s) => s.key === "section.collections")!;
    const byKey = new Map(collections.items.map((item) => [item.key, item]));
    assert.equal(byKey.get("collections.payments")?.href, "/dashboard/payments");
    assert.equal(byKey.get("collections.payments")?.title, "nav.collections.payments");
    assert.equal(
      byKey.get("collections.payment_report")?.href,
      "/dashboard/payments/reports?type=collections",
    );
    // No entry is called what its section is called.
    for (const item of collections.items) {
      assert.notEqual(item.title, "nav.payments.collection");
    }
    const en = readCatalog("en");
    const ar = readCatalog("ar");
    for (const item of collections.items) {
      assert.notEqual(ar[item.title], ar[collections.title!], item.key);
      assert.notEqual(en[item.title], en[collections.title!], item.key);
    }

    const accounting = NAV_SECTIONS.find((s) => s.key === "section.accounting")!;
    assert.equal(ar[accounting.title!], "المحاسبة");
    assert.deepEqual(
      accounting.items.map((item) => item.href),
      [
        "/dashboard/accounting/invoices",
        "/dashboard/accounting/expenses",
        "/dashboard/accounting/revenues",
        "/dashboard/accounting/transactions",
        "/dashboard/accounting/reports",
        // Accounting phase 0: the receipt vouchers and the VAT summary.
        "/dashboard/payments/reports?type=collections&view=receipts",
        "/dashboard/accounting/vat-summary",
        // The double-entry books.
        "/dashboard/accounting/journals",
        "/dashboard/accounting/chart-of-accounts",
        "/dashboard/accounting/banks",
        // Ticking a bank account's lines off against its statement.
        "/dashboard/accounting/banks/reconcile",
        "/dashboard/accounting/payouts",
        // Purchases and payments, a group of its own; and the two registers.
        "/dashboard/accounting/purchases/suppliers",
        "/dashboard/accounting/registers/sales",
        // The ledger's reports, a group of its own.
        "/dashboard/accounting/ledger-reports/account-statement",
        "/dashboard/accounting/setup",
      ],
    );
  });
});

describe("what a package list opens", () => {
  test("a section key alone opens the whole section, items added later included", () => {
    const state = resolveModuleState(["section.collections"]);
    for (const leaf of toggleableLeavesUnder("section.collections")) {
      assert.ok(state.enabled.has(leaf), leaf);
    }
    // The Payment report is new in this release: a package holding the whole
    // section has it without anyone ticking it.
    assert.ok(state.enabled.has("collections.payment_report"));
    assert.ok(!state.enabled.has("leasing.contracts"));
  });

  test("a section with some of its items listed opens only those", () => {
    const state = resolveModuleState(["section.collections", "collections.due"]);
    assert.deepEqual(
      enabledToggleableLeaves(state.enabled).filter((key) =>
        key.startsWith("collections."),
      ),
      ["collections.due"],
    );
  });

  test("an item listed alone switches its section and group on", () => {
    const state = resolveModuleState(["leasing.reports.renewed"]);
    assert.ok(state.enabled.has("leasing.reports.renewed"));
    assert.ok(state.enabled.has("leasing.reports"));
    assert.ok(state.enabled.has("section.leasing"));
    assert.ok(!state.enabled.has("leasing.reports.expired"));
  });

  test("a group listed alone opens everything under it", () => {
    const state = resolveModuleState(["properties.compounds"]);
    assert.ok(state.enabled.has("properties.compounds.list"));
    assert.ok(state.enabled.has("properties.compounds.new"));
    assert.ok(!state.enabled.has("properties.units"));
  });

  test("always-on modules are on in an empty package", () => {
    const state = resolveModuleState([MODULE_FORMAT_MARKER]);
    for (const key of ALWAYS_ON_MODULE_KEYS) assert.ok(state.enabled.has(key), key);
    assert.deepEqual(enabledToggleableLeaves(state.enabled), []);
  });

  test("the platform switch turns a module off in every package, with what is under it", () => {
    const business = normalizeStoredModules(LEGACY_TIERS.business);
    const state = resolveModuleState(business, ["section.maintenance", "accounting.reports"]);
    for (const leaf of toggleableLeavesUnder("section.maintenance")) {
      assert.ok(!state.enabled.has(leaf), leaf);
      assert.ok(state.platformOff.has(leaf), leaf);
    }
    assert.ok(!state.enabled.has("accounting.reports"));
    assert.ok(state.enabled.has("accounting.invoices"));
    // The package still says it includes them.
    assert.ok(state.planEnabled.has("maintenance.requests"));
  });

  test("always-on modules ignore the platform switch", () => {
    const state = resolveModuleState(
      normalizeStoredModules(LEGACY_TIERS.business),
      ["section.employees", "communication.inbox", "administration.settings"],
    );
    assert.ok(state.enabled.has("employees.list"));
    assert.ok(state.enabled.has("communication.notifications"));
    assert.ok(state.enabled.has("settings.billing"));
    assert.ok(!state.enabled.has("employees.groups"));
    assert.ok(!state.enabled.has("communication.messages"));
    assert.ok(!state.enabled.has("settings.email"));
  });

  test("no package resolves: everything on but the platform switches", () => {
    const state = allModulesState(["section.inspections"]);
    assert.ok(state.enabled.has("leasing.contracts"));
    assert.ok(!state.enabled.has("inspections.list"));
  });
});

describe("the shortest stored list", () => {
  test("whole sections are stored as the section, the rest item by item", () => {
    const encoded = encodeModuleSelection([
      ...toggleableLeavesUnder("section.maintenance"),
      "collections.due",
    ]);
    // In menu order: Collections comes before Maintenance.
    assert.deepEqual(encoded, ["collections.due", "section.maintenance"]);
  });

  test("everything is one key per section, and nothing is the marker", () => {
    const all = encodeModuleSelection(TOGGLEABLE_LEAF_KEYS);
    for (const section of NAV_SECTIONS) {
      if (section.key) assert.ok(all.includes(section.key), section.key);
    }
    assert.deepEqual(encodeModuleSelection([]), [MODULE_FORMAT_MARKER]);
  });

  test("encoding and reading back give the same items, for any selection", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 300; round += 1) {
      const density = random();
      const chosen = TOGGLEABLE_LEAF_KEYS.filter(() => random() < density);
      const encoded = encodeModuleSelection(chosen);
      assert.deepEqual(
        enabledToggleableLeaves(resolveModuleState(encoded).planEnabled),
        [...chosen],
        `round ${round}`,
      );
      // And it is a fixed point.
      assert.deepEqual(normalizeStoredModules(encoded), encoded);
    }
  });
});

describe("old flat keys keep every screen they opened", () => {
  test("a list with no dotted key is the old format", () => {
    assert.ok(isLegacyFeatureList(["maintenance", "payments"]));
    assert.ok(isLegacyFeatureList([]));
    assert.ok(!isLegacyFeatureList(["section.leasing"]));
  });

  test("an old key implies its modules, and the never-gated screens come along", () => {
    const state = resolveModuleState(["maintenance"]);
    for (const leaf of toggleableLeavesUnder("section.maintenance")) {
      assert.ok(state.enabled.has(leaf), leaf);
    }
    assert.ok(state.enabled.has("archive.records"));
    assert.ok(state.enabled.has("settings.payment"));
    assert.ok(!state.enabled.has("collections.payments"));
    assert.ok(!state.enabled.has("leasing.contracts"));
  });

  test("an old key is on while any module it covered is", () => {
    const state = resolveModuleState(["accounting.reports"]);
    assert.ok(isModuleOn(state, "advanced_analytics"));
    assert.ok(!isModuleOn(state, "maintenance"));
    assert.ok(satisfiedLegacyKeys(state).includes("advanced_analytics"));
    assert.ok(isModuleOn(resolveModuleState(["capability.data_export"]), "data_export"));
  });

  const featureSets: Array<[string, string[]]> = [
    ...Object.entries(LEGACY_TIERS),
    ["empty", []],
    ...LEGACY_PLAN_FEATURES.map((feature): [string, string[]] => [
      `only ${feature.key}`,
      [feature.key],
    ]),
  ];

  // Built after the module tree, never in an old package: nothing to keep.
  const NEW_SINCE_THE_TREE = [/^\/dashboard\/marketing(\/|$)/, /^\/api\/marketing(\/|$)/];

  test("every menu entry an old package showed is still on, before and after the backfill", () => {
    for (const [name, features] of featureSets) {
      const read = resolveModuleState(features);
      const backfilled = resolveModuleState(normalizeStoredModules(features));
      for (const node of leaves()) {
        if (!node.href || node.alwaysOn) continue;
        if (NEW_SINCE_THE_TREE.some((pattern) => pattern.test(node.href))) continue;
        const oldKey = legacyResolve(node.href, "appPrefixes");
        const shownBefore = !oldKey || features.includes(oldKey);
        if (!shownBefore) continue;
        assert.ok(read.enabled.has(node.key), `${name}: ${node.key} (${node.href})`);
        assert.ok(backfilled.enabled.has(node.key), `${name} backfilled: ${node.key}`);
      }
    }
  });

  // Deliberate changes, owner's decision: the tenant portal follows the same
  // keys as the office (maintenance off = tenant maintenance off). The three
  // statistics endpoints moved from analytics to their own module; each only
  // feeds a screen of that module, which an old package without it could not
  // open either.
  const DELIBERATELY_GATED = [
    /^\/api\/tenant\//,
    /^\/api\/invoices\/stats$/,
    /^\/api\/leases\/stats$/,
    /^\/api\/tenants\/statistics$/,
  ];

  test("every API an old package could call is still answered", () => {
    const routes = apiRoutes().filter(
      (route) =>
        ![...DELIBERATELY_GATED, ...NEW_SINCE_THE_TREE].some((pattern) =>
          pattern.test(route),
        ),
    );
    for (const [name, features] of featureSets) {
      const state = resolveModuleState(normalizeStoredModules(features));
      for (const route of routes) {
        const oldKey = legacyResolve(route, "apiPrefixes");
        if (oldKey && !features.includes(oldKey)) continue;
        assert.ok(decideApi(route, state).allowed, `${name}: ${route}`);
      }
    }
  });

  test("the backfill never changes what a package opens", () => {
    for (const [name, features] of featureSets) {
      assert.deepEqual(
        enabledToggleableLeaves(
          resolveModuleState(normalizeStoredModules(features)).planEnabled,
        ),
        enabledToggleableLeaves(resolveModuleState(features).planEnabled),
        name,
      );
    }
  });
});

describe("the page guard", () => {
  const withoutMaintenanceAndAccounting = resolveModuleState(
    encodeModuleSelection(
      TOGGLEABLE_LEAF_KEYS.filter(
        (key) => !key.startsWith("maintenance.") && !key.startsWith("accounting."),
      ),
    ),
  );

  test("a module left out shows the card, named after its module", () => {
    const decision = decidePage("/dashboard/maintenance", withoutMaintenanceAndAccounting);
    assert.equal(decision.allowed, false);
    // The whole section is off, so the card names the section.
    assert.equal(decision.blockedKey, "section.maintenance");
    assert.equal(decision.platformOff, false);
    assert.equal(
      decidePage("/dashboard/maintenance/abc123/edit", withoutMaintenanceAndAccounting).allowed,
      false,
    );
    assert.equal(
      decidePage("/dashboard/accounting/invoices/new", withoutMaintenanceAndAccounting).allowed,
      false,
    );
    assert.equal(
      decidePage("/dashboard/leases", withoutMaintenanceAndAccounting).allowed,
      true,
    );
  });

  test("a platform switch says so", () => {
    const state = resolveModuleState(["section.inspections"], ["section.inspections"]);
    const decision = decidePage("/dashboard/inspections", state);
    assert.equal(decision.allowed, false);
    assert.equal(decision.platformOff, true);
  });

  test("always-on and unowned pages open in an empty package", () => {
    const empty = resolveModuleState([MODULE_FORMAT_MARKER]);
    for (const href of [
      "/dashboard",
      "/dashboard/notifications/abc",
      "/dashboard/settings",
      "/dashboard/settings/profile",
      "/dashboard/settings/security",
      "/dashboard/settings/appearance",
      "/dashboard/settings/billing",
      "/dashboard/admin/users",
      "/dashboard/admin/users/abc/edit",
      "/dashboard/updates",
      "/dashboard/no-such-page",
    ]) {
      assert.equal(decidePage(href, empty).allowed, true, href);
    }
    assert.equal(decidePage("/dashboard/settings/messaging", empty).allowed, false);
    assert.equal(decidePage("/dashboard/archive", empty).allowed, false);
  });

  test("a report link is its own module, the page's default when the link names none", () => {
    assert.deepEqual(
      keysOf(pageModuleCandidates("/dashboard/payments/reports?type=collections")),
      ["collections.payment_report"],
    );
    assert.deepEqual(keysOf(pageModuleCandidates("/dashboard/payments/reports")), [
      "collections.overdue",
    ]);
    assert.deepEqual(
      keysOf(pageModuleCandidates("/dashboard/payments/reports?type=no-such")),
      ["collections.overdue"],
    );
    assert.deepEqual(keysOf(pageModuleCandidates("/dashboard/leases/reports")), [
      "leasing.reports.registers",
    ]);
    assert.deepEqual(
      keysOf(pageModuleCandidates("/dashboard/leases/reports?type=active")),
      ["leasing.reports.registers"],
    );
    assert.deepEqual(keysOf(pageModuleCandidates("/dashboard/properties/reports")), [
      "leasing.reports.occupancy",
    ]);
    assert.deepEqual(
      keysOf(pageModuleCandidates("/dashboard/properties/reports?type=occupancy&occupancy=vacant")),
      ["leasing.reports.vacant"],
    );
    assert.deepEqual(
      keysOf(pageModuleCandidates("/dashboard/payments/reports?type=expenses-by-building&startDate=2026-01-01")),
      ["accounting.reports"],
    );
    assert.deepEqual(keysOf(pageModuleCandidates("/dashboard/agreements?kind=investment")), [
      "operations.investment",
    ]);
    assert.deepEqual(keysOf(pageModuleCandidates("/dashboard/agreements")), [
      "operations.agreements",
    ]);
  });

  test("one report off leaves the others open", () => {
    const state = resolveModuleState(
      encodeModuleSelection(
        TOGGLEABLE_LEAF_KEYS.filter((key) => key !== "collections.payment_report"),
      ),
    );
    assert.equal(
      decidePage("/dashboard/payments/reports?type=collections", state).allowed,
      false,
    );
    // Its section is on: the card names the report itself.
    assert.equal(
      decidePage("/dashboard/payments/reports?type=collections", state).blockedKey,
      "collections.payment_report",
    );
    assert.equal(
      decidePage("/dashboard/payments/reports?type=overdue-tenants", state).allowed,
      true,
    );
    assert.equal(decidePage("/dashboard/payments/analytics", state).allowed, false);
  });

  test("the pages that need their query are the ones whose module depends on it", () => {
    assert.ok(pageNeedsQuery("/dashboard/payments/reports"));
    assert.ok(pageNeedsQuery("/dashboard/properties/reports"));
    assert.ok(pageNeedsQuery("/dashboard/agreements"));
    assert.ok(!pageNeedsQuery("/dashboard/maintenance"));
    assert.ok(!pageNeedsQuery("/dashboard/payments"));
  });

  test("among modules sharing a page, the reader's own decide", () => {
    // Staff contracts off, the tenant's "My leases" on.
    const state = resolveModuleState(["leasing.mine"]);
    assert.equal(decidePage("/dashboard/leases/abc", state, tenant).allowed, true);
    assert.equal(decidePage("/dashboard/leases/abc", state, staff).allowed, false);
    assert.equal(decidePage("/dashboard/leases", state, staff).allowed, false);
    // Unknown reader, mixed owners: the answer waits for the role.
    const unknown = decideModuleAccess(
      pageModuleCandidates("/dashboard/leases/abc"),
      (key) => state.enabled.has(key),
    );
    assert.equal(unknown.needsRole, true);
  });

  test("the owner portal follows its key", () => {
    const without = resolveModuleState(["section.properties"]);
    assert.equal(decidePage("/dashboard/portfolio", without, owner).allowed, false);
    const withPortal = resolveModuleState(["home.portfolio"]);
    assert.equal(decidePage("/dashboard/portfolio", withPortal, owner).allowed, true);
  });
});

describe("the API gate", () => {
  test("/api/v1 is gated exactly like /api", () => {
    assert.equal(normalizeApiPath("/api/v1/maintenance"), "/api/maintenance");
    assert.equal(normalizeApiPath("/api/v1"), "/api");
    assert.equal(normalizeApiPath("/api/v10/maintenance"), "/api/v10/maintenance");
    for (const route of apiRoutes()) {
      const versioned = route.replace(/^\/api/, "/api/v1");
      assert.deepEqual(
        keysOf(apiModuleCandidates(versioned)),
        keysOf(apiModuleCandidates(route)),
        route,
      );
    }
    const state = resolveModuleState(
      encodeModuleSelection(
        TOGGLEABLE_LEAF_KEYS.filter((key) => !key.startsWith("maintenance.")),
      ),
    );
    assert.equal(decideApi("/api/v1/maintenance", state).allowed, false);
    assert.equal(decideApi("/api/v1/leases", state).allowed, true);
  });

  test("each report type is its own module", () => {
    const owners = (path: string) => keysOf(apiModuleCandidates(path));
    assert.deepEqual(owners("/api/payments/reports?type=overdue-tenants"), [
      "collections.overdue_tenants",
    ]);
    assert.deepEqual(owners("/api/payments/reports?type=outstanding"), ["collections.due"]);
    assert.deepEqual(owners("/api/payments/reports?type=overdue"), ["collections.overdue"]);
    assert.deepEqual(owners("/api/payments/reports"), ["collections.overdue"]);
    // Also reached from Accounting, as the receipt vouchers.
    assert.deepEqual(owners("/api/payments/reports?type=collections"), [
      "accounting.receipts",
      "collections.payment_report",
    ]);
    assert.deepEqual(owners("/api/payments/reports?type=collections-by-building"), [
      "collections.payment_report",
    ]);
    assert.deepEqual(owners("/api/payments/reports?type=expenses-by-building"), [
      "accounting.reports",
    ]);
    assert.deepEqual(owners("/api/payments/reports/analytics"), [
      "collections.payment_report",
    ]);
    assert.deepEqual(owners("/api/leases/reports?type=renewed"), ["leasing.reports.renewed"]);
    assert.deepEqual(owners("/api/leases/reports?type=terminated"), [
      "leasing.reports.cancelled",
    ]);
    assert.deepEqual(owners("/api/leases/reports"), ["leasing.reports.registers"]);
    assert.deepEqual(owners("/api/properties/reports?type=occupancy"), [
      "leasing.reports.leased",
      "leasing.reports.occupancy",
      "leasing.reports.vacant",
    ]);
    assert.deepEqual(owners("/api/properties/reports?type=maintenance"), [
      "operations.reports.maintenance",
    ]);
    assert.deepEqual(owners("/api/properties/reports?type=unit-statement"), [
      "operations.reports.unit_statement",
    ]);
    assert.deepEqual(owners("/api/reports/financial?type=rent-roll"), ["accounting.reports"]);
    assert.deepEqual(owners("/api/agreements/reports"), ["operations.reports.agreements"]);
    // The ledger's reports: one route, each report its own module.
    assert.deepEqual(owners("/api/accounting/ledger/reports/trial-balance"), [
      "accounting.ledger_reports.trial_balance",
    ]);
    assert.deepEqual(owners("/api/accounting/ledger/reports/vat-return?from=2026-07-01"), [
      "accounting.ledger_reports.vat_return",
    ]);
    assert.deepEqual(owners("/api/accounting/ledger/reports/parties?partyType=owner"), [
      "accounting.ledger_reports.party_statement",
    ]);

    const state = resolveModuleState(
      encodeModuleSelection(
        TOGGLEABLE_LEAF_KEYS.filter((key) => key !== "leasing.reports.renewed"),
      ),
    );
    assert.equal(decideApi("/api/leases/reports?type=renewed", state).allowed, false);
    assert.equal(decideApi("/api/leases/reports?type=expired", state).allowed, true);
  });

  test("lookups every screen needs stay open on every package", () => {
    for (const path of [
      "/api/roles/names",
      "/api/payments/filter-options",
      "/api/reports/filter-options",
      "/api/billing/entitlements",
      "/api/billing/checkout",
      "/api/auth/session",
      "/api/user/profile",
      "/api/upload/images",
    ]) {
      assert.equal(apiModuleCandidates(path), null, path);
    }
    const empty = resolveModuleState([MODULE_FORMAT_MARKER]);
    for (const path of [
      "/api/notifications",
      "/api/tenant/notifications",
      "/api/settings/profile",
      "/api/settings/display",
      "/api/dashboard/overview",
      "/api/sidebar/counts",
      "/api/tenant/dashboard",
      "/api/users",
      "/api/users/abc/permissions",
    ]) {
      assert.equal(decideApi(path, empty).allowed, true, path);
    }
  });

  test("the APIs the audit found ungated now belong to a module", () => {
    for (const path of [
      "/api/archive",
      "/api/archive/leases/abc",
      "/api/settings/payment",
      "/api/settings/payment/test",
      "/api/tenant/maintenance",
      "/api/tenant/tickets",
      "/api/tenant/invoices",
      "/api/tenant/payments/abc/pay",
      "/api/tenant/receipts/abc/download",
      "/api/tenant/recurring-payments/abc",
      "/api/tenant/documents/abc/download",
    ]) {
      assert.ok(apiModuleCandidates(path), path);
    }
  });

  test("the tenant portal follows the office's keys", () => {
    const state = resolveModuleState(
      encodeModuleSelection(
        TOGGLEABLE_LEAF_KEYS.filter((key) => !key.startsWith("maintenance.")),
      ),
    );
    assert.equal(decideApi("/api/tenant/maintenance", state, tenant).allowed, false);
    assert.equal(decideApi("/api/maintenance/abc", state, tenant).allowed, false);
    assert.equal(decideApi("/api/tenant/payments", state, tenant).allowed, true);
    // Only "My requests" off: the tenant is refused though the office's
    // maintenance list is on.
    const mineOff = resolveModuleState(
      encodeModuleSelection(
        TOGGLEABLE_LEAF_KEYS.filter(
          (key) => key !== "maintenance.mine" && key !== "maintenance.new",
        ),
      ),
    );
    assert.equal(decideApi("/api/tenant/maintenance", mineOff, tenant).allowed, false);
    assert.equal(decideApi("/api/maintenance", mineOff, staff).allowed, true);
  });

  test("recording a payment is open to Collections without Accounting", () => {
    const state = resolveModuleState(["section.collections"]);
    assert.equal(decideApi("/api/invoices/abc", state).allowed, true);
    assert.equal(decideApi("/api/accounting/expenses", state).allowed, false);
  });

  test("a route's explicit module key names its modules", () => {
    assert.deepEqual(keysOf(moduleCandidatesForKey("accounting.reports")), [
      "accounting.reports",
    ]);
    assert.ok(keysOf(moduleCandidatesForKey("advanced_analytics")).includes("accounting.reports"));
    assert.equal(moduleCandidatesForKey("no_such_key"), null);
  });
});

describe("the package form's cascade", () => {
  const fromPlan = (features: string[]) =>
    new Set(resolveModuleState(features).planEnabled);

  test("switching a section off switches its items off, and back on restores them", () => {
    const start = fromPlan(["section.collections", "collections.due", "collections.payments"]);
    assert.deepEqual(
      effectiveModuleLeaves(start).filter((key) => key.startsWith("collections.")),
      ["collections.due", "collections.payments"],
    );
    const off = toggleModuleCheck(start, "section.collections", false);
    assert.deepEqual(
      effectiveModuleLeaves(off).filter((key) => key.startsWith("collections.")),
      [],
    );
    // The items kept their ticks while greyed out.
    assert.ok(off.has("collections.due"));
    const on = toggleModuleCheck(off, "section.collections", true);
    assert.deepEqual(
      effectiveModuleLeaves(on).filter((key) => key.startsWith("collections.")),
      ["collections.due", "collections.payments"],
    );
  });

  test("switching on an empty section ticks all of it", () => {
    const on = toggleModuleCheck(new Set(), "section.maintenance", true);
    assert.deepEqual(
      effectiveModuleLeaves(on),
      toggleableLeavesUnder("section.maintenance"),
    );
  });

  test("a group off takes its items, the section's other items stay", () => {
    const start = fromPlan(["section.leasing"]);
    const off = toggleModuleCheck(start, "leasing.reports", false);
    const opened = effectiveModuleLeaves(off);
    assert.ok(!opened.includes("leasing.reports.renewed"));
    assert.ok(opened.includes("leasing.contracts"));
    // What the form saves reads back as exactly that.
    assert.deepEqual(
      enabledToggleableLeaves(resolveModuleState(encodeModuleSelection(opened)).planEnabled),
      opened,
    );
  });

  test("select all and clear all", () => {
    assert.deepEqual(effectiveModuleLeaves(allModuleChecks(true)), [...TOGGLEABLE_LEAF_KEYS]);
    assert.deepEqual(effectiveModuleLeaves(allModuleChecks(false)), []);
    assert.deepEqual(
      encodeModuleSelection(effectiveModuleLeaves(allModuleChecks(false))),
      [MODULE_FORMAT_MARKER],
    );
  });

  test("an old package opens in the form as what it has, and saves unchanged", () => {
    for (const features of Object.values(LEGACY_TIERS)) {
      const checks = fromPlan(features);
      assert.deepEqual(
        effectiveModuleLeaves(checks),
        enabledToggleableLeaves(resolveModuleState(features).planEnabled),
      );
      assert.deepEqual(
        encodeModuleSelection(effectiveModuleLeaves(checks)),
        normalizeStoredModules(features),
      );
    }
  });
});

describe("the tree helpers", () => {
  test("descendants and toggleable leaves", () => {
    assert.ok(moduleDescendants("section.leasing").includes("leasing.reports.expired"));
    assert.ok(!toggleableLeavesUnder("section.employees").includes("employees.list"));
    assert.deepEqual(toggleableLeavesUnder("section.employees"), ["employees.groups"]);
  });
});

describe("the Marketing section", () => {
  test("two entries, their rights, and the pages and APIs they own", () => {
    const marketing = NAV_SECTIONS.find((s) => s.key === "section.marketing")!;
    assert.equal(marketing.title, "nav.section.marketing");
    assert.equal(marketing.icon, "Megaphone");
    assert.deepEqual(
      marketing.items.map((item) => [
        item.key,
        item.href,
        item.icon,
        [...(item.roles ?? [])].sort(),
        [...(item.requiredPermissions ?? [])],
      ]),
      [
        [
          "marketing.listings",
          "/dashboard/marketing/listings",
          "Megaphone",
          ["admin", "manager"],
          ["listing_view", "listing_management"],
        ],
        [
          "marketing.inquiries",
          "/dashboard/marketing/inquiries",
          "Inbox",
          ["admin", "manager"],
          ["listing_inquiries", "listing_management"],
        ],
      ],
    );
    assert.deepEqual(keysOf(pageModuleCandidates("/dashboard/marketing")), [
      "marketing.listings",
    ]);
    assert.deepEqual(
      keysOf(pageModuleCandidates("/dashboard/marketing/listings/abc/edit")),
      ["marketing.listings"],
    );
    for (const path of [
      "/api/marketing/listings",
      "/api/marketing/listings/abc/status",
      "/api/marketing/listings/candidates",
      "/api/marketing/settings",
    ]) {
      assert.deepEqual(keysOf(apiModuleCandidates(path)), ["marketing.listings"], path);
    }
    for (const path of [
      "/api/marketing/inquiries",
      "/api/marketing/inquiries/assignees",
    ]) {
      assert.deepEqual(keysOf(apiModuleCandidates(path)), ["marketing.inquiries"], path);
    }
    // A visitor's side follows the office's package in lib/listings/public.ts,
    // not the gate: it has no session to read a package from.
    assert.equal(apiModuleCandidates("/api/public/listings/abc/inquiries"), null);
    assert.equal(pageModuleCandidates("/o/office"), null);
    assert.equal(pageModuleCandidates("/o/office/listing"), null);
  });

  test("a package without it shows the card and refuses its APIs", () => {
    const without = resolveModuleState(
      encodeModuleSelection(
        TOGGLEABLE_LEAF_KEYS.filter((key) => !key.startsWith("marketing.")),
      ),
    );
    const page = decidePage("/dashboard/marketing", without);
    assert.equal(page.allowed, false);
    assert.equal(page.blockedKey, "section.marketing");
    assert.equal(decidePage("/dashboard/marketing/inquiries", without).allowed, false);
    assert.equal(decideApi("/api/marketing/listings", without).allowed, false);
    assert.equal(decideApi("/api/v1/marketing/inquiries", without).allowed, false);
  });
});

describe("modules added later", () => {
  // The packages as the shared database stored them before Marketing existed,
  // with Archive where a save writes it since it moved to the end of the menu
  // (2026-10-16). Rows saved before that hold it earlier; they open the same
  // modules (see "a package saved before Archive moved" below).
  const STORED: Record<string, string[]> = {
    starter: [
      "leasing.reports.occupancy", "leasing.reports.vacant", "leasing.reports.leased",
      "leasing.contracts", "leasing.new", "leasing.mine", "leasing.documents",
      "collections.follow_up", "collections.payments", "collections.pay_rent",
      "accounting.invoices", "accounting.expenses", "accounting.revenues",
      "accounting.transactions", "operations.reports.compound_statement",
      "operations.reports.property_statement", "operations.reports.unit_statement",
      "operations.reports.maintenance", "section.properties", "section.maintenance",
      "clients.tenants", "communication.inbox",
      "administration.overview", "administration.new_user", "administration.feedback",
      "administration.settings", "archive.records", "capability.data_export",
    ],
    professional: [
      "home.portfolio", "section.leasing", "section.collections", "section.accounting",
      "section.operations", "section.properties", "section.maintenance",
      "section.inspections", "section.clients",
      "section.communication", "administration.overview", "administration.new_user",
      "administration.import", "administration.feedback", "administration.settings",
      "archive.records", "capability.data_export", "capability.security_deposits",
    ],
    business: [
      "home.portfolio", "section.leasing", "section.collections", "section.accounting",
      "section.operations", "section.properties", "section.maintenance",
      "section.inspections", "section.clients", "section.employees",
      "section.communication", "section.administration", "archive.records",
      "capability.data_export", "capability.security_deposits",
    ],
  };
  const opens = (planKey: string, features: readonly string[]) =>
    resolveModuleState(withModulesAddedLater(planKey, features)).planEnabled;
  const leavesOf = (features: readonly string[]) =>
    enabledToggleableLeaves(resolveModuleState(features).planEnabled);
  const MARKETING = toggleableLeavesUnder("section.marketing");
  const GATEWAYS = toggleableLeavesUnder("capability.payment_gateways");
  const ADDED = [...MARKETING, ...GATEWAYS];

  test("Marketing starts on in Professional and Business, off in the others", () => {
    for (const planKey of ["professional", "business"]) {
      const on = opens(planKey, STORED[planKey]);
      for (const leaf of MARKETING) assert.ok(on.has(leaf), `${planKey}: ${leaf}`);
      // And nothing else moves (the payment gateways are added later too).
      assert.deepEqual(
        enabledToggleableLeaves(on).filter((key) => !ADDED.includes(key)),
        leavesOf(STORED[planKey]),
        planKey,
      );
    }
    assert.ok(!opens("starter", STORED.starter).has("marketing.listings"));
    assert.ok(!opens("free", [MODULE_FORMAT_MARKER]).has("marketing.listings"));
    assert.ok(!opens("custom-plan", STORED.business).has("marketing.listings"));
  });

  test("the backfill and the API leave a package nobody has saved since alone", () => {
    for (const features of Object.values(STORED)) {
      assert.deepEqual(normalizeStoredModules(features), features);
    }
  });

  test("a package saved before Archive moved opens the same modules", () => {
    // The order the shared database holds from before 2026-10-16: Archive
    // ahead of Communication. Normalizing only moves it.
    const old = [
      "home.portfolio", "section.clients", "archive.records",
      "section.communication", "section.administration", "capability.data_export",
    ];
    const next = normalizeStoredModules(old);
    assert.deepEqual([...next].sort(), [...old].sort());
    assert.deepEqual(leavesOf(next), leavesOf(old));
  });

  test("saved without it, a package keeps it off; saved with it, on", () => {
    const without = encodeModuleSelection([...leavesOf(STORED.business), ...GATEWAYS], "business");
    assert.deepEqual(without.slice(-1), ["!section.marketing"]);
    assert.ok(without.every(isPlanFeatureKey));
    // The admin API normalizes what the form sends: the opt-out survives.
    assert.deepEqual(normalizeStoredModules(without), without);
    assert.ok(!opens("business", without).has("marketing.listings"));

    const withIt = encodeModuleSelection(
      [...leavesOf(STORED.business), ...MARKETING, ...GATEWAYS],
      "business",
    );
    assert.ok(withIt.includes("section.marketing"));
    assert.ok(!withIt.some((key) => key.startsWith("!")));
    assert.ok(opens("business", withIt).has("marketing.inquiries"));

    // Part of it: exactly that part.
    const part = encodeModuleSelection(
      [...leavesOf(STORED.business), ...GATEWAYS, "marketing.inquiries"],
      "business",
    );
    assert.ok(!part.some((key) => key.startsWith("!")));
    assert.ok(opens("business", part).has("marketing.inquiries"));
    assert.ok(!opens("business", part).has("marketing.listings"));

    // A package it never started in records nothing either way.
    assert.ok(
      !encodeModuleSelection([...leavesOf(STORED.starter), ...GATEWAYS], "starter").some((key) =>
        key.startsWith("!"),
      ),
    );
  });

  test("the payment gateways start on in every package; a package saved without one keeps it off", () => {
    for (const planKey of ["starter", "professional", "business"]) {
      const on = opens(planKey, STORED[planKey]);
      for (const leaf of GATEWAYS) assert.ok(on.has(leaf), `${planKey}: ${leaf}`);
    }
    // A custom package too: no office loses the gateway it collects through.
    assert.ok(opens("custom-plan", STORED.business).has("capability.gateway_stripe"));
    assert.ok(opens("free", [MODULE_FORMAT_MARKER]).has("capability.gateway_moyasar"));

    // Moyasar and Tap only: exactly those two, and no opt-out of the group.
    const two = encodeModuleSelection(
      [...leavesOf(STORED.business), ...MARKETING, "capability.gateway_moyasar", "capability.gateway_tap"],
      "business",
    );
    assert.ok(!two.some((key) => key.startsWith("!")));
    const state = opens("business", two);
    assert.ok(state.has("capability.gateway_moyasar"));
    assert.ok(state.has("capability.gateway_tap"));
    assert.ok(!state.has("capability.gateway_stripe"));
    assert.ok(!state.has("capability.gateway_paypal"));

    // None: the group's opt-out keeps all five off.
    const none = encodeModuleSelection([...leavesOf(STORED.business), ...MARKETING], "business");
    assert.deepEqual(none.slice(-1), ["!capability.payment_gateways"]);
    for (const leaf of GATEWAYS) assert.ok(!opens("business", none).has(leaf), leaf);

    // The platform switch takes one gateway out of every package.
    const switched = resolveModuleState(
      withModulesAddedLater("business", STORED.business),
      ["capability.gateway_paypal"],
    );
    assert.ok(!switched.enabled.has("capability.gateway_paypal"));
    assert.ok(switched.enabled.has("capability.gateway_moyasar"));
  });

  test("an old flat list keeps every screen it had", () => {
    const old = LEGACY_TIERS.business;
    const on = opens("business", old);
    for (const leaf of leavesOf(old)) assert.ok(on.has(leaf), leaf);
    assert.ok(on.has("marketing.listings"));
  });

  test("only a module that starts on somewhere can be opted out of", () => {
    assert.equal(isPlanFeatureKey("!section.marketing"), true);
    assert.equal(isPlanFeatureKey("!section.leasing"), false);
    assert.equal(isPlanFeatureKey("!nonsense"), false);
  });
});
