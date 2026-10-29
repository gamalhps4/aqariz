import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AvailablePropertiesLoading() {
  return (
    <div className="space-y-4">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex items-center space-x-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* Unit Statistics Skeleton - Matches UnitStats component */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card
            key={i}
            className="border-0 shadow-sm bg-gray-100 dark:bg-muted dark:border-gray-700 border gap-2 p-3"
          >
            <CardHeader className="flex flex-row items-center justify-between px-2 space-y-0">
              {/* Title skeleton */}
              <Skeleton className="h-4 w-28" />
              {/* Icon container skeleton */}
              <Skeleton className="h-8 w-8 rounded-lg" />
            </CardHeader>
            <CardContent className="px-2 pb-1">
              {/* Value skeleton - text-2xl */}
              <Skeleton className="h-7 w-28 mb-1" />
              {/* Description skeleton - text-xs */}
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Available Units Card */}
      <Card>
        <CardHeader className="pb-4">
          {/* Main Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* View Mode Toggle Skeleton */}
              <Skeleton className="h-10 w-32 rounded-lg" />
            </div>
          </div>

          {/* Filters Bar Skeleton */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <Skeleton className="h-10 flex-1" />
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-10 w-[140px]" />
              <Skeleton className="h-10 w-[120px]" />
              <Skeleton className="h-10 w-[120px]" />
              <Skeleton className="h-10 w-[140px]" />
            </div>
          </div>
        </CardHeader>

        {/* Content - Property Cards Grid Skeleton */}
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="overflow-hidden py-0 gap-0">
                {/* Image Skeleton */}
                <Skeleton className="h-48 w-full" />
                {/* Card Content Skeleton */}
                <CardContent className="p-4 space-y-3">
                  {/* Title */}
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                  {/* Location */}
                  <div className="flex items-center gap-1">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  {/* Details (beds, baths, sqft) */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-4 w-4" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-4 w-4" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  </div>
                  {/* Floor */}
                  <Skeleton className="h-6 w-16" />
                  {/* Rent & Actions */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1">
                      <Skeleton className="h-6 w-20" />
                      <Skeleton className="h-4 w-8" />
                    </div>
                    <Skeleton className="h-8 w-8" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Pagination Skeleton */}
      <div className="flex justify-center items-center space-x-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-20" />
      </div>
    </div>
  );
}
