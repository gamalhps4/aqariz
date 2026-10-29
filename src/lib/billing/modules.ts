/**
 * PropertyPro SaaS - Which modules a package includes, and what that opens
 *
 * Pure: no database, no React. Read by the API gate, the entitlements feed,
 * the page guard, the sidebar, the ⌘K palette and the Super Admin's package
 * form, so each of them answers "is this module on?" the same way.
 *
 * THE STORED LIST (`Plan.features`) — the module keys of
 * lib/navigation/menu-config.ts, read as a tree:
 *
 *   - a key alone means that node and everything under it, including items a
 *     later release adds there ("section.collections" is the whole section);
 *   - a key with some of its descendants also listed means only those
 *     descendants ("section.leasing" + "leasing.new" is just New contract);
 *   - a listed descendant switches its ancestors on — it could not be reached
 *     otherwise.
 *
 * `encodeModuleSelection` writes the shortest list for a set of ticked items;
 * `resolveModuleState` reads one back. "home.dashboard" (always on) marks a
 * list in this format even when nothing else is ticked.
 *
 * THE OLD LIST — flat keys with no dot ("maintenance", "advanced_analytics")
 * from before the tree. Read through each module's `legacy` entry, so a
 * package keeps every screen it had before any backfill runs; "*" covers the
 * screens that were never plan-gated, which every old package had.
 * `src/scripts/backfill-plan-modules.ts` rewrites old lists to the tree.
 *
 * PLATFORM SWITCHES — a module the Super Admin switched off for the whole
 * platform is off in every package, with everything under it, whatever the
 * package says. Always-on modules ignore both.
 */

import {
  CAPABILITY_NODES,
  NAV_SECTIONS,
  OPEN_API_PREFIXES,
  REPORT_ENDPOINTS,
  type MenuNode,
  type MenuSection,
} from "@/lib/navigation/menu-config";

// ---------------------------------------------------------------------------
// The tree, indexed
// ---------------------------------------------------------------------------

export type ModuleKind = "section" | "group" | "leaf";

export interface ModuleEntry {
  key: string;
  kind: ModuleKind;
  parent: string | null;
  children: readonly string[];
  /** The menu node; undefined for a section. */
  node?: MenuNode;
  /** The section; set for a section entry only. */
  section?: MenuSection;
  /** i18n key of the label. */
  title: string;
  /** English label. */
  label: string;
  alwaysOn: boolean;
  /** Not drawn in the sidebar or the palette. */
  hidden: boolean;
  /** A capability rather than a menu module. */
  capability: boolean;
  /** Plan keys of the packages it starts on in, as a module added later. */
  defaultPlans: readonly string[];
}

const INDEX = new Map<string, ModuleEntry>();
/** Top-level keys: sections, untitled-section items and capabilities. */
const ROOTS: string[] = [];

function indexNode(
  node: MenuNode,
  parent: string | null,
  capability: boolean,
): string {
  const children = (node.children ?? []).map((child) =>
    indexNode(child, node.key, capability),
  );
  if (INDEX.has(node.key)) {
    throw new Error(`Duplicate module key in the menu config: ${node.key}`);
  }
  INDEX.set(node.key, {
    key: node.key,
    kind: children.length > 0 ? "group" : "leaf",
    parent,
    children,
    node,
    title: node.title,
    label: node.label,
    alwaysOn: Boolean(node.alwaysOn),
    hidden: Boolean(node.hidden),
    capability,
    defaultPlans: node.defaultPlans ?? [],
  });
  return node.key;
}

for (const section of NAV_SECTIONS) {
  if (section.key === null) {
    for (const item of section.items) ROOTS.push(indexNode(item, null, false));
    continue;
  }
  const children = section.items.map((item) =>
    indexNode(item, section.key, false),
  );
  if (INDEX.has(section.key)) {
    throw new Error(`Duplicate module key in the menu config: ${section.key}`);
  }
  INDEX.set(section.key, {
    key: section.key,
    kind: "section",
    parent: null,
    children,
    section,
    title: section.title ?? section.key,
    label: section.label ?? section.key,
    alwaysOn: false,
    hidden: false,
    capability: false,
    defaultPlans: section.defaultPlans ?? [],
  });
  ROOTS.push(section.key);
}
for (const capability of CAPABILITY_NODES) {
  ROOTS.push(indexNode(capability, null, true));
}

