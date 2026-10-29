"use client";

import { SettingsLayout } from "@/components/settings/settings-layout";
import { SecuritySettings } from "@/components/settings/security-settings";
import { UserSessionManagement } from "@/components/users/user-session-management";
import { AccountDangerZone } from "@/components/settings/account-danger-zone";
import { TwoFactorSettings } from "@/components/settings/two-factor-settings";
import { useSession } from "@/lib/auth-client";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export default function SecuritySettingsPage() {
  const { t } = useLocalizationContext();
  const { data: session } = useSession();

  return (
    <SettingsLayout
      title={t("nav.settings.security")}
      description={t("settings.security.pageDescription")}
      section="security"
      showRefresh={false}
    >
      {({ userProfile, onAlert }) => (
        <div className="space-y-6">
          <SecuritySettings user={userProfile} onAlert={onAlert} />
          <TwoFactorSettings />
          {/* Reviewing and revoking your own logins is account security, not
              an admin task — it used to be reachable only from the admin
              user-detail screen, so most roles could never see their devices. */}
          {session?.user?.id && (
            <UserSessionManagement userId={session.user.id} />
          )}
          <AccountDangerZone />
        </div>
      )}
    </SettingsLayout>
  );
}
