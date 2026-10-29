"use client";

/**
 * PropertyPro - Client Affairs
 *
 * The hub the scope calls for: tenants, owners and their reports in one
 * place. Tenants keep living under /dashboard/tenants — this links to them
 * rather than duplicating the module, so every existing link and bookmark
 * still works.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  FileSpreadsheet,
  Receipt,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { OwnerSummary } from "@/types/owner";

interface HubTotals {
  owners: number;
  properties: number;
  rentRoll: number;
  outstanding: number;
  tenants: number;
}

export default function ClientAffairsPage() {
  const { t, formatCurrency } = useLocalizationContext();
  const [totals, setTotals] = useState<HubTotals>({
    owners: 0,
    properties: 0,
    rentRoll: 0,
    outstanding: 0,
    tenants: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const loadOwners = fetch("/api/owners")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => (payload?.data ?? []) as OwnerSummary[])
      .catch(() => [] as OwnerSummary[]);

    const loadTenants = fetch("/api/tenants?limit=1")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => payload?.pagination?.total ?? 0)
      .catch(() => 0);

    Promise.all([loadOwners, loadTenants]).then(([owners, tenantCount]) => {
      if (cancelled) return;
      setTotals({
        owners: owners.length,
        properties: owners.reduce((sum, o) => sum + o.propertyCount, 0),
        rentRoll: owners.reduce((sum, o) => sum + o.monthlyRent, 0),
        outstanding: owners.reduce((sum, o) => sum + o.outstandingBalance, 0),
        tenants: tenantCount,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const sections = [
    {
      href: "/dashboard/tenants",
      icon: Users,
      titleKey: "nav.clients.tenants",
      titleFallback: "Tenants",
      bodyKey: "clients.hub.tenants",
      bodyFallback:
        "Everyone renting from you, with their contracts, payments and ledger",
      cta: t("clients.hub.openTenants", { defaultValue: "Open tenants" }),
    },
    {
      href: "/dashboard/clients/owners",
      icon: UserRound,
      titleKey: "nav.clients.owners",
      titleFallback: "Owners",
      bodyKey: "clients.hub.owners",
      bodyFallback:
        "Everyone who owns property here, with their portfolio and statement of account",
      cta: t("clients.hub.openOwners", { defaultValue: "Open owners" }),
    },
    {
      href: "/dashboard/payments/reports",
      icon: FileSpreadsheet,
      titleKey: "clients.hub.reportsTitle",
      titleFallback: "Reports",
      bodyKey: "clients.hub.reports",
      bodyFallback:
        "Overdue and outstanding rent, collections by period and by building",
      cta: t("clients.hub.openReports", { defaultValue: "Open reports" }),
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("nav.clients", { defaultValue: "Client Affairs" })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("clients.hub.subtitle", {
            defaultValue:
              "Tenants, owners and their financial statements in one place",
          })}
        </p>
      </div>

      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("nav.clients.tenants", { defaultValue: "Tenants" })}
          value={String(totals.tenants)}
          icon={Users}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("nav.clients.owners", { defaultValue: "Owners" })}
          value={String(totals.owners)}
          icon={UserRound}
          iconColor="primary"
          description={t("clients.hub.propertyCount", {
            defaultValue: "{count} properties",
            values: { count: totals.properties },
          })}
        />
        <AnalyticsCard
          title={t("clients.owners.stats.rent", { defaultValue: "Rent roll" })}
          value={formatCurrency(totals.rentRoll)}
          icon={Receipt}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("clients.owners.stats.outstanding", {
            defaultValue: "Outstanding",
          })}
          value={formatCurrency(totals.outstanding)}
          icon={Wallet}
          iconColor="warning"
        />
      </AnalyticsCardGrid>

      <div className="grid gap-4 md:grid-cols-3">
        {sections.map((section) => (
          <Card key={section.href} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <section.icon className="h-4 w-4" />
                {t(section.titleKey, { defaultValue: section.titleFallback })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {t(section.bodyKey, { defaultValue: section.bodyFallback })}
              </p>
              <Button variant="outline" size="sm" asChild className="self-start">
                <Link href={section.href}>
                  {section.cta}
                  <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            {t("clients.hub.statementsTitle", {
              defaultValue: "Statements of account",
            })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="mb-1 text-sm font-medium">
              {t("clients.hub.ownerStatement", {
                defaultValue: "Owner statement of account",
              })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("clients.hub.ownerStatementBody", {
                defaultValue:
                  "Rent collected, expenses, management commission and the net owed — per owner, for any period.",
              })}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="mb-1 text-sm font-medium">
              {t("clients.hub.tenantStatement", {
                defaultValue: "Tenant statement of account",
              })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("clients.hub.tenantStatementBody", {
                defaultValue:
                  "Every charge and payment on a tenant's ledger, with the running balance. Open a tenant to view theirs.",
              })}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
