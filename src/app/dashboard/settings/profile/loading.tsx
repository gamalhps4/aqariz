import { ProfileSettingsSkeleton } from "@/components/settings/profile-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level fallback while this page's chunk loads. The generic settings
 * skeleton renders a four-field card, which would then jump to this page's
 * much taller card stack — so it mirrors the page instead. The header is
 * skeletoned too: its title and description come from the client-side
 * localization context, which is not available yet at this point.
 */
export default function ProfileSettingsLoading() {
  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-8 w-24 shrink-0 rounded-lg" />
      </div>
      <ProfileSettingsSkeleton />
    </div>
  );
}
