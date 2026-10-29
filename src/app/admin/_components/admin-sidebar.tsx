"use client";

import Link from "next/link";
import Image from "@/components/ui/app-image";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useSession } from "@/lib/auth-client";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/layout/user-menu";
import {
  Activity,
  Building2,
  ChevronRight,
  CreditCard,
  Gauge,
  Inbox,
  Layers3,
  LayoutTemplate,
  Megaphone,
  MessageSquare,
  MessageSquareHeart,
  Newspaper,
  Settings,
  Webhook,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { PlatformBranding } from "./admin-shell";
import { useUserAvatar } from "@/components/providers/UserAvatarProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/** `title` is a translation key — see NAV_SECTIONS. */
interface AdminNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Key into the counts fetched from /api/admin/inbox/summary. */
  countKey?: "unreadMessages" | "draftAnnouncements";
  children?: AdminNavItem[];
}

interface AdminNavSection {
  title?: string;
  items: AdminNavItem[];
}

// Platform-level navigation. Mirrors the org sidebar (sections + styling +
// collapsed tiles) so the console feels like the same product. Extend as new
// /admin pages are added.
const NAV_SECTIONS: AdminNavSection[] = [
  {
    title: "platform.nav.section",
    items: [
      { title: "platform.nav.overview", href: "/admin", icon: Gauge },
      { title: "platform.nav.organizations", href: "/admin/organizations", icon: Building2 },
      { title: "platform.nav.users", href: "/admin/users", icon: Users },
      { title: "platform.nav.billing", href: "/admin/billing", icon: CreditCard },
      { title: "platform.nav.plans", href: "/admin/plans", icon: Layers3 },
      { title: "platform.nav.paymentGateways", href: "/admin/payment-gateways", icon: Wallet },
      { title: "platform.nav.landing", href: "/admin/landing", icon: LayoutTemplate },
      { title: "platform.nav.blog", href: "/admin/blog", icon: Newspaper },
      {
        // Everything the platform sends or receives, grouped the way the org
        // dashboard groups its own communication section.
        title: "platform.nav.inbox",
        href: "/admin/inbox",
        icon: Inbox,
        countKey: "unreadMessages",
        children: [
          {
            title: "platform.nav.messages",
            href: "/admin/inbox",
            icon: MessageSquare,
            countKey: "unreadMessages",
          },
          {
            title: "platform.nav.announcements",
            href: "/admin/inbox/announcements",
            icon: Megaphone,
          },
        ],
      },
      { title: "platform.nav.feedback", href: "/admin/feedback", icon: MessageSquareHeart },
      { title: "platform.nav.activity", href: "/admin/activity", icon: Activity },
      { title: "platform.nav.webhooks", href: "/admin/webhooks", icon: Webhook },
      { title: "platform.nav.settings", href: "/admin/settings", icon: Settings },
    ],
  },
];

