"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, Megaphone } from "lucide-react";

import NotificationsPage from "@/app/dashboard/notifications/page";
import AnnouncementsPage from "@/app/dashboard/announcements/page";
import { cn } from "@/lib/utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type UpdatesTab = "notifications" | "announcements";

export default function UpdatesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLocalizationContext();

  const activeTab: UpdatesTab =
    (searchParams.get("tab") as UpdatesTab) === "announcements"
      ? "announcements"
      : "notifications";

  const setTab = useCallback(
    (tab: UpdatesTab) => {
      const params = new URLSearchParams();
      params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router],
  );

  const tabs = useMemo(
    () => [
      {
        value: "notifications" as const,
        label: t("dashboard.updates.tabs.notifications"),
        icon: Bell,
      },
      {
        value: "announcements" as const,
        label: t("dashboard.updates.tabs.announcements"),
        icon: Megaphone,
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("dashboard.updates.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("dashboard.updates.header.subtitle")}
          </p>
        </div>

        <div id="updates-header-actions" className="flex flex-wrap gap-2" />
      </div>

      <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setTab(tab.value)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "notifications" ? (
        <NotificationsPage embedded />
      ) : (
        <AnnouncementsPage embedded />
      )}
    </div>
  );
}