/** Every module key, sections first within their subtree, in menu order. */
export const ALL_MODULE_KEYS: readonly string[] = (() => {
  const out: string[] = [];
  const walk = (key: string) => {
    out.push(key);
    for (const child of INDEX.get(key)!.children) walk(child);
  };
  ROOTS.forEach(walk);
  return out;
})();

export const ALWAYS_ON_MODULE_KEYS: readonly string[] = ALL_MODULE_KEYS.filter(
  (key) => INDEX.get(key)!.alwaysOn,
);

/** The leaves a package can include or leave out. */
export const TOGGLEABLE_LEAF_KEYS: readonly string[] = ALL_MODULE_KEYS.filter(
  (key) => {
    const entry = INDEX.get(key)!;
    return entry.kind === "leaf" && !entry.alwaysOn;
  },
);

/** The flat keys of the old catalog that some module still answers to. */
export const LEGACY_FEATURE_KEYS: readonly string[] = Array.from(
  new Set(
    ALL_MODULE_KEYS.flatMap((key) =>
      (INDEX.get(key)!.node?.legacy ?? []).filter((legacy) => legacy !== "*"),
    ),
  ),
).sort();

/** Written into a list that would otherwise be empty, so it still reads as
 * the tree format (an empty old list meant "the ungated screens"). */
export const MODULE_FORMAT_MARKER = "home.dashboard";

export function moduleEntry(key: string): ModuleEntry | null {
  return INDEX.get(key) ?? null;
}

export function isModuleKey(key: string): boolean {
  return INDEX.has(key);
}

export function isAlwaysOnModule(key: string): boolean {
  return INDEX.get(key)?.alwaysOn ?? false;
}

export function moduleRootKeys(): readonly string[] {
  return ROOTS;
}

/** Ancestors of a key, nearest first. */
export function moduleAncestors(key: string): string[] {
  const out: string[] = [];
  let parent = INDEX.get(key)?.parent ?? null;
  while (parent) {
    out.push(parent);
    parent = INDEX.get(parent)?.parent ?? null;
  }
  return out;
}

/** Every key under this one (not including it). */
export function moduleDescendants(key: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const child of INDEX.get(current)?.children ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(key);
  return out;
}

/** The toggleable leaves at or under a key. */
export function toggleableLeavesUnder(key: string): string[] {
  return [key, ...moduleDescendants(key)].filter((candidate) => {
    const entry = INDEX.get(candidate);
    return entry?.kind === "leaf" && !entry.alwaysOn;
  });
}

/** English label of a module key, or of an old flat key. */
export function moduleLabel(key: string): string {
  const entry = INDEX.get(key);
  if (entry) return entry.label;
  return key.replaceAll("_", " ");
}

/** i18n key of a module's label, or null for an unknown key. */
export function moduleTitleKey(key: string): string | null {
  return INDEX.get(key)?.title ?? null;
}

// ---------------------------------------------------------------------------
// Reading a stored list
// ---------------------------------------------------------------------------

/** A list written before the module tree: no key in it has a dot. */
export function isLegacyFeatureList(features: readonly string[]): boolean {
  return !features.some((feature) => feature.includes("."));
}

/**
 * The keys a stored list names explicitly, old keys translated to the
 * modules that answer to them.
 */
export function explicitModuleKeys(features: readonly string[]): Set<string> {
  const explicit = new Set<string>();
  const legacyFormat = isLegacyFeatureList(features);
  const legacyKeys = new Set(
    features.filter((feature) => !feature.includes(".")),
  );
  for (const feature of features) {
    if (INDEX.has(feature)) explicit.add(feature);
  }
  for (const entry of INDEX.values()) {
    const legacy = entry.node?.legacy;
    if (!legacy) continue;
    if (
      legacy.some((key) => (key === "*" ? legacyFormat : legacyKeys.has(key)))
    ) {
      explicit.add(entry.key);
    }
  }
  return explicit;
}

