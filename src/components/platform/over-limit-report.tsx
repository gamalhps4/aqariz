"use client";

/**
 * PropertyPro SaaS - Over-limit organizations (platform console)
 *
 * Limits block creation, never existing data — so a customer who downgrades
 * keeps everything they already had and simply cannot add more. That is the
 * right product behaviour, but it leaves revenue on the table invisibly:
 * nothing told the operator that an account is sitting on Business-sized
 * usage while paying for Free. This panel is that signal.
 *
 * The sweep costs a handful of queries per organization, so it loads on
 * demand rather than with the rest of the billing dashboard.
 */

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatPlanLimitValue,
  planLimitLabel,
  type PlanLimitKey,
} from "@/lib/billing/plan-constants";

interface Overage {
  key: PlanLimitKey;
  limit: number;
  usage: number;
  over: number;
}

interface OverLimitOrg {
  organizationId: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  overages: Overage[];
}

export function OverLimitReport() {
  const [organizations, setOrganizations] = useState<OverLimitOrg[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/over-limit");
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to build the report");
      }
      setOrganizations(payload.data.organizations as OverLimitOrg[]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to build the report",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Over plan limits</CardTitle>
          <CardDescription>
            Organizations using more than their current plan allows — usually
            after a downgrade or a lapsed subscription. Existing data keeps
            working; they just can&apos;t add more.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={loading}
          className="shrink-0"
        >
          {loading ? (
            <>
              <Loader2 className="me-2 size-4 animate-spin" />
              Checking…
            </>
          ) : organizations ? (
            "Re-check"
          ) : (
            "Run check"
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!error && organizations === null && (
          <p className="text-sm text-muted-foreground">
            Not run yet — this scans every organization&apos;s usage against its
            plan.
          </p>
        )}

        {!error && organizations?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Every organization is within its plan limits.
          </p>
        )}

        {!error && organizations && organizations.length > 0 && (
          <ul className="divide-y">
            {organizations.map((organization) => (
              <li key={organization.organizationId} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                  <Link
                    href={`/admin/organizations/${organization.organizationId}`}
                    className="font-medium hover:underline"
                  >
                    {organization.name}
                  </Link>
                  <Badge variant="outline" className="capitalize">
                    {organization.plan}
                  </Badge>
                  <Badge
                    variant={
                      organization.status === "suspended"
                        ? "destructive"
                        : "secondary"
                    }
                    className="capitalize"
                  >
                    {organization.status}
                  </Badge>
                  <ChevronRight className="ms-auto size-4 text-muted-foreground rtl:-scale-x-100" />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 ps-6 text-sm text-muted-foreground">
                  {organization.overages.map((overage) => (
                    <span key={overage.key} className="tabular-nums">
                      {planLimitLabel(overage.key)}:{" "}
                      <span className="font-medium text-foreground">
                        {formatPlanLimitValue(overage.key, overage.usage)}
                      </span>{" "}
                      / {formatPlanLimitValue(overage.key, overage.limit)}
                      <span className="text-amber-700 dark:text-amber-500">
                        {" "}
                        (+{formatPlanLimitValue(overage.key, overage.over)})
                      </span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
