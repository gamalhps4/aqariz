/**
 * PropertyPro - Sidebar Navigation
 * Role-based navigation sidebar for the dashboard
 */

"use client";

import Link from "next/link";
import Image from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserMenu } from "@/components/layout/user-menu";
import { useUserAvatar } from "@/components/providers/UserAvatarProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Ban,
  BarChart3,
  Bell,
  Briefcase,
  Building,
  Building2,
  Calculator,
  Calendar,
  CalendarClock,
  CalendarX,
  ChevronRight,
  ClipboardCheck,
  Clock,
  CreditCard,
  DoorOpen,
  Download,
  FileBarChart,
  FilePlus,
  FileSignature,
  FileText,
  FileUp,
  Grid3X3,
  HandCoins,
  Handshake,
  Home,
  Inbox,
  KeyRound,
  Mail,
  Megaphone,
  MessageSquare,
  MessageSquareHeart,
  Palette,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Tags,
  TicketCheck,
  TrendingDown,
  TrendingUp,
  User,
  UserCog,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useSidebarCounts, type SidebarCounts } from "@/hooks/useSidebarCounts";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { canAccessNavItem } from "@/lib/role-utils";
import { useOwnRoleName } from "@/hooks/useGroupNames";
import { useModuleAccess } from "@/components/layout/module-access";
import {
  NAV_SECTIONS,
  type MenuIconName,
  type MenuNode,
} from "@/lib/navigation/menu-config";

type IconComponent = React.ComponentType<{ className?: string }>;

/** The menu config names its icons; this is where the names become icons. */
const MENU_ICONS: Record<MenuIconName, IconComponent> = {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Ban,
  BarChart3,
  Bell,
  Briefcase,
  Building,
  Building2,
  Calculator,
  Calendar,
  CalendarClock,
  CalendarX,
  ClipboardCheck,
  Clock,
  CreditCard,
  DoorOpen,
  Download,
  FileBarChart,
  FilePlus,
  FileSignature,
  FileText,
  FileUp,
  Grid3X3,
  HandCoins,
  Handshake,
  Home,
  Inbox,
  KeyRound,
  Mail,
  Megaphone,
  MessageSquare,
  MessageSquareHeart,
  Palette,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Tags,
  TicketCheck,
  TrendingDown,
  TrendingUp,
  User,
  UserCog,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  Wrench,
};

interface NavItem {
  /** The module key — what the package gates. */
  key: string;
  title: string;
  href: string;
  icon: IconComponent;
  badge?: string;
  countKey?: keyof SidebarCounts;
  /** The config entry, for the role and permission check. */
  node: MenuNode;
  children?: NavItem[];
}

interface NavSection {
  title?: string;
  /** The section's tile on the collapsed rail, and its header when open. */
  icon?: IconComponent;
  items: NavItem[];
}

function toNavItem(node: MenuNode): NavItem | null {
  // A module that is not a menu entry (a report reached from its page).
  if (node.hidden) return null;
  const children = (node.children ?? [])
    .map(toNavItem)
    .filter((child): child is NavItem => child !== null);
  return {
    key: node.key,
    title: node.title,
    href: node.href,
    icon: MENU_ICONS[node.icon],
    countKey: node.countKey,
    node,
    children: children.length > 0 ? children : undefined,
  };
}

/**
 * The menu, from the shared config (lib/navigation/menu-config.ts) — the same
 * tree the ⌘K palette, the page guard and the Super Admin's package form read.
 * The structure, order and wording follow the client review; the reasons for
 * each entry are recorded there.
 */
const navigationSections: NavSection[] = NAV_SECTIONS.map((section) => ({
  title: section.title,
  icon: section.icon ? MENU_ICONS[section.icon] : undefined,
  items: section.items
    .map(toNavItem)
    .filter((item): item is NavItem => item !== null),
}));

interface SidebarProps {
  className?: string;
  isCollapsed?: boolean;
}

