"use client";

import { SettingsLayout } from "@/components/settings/settings-layout";
import { ProfileSettings } from "@/components/settings/profile-settings";
import { MessagingOptOutCard } from "@/components/settings/messaging-opt-out";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export default function ProfileSettingsPage() {
  const { t } = useLocalizationContext();

  return (
    <SettingsLayout
      title={t("nav.settings.profile")}
      description={t("settings.profile.pageDescription")}
      section="profile"
      showRefresh={true}
    >
      {({ userProfile, onUpdate, onAlert }) => (
        <>
          <ProfileSettings
            user={userProfile}
            onUpdate={onUpdate}
            onAlert={onAlert}
          />
          <MessagingOptOutCard />
        </>
      )}
    </SettingsLayout>
  );
}
