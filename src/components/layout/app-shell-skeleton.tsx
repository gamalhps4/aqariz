import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Chrome-level placeholder for the whole application shell.
 *
 * The per-route `loading.tsx` skeletons only cover a page body — they render
 * *inside* an already-mounted layout. This one stands in for the layout
 * itself, for the two moments where there is no chrome on screen yet:
 *
 *  - `/admin`, whose server layout awaits the session and the platform
 *    branding before any of its own markup exists (see `admin/layout.tsx`);
 *  - the dashboard layout while it is bouncing a user who belongs elsewhere.
 *
 * Both used to paint white for the length of a session round-trip. Geometry is
 * copied from `DashboardShell` so the real chrome lands in the same place the
 * placeholder left it, with no visible jump.
 */
export function AppShellSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="flex h-screen overflow-hidden bg-background"
    >
      {/* Sidebar rail — off-canvas below md, exactly like the real sidebar. */}
      <aside className="hidden w-64 shrink-0 flex-col border-e border-gray-200 bg-white md:flex dark:border-gray-800 dark:bg-gray-900">
        <div className="flex h-16 shrink-0 items-center border-b border-gray-200 px-4 dark:border-gray-800">
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="flex-1 space-y-1.5 overflow-hidden p-4">
          {Array.from({ length: 9 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-lg" />
          ))}
        </div>
        <div className="border-t border-gray-200 p-4 dark:border-gray-800">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-border/30 bg-glass px-4 backdrop-blur-[8px] lg:px-6">
          <Skeleton className="h-8 w-44 max-w-[45vw]" />
          <div className="flex shrink-0 items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </header>

        <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-linear-to-br from-background via-background to-muted/20 p-4 md:p-6">
          {children ?? <AppShellBodySkeleton />}
        </main>
      </div>
    </div>
  );
}

/** Neutral page body: a title block, a stat row, then two panels. */
function AppShellBodySkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
