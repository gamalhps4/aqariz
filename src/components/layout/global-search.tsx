"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useModuleAccess } from "@/components/layout/module-access";
import { NAV_SECTIONS, type MenuNode } from "@/lib/navigation/menu-config";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

interface SearchRoute {
  key: string;
  /** A navigation key — the same label the sidebar shows, in any language. */
  label: string;
  fallback: string;
  /** The group the entry sits in, for context ("Reports › Renewed …"). */
  parent?: { label: string; fallback: string };
  href: string;
}

interface SearchGroup {
  key: string;
  heading?: string;
  fallback?: string;
  items: SearchRoute[];
}

/**
 * Every menu entry under a node, with the group it sits in. Groups are not
 * checked themselves, as in the sidebar: a group shows when an entry under it
 * does (Notifications keeps the Inbox group whatever else is switched off).
 */
function routesUnder(
  node: MenuNode,
  isVisible: (node: MenuNode) => boolean,
  parent?: MenuNode,
): SearchRoute[] {
  if (node.hidden) return [];
  if (node.children && node.children.length > 0) {
    return node.children.flatMap((child) => routesUnder(child, isVisible, node));
  }
  if (!isVisible(node)) return [];
  return [
    {
      key: node.key,
      label: node.title,
      fallback: node.label,
      parent: parent ? { label: parent.title, fallback: parent.label } : undefined,
      href: node.href,
    },
  ];
}

/**
 * Where ⌘K can take you: the sidebar's own entries, in its order and words,
 * with the same rule deciding what is listed — the package, the role and a
 * permission group's rights (components/layout/module-access). It used to be
 * a list of its own that offered screens the package did not include.
 */
function useSearchGroups(): SearchGroup[] {
  const { canSeeItem } = useModuleAccess();
  return useMemo(
    () =>
      NAV_SECTIONS.map((section, index) => ({
        key: section.key ?? `entries-${index}`,
        heading: section.title,
        fallback: section.label,
        items: section.items.flatMap((item) => routesUnder(item, canSeeItem)),
      })).filter((group) => group.items.length > 0),
    [canSeeItem],
  );
}

interface GlobalSearchProps {
  className?: string;
}

export function GlobalSearch({ className }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { t } = useLocalizationContext();
  const searchGroups = useSearchGroups();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSelect = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const routeLabel = (route: SearchRoute) => {
    const own = t(route.label, { defaultValue: route.fallback });
    return route.parent
      ? `${t(route.parent.label, { defaultValue: route.parent.fallback })} › ${own}`
      : own;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full border border-border/60 bg-muted/80 ps-3 pe-1.5 text-foreground shadow-sm transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-border/70 dark:bg-muted/70 dark:hover:bg-accent/70",
          className
        )}
        aria-label={t("common.search.open", { defaultValue: "Open search" })}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <kbd className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm dark:bg-background/80">
          <span>⌘</span>
          <span>K</span>
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder={t("common.search.placeholder", { defaultValue: "Go to…" })}
        />
        <CommandList className="max-h-[420px]">
          <CommandEmpty>
            {t("common.search.empty", { defaultValue: "Nothing matches" })}
          </CommandEmpty>
          {searchGroups.map((group, idx) => (
            <div key={group.key}>
              {idx > 0 && <CommandSeparator />}
              <CommandGroup
                heading={
                  group.heading
                    ? t(group.heading, { defaultValue: group.fallback })
                    : undefined
                }
              >
                {group.items.map((item) => (
                  <CommandItem
                    key={item.key}
                    // Matched in the reader's language and in English, so a
                    // search typed either way finds the screen.
                    value={`${routeLabel(item)} ${item.parent?.fallback ?? ""} ${item.fallback} ${item.href}`}
                    onSelect={() => handleSelect(item.href)}
                    className="flex items-center justify-between gap-3 px-3 py-3 cursor-pointer hover:bg-accent/60"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold text-foreground truncate">
                        {routeLabel(item)}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {item.href}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
