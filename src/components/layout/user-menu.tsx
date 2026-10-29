"use client";

import { ReactNode } from "react";
import { signOut, useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { LogOut, Settings, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useOwnRoleName } from "@/hooks/useGroupNames";

interface UserMenuProps {
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}

export function UserMenu({
  children,
  align = "end",
  side,
  sideOffset,
}: UserMenuProps) {
  const { data: session } = useSession();
  const { canManageSystemSettings } = useAuthorization();
  const { t } = useLocalizationContext();
  const router = useRouter();
  // The role by its name in the reader's language, never a group's key.
  const ownRoleName = useOwnRoleName();

  const user = session?.user;
  // Platform super-admins have no organization, so every org-scoped settings
  // route (and the API behind it) refuses them — send them to the console's
  // own profile/settings screens instead.
  const isPlatformAdmin = user?.role === "super_admin" && !user?.organizationId;
  const profileHref = isPlatformAdmin
    ? "/admin/profile"
    : "/dashboard/settings/profile";
  const settingsHref = isPlatformAdmin
    ? "/admin/settings"
    : "/dashboard/settings/appearance";
  // Display & branding is one setting for the whole organization, open to
  // whoever holds "System settings".
  const canAccessDisplaySettings = canManageSystemSettings || isPlatformAdmin;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-56"
        align={align}
        side={side}
        sideOffset={sideOffset}
        forceMount
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {user?.email}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {ownRoleName}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => router.push(profileHref)}
        >
          <User className="me-2 h-4 w-4" />
          <span>{t("header.menu.profile")}</span>
        </DropdownMenuItem>
        {canAccessDisplaySettings && (
          <DropdownMenuItem
            onClick={() => router.push(settingsHref)}
          >
            <Settings className="me-2 h-4 w-4" />
            <span>{t("header.menu.settings")}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600"
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          <LogOut className="me-2 h-4 w-4" />
          <span>{t("header.menu.logout")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
