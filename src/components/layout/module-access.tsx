"use client";

/**
 * PropertyPro - What this reader may open: package, role and rights together
 *
 * The dashboard layout provides one answer for everything under it — the
 * sidebar, the ⌘K palette, the page guard and the dashboards — so a module
 * the package leaves out disappears from all of them at once, and a direct
 * URL to it shows an upgrade card instead of the page.
 *
 * Presentation only: the API refuses the same modules with 402 whatever this
 * shows (lib/api-utils.ts). It reads the module list from the entitlements
 * feed, fetched once and shared, and fails open — a network blip must not
 * look like the account losing its features.
 */

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Lock, Sparkles } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import {
  canAccessNavItem,
  createAccessProfile,
  type AccessProfile,
} from "@/lib/role-utils";
import {
  decideModuleAccess,
  isAlwaysOnModule,
  moduleLabel,
  moduleTitleKey,
  pageModuleCandidates,
  pageNeedsQuery,
  type ModuleDecision,
} from "@/lib/billing/modules";
import type { MenuNode } from "@/lib/navigation/menu-config";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

// ---------------------------------------------------------------------------
// The module feed
// ---------------------------------------------------------------------------

interface ModuleFeed {
  modules: string[];
  platformDisabled?: string[];
  planName?: string;
  canManageBilling?: boolean;
}

/**
 * One request for the whole page, started as soon as the layout mounts —
 * alongside the session request rather than after it. It is tagged with the
 * user it answered for once that is known, so signing in as someone else in
 * the same tab asks again.
 */
let feedCache: { userId: string | null; promise: Promise<ModuleFeed | null> } | null =
  null;

function fetchFeed(): Promise<ModuleFeed | null> {
  return fetch("/api/billing/entitlements?usage=0")
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => (payload?.data as ModuleFeed | undefined) ?? null)
    .catch(() => null);
}

function loadFeed(userId: string | null): Promise<ModuleFeed | null> {
  if (feedCache) {
    if (feedCache.userId === userId) return feedCache.promise;
    if (feedCache.userId === null && userId) {
      feedCache.userId = userId;
      return feedCache.promise;
    }
  }
  feedCache = { userId, promise: fetchFeed() };
  return feedCache.promise;
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

export interface ModuleAccess {
  /** Role, rights and package are all known: menus can be drawn. */
  ready: boolean;
  /** The package's answer has arrived (or failed, which opens everything). */
  feedLoaded: boolean;
  /** The reader's role and a permission group's rights are known. */
  rolesKnown: boolean;
  profile: AccessProfile;
  /** Whether the package (after platform switches) includes a module. */
  planIncludes: (key: string) => boolean;
  isPlatformOff: (key: string) => boolean;
  /** A menu entry, by package, role and rights — the sidebar's rule. */
  canSeeItem: (node: MenuNode) => boolean;
  /** What the page guard would decide for a dashboard URL. */
  decideHref: (href: string) => ModuleDecision;
  /** Whether a dashboard URL opens (true while undecided). */
  canOpen: (href: string) => boolean;
  canManageBilling: boolean;
  planName: string | null;
}

const ModuleAccessContext = createContext<ModuleAccess | null>(null);

function useModuleAccessState(): ModuleAccess {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const role = session?.user?.role;
  const {
    permissions,
    storedGroup,
    isLoading: permissionsLoading,
  } = useRolePermissions();
  const [feed, setFeed] = useState<{
    userId: string | null;
    value: ModuleFeed | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    loadFeed(userId).then((value) => {
      if (active) setFeed({ userId, value });
    });
    return () => {
      active = false;
    };
  }, [userId]);

  // An answer fetched before the session resolved stands for its user.
  const feedLoaded =
    feed !== null && (feed.userId === userId || feed.userId === null);
  const value = feedLoaded ? feed.value : null;

  const modules = useMemo(
    () => (value ? new Set(value.modules) : null),
    [value],
  );
  const platformDisabled = useMemo(
    () => new Set(value?.platformDisabled ?? []),
    [value],
  );
  const profile = useMemo(
    () => createAccessProfile(role, permissions, null, { storedGroup }),
    [permissions, role, storedGroup],
  );
  const rolesKnown =
    Boolean(role) && (profile.isSystemRole || !permissionsLoading);

  const planIncludes = useCallback(
    (key: string) => !modules || isAlwaysOnModule(key) || modules.has(key),
    [modules],
  );
  const isPlatformOff = useCallback(
    (key: string) => platformDisabled.has(key),
    [platformDisabled],
  );
  const canSeeItem = useCallback(
    (node: MenuNode) =>
      Boolean(role) && planIncludes(node.key) && canAccessNavItem(profile, node),
    [planIncludes, profile, role],
  );
  const decideHref = useCallback(
    (href: string) =>
      decideModuleAccess(pageModuleCandidates(href), planIncludes, {
        applies: rolesKnown
          ? (node) => canAccessNavItem(profile, node)
          : undefined,
        isPlatformOff,
      }),
    [isPlatformOff, planIncludes, profile, rolesKnown],
  );
  const canOpen = useCallback(
    (href: string) => decideHref(href).allowed,
    [decideHref],
  );

  return useMemo(
    () => ({
      ready: rolesKnown && feedLoaded,
      feedLoaded,
      rolesKnown,
      profile,
      planIncludes,
      isPlatformOff,
      canSeeItem,
      decideHref,
      canOpen,
      canManageBilling: Boolean(value?.canManageBilling),
      planName: value?.planName ?? null,
    }),
    [
      canOpen,
      canSeeItem,
      decideHref,
      feedLoaded,
      isPlatformOff,
      planIncludes,
      profile,
      rolesKnown,
      value,
    ],
  );
}