export function Sidebar({ className, isCollapsed = false }: SidebarProps) {
  /**
   * The reader's own open/close choices, remembered for the page they were
   * made on (see toggleExpanded and toggleSection). Navigating resets both
   * to the path of the page itself.
   */
  const [expandedChoice, setExpandedChoice] = useState<{
    at: string;
    items: Record<number, string>;
  } | null>(null);
  const [sectionChoice, setSectionChoice] = useState<{
    at: string;
    open: string | null;
  } | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A flyout opened from the keyboard takes focus; one opened by hover leaves it. */
  const flyoutByKeyboardRef = useRef(false);

  const openFlyout = useCallback((href: string) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHoveredItem(href);
  }, []);

  const scheduleCloseFlyout = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setHoveredItem(null), 120);
  }, []);

  const closeFlyout = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHoveredItem(null);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  /** The page as the menu sees it: path and query. */
  const location = `${pathname}?${search}`;
  const { avatarUrl } = useUserAvatar();

  const { data: session } = useSession();
  const { resolvedTheme } = useTheme();
  const { t, isRTL } = useLocalizationContext();
  // Branding (logo/favicon) + nav color come from the global SettingsProvider.
  const { settings } = useSettings();
  const branding = settings.branding;
  const navColor = settings.navColor ?? "integrate";

  // Get dynamic sidebar counts
  const { counts } = useSidebarCounts({
    refreshInterval: 30000, // Refresh every 30 seconds
    enabled: !!session?.user, // Only fetch when user is logged in
  });

  const userRole = session?.user?.role;
  const ownRoleName = useOwnRoleName();
  // Package, role and rights together — the same answer the ⌘K palette, the
  // page guard and the dashboards use (components/layout/module-access).
  const moduleAccess = useModuleAccess();
  const { planIncludes, profile: accessProfile } = moduleAccess;

  const canAccessItem = useCallback(
    (item: NavItem): boolean => {
      if (!userRole) {
        return false;
      }

      // The package, checked before any role logic: a module the
      // subscription does not include is not "denied", it is not bought, and
      // showing it only to 402 on click is what this replaces. Every entry
      // carries its module key in the menu config.
      //
      // Only leaves are checked. A group is on when any entry under it is —
      // a group switched off takes its entries with it already, since the
      // package resolves the tree — and a group with nothing left to show is
      // dropped by the caller.
      if (
        (!item.children || item.children.length === 0) &&
        !planIncludes(item.key)
      ) {
        return false;
      }

      // A built-in role goes by the roles the item lists; a permission group
      // by what it has been ticked. A group is staff, so it never sees a
      // tenant-only item (like "My Leases") whatever permissions overlap, and
      // it reaches an Administrator's item through the permission that names
      // it rather than by ranking as one.
      return canAccessNavItem(accessProfile, item.node);
    },
    [accessProfile, userRole, planIncludes],
  );

  const getVisibleChildren = useCallback(
    (children?: NavItem[]): NavItem[] =>
      (children ?? []).filter((child) => canAccessItem(child)),
    [canAccessItem],
  );

  /**
   * Open one group at a time, per level.
   *
   * The menu used to leave every group the reader had ever opened expanded
   * behind them, so a few clicks turned the sidebar into a wall and the item
   * they wanted scrolled off the bottom. The review asks for the opposite:
   * opening a group closes the one that was open beside it.
   *
   * Tracked by level rather than by sibling set, which is the same thing in
   * practice — only one parent is open, so only one level-one set is ever on
   * screen — and avoids threading a parent reference through the recursion
   * for no gain.
   */
  const toggleExpanded = (href: string, level: number) => {
    setExpandedChoice(() => {
      const next = { ...expandedItems };
      if (next[level] === href) {
        delete next[level];
        // Closing a group closes anything opened inside it; leaving those
        // behind would reopen a stale sub-group the next time the parent is
        // expanded.
        for (const key of Object.keys(next)) {
          if (Number(key) > level) delete next[Number(key)];
        }
      } else {
        next[level] = href;
        for (const key of Object.keys(next)) {
          if (Number(key) > level) delete next[Number(key)];
        }
      }
      return { at: location, items: next };
    });
  };

  /**
   * Open one section at a time.
   *
   * The review lays the menu out as top-level dropdowns — "Leasing ▾",
   * "Collections ▾", "Properties ▾" — and asks that opening one close the
   * one already open. The sections used to be fixed headings with every
   * entry listed under them, so the whole menu was always on screen.
   */
  const toggleSection = (key: string) => {
    setSectionChoice({
      at: location,
      open: openSection === key ? null : key,
    });
  };

  // Function to get dynamic badge for navigation items
  const formatCountBadge = (count?: number): string | undefined =>
    (count ?? 0) > 0 ? String(count) : undefined;

  // Each entry names its badge in the menu config; the counts API leaves out
  // the modules the package does not include.
  const getDynamicBadge = (item: NavItem): string | undefined =>
    item.countKey ? formatCountBadge(counts?.[item.countKey]) : undefined;

  // Update navigation sections with dynamic badges
  const updateItemWithDynamicBadge = (item: NavItem): NavItem => {
    const dynamicBadge = getDynamicBadge(item);
    const updatedItem = {
      ...item,
      badge: dynamicBadge ?? item.badge, // Use dynamic badge when available; preserve explicit empty string values
      children: item.children?.map(updateItemWithDynamicBadge),
    };
    return updatedItem;
  };

  /**
   * What a closed group or section is holding back. An entry's own count
   * already stands for everything under it — Inbox is its messages,
   * notifications, announcements and tickets together — so children are
   * added up only when the entry has none. A closed section used to hide the
   * Emergencies and Inbox counts altogether.
   */
  const pendingCount = (items: NavItem[]): number =>
    items.reduce(
      (sum, item) =>
        sum +
        (item.badge
          ? Number(item.badge) || 0
          : pendingCount(getVisibleChildren(item.children))),
      0,
    );
  const pendingBadge = (items: NavItem[]): string | undefined =>
    formatCountBadge(pendingCount(items));

  /** Every link in the menu, to tell a plain path from a more specific one. */
  const allHrefs = useMemo(() => {
    const out: string[] = [];
    const walk = (items: NavItem[]) =>
      items.forEach((item) => {
        out.push(item.href);
        if (item.children) walk(item.children);
      });
    navigationSections.forEach((section) => walk(section.items));
    return out;
  }, []);

  /**
   * Whether a link points at the page being shown.
   *
   * The reports are one page each with the report in the query —
   * "/dashboard/leases/reports?type=renewed" — and comparing only the path
   * never matched them, so no report entry was ever highlighted or opened its
   * group. A link matches when the page carries everything in its query, and
   * only the most specific of the links that match is the page: on
   * "?type=occupancy&occupancy=vacant" that is "Vacant units", not also
   * "Occupancy report".
   */
  const isAtHref = useCallback(
    (href: string): boolean => {
      /** How many query terms a link matches the page on, or null. */
      const specificity = (link: string): number | null => {
        const [path, query] = link.split("?");
        if (path !== pathname) return null;
        const wanted = new URLSearchParams(query ?? "");
        let terms = 0;
        for (const [key, value] of wanted) {
          if (searchParams?.get(key) !== value) return null;
          terms += 1;
        }
        return terms;
      };
      const own = specificity(href);
      if (own === null) return false;
      return !allHrefs.some(
        (other) => other !== href && (specificity(other) ?? -1) > own,
      );
    },
    [allHrefs, pathname, searchParams],
  );

  /** Whether the page being shown is somewhere under this entry. */
  const containsActive = (item: NavItem): boolean =>
    isAtHref(item.href) ||
    (item.children ?? []).some((child) => containsActive(child));

  const filteredSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => {
          if (!canAccessItem(item)) {
            return false;
          }

          if (!item.children || item.children.length === 0) {
            return true;
          }

          return getVisibleChildren(item.children).length > 0;
        })
        .map(updateItemWithDynamicBadge),
    }))
    .filter((section) => section.items.length > 0);

  // Nothing is drawn until everything that decides the menu is known: the
  // role, a custom role's permissions, and what the plan includes. It used to
  // draw what the role alone allowed and then drop what the plan or the
  // permission group did not, so the menu shrank a few seconds into every page
  // load — "Collections" appeared and then went.
  const navReady = Boolean(userRole) && moduleAccess.ready;

  // Where the page being shown sits in the menu: its section, and the group
  // it is under at each level. That is what is open until the reader chooses
  // otherwise.
  const activeSection =
    filteredSections.find(
      (section) =>
        section.title &&
        section.items.some((item) => containsActive(item)),
    )?.title ?? null;
  const activeChain: Record<number, string> = {};
  const markChain = (items: NavItem[], level: number) => {
    for (const item of items) {
      const children = getVisibleChildren(item.children);
      if (children.length > 0 && children.some((child) => containsActive(child))) {
        activeChain[level] = item.href;
        markChain(children, level + 1);
        return;
      }
    }
  };
  filteredSections.forEach((section) => markChain(section.items, 0));

  const openSection =
    sectionChoice && sectionChoice.at === location
      ? sectionChoice.open
      : activeSection;
  const expandedItems =
    expandedChoice && expandedChoice.at === location
      ? expandedChoice.items
      : activeChain;

  /**
   * A tile on the collapsed rail that opens a panel beside it: a section and
   * its entries. The panel draws them with the same rows as the open sidebar
   * (renderNavItem), so both modes show one menu. The rail used to spill every
   * section's entries onto itself instead — thirty-odd tiles, two identical
   * "Reports", and none of the dropdowns the client review set out.
   */
  const renderFlyout = ({
    key,
    icon: Icon,
    label,
    active,
    badge,
    content,
  }: {
    key: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    active: boolean;
    badge?: string;
    content: React.ReactNode;
  }) => {
    const isOpen = hoveredItem === key;
    return (
      <Popover
        key={key}
        open={isOpen}
        // Escape, a click elsewhere, or focus moving away closes the panel.
        onOpenChange={(open) => {
          if (!open) closeFlyout();
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(event) => {
              // A click only ever opens the panel, as hovering does; the
              // trigger's own toggle would shut one the pointer just opened.
              event.preventDefault();
              flyoutByKeyboardRef.current = event.detail === 0;
              openFlyout(key);
            }}
            onMouseEnter={() => {
              flyoutByKeyboardRef.current = false;
              openFlyout(key);
            }}
            onMouseLeave={scheduleCloseFlyout}
            className={cn(
              "relative flex w-full flex-col items-center justify-center gap-1.5 px-1 py-3 rounded-lg transition-colors",
              navColor === "apparent"
                ? "hover:bg-white/12"
                : "hover:bg-sidebar-accent/60",
              isOpen &&
                !active &&
                (navColor === "apparent" ? "bg-white/12" : "bg-sidebar-accent/60"),
              active &&
                (navColor === "apparent"
                  ? "bg-white/18"
                  : "bg-primary/10 text-primary"),
            )}
          >
            <Icon
              className={cn(
                "h-5.5 w-5.5 stroke-[2.35] transition-colors",
                active ? "text-primary" : "text-gray-600 dark:text-gray-400",
              )}
            />
            <span
              className={cn(
                "text-[10px] font-medium leading-tight text-center w-full px-0.5 wrap-break-word",
                active ? "text-primary" : "text-gray-700 dark:text-gray-300",
              )}
            >
              {label}
            </span>
            <ChevronRight
              className={cn(
                "absolute inset-e-1 top-1/2 -translate-y-1/2 h-3.5 w-3.5 transition-colors rtl:rotate-180",
                active ? "text-primary" : "text-gray-400 dark:text-gray-500",
              )}
            />
            {badge && (
              <span className="absolute top-1 inset-e-1 inline-flex items-center justify-center min-w-4 h-4 px-1 text-[9px] font-semibold bg-primary text-primary-foreground rounded-full">
                {badge}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side={isRTL ? "left" : "right"}
          align="start"
          // Measured from the tile, which sits inside the rail's 12px padding:
          // 20px clears the rail's edge by 8.
          sideOffset={20}
          collisionPadding={8}
          className="w-64 max-h-(--radix-popover-content-available-height) overflow-y-auto p-2"
          onMouseEnter={() => openFlyout(key)}
          onMouseLeave={scheduleCloseFlyout}
          onOpenAutoFocus={(event) => {
            if (!flyoutByKeyboardRef.current) event.preventDefault();
          }}
          // Closing a hover-opened panel used to move focus onto its tile,
          // leaving a focus ring on whichever tile was hovered last.
          onCloseAutoFocus={(event) => {
            if (!flyoutByKeyboardRef.current) event.preventDefault();
          }}
        >
          <div className="px-3 py-2 border-b border-border/60 mb-1">
            <p className="text-xs font-semibold text-foreground">{label}</p>
          </div>
          <div className="space-y-0.5">{content}</div>
        </PopoverContent>
      </Popover>
    );
  };

  const renderNavItem = (
    item: NavItem,
    level = 0,
    isLastChild = false,
    inFlyout = false,
  ): React.ReactNode => {
    // The collapsed rail draws its top level as tiles. A flyout beside it
    // draws rows as the open sidebar does, on the popover's own surface — the
    // sidebar's "apparent" colours would be white on white there.
    const onRail = isCollapsed && !inFlyout;
    const palette = inFlyout ? "integrate" : navColor;
    const isActive = isAtHref(item.href);
    const filteredChildren = getVisibleChildren(item.children);
    const hasChildren = filteredChildren.length > 0;
    const isSubItem = level > 0;

    // Check if any child is active (for parent highlighting)
    const hasActiveChild =
      hasChildren && filteredChildren.some((child) => containsActive(child));
    const isParentActive = hasActiveChild && level === 0;
    const isChildActive = isActive && level > 0;

    // The group holding the page starts open (see activeChain), but the
    // reader can close it, and opening a sibling closes it — it used to be
    // pinned open, so two groups stayed open side by side.
    const isExpanded = expandedItems[level] === item.href;
    // A closed group shows what its entries are counting.
    const shownBadge =
      item.badge ??
      (hasChildren && !isExpanded ? pendingBadge(filteredChildren) : undefined);

    // Collapsed top-level rendering: vertical icon+label tile
    if (onRail && level === 0) {
      if (hasChildren) {
        return renderFlyout({
          key: item.href,
          icon: item.icon,
          label: t(item.title),
          active: isParentActive,
          badge: shownBadge,
          content: filteredChildren.map((child, index) =>
            renderNavItem(child, 1, index === filteredChildren.length - 1, true),
          ),
        });
      }

      return (
        <div key={item.key}>
          <Link
            href={item.href}
            data-sidebar-item="root"
            data-active={isActive ? "true" : undefined}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1.5 px-1 py-3 rounded-lg transition-colors group",
              "hover:bg-sidebar-accent/60",
              isActive && "bg-primary/10 text-primary",
            )}
          >
            <item.icon
              className={cn(
                "h-5.5 w-5.5 stroke-[2.35] transition-colors",
                isActive ? "text-primary" : "text-gray-600 dark:text-gray-400",
              )}
            />
            <span
              className={cn(
                "text-[10px] font-medium leading-tight text-center w-full px-0.5 wrap-break-word",
                isActive ? "text-primary" : "text-gray-700 dark:text-gray-300",
              )}
            >
              {t(item.title)}
            </span>
            {item.badge && (
              <span className="absolute top-1 inset-e-1 inline-flex items-center justify-center min-w-4 h-4 px-1 text-[9px] font-semibold bg-primary text-primary-foreground rounded-full">
                {item.badge}
              </span>
            )}
          </Link>
        </div>
      );
    }

    return (
      <div key={item.key} className={cn(isSubItem && "relative min-h-10")}>
        {isSubItem && (
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-s-4.75 top-0 h-10 w-6 overflow-visible text-gray-200 dark:text-gray-700 rtl:-scale-x-100"
            viewBox="0 0 24 40"
            fill="none"
            preserveAspectRatio="none"
          >
            <path
              d={isLastChild ? "M1 0V10" : "M1 0V40"}
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="butt"
            />
            <path
              d="M1 10C1 14.4 4.6 18 9 18H18"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <Link
          href={hasChildren ? "#" : item.href}
          data-sidebar-item={isSubItem ? "sub" : "root"}
          data-active={isActive || isParentActive ? "true" : undefined}
          data-expanded={isExpanded && level === 0 ? "true" : undefined}
          onClick={(e) => {
            if (hasChildren) {
              e.preventDefault();
              toggleExpanded(item.href, level);
            } else if (inFlyout) {
              closeFlyout();
            }
          }}
          className={cn(
            "relative group flex items-center text-sm font-medium transition-all duration-200 rounded-lg",
            "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            isSubItem
              ? palette === "apparent"
                ? "ms-8 h-9 gap-2 px-2 text-white/80 hover:bg-white/[0.12] hover:text-white"
                : "ms-8 h-9 gap-2 px-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100/80 hover:text-gray-900 dark:hover:bg-gray-800/70 dark:hover:text-gray-100"
              : "h-10 gap-3 px-3",
            // Main parent active state (full primary styling)
            isActive &&
              level === 0 &&
              (palette === "apparent"
                ? "bg-white/[0.18] text-white"
                : "bg-primary/10 text-primary"),
            // Parent with active child (subtle primary styling)
            isParentActive &&
              (palette === "apparent"
                ? "bg-white/[0.18] text-white"
                : "bg-primary/10 text-primary"),
            isExpanded &&
              level === 0 &&
              !isActive &&
              !isParentActive &&
              (palette === "apparent"
                ? "bg-white/[0.14] text-white"
                : "bg-gray-50 text-gray-900 dark:bg-gray-800/60 dark:text-gray-100"),
            // Child active state (lighter styling)
            isChildActive &&
              (palette === "apparent"
                ? "bg-white/[0.16] text-white font-semibold"
                : "bg-gray-100 text-gray-950 font-semibold dark:bg-gray-800 dark:text-gray-50"),
          )}
        >
          {!isSubItem && (
            <item.icon
              className={cn(
                "h-4 w-4 shrink-0 stroke-[2.35] transition-colors",
                palette === "apparent"
                  ? "text-white"
                  : isActive || isParentActive
                  ? "text-primary"
                  : "text-gray-600 dark:text-gray-400",
              )}
            />
          )}
          <span
            className={cn(
              "flex-1 truncate font-medium",
              isSubItem
                ? isChildActive
                  ? palette === "apparent"
                    ? "text-white"
                    : "text-gray-950 dark:text-gray-50"
                  : palette === "apparent"
                    ? "text-white/80"
                    : "text-gray-500 dark:text-gray-400"
                : palette === "apparent"
                  ? "text-white"
                  : isActive || isParentActive
                  ? "text-primary"
                  : "text-gray-700 dark:text-gray-300",
            )}
          >
            {t(item.title)}
          </span>
          {shownBadge && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary border border-primary/15 rounded-full">
              {shownBadge}
            </span>
          )}
          {hasChildren && (
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                palette === "apparent"
                  ? "text-white/75"
                  : "text-gray-400 dark:text-gray-500",
                isExpanded ? "rotate-90" : "rtl:rotate-180",
              )}
            />
          )}
        </Link>

        {hasChildren && isExpanded && (
          <div className="mt-1">
            {filteredChildren.map((child, index) =>
              renderNavItem(
                child,
                level + 1,
                index === filteredChildren.length - 1,
                inFlyout,
              ),
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSection = (section: NavSection): React.ReactNode => {
    // Untitled sections (Dashboard, Archive) are single entries, always shown.
    if (!section.title) {
      return (
        <div key={section.items[0]?.href} className="space-y-1">
          <div className="space-y-0.5">
            {section.items.map((item) => renderNavItem(item))}
          </div>
        </div>
      );
    }

    const isOpen = openSection === section.title;
    const holdsActive = activeSection === section.title;
    const SectionIcon = section.icon ?? section.items[0].icon;
    const badge = pendingBadge(section.items);

    // Collapsed, a section is still one entry: a tile whose entries open
    // beside it, one panel at a time, as the open sidebar's dropdowns do.
    if (isCollapsed) {
      return renderFlyout({
        key: `section:${section.title}`,
        icon: SectionIcon,
        label: t(section.title),
        active: holdsActive,
        badge,
        content: section.items.map((item) => renderNavItem(item, 0, false, true)),
      });
    }

    return (
      <div key={section.title} className="space-y-0.5">
        <button
          type="button"
          onClick={() => toggleSection(section.title!)}
          aria-expanded={isOpen}
          className={cn(
            "flex h-9 w-full items-center gap-3 rounded-lg px-3 text-start text-[13px] font-semibold transition-colors",
            navColor === "apparent"
              ? "text-white/90 hover:bg-white/[0.12] hover:text-white"
              : "text-gray-800 hover:bg-gray-100/80 dark:text-gray-200 dark:hover:bg-gray-800/70",
            holdsActive &&
              !isOpen &&
              (navColor === "apparent" ? "text-white" : "text-primary"),
          )}
        >
          <SectionIcon
            className={cn(
              "h-4 w-4 shrink-0 stroke-[2.35] transition-colors",
              navColor === "apparent"
                ? "text-white"
                : holdsActive && !isOpen
                  ? "text-primary"
                  : "text-gray-600 dark:text-gray-400",
            )}
          />
          <span className="flex-1 truncate">{t(section.title)}</span>
          {!isOpen && badge && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary border border-primary/15 rounded-full">
              {badge}
            </span>
          )}
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200",
              navColor === "apparent"
                ? "text-white/75"
                : "text-gray-400 dark:text-gray-500",
              isOpen ? "rotate-90" : "rtl:rotate-180",
            )}
          />
        </button>
        {isOpen && (
          <div className="space-y-0.5 ps-2">
            {section.items.map((item) => renderNavItem(item))}
          </div>
        )}
      </div>
    );
  };

  // Compute current logo URL from branding and theme. Apparent nav has a dark/colored
  // background, so use the dark-theme (light) logo there regardless of theme.
  const currentLogoUrl = useMemo(() => {
    const light = branding.logoLight || "/images/logo-light.png";
    const dark = branding.logoDark || "/images/logo-dark.png";
    const useDarkLogo = resolvedTheme === "dark" || navColor === "apparent";
    return useDarkLogo ? dark : light;
  }, [branding.logoLight, branding.logoDark, resolvedTheme, navColor]);

  // Offices no longer set a browser icon, so the collapsed rail shows the
  // app's own; a favicon an office saved earlier is not shown.
  const currentIconUrl = "/favicon.ico";

  // Branding is sourced centrally from the SettingsProvider. When no custom
  // logo has been uploaded the stored value is just a default placeholder path
  // (e.g. "/images/logo-light.png") that isn't shipped as a file, so rendering
  // it through next/image 400s and shows a broken image. In that case fall back
  // to a dynamic text wordmark built from the central company name instead.
  const companyName = (branding.companyName ?? "").trim() || "PropertyPro";
  const isMissingLogoAsset = (url?: string) =>
    !url || url.startsWith("/images/logo");
  const [logoError, setLogoError] = useState(false);
  useEffect(() => setLogoError(false), [currentLogoUrl]);
  const showLogoImage = !isMissingLogoAsset(currentLogoUrl) && !logoError;

  return (
    <div
      data-sidebar="root"
      className={cn(
        "flex h-full flex-col bg-white dark:bg-gray-900 border-e border-gray-200 dark:border-gray-800 overflow-hidden relative transition-[width] duration-300 ease-in-out",
        isCollapsed ? "w-28" : "w-64",
        className,
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex h-16 items-center flex-shrink-0 border-b border-gray-200 dark:border-gray-800 gap-2",
          isCollapsed ? "px-2 justify-center" : "px-4",
        )}
      >
        <Link
          href="/dashboard"
          className={cn(
            "flex items-center hover:opacity-80 transition-opacity duration-150",
            isCollapsed ? "justify-center gap-0" : "flex-1 gap-3",
          )}
        >
          <div className="flex items-center justify-center">
            {isCollapsed ? (
              <Image
                src={currentIconUrl}
                loading="lazy"
                alt={companyName}
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
              />
            ) : showLogoImage ? (
              <Image
                src={currentLogoUrl}
                loading="lazy"
                alt={companyName}
                width={140}
                height={36}
                onError={() => setLogoError(true)}
                className="h-8 w-auto max-w-[140px] object-contain"
              />
            ) : (
              <span
                className={cn(
                  "truncate text-lg font-bold tracking-tight",
                  navColor === "apparent"
                    ? "text-white"
                    : "text-gray-900 dark:text-white",
                )}
              >
                {companyName}
              </span>
            )}
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav
        aria-busy={!navReady}
        className={cn(
          "flex-1 overflow-y-auto min-h-0 sidebar-scroll",
          isCollapsed ? "space-y-1 p-3" : "space-y-4 p-4",
        )}
      >
        {navReady ? (
          filteredSections.map((section) => renderSection(section))
        ) : (
          <div role="status" className={isCollapsed ? "space-y-1" : "space-y-4"}>
            {Array.from({ length: 10 }, (_, index) => (
              <Skeleton
                key={index}
                className={cn(
                  "rounded-lg",
                  isCollapsed ? "h-16" : "h-9",
                  navColor === "apparent" &&
                    "border-white/10 from-white/15 via-white/5 to-white/15",
                )}
              />
            ))}
            <span className="sr-only">{t("common.loading")}</span>
          </div>
        )}
      </nav>

      {/* User Info */}
      {session?.user && (
        <div
          className={cn(
            "border-t border-gray-200 dark:border-gray-800 shrink-0",
            isCollapsed ? "p-2" : "p-4",
          )}
        >
          <UserMenu
            side="top"
            align={isCollapsed ? "center" : "start"}
            sideOffset={8}
          >
            <button
              type="button"
              className={cn(
                "flex items-center w-full rounded-lg transition-colors hover:bg-sidebar-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                isCollapsed ? "justify-center p-1" : "gap-3 p-2 text-start",
              )}
              aria-label={t("nav.userMenuAria", { defaultValue: "Open the account menu" })}
            >
              <Avatar className="h-8 w-8">
                <AvatarImage
                  src={
                    avatarUrl || session.user.avatar || session.user.image || ""
                  }
                  alt={`${session.user.firstName} ${session.user.lastName}`}
                />
                <AvatarFallback className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium">
                  {session.user.firstName?.[0]}
                  {session.user.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {session.user.firstName} {session.user.lastName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {/* A permission group goes by its name — its Arabic one
                        on an Arabic screen — and a built-in role by the
                        catalogue's; a group's stored name is only a key. */}
                    {ownRoleName}
                  </p>
                </div>
              )}
            </button>
          </UserMenu>
        </div>
      )}
    </div>
  );
}
