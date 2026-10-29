"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, type AppSession, type SessionStatus } from "@/lib/auth-client";
import { landingPathForUser } from "@/lib/auth-landing";
import { AppShellSkeleton } from "@/components/layout/app-shell-skeleton";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/layout/sidebar";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { UserMenu } from "@/components/layout/user-menu";
import { GlobalSearch } from "@/components/layout/global-search";
import { useUserAvatar } from "@/components/providers/UserAvatarProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { PreferencesDrawer } from "@/components/layout/preferences/preferences-drawer";
import { MaintenanceNotice } from "@/components/platform/maintenance-notice";
import { ImpersonationBanner } from "@/components/platform/impersonation-banner";
import { PlatformAnnouncements } from "@/components/platform/platform-announcements";
import { BillingNotice } from "@/components/billing/billing-notice";
import { EmailVerificationGate } from "@/components/auth/email-verification-gate";
import {
  ModuleAccessProvider,
  ModuleGuard,
} from "@/components/layout/module-access";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Where this session should go instead of the org dashboard, or null to stay.
 *
 * Kept out of the component so the decision is a value rather than a
 * `redirect()` thrown mid-render. Throwing unmounts everything below Next's
 * redirect boundary, so the screen went white for the whole of the next
 * route's server render — the blank gap super-admins saw between the dashboard
 * skeleton and the console.
 */
function elsewhereFor(
  status: SessionStatus,
  session: AppSession | null,
): string | null {
  if (status === "unauthenticated") return "/auth/signin";
  if (status !== "authenticated" || !session?.user) return null;

  if (session.user.isActive === false) {
    return "/auth/signin?error=AccountDeactivated";
  }

  // Platform super-admins belong in the console; users without an organization
  // (e.g. a fresh OAuth sign-up) belong in onboarding.
  const home = landingPathForUser(session.user);
  return home === "/dashboard" ? null : home;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { data: session, status } = useSession();
  const { avatarUrl } = useUserAvatar();
  const router = useRouter();

  const elsewhere = elsewhereFor(status, session);

  useEffect(() => {
    if (elsewhere) router.replace(elsewhere);
  }, [elsewhere, router]);

  // Hold the chrome on screen for the length of the bounce rather than
  // rendering an org dashboard this user is about to be moved out of. The
  // console's own Suspense fallback is the same skeleton, so the two routes
  // hand over without a flash.
  if (elsewhere) return <AppShellSkeleton />;

  // No blocking spinner while the session resolves: the shell renders straight
  // away and each route's loading.tsx skeleton covers the page body. The check
  // above is gated on a resolved status, so an unresolved session simply falls
  // through and renders the chrome.
  const user = session?.user;

  return (
    // What the package, role and rights open, decided once for the sidebar,
    // the ⌘K palette, the page guard and the pages (module-access.tsx).
    <ModuleAccessProvider>
      <DashboardShell
        // The sidebar and the pages read the query string (the report links are
        // "?type=…"). Next only allows useSearchParams under a Suspense
        // boundary on a statically rendered route; without these, the
        // production build refuses every dashboard page.
        renderSidebar={(isCollapsed) => (
          <Suspense fallback={null}>
            <Sidebar isCollapsed={isCollapsed} />
          </Suspense>
        )}
        headerLeading={<GlobalSearch />}
        headerActions={
          <>
            <NotificationBell />
            <PreferencesDrawer />
            <UserMenu>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarImage
                    src={avatarUrl || user?.avatar || ""}
                    alt={user?.firstName || ""}
                  />
                  <AvatarFallback>
                    {user?.firstName?.[0]}
                    {user?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </UserMenu>
          </>
        }
      >
        <ImpersonationBanner />
        <MaintenanceNotice />
        <EmailVerificationGate>
          <PlatformAnnouncements />
          <BillingNotice />
          <Suspense fallback={null}>
            {/* A page whose module the package leaves out shows an upgrade
                card instead — opened from a bookmark or a typed URL as much as
                from a link. Its API answers 402 regardless. */}
            <ModuleGuard>{children}</ModuleGuard>
          </Suspense>
        </EmailVerificationGate>
      </DashboardShell>
    </ModuleAccessProvider>
  );
}