export interface ModuleState {
  /** Modules this organization can use: package, platform and always-on. */
  enabled: ReadonlySet<string>;
  /** What the package alone includes (always-on modules counted in). */
  planEnabled: ReadonlySet<string>;
  /** Modules the platform has switched off, with everything under them. */
  platformOff: ReadonlySet<string>;
}

function planOnFor(explicit: ReadonlySet<string>): Set<string> {
  const listedBelow = new Map<string, boolean>();
  const markBelow = (key: string): boolean => {
    let below = false;
    for (const child of INDEX.get(key)!.children) {
      if (markBelow(child)) below = true;
    }
    listedBelow.set(key, below);
    return below || explicit.has(key);
  };
  ROOTS.forEach(markBelow);

  const on = new Set<string>();
  const walk = (key: string, fullAbove: boolean) => {
    const entry = INDEX.get(key)!;
    const listed = explicit.has(key);
    const below = listedBelow.get(key) ?? false;
    if (fullAbove || listed || below || entry.alwaysOn) on.add(key);
    // Listed with nothing under it listed: the whole subtree.
    const full = fullAbove || (listed && !below);
    for (const child of entry.children) walk(child, full);
  };
  ROOTS.forEach((root) => walk(root, false));
  return on;
}

function platformOffFor(disabled: ReadonlySet<string>): Set<string> {
  const off = new Set<string>();
  const walk = (key: string, offAbove: boolean) => {
    const entry = INDEX.get(key)!;
    const switchedOff = offAbove || disabled.has(key);
    if (switchedOff && !entry.alwaysOn) off.add(key);
    for (const child of entry.children) walk(child, switchedOff);
  };
  ROOTS.forEach((root) => walk(root, false));
  return off;
}

function stateFrom(
  planEnabled: Set<string>,
  platformDisabled: readonly string[],
): ModuleState {
  const platformOff = platformOffFor(new Set(platformDisabled));
  const enabled = new Set<string>();
  for (const key of planEnabled) {
    if (!platformOff.has(key)) enabled.add(key);
  }
  for (const key of ALWAYS_ON_MODULE_KEYS) enabled.add(key);
  return { enabled, planEnabled, platformOff };
}

/** What a stored package list opens, after the platform switches. */
export function resolveModuleState(
  features: readonly string[],
  platformDisabled: readonly string[] = [],
): ModuleState {
  return stateFrom(planOnFor(explicitModuleKeys(features)), platformDisabled);
}

/**
 * Every module on, bar the platform switches — for when no package resolves
 * at all (plans not configured yet), which has never blocked anything.
 */
export function allModulesState(
  platformDisabled: readonly string[] = [],
): ModuleState {
  return stateFrom(new Set(ALL_MODULE_KEYS), platformDisabled);
}

/**
 * Whether a module key — or an old flat key — is on. An old key is on when
 * any module that answers to it is: `requirePlanFeature("advanced_analytics")`
 * in a route asks "is any of the reports it used to cover still included?",
 * and the path gate in front of that route asks about its own report.
 */
export function isModuleOn(state: ModuleState, key: string): boolean {
  if (key.includes(".")) return state.enabled.has(key);
  for (const entry of INDEX.values()) {
    if (entry.node?.legacy?.includes(key) && state.enabled.has(entry.key)) {
      return true;
    }
  }
  return false;
}

/** The old flat keys still satisfied, for screens that ask with them. */
export function satisfiedLegacyKeys(state: ModuleState): string[] {
  return LEGACY_FEATURE_KEYS.filter((key) => isModuleOn(state, key));
}

/** The ticked leaves of a state's package (or of a set of enabled keys). */
export function enabledToggleableLeaves(enabled: ReadonlySet<string>): string[] {
  return TOGGLEABLE_LEAF_KEYS.filter((key) => enabled.has(key));
}

// ---------------------------------------------------------------------------
// Writing a stored list
// ---------------------------------------------------------------------------

/**
 * The shortest list that opens exactly these leaves: a node whose every
 * toggleable leaf is chosen is stored alone, so a whole section is one key
 * and also takes in items added to it later. Given the package's plan key, it
 * also records the modules added later that this package goes without (see
 * "Modules added later" below) — the package form passes it.
 */
