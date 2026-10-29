"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface DashboardShellProps {
  children: ReactNode;
  renderSidebar: (isCollapsed: boolean) => ReactNode;
  headerLeading?: ReactNode;
  headerActions?: ReactNode;
  className?: string;
}

/**
 * Shared application chrome for organization and platform dashboards.
 * Route-specific layouts provide their own navigation and header tools while
 * collapse, mobile navigation, scrolling, spacing, and transitions stay in one
 * place.
 */
export function DashboardShell({
  children,
  renderSidebar,
  headerLeading,
  headerActions,
  className,
}: DashboardShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { t } = useLocalizationContext();

  useEffect(() => {
    document.documentElement.classList.add("dashboard-layout");
    document.body.classList.add("dashboard-layout");

    return () => {
      document.documentElement.classList.remove("dashboard-layout");
      document.body.classList.remove("dashboard-layout");
    };
  }, []);

  return (
    <div
      className={cn("flex h-screen overflow-hidden bg-background", className)}
    >
      {isMobileMenuOpen && (
        <button
          type="button"
          aria-label={t("nav.closeNavigation", { defaultValue: "Close navigation" })}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <aside
        className={cn(
          // Logical sides: in Arabic the drawer comes in from the right,
          // where the sidebar sits.
          "fixed inset-y-0 start-0 z-50 transition-transform duration-300 ease-in-out md:relative md:z-auto md:flex md:shrink-0 md:flex-col",
          isMobileMenuOpen
            ? "translate-x-0"
            : "-translate-x-full rtl:translate-x-full md:translate-x-0 md:rtl:translate-x-0",
        )}
      >
        {renderSidebar(isSidebarCollapsed)}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* The glass utilities paint a border on all four sides, so the header's
            left edge used to stack on top of the sidebar's border-r and read as
            one thick divider. Take the background and blur only, and keep the
            single bottom rule as the header's own border. */}
        <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-border/30 bg-glass px-4 backdrop-blur-[8px] lg:px-6">
          <div className="flex min-w-0 items-center gap-3 lg:gap-4">
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              aria-label={
                isMobileMenuOpen
                  ? t("nav.closeNavigation", { defaultValue: "Close navigation" })
                  : t("nav.openNavigation", { defaultValue: "Open navigation" })
              }
            >
              {isMobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="hidden h-10 w-10 rounded-lg border border-border/50 bg-transparent transition-colors hover:bg-transparent md:inline-flex"
              onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
              aria-label={
                isSidebarCollapsed
                  ? t("nav.expandSidebar", { defaultValue: "Expand sidebar" })
                  : t("nav.collapseSidebar", { defaultValue: "Collapse sidebar" })
              }
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="size-5 text-muted-foreground rtl:-scale-x-100" />
              ) : (
                <PanelLeftClose className="size-5 text-muted-foreground rtl:-scale-x-100" />
              )}
            </Button>

            {headerLeading}
          </div>

          {headerActions && (
            <div className="flex shrink-0 items-center gap-2 lg:gap-4">
              {headerActions}
            </div>
          )}
        </header>

        <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-linear-to-br from-background via-background to-muted/20 p-4 md:p-6">
          <div className="animate-fade-in-up">{children}</div>
        </main>
      </div>
    </div>
  );
}
