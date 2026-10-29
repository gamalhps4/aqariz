"use client";

/**
 * PropertyPro - The module tree the Super Admin builds a package from
 *
 * The menu's own tree (lib/navigation/menu-config.ts): sections, the items in
 * them and the reports under those, plus the capabilities that are not menu
 * entries. Two modes:
 *
 *   "plan"     — what one package includes. A section's switch takes its
 *                items with it: off, they are greyed out and cannot be ticked,
 *                and they come back as they were when it is switched on again.
 *   "platform" — what is switched off for every package at once.
 *
 * Always-on modules (dashboard, notifications, profile and security, display
 * and branding, billing, the employees list) are shown locked on in both.
 */

import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  effectiveModuleLeaves,
  moduleAncestors,
  moduleEntry,
  moduleRootKeys,
  toggleModuleCheck,
  toggleableLeavesUnder,
  type ModuleEntry,
} from "@/lib/billing/modules";

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

interface ModuleTreeProps {
  mode: "plan" | "platform";
  /** Plan mode: the ticked nodes. Platform mode: the switched-off nodes. */
  value: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Plan mode: what the platform has switched off, flagged on the rows. */
  platformOff?: ReadonlySet<string>;
  disabled?: boolean;
}

export function ModuleTree({
  mode,
  value,
  onChange,
  platformOff,
  disabled = false,
}: ModuleTreeProps) {
  const { t } = useLocalizationContext();
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const roots = moduleRootKeys().map((key) => moduleEntry(key)!);
  const menuRoots = roots.filter((entry) => !entry.capability);
  const capabilityRoots = roots.filter((entry) => entry.capability);

  /** On for this row: ticked (plan) or not switched off (platform). */
  const isOn = (entry: ModuleEntry) =>
    entry.alwaysOn ||
    (mode === "plan" ? value.has(entry.key) : !value.has(entry.key));

  /** Greyed out because something above it is off. */
  const isLockedByParent = (entry: ModuleEntry) =>
    moduleAncestors(entry.key).some((ancestor) =>
      mode === "plan" ? !value.has(ancestor) : value.has(ancestor),
    );

  const setOn = (entry: ModuleEntry, on: boolean) => {
    if (entry.alwaysOn) return;
    if (mode === "plan") {
      onChange(toggleModuleCheck(value, entry.key, on));
    } else {
      const next = new Set(value);
      if (on) next.delete(entry.key);
      else next.add(entry.key);
      onChange(next);
    }
  };

  const label = (entry: ModuleEntry) =>
    t(entry.title, { defaultValue: entry.label });

  /** "4 of 9" for a section or group, counted on what would really open. */
  const countFor = (entry: ModuleEntry) => {
    const leaves = toggleableLeavesUnder(entry.key);
    if (leaves.length === 0) return null;
    const on =
      mode === "plan"
        ? effectiveModuleLeaves(value).filter((leaf) => leaves.includes(leaf))
            .length
        : leaves.filter(
            (leaf) =>
              !value.has(leaf) &&
              !moduleAncestors(leaf).some((ancestor) => value.has(ancestor)),
          ).length;
    return t("platform.planForm.modules.count", {
      defaultValue: "{enabled} of {total}",
      values: { enabled: on, total: leaves.length },
    });
  };

  const toggleOpen = (key: string) =>
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderBadges = (entry: ModuleEntry) => (
    <>
      {entry.alwaysOn && (
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-px text-[10px] font-normal text-muted-foreground">
          <Lock className="size-2.5" />
          {t("platform.planForm.modules.alwaysOn", { defaultValue: "Always on" })}
        </span>
      )}
      {entry.hidden && !entry.capability && (
        <span className="rounded bg-muted px-1.5 py-px text-[10px] font-normal text-muted-foreground">
          {t("platform.planForm.modules.notInMenu", {
            defaultValue: "Reached from its page",
          })}
        </span>
      )}
      {mode === "plan" && platformOff?.has(entry.key) && !entry.alwaysOn && (
        <span className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-normal text-amber-700 dark:text-amber-400">
          {t("platform.planForm.modules.platformOff", {
            defaultValue: "Off platform-wide",
          })}
        </span>
      )}
    </>
  );

  const renderNode = (entry: ModuleEntry, depth: number): React.ReactNode => {
    const locked = disabled || entry.alwaysOn || isLockedByParent(entry);
    const on = isOn(entry);
    const children = entry.children.map((key) => moduleEntry(key)!);
    const hasChildren = children.length > 0;
    const open = openKeys.has(entry.key);
    const id = `module-${mode}-${entry.key}`;

    return (
      <div key={entry.key}>
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-md py-1.5 pe-2",
            isLockedByParent(entry) && "opacity-50",
          )}
          style={{ paddingInlineStart: `${depth * 1.25 + 0.5}rem` }}
        >
          {mode === "plan" ? (
            <Checkbox
              id={id}
              checked={on}
              disabled={locked}
              onCheckedChange={(checked) => setOn(entry, checked === true)}
            />
          ) : (
            <Switch
              id={id}
              checked={on}
              disabled={locked}
              onCheckedChange={(checked) => setOn(entry, checked)}
            />
          )}
          <label
            htmlFor={id}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm"
          >
            <span className="truncate">{label(entry)}</span>
            {renderBadges(entry)}
          </label>
          {hasChildren && (
            <>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {countFor(entry)}
              </span>
              <button
                type="button"
                onClick={() => toggleOpen(entry.key)}
                aria-expanded={open}
                aria-label={
                  open
                    ? t("platform.planForm.modules.collapse", {
                        defaultValue: "Hide the items",
                      })
                    : t("platform.planForm.modules.expand", {
                        defaultValue: "Show the items",
                      })
                }
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform",
                    open ? "rotate-180" : "",
                  )}
                />
              </button>
            </>
          )}
        </div>
        {hasChildren && open && (
          <div>{children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="divide-y rounded-lg border">
        {menuRoots.map((entry) => (
          <div key={entry.key} className="px-1 py-1">
            {renderNode(entry, 0)}
          </div>
        ))}
      </div>
      {capabilityRoots.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t("platform.planForm.modules.capabilities", {
              defaultValue: "Other capabilities",
            })}
          </p>
          <div className="divide-y rounded-lg border">
            {capabilityRoots.map((entry) => (
              <div key={entry.key} className="px-1 py-1">
                {renderNode(entry, 0)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
