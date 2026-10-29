import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Inline content skeleton for settings pages. Rendered inside the settings
 * shell (below the real, static page header) while dynamic data loads — so the
 * page never blanks out behind a full-screen spinner.
 *
 * This carries the loading announcement rather than `SettingsPageSkeleton`
 * below, because it is also rendered on its own by the settings layout's
 * content area — announcing here covers both call sites with a single live
 * region, and leaves the page wrapper free of a second, nested one.
 */
export function SettingsFieldsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card role="status" aria-busy="true" aria-label="Loading settings">
      <CardContent className="space-y-6 p-6">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full max-w-md rounded-md" />
          </div>
        ))}
        {/*
          Action bar: the real footer is a right-aligned `flex gap-2` of two
          `size="sm"` buttons (`h-8 rounded-lg`) — an icon-only reset and a
          `min-w-[140px]` submit. Buttons are never `rounded-md`; that radius
          belongs to Input/SelectTrigger, which the field rows above use.
        */}
        <div className="flex justify-end gap-2">
          <Skeleton className="h-8 w-10 rounded-lg" />
          <Skeleton className="h-8 w-[140px] rounded-lg" />
        </div>
      </CardContent>
      <span className="sr-only">Loading settings…</span>
    </Card>
  );
}

/**
 * Full-page skeleton (header + content) used by route-level `loading.tsx`
 * fallbacks so navigation shows the settings layout shell, not a bare spinner.
 */
export function SettingsPageSkeleton({ rows }: { rows?: number }) {
  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <SettingsFieldsSkeleton rows={rows} />
    </div>
  );
}
