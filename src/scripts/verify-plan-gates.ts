/**
 * Prints which modules own each API route, and which routes stay reachable on
 * every package.
 *
 * `pnpm verify:plan-gates`
 *
 * The gate is an allowlist keyed on path prefixes (the menu tree's `apis`), so
 * the failure mode worth catching is a prefix that swallows more than it
 * should — billing, auth or the always-on screens ending up behind a paywall
 * would lock an organization out of the screens it needs to fix its own
 * subscription.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_MODULE_KEYS,
  apiModuleCandidates,
  moduleEntry,
} from "@/lib/billing/modules";

/** Paths that must never be refused for want of a module. */
const MUST_STAY_OPEN = [
  "/api/billing/checkout",
  "/api/billing/portal",
  "/api/billing/entitlements",
  "/api/billing/subscription",
  "/api/auth/x",
  "/api/user/profile",
  "/api/user/export-data",
  "/api/settings/profile",
  "/api/settings/display",
  "/api/notifications",
  "/api/sidebar/counts",
  "/api/dashboard/overview",
  "/api/tenant/dashboard",
  "/api/tenant/notifications",
  "/api/users",
  "/api/roles/names",
  "/api/organization/delete",
  "/api/health",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function toUrlPath(file: string, appDir: string): string {
  return file
    .replace(appDir, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\/\([^)]+\)/g, "")
    .replace(/\[\.\.\.[^\]]+\]/g, "x")
    .replace(/\[[^\]]+\]/g, "x");
}

/** Open when no module owns it, or an always-on module does. */
function isOpen(path: string): boolean {
  const owners = apiModuleCandidates(path);
  return !owners || owners.some((owner) => owner.alwaysOn);
}

const appDir = join(process.cwd(), "src/app");
const routes = walk(join(appDir, "api")).map((f) => toUrlPath(f, appDir)).sort();

const byModule = new Map<string, string[]>(ALL_MODULE_KEYS.map((key) => [key, []]));
const open: string[] = [];

for (const route of routes) {
  const owners = apiModuleCandidates(route);
  if (!owners || owners.some((owner) => owner.alwaysOn)) {
    open.push(route);
    continue;
  }
  for (const owner of owners) byModule.get(owner.key)?.push(route);
}

console.log("=== GATED: 402 when every module owning the route is off ===");
for (const [key, paths] of byModule) {
  if (paths.length === 0) continue;
  console.log(`\n  ${key} (${paths.length})`);
  for (const p of paths) console.log(`      ${p}`);
}

console.log(`\n\n=== OPEN: reachable on every package (${open.length}) ===`);
for (const p of open) console.log(`      ${p}`);

const leaked = MUST_STAY_OPEN.filter((p) => !isOpen(p));
console.log("\n\n=== SAFETY CHECK ===");
if (leaked.length === 0) {
  console.log(`  OK - all ${MUST_STAY_OPEN.length} always-open paths are open.`);
} else {
  console.log("  FAIL - these must never be plan-gated:");
  for (const p of leaked) {
    console.log(
      `      ${p} -> ${(apiModuleCandidates(p) ?? []).map((n) => n.key).join(" | ")}`,
    );
  }
  process.exitCode = 1;
}

// A module's declared API prefix that matches no route gates nothing.
const declared = ALL_MODULE_KEYS.flatMap((key) =>
  (moduleEntry(key)?.node?.apis ?? []).map((prefix) => ({ key, prefix })),
);
const dead = declared.filter(
  ({ prefix }) =>
    !routes.some((route) => route === prefix || route.startsWith(`${prefix}/`)),
);
if (dead.length > 0) {
  // A warning, not a failure: a prefix can be declared ahead of its route.
  console.log("\n  WARNING - declared API prefixes matching no route:");
  for (const { key, prefix } of dead) console.log(`      ${key}: ${prefix}`);
}
