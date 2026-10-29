"use client";

/**
 * PropertyPro - Agreement detail
 *
 * Shows the terms, and — more usefully — which properties the agreement
 * actually governs after precedence is applied. A portfolio-wide agreement's
 * reach is not readable from its own row, and an operator needs to see that a
 * more specific agreement has taken a building off it.
 */

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarRange,
  Edit,
  ExternalLink,
  FileText,
  Handshake,
  Info,
  Loader2,
  Percent,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { AgreementDetail, AgreementStatus } from "@/types/agreement";

const STATUS_STYLES: Record<AgreementStatus, string> = {
  active: "bg-success/10 text-success border-success/20",
  draft: "bg-muted text-muted-foreground border-muted",
  expired: "bg-warning/10 text-warning border-warning/20",
  terminated: "bg-error/10 text-error border-error/20",
};

export default function AgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t, formatDate, formatCurrency } = useLocalizationContext();

  const [agreement, setAgreement] = useState<AgreementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/agreements/${id}`);
      if (response.status === 404) {
        setNotFound(true);
        return;
      }
      const payload = await response.json();
      if (payload?.success) setAgreement(payload.data as AgreementDetail);
    } catch (error) {
      console.error("Failed to load agreement:", error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (notFound) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Handshake className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("agreements.notFound", {
              defaultValue: "This agreement no longer exists",
            })}
          </p>
          <Button size="sm" asChild>
            <Link href="/dashboard/agreements">
              {t("agreements.backToList", {
                defaultValue: "Back to agreements",
              })}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  /** "5%" or "3,000.00 ﷼ / monthly", in the reader's language. */
  const feeText = agreement
    ? agreement.feeType === "fixed"
      ? `${formatCurrency(agreement.feeAmount)} / ${t(
          `leases.contract.frequency.${agreement.feeFrequency}`,
          { defaultValue: agreement.feeFrequency.replace(/_/g, " ") },
        )}`
      : `${agreement.feePercentage}%`
    : "";

  const scopeLabel =
    agreement?.scopeType === "property"
      ? (agreement.property?.name ?? "—")
      : agreement?.scopeType === "compound"
        ? (agreement.compound?.name ?? "—")
        : t("agreements.scope.portfolio", {
            defaultValue: "Whole portfolio",
          });

  const rows: Array<[string, React.ReactNode]> = agreement
    ? [
        [
          t("agreements.form.owner", { defaultValue: "Owner" }),
          <Link
            key="owner"
            href={`/dashboard/clients/owners/${agreement.ownerId}`}
            className="transition-colors hover:text-blue-600 dark:hover:text-blue-400"
          >
            {agreement.owner
              ? `${agreement.owner.firstName} ${agreement.owner.lastName}`.trim()
              : "—"}
          </Link>,
        ],
        [t("agreements.table.covers", { defaultValue: "Covers" }), scopeLabel],
        ...(agreement.kind === "investment"
          ? ([[t("agreements.investment.rent", { defaultValue: "Rent paid to the owner" }), feeText]] as Array<
              [string, React.ReactNode]
            >)
          : ([
              [t("agreements.table.fee", { defaultValue: "Fee" }), feeText],
              [
                t("agreements.form.basis", { defaultValue: "Charged on" }),
                t(`agreements.basis.${agreement.commissionBasis}`, {
                  defaultValue: agreement.commissionBasis,
                }),
              ],
            ] as Array<[string, React.ReactNode]>)),
        [
          t("agreements.form.term", { defaultValue: "Term" }),
          `${formatDate(agreement.startDate)}${
            agreement.endDate ? ` – ${formatDate(agreement.endDate)}` : ""
          }`,
        ],
        [
          t("agreements.detail.currency", { defaultValue: "Currency" }),
          agreement.currency,
        ],
        // The day it closed: terminated, or marked expired before its end.
        ...(agreement.terminatedDate
          ? ([
              [
                agreement.status === "terminated"
                  ? t("agreements.detail.terminated", {
                      defaultValue: "Terminated",
                    })
                  : t("agreements.detail.closed", {
                      defaultValue: "Closed on",
                    }),
                formatDate(agreement.terminatedDate),
              ],
            ] as Array<[string, React.ReactNode]>)
          : []),
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/agreements">
              <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              {agreement?.agreementNumber ??
                t("agreements.table.unnumbered", {
                  defaultValue: "(no number)",
                })}
              {agreement && (
                <Badge
                  variant="outline"
                  className={`text-xs font-normal capitalize ${STATUS_STYLES[agreement.status]}`}
                >
                  {t(`agreements.status.${agreement.status}`, {
                    defaultValue: agreement.status,
                  })}
                </Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {agreement?.kind === "investment"
                ? t("agreements.kind.investment", { defaultValue: "Investment agreement" })
                : t("agreements.detail.subtitle", {
                    defaultValue: "Management agreement",
                  })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/agreements/${id}/statement`}>
              <FileText className="h-4 w-4" />
              {t("agreements.report.openStatement", {
                defaultValue: "Statement",
              })}
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/agreements/${id}/edit`}>
              <Edit className="h-4 w-4" />
              {t("common.edit", { defaultValue: "Edit" })}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {t("agreements.detail.covers", {
                  defaultValue: "Properties this agreement governs",
                })}
              </span>
              <Badge variant="outline">{agreement?.covers.length ?? 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {agreement?.covers.length ? (
              <div className="divide-y rounded-lg border">
                {agreement.covers.map((property) => (
                  <Link
                    key={property.id}
                    href={`/dashboard/properties/${property.id}`}
                    className="flex items-center justify-between p-3 text-sm transition-colors hover:bg-muted/50"
                  >
                    <span>{property.name}</span>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                {t("agreements.detail.coversNone", {
                  defaultValue:
                    "No properties currently fall under this agreement — either the owner has none, or a more specific agreement covers each of them.",
                })}
              </p>
            )}

            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("agreements.detail.precedenceHint", {
                defaultValue:
                  "A property agreement overrides a compound one, which overrides a portfolio-wide one. Only the winning agreement earns on a building.",
              })}
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Percent className="h-4 w-4" />
                {t("agreements.detail.terms", { defaultValue: "Terms" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {rows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-3"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-end">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {agreement?.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("agreements.form.notes", { defaultValue: "Notes" })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{agreement.notes}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-2 pt-6">
              <Button variant="outline" size="sm" asChild className="w-full">
                <Link
                  href={`/dashboard/clients/owners/${agreement?.ownerId ?? ""}`}
                >
                  <UserRound className="h-4 w-4" />
                  {t("agreements.detail.openStatement", {
                    defaultValue: "Owner statement",
                  })}
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="w-full">
                <Link href="/dashboard/agreements/reports">
                  <CalendarRange className="h-4 w-4" />
                  {t("agreements.actions.report", {
                    defaultValue: "Report",
                  })}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