export function encodeModuleSelection(
  selected: Iterable<string>,
  planKey?: string,
): string[] {
  const chosen = new Set(selected);
  const out: string[] = [];
  const encode = (key: string) => {
    const leaves = toggleableLeavesUnder(key);
    if (leaves.length === 0) return;
    const count = leaves.filter((leaf) => chosen.has(leaf)).length;
    if (count === 0) return;
    if (count === leaves.length) {
      out.push(key);
      return;
    }
    for (const child of INDEX.get(key)!.children) encode(child);
  };
  ROOTS.forEach(encode);
  if (out.length === 0) out.push(MODULE_FORMAT_MARKER);
  if (planKey) {
    for (const { key, plans } of ADDED_LATER) {
      if (startsOnIn(plans, planKey) && !hasLeafUnder(key, chosen)) {
        out.push(optOutKey(key));
      }
    }
  }
  return out;
}

/**
 * Any stored list — old, new or mixed — rewritten in the canonical form. The
 * opt-outs it holds are kept while their module stays off; none are added, so
 * a package nobody has saved since a module was added still starts with it.
 */
export function normalizeStoredModules(features: readonly string[]): string[] {
  const { planEnabled } = resolveModuleState(features);
  const out = encodeModuleSelection(enabledToggleableLeaves(planEnabled));
  for (const { key } of ADDED_LATER) {
    if (features.includes(optOutKey(key)) && !hasLeafUnder(key, planEnabled)) {
      out.push(optOutKey(key));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Modules added later
// ---------------------------------------------------------------------------

/*
 * A module added after the packages were saved is in no stored list, so it
 * starts off in all of them. One that names `defaultPlans` (menu-config.ts)
 * starts on in those packages instead, with nothing written to the database,
 * until the Super Admin saves the package with it unticked. A key left out
 * cannot say "seen and left out", so that save stores "!<key>" — an opt-out —
 * for exactly those packages. A list that names the module or anything under
 * it has said what it wants already.
 */

const OPT_OUT = "!";

/** The modules that start on in some packages, and those packages' keys. */
const ADDED_LATER: ReadonlyArray<{ key: string; plans: readonly string[] }> =
  ALL_MODULE_KEYS.flatMap((key) => {
    const plans = INDEX.get(key)!.defaultPlans;
    return plans.length > 0 ? [{ key, plans }] : [];
  });

/** "*" in `defaultPlans`: every package, custom ones included. */
function startsOnIn(plans: readonly string[], planKey: string): boolean {
  return plans.includes(planKey) || plans.includes("*");
}

function optOutKey(key: string): string {
  return `${OPT_OUT}${key}`;
}

function hasLeafUnder(key: string, on: ReadonlySet<string>): boolean {
  return toggleableLeavesUnder(key).some((leaf) => on.has(leaf));
}

/** "!<key>": a package saved without a module that would start on in it. */
export function isModuleOptOut(value: string): boolean {
  return (
    value.startsWith(OPT_OUT) &&
    ADDED_LATER.some((entry) => optOutKey(entry.key) === value)
  );
}

/**
 * A package's stored list with the modules added later that start on in it
 * and that it was not saved without: what the package includes today. Read
 * where a plan is loaded (lib/billing/plans.ts), so every gate agrees.
 */
export function withModulesAddedLater(
  planKey: string,
  features: readonly string[],
): string[] {
  const listed = new Set(features);
  const due = ADDED_LATER.filter(
    ({ key, plans }) =>
      startsOnIn(plans, planKey) &&
      !listed.has(optOutKey(key)) &&
      ![key, ...moduleDescendants(key)].some((named) => listed.has(named)),
  );
  if (due.length === 0) return [...features];
  // A dotted key would stop an old flat list reading as one.
  const base = isLegacyFeatureList(features)
    ? normalizeStoredModules(features)
    : [...features];
  // On already under a whole ancestor: listing it would narrow the ancestor.
  const on = planOnFor(explicitModuleKeys(base));
  return [...base, ...due.filter(({ key }) => !on.has(key)).map(({ key }) => key)];
}

// ---------------------------------------------------------------------------
// The package form's ticks
// ---------------------------------------------------------------------------

/**
 * The leaves a set of ticked nodes opens: ticked, under ticked ancestors. The
 * package form keeps the ticks of a section's items while the section is off,
 * so switching it back on restores them; only these leaves are saved.
 */
export function effectiveModuleLeaves(checked: ReadonlySet<string>): string[] {
  const reachable = new Set<string>();
  for (const key of checked) {
    if (moduleAncestors(key).every((ancestor) => checked.has(ancestor))) {
      reachable.add(key);
    }
  }
  return enabledToggleableLeaves(reachable);
}

/** Tick or untick a node in the package form. */
export function toggleModuleCheck(
  checked: ReadonlySet<string>,
  key: string,
  on: boolean,
): Set<string> {
  const next = new Set(checked);
  if (!on) {
    // Its items keep their ticks, greyed out, for when it comes back.
    next.delete(key);
    return next;
  }
  next.add(key);
  // Switching on a section or group with nothing ticked in it ticks all of
  // it: an empty section would be the same as one switched off.
  const leaves = toggleableLeavesUnder(key);
  if (leaves.length > 0 && !leaves.some((leaf) => next.has(leaf))) {
    for (const descendant of moduleDescendants(key)) next.add(descendant);
  }
  return next;
}

/** Every node ticked, or none. */
export function allModuleChecks(on: boolean): Set<string> {
  return on ? new Set(ALL_MODULE_KEYS) : new Set();
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * `/api/v1/*` is a rewrite of `/api/*` (next.config.ts) and Next hands the
 * route the URL as requested, so the gate has to fold the version back out —
 * left in, no prefix matched and the mobile app was never refused anything.
 */
export function normalizeApiPath(pathname: string): string {
  return pathname.replace(/^\/api\/v1(?=\/|$)/, "/api");
}

function splitUrl(
  url: string,
  search?: URLSearchParams | string | null,
): { path: string; query: URLSearchParams } {
  const [rawPath, rawQuery = ""] = url.split("#", 1)[0].split("?");
  const path =
    rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const query =
    search instanceof URLSearchParams
      ? new URLSearchParams(search)
      : new URLSearchParams(search ?? rawQuery);
  return { path, query };
}

/** Prefix match on segment boundaries: "/api/tenants" never swallows
 * "/api/tenant/documents". */
function underPrefix(path: string, prefix: string): boolean {
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest === "" || rest.startsWith("/");
}

interface PagePattern {
  path: string;
  query: Array<[string, string]>;
  node: MenuNode;
}

const REPORT_BY_PAGE = new Map<string, (typeof REPORT_ENDPOINTS)[number]>(
  REPORT_ENDPOINTS.map((endpoint) => [endpoint.page, endpoint]),
);

function pagePattern(href: string, node: MenuNode): PagePattern {
  const { path, query } = splitUrl(href);
  const report = REPORT_BY_PAGE.get(path);
  if (report && !query.has("type")) query.set("type", report.defaultType);
  return { path, query: Array.from(query.entries()), node };
}

const PAGE_PATTERNS: PagePattern[] = [];
const API_PATTERNS: Array<{ prefix: string; node: MenuNode }> = [];

for (const key of ALL_MODULE_KEYS) {
  const entry = INDEX.get(key)!;
  const node = entry.node;
  if (!node) continue;
  for (const prefix of node.apis ?? []) API_PATTERNS.push({ prefix, node });
  // A group's href is only its first child's page: it owns none itself.
  if (entry.kind !== "leaf") continue;
  if (node.href) PAGE_PATTERNS.push(pagePattern(node.href, node));
  for (const page of node.pages ?? []) {
    PAGE_PATTERNS.push(pagePattern(page, node));
  }
  for (const report of node.reports ?? []) {
    for (const type of report.types) {
      PAGE_PATTERNS.push(pagePattern(`${report.endpoint}?type=${type}`, node));
    }
  }
}

/** The report types each report page knows, from the modules that own them. */
const KNOWN_REPORT_TYPES = new Map<string, Set<string>>(
  REPORT_ENDPOINTS.map((endpoint) => [
    endpoint.page,
    new Set(
      PAGE_PATTERNS.filter((pattern) => pattern.path === endpoint.page).flatMap(
        (pattern) =>
          pattern.query
            .filter(([name]) => name === "type")
            .map(([, value]) => value),
      ),
    ),
  ]),
);

/** A report page opens its default report for a missing or unknown type. */
function normalizeReportType(page: string, query: URLSearchParams): void {
  const report = REPORT_BY_PAGE.get(page);
  if (!report) return;
  const type = query.get("type");
  if (!type || !KNOWN_REPORT_TYPES.get(page)?.has(type)) {
    query.set("type", report.defaultType);
  }
}

function uniqueNodes(nodes: MenuNode[]): MenuNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.key)) return false;
    seen.add(node.key);
    return true;
  });
}

