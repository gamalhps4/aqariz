"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertCircle, ArrowLeft, Building2, Check, CreditCard, FileText, Home, Loader2, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnalyticsCard, AnalyticsCardGrid } from "@/components/analytics/AnalyticsCard";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { summarizeModules } from "@/lib/billing/modules";

interface OrganizationDetail {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "trial";
  plan: string;
  createdAt: string;
  owner: { id: string; name: string; email: string; isActive: boolean; lastLogin: string | null } | null;
  usage: { users: number; properties: number; leases: number };
  billing: {
    subscriptionStatus: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    stripePriceId: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  limits: { properties: number | null; members: number | null };
  modules: string[];
}

/** Loaded from /api/admin/plans rather than hard-coded: a custom plan created
 * in the Plans console was previously impossible to assign here, even though
 * the API would have accepted it. */
interface PlanOption {
  key: string;
  name: string;
}
const MANAGED_STATUSES = ["incomplete", "trialing", "active", "past_due", "unpaid", "paused"];

export default function OrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const { t, formatDate } = useLocalizationContext();
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [status, setStatus] = useState("active");
  const [plan, setPlan] = useState("free");
  const [trialEndsAt, setTrialEndsAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/organizations/${params.id}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load organization");
      const value: OrganizationDetail = payload.data.organization;
      setOrganization(value);
      setStatus(value.status);
      setPlan(value.plan);
      setTrialEndsAt(value.billing.trialEndsAt ? value.billing.trialEndsAt.slice(0, 10) : "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("platform.orgDetail.loadError", { defaultValue: "Unable to load organization" }));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/plans")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const rows = payload?.data?.plans;
        if (!active || !Array.isArray(rows)) return;
        setPlanOptions(
          rows
            .filter((row: { isActive?: boolean }) => row.isActive !== false)
            .map((row: { key: string; name: string }) => ({
              key: row.key,
              name: row.name,
            })),
        );
      })
      .catch(() => {
        // The picker falls back to the plan already on the organization.
      });
    return () => { active = false; };
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/organizations/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, plan, trialEndsAt: trialEndsAt || null }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to update organization");
      setMessage("Organization controls updated.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("platform.orgDetail.updateError", { defaultValue: "Unable to update organization" }));
    } finally {
      setSaving(false);
    }
  }

  async function openBillingPortal() {
    setOpeningPortal(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/organizations/${params.id}/billing-portal`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.data?.url) throw new Error(payload.error || "Unable to open billing portal");
      window.location.assign(payload.data.url);
    } catch (portalError) {
      setError(portalError instanceof Error ? portalError.message : t("platform.orgDetail.portalError", { defaultValue: "Unable to open billing portal" }));
      setOpeningPortal(false);
    }
  }

  if (loading && !organization) return <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!organization) return <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error || "Organization not found"}</AlertDescription></Alert>;

  const stripeManaged = Boolean(organization.billing.stripeSubscriptionId) && MANAGED_STATUSES.includes(organization.billing.subscriptionStatus || "");

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ms-2"><Link href="/admin/organizations"><ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />{t("platform.nav.organizations", { defaultValue: "Organizations" })}</Link></Button>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div><div className="flex items-center gap-3"><h1 className="text-3xl font-bold tracking-tight">{organization.name}</h1><Badge variant={organization.status === "suspended" ? "destructive" : "secondary"} className="capitalize">{organization.status}</Badge></div><p className="text-muted-foreground">/{organization.slug} · created {formatDate(organization.createdAt, { format: "medium" })}</p></div>
          <div className="flex flex-wrap gap-2">
            {/* Everything this organization's people did, already filtered. */}
            <Button asChild variant="outline"><Link href={`/admin/activity?organizationId=${organization.id}`}><Activity className="me-2 h-4 w-4" />{t("platform.orgDetail.viewActivity", { defaultValue: "View activity" })}</Link></Button>
            {organization.billing.stripeCustomerId && <Button variant="outline" disabled={openingPortal} onClick={() => void openBillingPortal()}>{openingPortal ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <CreditCard className="me-2 h-4 w-4" />}Open billing portal</Button>}
          </div>
        </div>
      </div>

      {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}

      {/* Plan usage only. This organization's invoices and payments are their
          own business — the platform's relationship with them is the
          subscription, not what they collect from their tenants. */}
      <AnalyticsCardGrid className="lg:grid-cols-3">
        <AnalyticsCard title={t("platform.orgDetail.stats.users", { defaultValue: "Users" })} value={organization.usage.users} description={`Limit: ${organization.limits.members ?? t("platform.common.unlimited", { defaultValue: "Unlimited" })}`} icon={Users} iconColor="primary" />
        <AnalyticsCard title={t("platform.orgDetail.stats.properties", { defaultValue: "Properties" })} value={organization.usage.properties} description={`Limit: ${organization.limits.properties ?? "Unlimited"}`} icon={Home} iconColor="success" />
        <AnalyticsCard title={t("platform.orgDetail.stats.leases", { defaultValue: "Leases" })} value={organization.usage.leases} description={t("platform.orgDetail.stats.leasesHint", { defaultValue: "All lease records" })} icon={FileText} iconColor="info" />
      </AnalyticsCardGrid>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />{t("platform.orgDetail.controls.title", { defaultValue: "Organization controls" })}</CardTitle><CardDescription>{t("platform.orgDetail.controls.subtitle", { defaultValue: "Control account access, trial timing, and non-Stripe plan assignment." })}</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-2"><Label>{t("platform.orgDetail.status", { defaultValue: "Status" })}</Label><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">{t("platform.orgDetail.status.active", { defaultValue: "Active" })}</SelectItem><SelectItem value="trial">{t("platform.orgDetail.status.trial", { defaultValue: "Trial" })}</SelectItem><SelectItem value="suspended">{t("platform.orgDetail.status.suspended", { defaultValue: "Suspended" })}</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{t("platform.orgDetail.suspendHint", { defaultValue: "Suspending an organization blocks its members during sign-in and session refresh." })}</p></div>
            <div className="grid gap-2"><Label>{t("platform.orgDetail.plan", { defaultValue: "Plan" })}</Label><Select value={plan} onValueChange={setPlan} disabled={stripeManaged}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(planOptions.length ? planOptions : [{ key: plan, name: plan }]).map((option) => <SelectItem key={option.key} value={option.key}><span className="capitalize">{option.name}</span></SelectItem>)}</SelectContent></Select>{stripeManaged && <p className="text-xs text-muted-foreground">{t("platform.orgDetail.stripeManaged", { defaultValue: "This subscription is Stripe-managed. Use the billing portal for upgrades or downgrades." })}</p>}</div>
            <div className="grid gap-2"><Label htmlFor="trial-end">{t("platform.orgDetail.trialEndDate", { defaultValue: "Trial end date" })}</Label><Input id="trial-end" type="date" value={trialEndsAt} onChange={(event) => setTrialEndsAt(event.target.value)} /></div>
            <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Save controls</Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t("platform.orgDetail.owner", { defaultValue: "Owner" })}</CardTitle></CardHeader>
            <CardContent>{organization.owner ? <div><div className="flex items-center gap-2"><p className="font-medium">{organization.owner.name}</p><Badge variant={organization.owner.isActive ? "default" : "destructive"}>{organization.owner.isActive ? "Active" : t("platform.common.inactive", { defaultValue: "Inactive" })}</Badge></div><p className="text-sm text-muted-foreground">{organization.owner.email}</p><p className="mt-2 text-xs text-muted-foreground">Last login: {organization.owner.lastLogin ? formatDate(organization.owner.lastLogin, { format: "medium" }) : t("platform.common.never", { defaultValue: "Never" })}</p></div> : <p className="text-sm text-muted-foreground">{t("platform.orgDetail.ownerUnavailable", { defaultValue: "Owner record unavailable." })}</p>}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("platform.orgDetail.subscription", { defaultValue: "Subscription" })}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">{t("platform.billing.col.plan", { defaultValue: "Plan" })}</span><span className="font-medium capitalize">{organization.plan}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">{t("platform.users.col.status", { defaultValue: "Status" })}</span><Badge variant="outline" className="capitalize">{(organization.billing.subscriptionStatus || "none").replace("_", " ")}</Badge></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">{t("platform.orgDetail.trialEnds", { defaultValue: "Trial ends" })}</span><span>{organization.billing.trialEndsAt ? formatDate(organization.billing.trialEndsAt, { format: "medium" }) : "—"}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">{t("platform.orgDetail.renews", { defaultValue: "Renews" })}</span><span>{organization.billing.currentPeriodEnd ? formatDate(organization.billing.currentPeriodEnd, { format: "medium" }) : "—"}</span></div>
              {organization.billing.cancelAtPeriodEnd && <Alert variant="destructive"><AlertDescription>{t("platform.orgDetail.cancelScheduled", { defaultValue: "Subscription is scheduled to cancel at period end." })}</AlertDescription></Alert>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("platform.orgDetail.entitlements", { defaultValue: "Entitlements" })}</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-1">
              {summarizeModules(new Set(organization.modules))
                .filter((row) => row.enabled > 0)
                .map((row) => (
                  <span
                    key={row.key}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                  >
                    <Check className="h-3 w-3 text-emerald-600" />
                    {t(row.title, { defaultValue: row.label })}
                    {row.enabled < row.total && (
                      <span className="tabular-nums text-muted-foreground">
                        {t("platform.planForm.modules.count", {
                          defaultValue: "{enabled} of {total}",
                          values: { enabled: row.enabled, total: row.total },
                        })}
                      </span>
                    )}
                  </span>
                ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </ResponsiveLayout>
  );
}
