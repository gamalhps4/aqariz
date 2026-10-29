import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";

/**
 * Body skeleton for the console. Sits inside the chrome, so it covers page
 * navigation within /admin; the layout's own Suspense fallback covers the
 * earlier moment when there is no chrome yet. Shaped after the overview page,
 * which is what /admin itself renders.
 */
export default function PlatformConsoleLoading() {
  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="mb-2 h-8 w-16" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex-row items-center justify-between">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-8 w-20" />
            </CardHeader>
            <CardContent className="space-y-1">
              {Array.from({ length: 5 }).map((_, row) => (
                <div key={row} className="flex items-center justify-between gap-4 px-3 py-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-40 max-w-full" />
                    <Skeleton className="h-3 w-56 max-w-full" />
                  </div>
                  <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </ResponsiveLayout>
  );
}