/** The page modules a set of URL query terms resolves to, best match only. */
function matchPagePatterns(path: string, query: URLSearchParams): MenuNode[] {
  let best: { pathLength: number; terms: number } | null = null;
  let owners: MenuNode[] = [];
  for (const pattern of PAGE_PATTERNS) {
    if (!underPrefix(path, pattern.path)) continue;
    if (!pattern.query.every(([name, value]) => query.get(name) === value)) {
      continue;
    }
    const score = { pathLength: pattern.path.length, terms: pattern.query.length };
    const better =
      !best ||
      score.pathLength > best.pathLength ||
      (score.pathLength === best.pathLength && score.terms > best.terms);
    const tie =
      best &&
      score.pathLength === best.pathLength &&
      score.terms === best.terms;
    if (better) {
      best = score;
      owners = [pattern.node];
    } else if (tie) {
      owners.push(pattern.node);
    }
  }
  return uniqueNodes(owners);
}

/**
 * The modules that own a dashboard URL, or null when none does. The longest
 * path wins, then the link that matches most of the query: on
 * "?type=occupancy&occupancy=vacant" that is Vacant units, not also the
 * occupancy report.
 */
export function pageModuleCandidates(
  url: string,
  search?: URLSearchParams | string | null,
): MenuNode[] | null {
  const { path, query } = splitUrl(url, search);
  normalizeReportType(path, query);
  const owners = matchPagePatterns(path, query);
  return owners.length > 0 ? owners : null;
}