export function ModuleAccessProvider({ children }: { children: ReactNode }) {
  const value = useModuleAccessState();
  return (
    <ModuleAccessContext.Provider value={value}>
      {children}
    </ModuleAccessContext.Provider>
  );
}

const OPEN_ACCESS: ModuleAccess = {
  ready: true,
  feedLoaded: true,
  rolesKnown: true,
  profile: createAccessProfile(undefined, [], null),
  planIncludes: () => true,
  isPlatformOff: () => false,
  canSeeItem: () => true,
  decideHref: () => ({
    gated: false,
    allowed: true,
    blockedKey: null,
    platformOff: false,
    needsRole: false,
  }),
  canOpen: () => true,
  canManageBilling: false,
  planName: null,
};

/**
 * The reader's module access. Outside the dashboard layout (no provider)
 * everything is open — the server still refuses what the package lacks.
 */
export function useModuleAccess(): ModuleAccess {
  return useContext(ModuleAccessContext) ?? OPEN_ACCESS;
}

// ---------------------------------------------------------------------------
// The page guard
// ---------------------------------------------------------------------------

function GuardSkeleton() {
  return (
    <div role="status" className="space-y-4">
      <Skeleton className="h-8 w-64 rounded-lg" />
      <Skeleton className="h-4 w-96 max-w-full rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

/** Upgrade card shown in place of a page the package does not include. */
export function ModuleUpgradeCard({
  moduleKey,
  platformOff = false,
}: {
  moduleKey: string | null;
  platformOff?: boolean;
}) {
  const { t } = useLocalizationContext();
  const access = useModuleAccess();
  const titleKey = moduleKey ? moduleTitleKey(moduleKey) : null;
  const feature = moduleKey
    ? titleKey
      ? t(titleKey, { defaultValue: moduleLabel(moduleKey) })
      : moduleLabel(moduleKey)
    : t("billing.gate.thisModule", { defaultValue: "This module" });

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-xl border border-dashed p-8 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
          {platformOff ? (
            <Lock className="size-5" />
          ) : (
            <Sparkles className="size-5" />
          )}
        </div>
        <h1 className="mt-4 text-lg font-semibold">
          {platformOff
            ? t("billing.gate.unavailableTitle", {
                defaultValue: "{feature} is not available",
                values: { feature },
              })
            : t("billing.gate.title", {
                defaultValue: "{feature} is not on your plan",
                values: { feature },
              })}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {platformOff
            ? t("billing.gate.unavailableBody", {
                defaultValue:
                  "This module is switched off for every account at the moment. Your existing data is untouched.",
              })
            : t("billing.gate.body", {
                defaultValue:
                  "Your current plan does not include this. Upgrade to turn it on — your existing data is untouched either way.",
              })}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {!platformOff && access.canManageBilling ? (
            <Button asChild>
              <Link href="/dashboard/settings/billing">
                {t("billing.notice.viewPlans", { defaultValue: "View plans" })}
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href="/dashboard">
              {t("errors.notFound.home", {
                defaultValue: "Back to the dashboard",
              })}
            </Link>
          </Button>
        </div>
        {!platformOff && !access.canManageBilling ? (
          <p className="mt-5 text-xs text-muted-foreground">
            {t("billing.gate.askAdmin", {
              defaultValue: "Ask an administrator to upgrade the account.",
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ModuleGate({ href, children }: { href: string; children: ReactNode }) {
  const access = useModuleAccess();
  const candidates = useMemo(() => pageModuleCandidates(href), [href]);

  // Open on every package: no reason to wait for anything.
  if (!candidates || candidates.some((node) => node.alwaysOn)) {
    return <>{children}</>;
  }
  // The page must not mount (and fetch) before the package is known: a
  // module left out shows the card, never a moment of the page.
  if (!access.feedLoaded) return <GuardSkeleton />;

  const decision = access.decideHref(href);
  if (decision.needsRole && !access.rolesKnown) return <GuardSkeleton />;
  if (decision.allowed) return <>{children}</>;
  return (
    <ModuleUpgradeCard
      moduleKey={decision.blockedKey}
      platformOff={decision.platformOff}
    />
  );
}

/** Reads the query too — for the report pages, where it names the module. */
function QueryModuleGate({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const search = useSearchParams();
  const query = search?.toString() ?? "";
  return (
    <ModuleGate href={query ? `${pathname}?${query}` : pathname}>
      {children}
    </ModuleGate>
  );
}

/**
 * Wraps every dashboard page: the page if its module is on, the upgrade card
 * if the package leaves it out. Only pages whose module depends on the query
 * read it, so the rest keep rendering without a Suspense bail-out.
 */
export function ModuleGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/dashboard";
  if (pageNeedsQuery(pathname)) {
    return (
      <Suspense fallback={<GuardSkeleton />}>
        <QueryModuleGate pathname={pathname}>{children}</QueryModuleGate>
      </Suspense>
    );
  }
  return <ModuleGate href={pathname}>{children}</ModuleGate>;
}
