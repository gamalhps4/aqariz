"use client";

/**
 * PropertyPro - The dashboard's "page not found" card
 *
 * A client component so it can speak the reader's language; the not-found
 * file that renders it stays a server component.
 */

import Link from "next/link";
import { Home, SearchX, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export function DashboardNotFoundCard() {
  const { t } = useLocalizationContext();
  return (
    <Card className="relative w-full max-w-2xl overflow-hidden border-border/50 bg-card/80 backdrop-blur-sm shadow-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-linear-to-r from-primary/80 via-info/70 to-success/80" />
      <CardContent className="p-6 sm:p-8 md:p-10">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <SearchX className="h-8 w-8" />
        </div>

        <div className="space-y-3 text-center">
          <p className="text-md font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("errors.notFound.code", { defaultValue: "Error 404" })}
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t("errors.notFound.title", { defaultValue: "This page is not available" })}
          </h1>
          <p className="mx-auto max-w-md text-sm text-muted-foreground sm:text-base">
            {t("errors.notFound.description", { defaultValue: "The link may be out of date, the page may have moved, or you may not have permission to see it." })}
          </p>
        </div>

        <div className="mt-8 flex justify-center gap-4">
          <Button asChild size="sm">
            <Link href="/dashboard">
              <Home className="me-2 h-4 w-4" />
              {t("errors.notFound.home", { defaultValue: "Back to the dashboard" })}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/payments">
              <Wallet className="me-2 h-4 w-4" />
              {t("errors.notFound.payments", { defaultValue: "Payments" })}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