/**
 * Whether the page's module depends on its query string, so the guard has
 * to read it (and so wait for it, under a Suspense boundary).
 */
export function pageNeedsQuery(url: string): boolean {
  const { path } = splitUrl(url);
  if (REPORT_BY_PAGE.has(path)) return true;
  return PAGE_PATTERNS.some(
    (pattern) => pattern.path === path && pattern.query.length > 0,
  );
}

/**
 * The modules that own an API request, or null when it is open on every
 * package. Report APIs are owned per `?type=`; everything else by the
 * longest declared prefix, shared by every module that declares it.
 */
export function apiModuleCandidates(
  url: string,
  search?: URLSearchParams | string | null,
): MenuNode[] | null {
  const split = splitUrl(url, search);
  const path = normalizeApiPath(split.path);
  const query = split.query;

  // The report endpoint itself; a route under it (".../analytics") is its
  // own API and goes by prefix like any other.
  const report = REPORT_ENDPOINTS.find((endpoint) => path === endpoint.api);
  if (report) {
    normalizeReportType(report.page, query);
    const type = query.get("type");
    const owners = uniqueNodes(
      PAGE_PATTERNS.filter(
        (pattern) =>
          pattern.path === report.page &&
          pattern.query.some(([name, value]) => name === "type" && value === type),
      ).map((pattern) => pattern.node),
    );
    if (owners.length > 0) return owners;
  }

  let bestLength = -1;
  let open = false;
  let owners: MenuNode[] = [];
  for (const prefix of OPEN_API_PREFIXES) {
    if (underPrefix(path, prefix) && prefix.length > bestLength) {
      bestLength = prefix.length;
      open = true;
      owners = [];
    }
  }
  for (const { prefix, node } of API_PATTERNS) {
    if (!underPrefix(path, prefix)) continue;
    if (prefix.length > bestLength) {
      bestLength = prefix.length;
      open = false;
      owners = [node];
    } else if (prefix.length === bestLength && !open) {
      owners.push(node);
    }
  }
  if (open || owners.length === 0) return null;
  return uniqueNodes(owners);
}

