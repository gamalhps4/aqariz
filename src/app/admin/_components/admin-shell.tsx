"use client";

import { useSession } from "@/lib/auth-client";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Button } from "@/components/ui/button";
import { AdminSidebar } from "./admin-sidebar";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { UserMenu } from "@/components/layout/user-menu";
import { useUserAvatar } from "@/components/providers/UserAvatarProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PreferencesDrawer } from "@/components/layout/preferences/preferences-drawer";
import { MaintenanceNotice } from "@/components/platform/maintenance-notice";

/**
 * Visual shell for the platform admin console. Intentionally mirrors the org
 * DashboardLayout (collapsible sidebar + glass header + scrollable main) so the
 * console feels like the same product, minus org-scoped widgets (global search,
 * notifications) which don't apply to a platform super-admin.
 */
export interface PlatformBranding {
  platformName: string;
  logoLight: string;
  logoDark: string;
  favicon: string;
}

export function AdminShell({
  children,
  branding,
}: {
  children: React.ReactNode;
  branding: PlatformBranding;
}) {
  const { t } = useLocalizationContext();
  const { data: session } = useSession();
  const { avatarUrl } = useUserAvatar();

  const user = session?.user;

  return (
    <DashboardShell
      renderSidebar={(isCollapsed) => (
        <AdminSidebar isCollapsed={isCollapsed} branding={branding} />
      )}
      headerLeading={
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {branding.platformName} Console
          </p>
          <p className="hidden text-xs text-muted-foreground sm:block">
            {t("platform.shell.tagline", { defaultValue: "Cross-organization administration" })}
          </p>
        </div>
      }
      headerActions={
        <>
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
      <MaintenanceNotice />
      {children}
    </DashboardShell>
  );
}