export function AdminSidebar({
  isCollapsed = false,
  branding,
}: {
  isCollapsed?: boolean;
  /** Platform branding resolved server-side in the admin layout. The org-scoped
   * SettingsProvider cannot serve an org-less super-admin, so only navColor —
   * a personal preference — still comes from there. */
  branding: PlatformBranding;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { avatarUrl } = useUserAvatar();
  const { settings } = useSettings();
  const { resolvedTheme } = useTheme();
  // NAV_SECTIONS holds translation keys, not labels; resolved here.
  const { t } = useLocalizationContext();
  const navColor = settings.navColor ?? "integrate";
  const user = session?.user;

  /**
   * Which group is open — at most one.
   *
   * The tenant sidebar was changed to a single-open accordion because the
   * review asked for it ("if one dropdown menu is opened while another is
   * open, the previously opened one closes automatically"). This console kept
   * a list, so the two behaved differently. Invisible today, since there is
   * exactly one expandable group, and precisely the kind of difference that
   * stops being invisible the moment a second one is added.
   */
  const [expanded, setExpanded] = useState<string | null>(null);
  const [flyout, setFlyout] = useState<string | null>(null);
  const [counts, setCounts] = useState({
    unreadMessages: 0,
    draftAnnouncements: 0,
  });
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleExpanded = (href: string) =>
    setExpanded((current) => (current === href ? null : href));

  const openFlyout = useCallback((href: string) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setFlyout(href);
  }, []);

  const scheduleCloseFlyout = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setFlyout(null), 120);
  }, []);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  // Unread badge. Re-read on navigation (opening a message clears its unread
  // state) rather than polling, which would spend a request a minute on a
  // console that is usually idle.
  useEffect(() => {
    let active = true;
    fetch("/api/admin/inbox/summary")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && payload?.success) {
          setCounts({
            unreadMessages: payload.data.unreadMessages ?? 0,
            draftAnnouncements: payload.data.draftAnnouncements ?? 0,
          });
        }
      })
      .catch(() => {
        // A missing badge is not worth surfacing an error for.
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  const logoUrl =
    resolvedTheme === "dark" || navColor === "apparent"
      ? branding.logoDark || "/images/logo-dark.png"
      : branding.logoLight || "/images/logo-light.png";
  const iconUrl = branding.favicon || "/favicon.ico";

  // Same fallback the org sidebar uses: when no logo has been uploaded the
  // stored value is a placeholder path with no file behind it, so next/image
  // 404s and shows a broken image. Fall back to a text wordmark instead.
  const platformName = (branding.platformName ?? "").trim() || "PropertyPro";
  const isMissingLogoAsset = (url?: string) =>
    !url || url.startsWith("/images/logo");
  // Keyed by URL rather than a boolean so a branding change re-tries the new
  // logo without an effect resetting the flag.
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const showLogoImage =
    !isMissingLogoAsset(logoUrl) && failedLogoUrl !== logoUrl;

  // A parent lights up for anything beneath it; a leaf only for its own page,
  // so "Messages" (/admin/inbox) does not stay lit on the announcements child.
  const isBranchActive = (href: string) =>
    pathname === href ||
    (href !== "/admin" && pathname.startsWith(`${href}/`));

  const badgeFor = (item: AdminNavItem): string | undefined => {
    const count = item.countKey ? counts[item.countKey] : 0;
    return count > 0 ? String(count) : undefined;
  };

  // Collapsed-rail flyout row. Keeps the icon because the popover has no
  // parent row to hang a connector off, exactly like the org sidebar's flyout.
  const renderFlyoutChild = (child: AdminNavItem, onNavigate?: () => void) => {
    const childActive = pathname === child.href;
    const badge = badgeFor(child);

    return (
      <Link
        key={child.href}
        href={child.href}
        onClick={onNavigate}
        data-sidebar-item="sub"
        data-active={childActive ? "true" : undefined}
        aria-current={childActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          childActive
            ? "bg-primary/10 text-primary"
            : "text-foreground hover:bg-accent/60",
        )}
      >
        <child.icon
          className={cn(
            "h-4 w-4 shrink-0 stroke-[2.35]",
            childActive ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{t(child.title)}</span>
        {badge && (
          <span className="inline-flex items-center justify-center rounded-full border border-primary/15 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {badge}
          </span>
        )}
      </Link>
    );
  };

  // Expanded-sidebar child row. Mirrors the org sidebar: no icon, an SVG elbow
  // tying the row back to its parent (the trunk stops at the last child), and a
  // neutral "current page" pill instead of the primary tint roots use.
  const renderSubItem = (child: AdminNavItem, isLastChild: boolean) => {
    const isChildActive = pathname === child.href;
    const badge = badgeFor(child);

    return (
      <div key={child.href} className="relative min-h-10">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute start-[19px] top-0 h-10 w-6 overflow-visible rtl:-scale-x-100 text-gray-200 dark:text-gray-700"
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
        <Link
          href={child.href}
          data-sidebar-item="sub"
          data-active={isChildActive ? "true" : undefined}
          aria-current={isChildActive ? "page" : undefined}
          className={cn(
            "relative group flex items-center text-sm font-medium transition-all duration-200 rounded-lg",
            "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            navColor === "apparent"
              ? "ms-8 h-9 gap-2 px-2 text-white/80 hover:bg-white/[0.12] hover:text-white"
              : "ms-8 h-9 gap-2 px-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100/80 hover:text-gray-900 dark:hover:bg-gray-800/70 dark:hover:text-gray-100",
            isChildActive &&
              (navColor === "apparent"
                ? "bg-white/[0.16] text-white font-semibold"
                : "bg-gray-100 text-gray-950 font-semibold dark:bg-gray-800 dark:text-gray-50"),
          )}
        >
          <span
            className={cn(
              "flex-1 truncate font-medium",
              isChildActive
                ? navColor === "apparent"
                  ? "text-white"
                  : "text-gray-950 dark:text-gray-50"
                : navColor === "apparent"
                  ? "text-white/80"
                  : "text-gray-500 dark:text-gray-400",
            )}
          >
            {t(child.title)}
          </span>
          {badge && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary border border-primary/15 rounded-full">
              {badge}
            </span>
          )}
        </Link>
      </div>
    );
  };

  const renderNavItem = (item: AdminNavItem) => {
    const children = item.children ?? [];
    const hasChildren = children.length > 0;
    const isActive = hasChildren
      ? pathname === item.href
      : isBranchActive(item.href);
    const isParentActive = hasChildren && isBranchActive(item.href);
    const isExpanded = expanded === item.href || isParentActive;
    const badge = badgeFor(item);

    // Collapsed: vertical icon + label tile (matches org sidebar). Parents
    // open the same hover flyout the org sidebar uses rather than expanding
    // inside a 7rem-wide rail.
    if (isCollapsed) {
      const tile = (
        <Link
          key={item.href}
          href={hasChildren ? "#" : item.href}
          data-sidebar-item="root"
          data-active={isActive || isParentActive ? "true" : undefined}
          aria-current={isActive ? "page" : undefined}
          onClick={(event) => {
            if (hasChildren) {
              event.preventDefault();
              openFlyout(item.href);
            }
          }}
          onMouseEnter={() => hasChildren && openFlyout(item.href)}
          onMouseLeave={() => hasChildren && scheduleCloseFlyout()}
          className={cn(
            "relative flex flex-col items-center justify-center gap-1.5 px-1 py-3 rounded-lg transition-colors group",
            "hover:bg-sidebar-accent/60",
            (isActive || isParentActive) && "bg-primary/10 text-primary",
          )}
        >
          <item.icon
            className={cn(
              "h-5.5 w-5.5 stroke-[2.35] transition-colors",
              isActive || isParentActive
                ? "text-primary"
                : "text-gray-600 dark:text-gray-400",
            )}
          />
          <span
            className={cn(
              "text-[10px] font-medium leading-tight text-center w-full px-0.5 wrap-break-word",
              isActive || isParentActive
                ? "text-primary"
                : "text-gray-700 dark:text-gray-300",
            )}
          >
            {t(item.title)}
          </span>
          {hasChildren && (
            <ChevronRight
              className={cn(
                "absolute end-1 top-1/2 -translate-y-1/2 h-3.5 w-3.5 transition-colors rtl:-scale-x-100",
                isActive || isParentActive
                  ? "text-primary"
                  : "text-gray-400 dark:text-gray-500",
              )}
            />
          )}
          {badge && (
            <span className="absolute top-1 end-1 inline-flex items-center justify-center min-w-4 h-4 px-1 text-[9px] font-semibold bg-primary text-primary-foreground rounded-full">
              {badge}
            </span>
          )}
        </Link>
      );

      if (!hasChildren) return <div key={item.href}>{tile}</div>;

      return (
        <Popover key={item.href} open={flyout === item.href}>
          <PopoverTrigger asChild>{tile}</PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-56 p-1"
            onMouseEnter={() => openFlyout(item.href)}
            onMouseLeave={scheduleCloseFlyout}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <div className="px-3 py-2 border-b border-border/60 mb-1">
              <p className="text-xs font-semibold text-foreground">
                {t(item.title)}
              </p>
            </div>
            <div className="space-y-0.5">
              {children.map((child) =>
                renderFlyoutChild(child, () => setFlyout(null)),
              )}
            </div>
          </PopoverContent>
        </Popover>
      );
    }

    return (
      <div key={item.href}>
        <Link
          href={hasChildren ? "#" : item.href}
          data-sidebar-item="root"
          data-active={isActive || isParentActive ? "true" : undefined}
          data-expanded={isExpanded && hasChildren ? "true" : undefined}
          aria-current={isActive ? "page" : undefined}
          onClick={(event) => {
            if (hasChildren) {
              event.preventDefault();
              toggleExpanded(item.href);
            }
          }}
          className={cn(
            "relative group flex items-center text-sm font-medium transition-all duration-200 rounded-lg h-10 gap-3 px-3",
            "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            (isActive || isParentActive) &&
              (navColor === "apparent"
                ? "bg-white/[0.18] text-white"
                : "bg-primary/10 text-primary"),
            isExpanded &&
              hasChildren &&
              !isActive &&
              !isParentActive &&
              (navColor === "apparent"
                ? "bg-white/[0.14] text-white"
                : "bg-gray-50 text-gray-900 dark:bg-gray-800/60 dark:text-gray-100"),
          )}
        >
          <item.icon
            className={cn(
              "h-4 w-4 shrink-0 stroke-[2.35] transition-colors",
              navColor === "apparent"
                ? "text-white"
                : isActive || isParentActive
                  ? "text-primary"
                  : "text-gray-600 dark:text-gray-400",
            )}
          />
          <span
            className={cn(
              "flex-1 truncate font-medium",
              navColor === "apparent"
                ? "text-white"
                : isActive || isParentActive
                  ? "text-primary"
                  : "text-gray-700 dark:text-gray-300",
            )}
          >
            {t(item.title)}
          </span>
          {badge && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary border border-primary/15 rounded-full">
              {badge}
            </span>
          )}
          {hasChildren && (
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                navColor === "apparent"
                  ? "text-white/75"
                  : "text-gray-400 dark:text-gray-500",
                isExpanded ? "rotate-90" : "rtl:rotate-180",
              )}
            />
          )}
        </Link>

        {hasChildren && isExpanded && (
          <div className="mt-1">
            {children.map((child, index) =>
              renderSubItem(child, index === children.length - 1),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      data-sidebar="root"
      className={cn(
        "flex h-full flex-col bg-white dark:bg-gray-900 border-e border-gray-200 dark:border-gray-800 overflow-hidden relative transition-[width] duration-300 ease-in-out",
        isCollapsed ? "w-28" : "w-64",
      )}
    >
      {/* Shared product branding */}
      <div
        className={cn(
          "flex h-16 items-center flex-shrink-0 border-b border-gray-200 dark:border-gray-800 gap-2",
          isCollapsed ? "px-2 justify-center" : "px-4",
        )}
      >
        <Link
          href="/admin"
          className={cn(
            "flex items-center hover:opacity-80 transition-opacity duration-150",
            isCollapsed ? "justify-center gap-0" : "flex-1 gap-3",
          )}
        >
          <div className="flex items-center justify-center">
            {isCollapsed ? (
              <Image
                src={iconUrl}
                loading="lazy"
                alt={platformName}
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
              />
            ) : showLogoImage ? (
              <Image
                src={logoUrl}
                loading="lazy"
                alt={platformName}
                width={140}
                height={36}
                onError={() => setFailedLogoUrl(logoUrl)}
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
                {platformName}
              </span>
            )}
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav
        className={cn(
          "flex-1 space-y-4 overflow-y-auto min-h-0 sidebar-scroll",
          isCollapsed ? "p-3" : "p-4",
        )}
      >
        {NAV_SECTIONS.map((section) => (
          <div key={section.title || "default"} className="space-y-1">
            {section.title && !isCollapsed && (
              <div className="px-3 pt-2 pb-1">
                <h3 className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {t(section.title)}
                </h3>
              </div>
            )}
            <div className="space-y-0.5">{section.items.map(renderNavItem)}</div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      {user && (
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
              aria-label={t("platform.nav.openUserMenu", { defaultValue: "Open user menu" })}
            >
              <Avatar className="h-8 w-8">
                <AvatarImage
                  src={avatarUrl || user.avatar || user.image || ""}
                  alt={`${user.firstName} ${user.lastName}`}
                />
                <AvatarFallback className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium">
                  {user.firstName?.[0]}
                  {user.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                    {user.role?.replace("_", " ")}
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