/** The module nodes a route's explicit `planFeature` stands for. */
export function moduleCandidatesForKey(key: string): MenuNode[] | null {
  if (key.includes(".")) {
    const node = INDEX.get(key)?.node;
    return node ? [node] : null;
  }
  const nodes = ALL_MODULE_KEYS.map((candidate) => INDEX.get(candidate)!)
    .filter((entry) => entry.node?.legacy?.includes(key))
    .map((entry) => entry.node!);
  return nodes.length > 0 ? nodes : null;
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

export interface ModuleDecision {
  /** False when no module owns the path: open on every package. */
  gated: boolean;
  allowed: boolean;
  /** The module to name in an upgrade message when refused. */
  blockedKey: string | null;
  /** Refused only because the platform switched the module off. */
  platformOff: boolean;
  /** The answer may change once the reader's role is known. */
  needsRole: boolean;
}

export interface DecideOptions {
  /**
   * Whether a module is meant for this reader (their role and rights). When
   * some owners are, only those count: a staff member is not let into the
   * contracts list because the tenant's "My leases" is on. Leave it out when
   * the reader is not known yet.
   */
  applies?: (node: MenuNode) => boolean;
  /** Whether a module is off because of a platform switch. */
  isPlatformOff?: (key: string) => boolean;
}

/** The section a key sits in, or null outside the sections. */
function sectionOf(key: string): string | null {
  const top = [key, ...moduleAncestors(key)].pop()!;
  return INDEX.get(top)?.kind === "section" ? top : null;
}

/**
 * The module an upgrade message names: the whole section when it is the
 * section that is off ("Maintenance is not on your plan"), otherwise the
 * entry itself ("Payment report").
 */
function blockedModuleKey(
  considered: readonly MenuNode[],
  isEnabled: (key: string) => boolean,
): string {
  const sections = new Set(considered.map((node) => sectionOf(node.key)));
  if (sections.size === 1) {
    const [section] = sections;
    if (section && !isEnabled(section)) return section;
  }
  return considered[0].key;
}

/** Whether a reader may open what these modules own. */
export function decideModuleAccess(
  candidates: readonly MenuNode[] | null,
  isEnabled: (key: string) => boolean,
  options: DecideOptions = {},
): ModuleDecision {
  if (!candidates || candidates.length === 0) {
    return {
      gated: false,
      allowed: true,
      blockedKey: null,
      platformOff: false,
      needsRole: false,
    };
  }
  // An always-on owner (the dashboard's own page, the employees list) keeps
  // the page open whatever else claims it.
  if (candidates.some((node) => node.alwaysOn)) {
    return {
      gated: true,
      allowed: true,
      blockedKey: null,
      platformOff: false,
      needsRole: false,
    };
  }

  let considered = candidates;
  if (options.applies) {
    const forReader = candidates.filter(options.applies);
    if (forReader.length > 0) considered = forReader;
  }

  const enabled = considered.filter((node) => isEnabled(node.key));
  const allowed = enabled.length > 0;
  const mixed =
    candidates.some((node) => isEnabled(node.key)) &&
    candidates.some((node) => !isEnabled(node.key));
  return {
    gated: true,
    allowed,
    blockedKey: allowed ? null : blockedModuleKey(considered, isEnabled),
    platformOff:
      !allowed &&
      Boolean(options.isPlatformOff) &&
      considered.every((node) => options.isPlatformOff!(node.key)),
    needsRole: !options.applies && mixed,
  };
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface ModuleSummaryRow {
  key: string;
  title: string;
  label: string;
  /** Toggleable leaves switched on. */
  enabled: number;
  /** Toggleable leaves in all. */
  total: number;
}

/**
 * Per top-level entry, how many of its modules a set of enabled keys holds —
 * for the package cards and anything else that lists a package briefly.
 */
export function summarizeModules(
  enabled: ReadonlySet<string>,
): ModuleSummaryRow[] {
  return ROOTS.map((key) => {
    const entry = INDEX.get(key)!;
    const leaves = toggleableLeavesUnder(key);
    return {
      key,
      title: entry.title,
      label: entry.label,
      enabled: leaves.filter((leaf) => enabled.has(leaf)).length,
      total: leaves.length,
    };
  }).filter((row) => row.total > 0);
}
