"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarStatsSkeleton } from "@/components/calendar/CalendarStatsSkeleton";
import { CalendarViewSkeleton } from "@/components/calendar/CalendarViewSkeleton";
import { EventListSkeleton } from "@/components/calendar/EventListSkeleton";

export default function CalendarLoading() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-10" />
        </div>
      </div>

      {/* Stats Cards Skeleton */}
      <CalendarStatsSkeleton />

      {/* Tabs Skeleton */}
      <Tabs value="calendar" onValueChange={() => {}} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="calendar">
            <Skeleton className="h-4 w-20" />
          </TabsTrigger>
          <TabsTrigger value="events">
            <Skeleton className="h-4 w-16" />
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <Skeleton className="h-4 w-18" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="space-y-6">
          <CalendarViewSkeleton />
        </TabsContent>

        <TabsContent value="events" className="space-y-6">
          <EventListSkeleton />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <div key={j} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Skeleton className="w-3 h-3 rounded-full" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <Skeleton className="h-5 w-8 rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
