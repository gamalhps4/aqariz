"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Building2, CircleDollarSign, Home, RefreshCw, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnalyticsCard, AnalyticsCardGrid } from "@/components/analytics/AnalyticsCard";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { APP_CURRENCY } from "@/lib/regional/region";

interface OverviewData {
  organizations: { total: number; active: number; trial: number; suspended: number };
  users: { total: number; byRole: Record<string, number> };
  properties: number;
  billing: {
    currency: string;
    mrr: number;
    arr: number;
    atRiskMrr: number;
    paying: number;
    pastDue: number;
  };
  recentOrganizations: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: string;
    createdAt: string;
  }>;
  recentActivity: Array<{
    id: string;
    summary: string;
    actorEmail: string;
    createdAt: string;
  }>;
}

export default function PlatformOverviewPage() {
  const { t, formatDate } = useLocalizationContext();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/overview");
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load overview");
      setData(payload.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("platform.overview.loadError", { defaultValue: "Unable to load overview" }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: data?.billing.currency || APP_CURRENCY,
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("platform.overview.title", { defaultValue: "Platform overview" })}</h1>
          <p className="text-muted-foreground">{t("platform.overview.subtitle", { defaultValue: "A live operating view across every PropertyPro organization." })}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("platform.common.refresh", { defaultValue: "Refresh" })}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <AnalyticsCardGrid className="lg:grid-cols-3 xl:grid-cols-6">
        <AnalyticsCard title={t("platform.overview.stats.organizations", { defaultValue: "Organizations" })} value={loading ? "—" : data?.organizations.total ?? 0} description={`${data?.organizations.active ?? 0} active`} icon={Building2} iconColor="primary" />
        <AnalyticsCard title={t("platform.overview.stats.users", { defaultValue: "Users" })} value={loading ? "—" : data?.users.total ?? 0} description={t("platform.overview.stats.usersHint", { defaultValue: "Organization members" })} icon={Users} iconColor="info" />
        <AnalyticsCard title={t("platform.overview.stats.properties", { defaultValue: "Properties" })} value={loading ? "—" : data?.properties ?? 0} description={t("platform.overview.stats.propertiesHint", { defaultValue: "Managed platform-wide" })} icon={Home} iconColor="success" />
        <AnalyticsCard title={t("platform.overview.stats.mrr", { defaultValue: "MRR" })} value={loading ? "—" : money(data?.billing.mrr ?? 0)} description={`${data?.billing.paying ?? 0} paying orgs`} icon={CircleDollarSign} iconColor="success" />
        <AnalyticsCard title={t("platform.overview.stats.trials", { defaultValue: "Trials" })} value={loading ? "—" : data?.organizations.trial ?? 0} description={t("platform.overview.stats.trialsHint", { defaultValue: "Organizations evaluating" })} icon={Building2} iconColor="warning" />
        <AnalyticsCard title={t("platform.overview.stats.atRisk", { defaultValue: "At risk" })} value={loading ? "—" : money(data?.billing.atRiskMrr ?? 0)} description={`${data?.billing.pastDue ?? 0} past due`} icon={CircleDollarSign} iconColor="error" />
      </AnalyticsCardGrid>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("platform.overview.newest", { defaultValue: "Newest organizations" })}</CardTitle>
            <Button asChild variant="ghost" size="sm"><Link href="/admin/organizations">{t("platform.common.viewAll", { defaultValue: "View all" })}</Link></Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {(data?.recentOrganizations ?? []).map((organization) => (
              <Link key={organization.id} href={`/admin/organizations/${organization.id}`} className="flex items-center justify-between gap-4 rounded-lg px-3 py-3 hover:bg-muted/60">
                <div className="min-w-0">
                  <p className="truncate font-medium">{organization.name}</p>
                  <p className="text-xs text-muted-foreground">/{organization.slug} · {formatDate(organization.createdAt, { format: "medium" })}</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="capitalize">{organization.plan}</Badge>
                  <Badge variant={organization.status === "suspended" ? "destructive" : "secondary"} className="capitalize">{organization.status}</Badge>
                </div>
              </Link>
            ))}
            {!loading && !data?.recentOrganizations.length && <p className="py-8 text-center text-sm text-muted-foreground">{t("platform.overview.noOrganizations", { defaultValue: "No organizations yet." })}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("platform.overview.recentActivity", { defaultValue: "Recent control activity" })}</CardTitle>
            <Button asChild variant="ghost" size="sm"><Link href="/admin/activity">{t("platform.common.viewAll", { defaultValue: "View all" })}</Link></Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {(data?.recentActivity ?? []).map((event) => (
              <div key={event.id} className="rounded-lg px-3 py-3">
                <p className="text-sm font-medium">{event.summary}</p>
                <p className="text-xs text-muted-foreground">{event.actorEmail} · {formatDate(event.createdAt, { format: "medium" })}</p>
              </div>
            ))}
            {!loading && !data?.recentActivity.length && <p className="py-8 text-center text-sm text-muted-foreground">{t("platform.overview.noActivity", { defaultValue: "Control changes will appear here." })}</p>}
          </CardContent>
        </Card>
      </div>
    </ResponsiveLayout>
  );
}
