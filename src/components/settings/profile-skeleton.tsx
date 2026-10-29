import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Label + `h-10` input, matching the real field stack. */
function FieldSkeleton({ labelWidth = "w-24" }: { labelWidth?: string }) {
  return (
    <div className="space-y-2">
      <Skeleton className={cn("h-4", labelWidth)} />
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}

/** Profile cards carry no header icon — just a `text-lg` title over one line. */
function CardHeaderSkeleton({
  titleWidth = "w-40",
  descriptionWidth = "max-w-md",
}: {
  titleWidth?: string;
  descriptionWidth?: string;
}) {
  return (
    <CardHeader>
      <Skeleton className={cn("h-5", titleWidth)} />
      <Skeleton className={cn("h-3.5 w-full", descriptionWidth)} />
    </CardHeader>
  );
}

/**
 * Shape-matched skeleton for Settings › Profile, rendered in place of the form
 * while the merged user profile loads. It mirrors the real card stack — avatar
 * row, the two-up field grids, the bio textarea and the account-info footer —
 * so the page keeps its height and settles in place instead of jumping when
 * data arrives.
 */
export function ProfileSettingsSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Loading profile settings"
    >
      {/* Avatar */}
      <Card>
        <CardHeaderSkeleton titleWidth="w-36" descriptionWidth="max-w-sm" />
        <CardContent>
          <div className="flex items-center gap-6">
            <Skeleton className="h-20 w-20 shrink-0 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-10 w-40 rounded-xl" />
              <Skeleton className="h-3.5 w-52" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Basic information */}
      <Card>
        <CardHeaderSkeleton titleWidth="w-44" />
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldSkeleton labelWidth="w-24" />
            <FieldSkeleton labelWidth="w-20" />
          </div>
          <FieldSkeleton labelWidth="w-16" />
          <FieldSkeleton labelWidth="w-20" />
          {/* Bio is a min-h-16 textarea, not an input */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldSkeleton labelWidth="w-20" />
            <FieldSkeleton labelWidth="w-14" />
          </div>
          <FieldSkeleton labelWidth="w-20" />
          <FieldSkeleton labelWidth="w-24" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldSkeleton labelWidth="w-20" />
            <FieldSkeleton labelWidth="w-24" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldSkeleton labelWidth="w-28" />
            <FieldSkeleton labelWidth="w-16" />
          </div>
          <Separator />
        </CardContent>
      </Card>

      {/* Emergency contact */}
      <Card>
        <CardHeaderSkeleton titleWidth="w-48" />
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldSkeleton labelWidth="w-28" />
            <FieldSkeleton labelWidth="w-32" />
          </div>
          <FieldSkeleton labelWidth="w-24" />
        </CardContent>
      </Card>

      {/* Social links */}
      <Card>
        <CardHeaderSkeleton titleWidth="w-32" />
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldSkeleton labelWidth="w-20" />
            <FieldSkeleton labelWidth="w-16" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldSkeleton labelWidth="w-20" />
            <FieldSkeleton labelWidth="w-24" />
          </div>
        </CardContent>
      </Card>

      {/* Reset / Save — both `size="sm"` */}
      <div className="flex justify-end gap-3">
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>

      {/* Account information */}
      <Card>
        <CardHeaderSkeleton titleWidth="w-52" />
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 shrink-0 rounded-md" />
              <div>
                <Skeleton className="h-4 w-12" />
                <Skeleton className="mt-1.5 h-6 w-28 rounded-lg" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 shrink-0 rounded-md" />
              <div>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-1.5 h-4 w-24" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <span className="sr-only">Loading profile settings…</span>
    </div>
  );
}
