"use client";

import { useEffect } from "react";
import { SettingsLayout } from "@/components/settings/settings-layout";
import { DisplaySettings } from "@/components/settings/display-settings";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useAuthorization } from "@/hooks/useAuthorization";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeleton";

export default function DisplaySettingsPage() {
  const { t } = useLocalizationContext();
  const router = useRouter();
  const { status } = useSession();
  const { canManageSystemSettings, isLoading: authzLoading } =
    useAuthorization();

  // Display & branding is one setting for the whole organization, kept by
  // whoever holds "System settings" — the permission its API asks for. Send
  // everyone else (managers and tenants) to their personal profile instead.
  useEffect(() => {
    if (
      status === "authenticated" &&
      !authzLoading &&
      !canManageSystemSettings
    ) {
      router.replace("/dashboard/settings/profile");
    }
  }, [status, authzLoading, canManageSystemSettings, router]);

  if (status === "loading" || authzLoading || !canManageSystemSettings) {
    return <SettingsPageSkeleton rows={4} />;
  }

  return (
    <SettingsLayout
      title={t("nav.settings.display")}
      description={t("settings.display.pageDescription")}
      section="display"
    >
      {({ userSettings, onUpdate, onAlert }) => (
        <DisplaySettings
          settings={userSettings?.display}
          onUpdate={onUpdate}
          onAlert={onAlert}
        />
      )}
    </SettingsLayout>
  );
}
