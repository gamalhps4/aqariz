/**
 * Prints which module each menu destination belongs to, as the page guard
 * resolves it — the config's own key should be among the owners of its href.
 *
 * `pnpm verify:plan-nav`
 */

import { NAV_SECTIONS, type MenuNode } from "@/lib/navigation/menu-config";
import { pageModuleCandidates } from "@/lib/billing/modules";

let mismatches = 0;

function walk(node: MenuNode, depth: number): void {
  const owners = (pageModuleCandidates(node.href) ?? []).map((owner) => owner.key);
  const isLeaf = !node.children || node.children.length === 0;
  const flag = isLeaf && node.href && !owners.includes(node.key) ? "  <-- MISMATCH" : "";
  if (flag) mismatches += 1;
  console.log(
    `${"  ".repeat(depth)}${node.key}${node.hidden ? " (hidden)" : ""}${node.alwaysOn ? " (always on)" : ""}` +
      `\n${"  ".repeat(depth)}    ${node.href || "(no page)"} -> ${owners.join(" | ") || "(open)"}${flag}`,
  );
  for (const child of node.children ?? []) walk(child, depth + 1);
}

for (const section of NAV_SECTIONS) {
  console.log(`\n${section.key ?? "(untitled)"}`);
  for (const item of section.items) walk(item, 1);
}

if (mismatches > 0) {
  console.log(`\nFAIL - ${mismatches} entr(ies) whose page resolves to another module.`);
  process.exitCode = 1;
} else {
  console.log("\nOK - every entry's page resolves to its own module.");
}
