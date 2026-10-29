"use client";

/**
 * PropertyPro - Compound detail
 *
 * Shows the compound's rollup alongside its member properties. Every property
 * row links straight to its own page: the compound reports on them, it never
 * becomes the place you manage them from.
 */

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building,
  Building2,
  Calendar,
  DoorOpen,
  Edit,
  ExternalLink,
  MapPin,
  Ruler,
  TrendingUp,
  User,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { displayCountry } from "@/lib/regional/region";
import { usePropertyCategories } from "@/hooks/use-property-categories";
import type { CompoundChildProperty, CompoundDetail } from "@/types/compound";

export default function CompoundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { t, formatCurrency, formatDate, language } = useLocalizationContext();
  const { labelFor: categoryLabelFor } = usePropertyCategories("property");

  const [compound, setCompound] = useState<CompoundDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchCompound = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/compounds/${id}`);
      if (response.status === 404) {
        setNotFound(true);
        return;
      }
      const payload = await response.json();
      if (payload?.success) setCompound(payload.data as CompoundDetail);
    } catch (error) {
      console.error("Failed to fetch compound:", error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCompound();
  }, [fetchCompound]);

  const columns: DataTableColumn<CompoundChildProperty>[] = [
    {
      id: "name",
      header: t("compounds.detail.propertyName", { defaultValue: "Property" }),
      cell: (row) => (
        <Link
          href={`/dashboard/properties/${row.id}`}
          className="group inline-flex flex-col text-foreground"
        >
          <span className="text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {row.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.addressStreet}
          </span>
        </Link>
      ),
      width: "min-w-[200px]",
    },
    {
      id: "type",
      header: t("compounds.detail.propertyType", { defaultValue: "Category" }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal">
          {categoryLabelFor(row.type)}
        </Badge>
      ),
      width: "min-w-[130px]",
    },
    {
      id: "units",
      header: t("compounds.detail.propertyUnits", { defaultValue: "Units" }),
      cell: (row) => <span className="text-sm">{row.totalUnits}</span>,
      align: "center",
      visibility: "md",
      width: "min-w-[90px]",
    },
    {
      id: "status",
      header: t("compounds.detail.propertyStatus", { defaultValue: "Status" }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs capitalize font-normal">
          {t(`properties.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
      width: "min-w-[110px]",
    },
    {
      id: "open",
      header: "",
      cell: (row) => (
        <Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0">
          <Link href={`/dashboard/properties/${row.id}`}>
            <ExternalLink className="h-4 w-4" />
          </Link>
        </Button>
      ),
      width: "w-10",
      align: "center",
    },
  ];

  if (notFound) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Building className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("compounds.detail.notFound", {
              defaultValue: "This compound no longer exists",
            })}
          </p>
          <Button size="sm" onClick={() => router.push("/dashboard/compounds")}>
            {t("compounds.detail.backToList", {
              defaultValue: "Back to compounds",
            })}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const stats = compound?.stats;
  const address = compound?.address;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/compounds">
              <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {compound?.name ??
                t("compounds.detail.loading", { defaultValue: "Loading…" })}
            </h1>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {[
                address?.street,
                address?.city,
                address?.state,
                displayCountry(address?.country, language),
              ]
                .filter(Boolean)
                .join(", ") || "—"}
            </p>
          </div>
        </div>
        {compound && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push(`/dashboard/compounds/${id}/edit`)}
          >
            <Edit className="h-4 w-4" />
            {t("common.edit", { defaultValue: "Edit" })}
          </Button>
        )}
      </div>

      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("compounds.stats.properties", { defaultValue: "Properties" })}
          value={String(stats?.propertyCount ?? 0)}
          icon={Building2}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("compounds.stats.units", { defaultValue: "Units" })}
          value={String(stats?.unitCount ?? 0)}
          icon={DoorOpen}
          iconColor="info"
          description={t("compounds.stats.occupancyValue", {
            defaultValue: "{rate}% occupied",
            values: { rate: (stats?.occupancyRate ?? 0).toFixed(1) },
          })}
        />
        <AnalyticsCard
          title={t("compounds.stats.monthlyRent", {
            defaultValue: "Monthly Rent",
          })}
          value={formatCurrency(stats?.monthlyRent ?? 0)}
          icon={TrendingUp}
          iconColor="success"
          description={t("compounds.stats.activeLeases", {
            defaultValue: "{count} active contracts",
            values: { count: stats?.activeLeases ?? 0 },
          })}
        />
        <AnalyticsCard
          title={t("compounds.stats.outstanding", {
            defaultValue: "Outstanding",
          })}
          value={formatCurrency(stats?.outstandingBalance ?? 0)}
          icon={Wallet}
          iconColor="warning"
        />
      </AnalyticsCardGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Building className="h-4 w-4" />
                {t("compounds.detail.properties", {
                  defaultValue: "Properties in this compound",
                })}
              </span>
              <Badge variant="outline">{compound?.properties?.length ?? 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={compound?.properties ?? []}
              loading={loading}
              getRowKey={(row) => row.id}
              emptyState={{
                icon: <Building2 className="h-10 w-10 text-muted-foreground" />,
                title: t("compounds.detail.emptyTitle", {
                  defaultValue: "No properties attached",
                }),
                description: t("compounds.detail.emptyDescription", {
                  defaultValue:
                    "Edit this compound to attach buildings, villas or other properties",
                }),
                action: (
                  <Button
                    size="sm"
                    onClick={() =>
                      router.push(`/dashboard/compounds/${id}/edit`)
                    }
                  >
                    <Edit className="h-4 w-4 me-2" />
                    {t("common.edit", { defaultValue: "Edit" })}
                  </Button>
                ),
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("compounds.detail.info", { defaultValue: "Details" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {compound?.code && (
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">
                  {t("compounds.form.code", { defaultValue: "Reference code" })}
                </span>
                <span className="font-mono">{compound.code}</span>
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                {t("compounds.form.owner", { defaultValue: "Owner" })}
              </span>
              <span className="text-end">
                {compound?.owner
                  ? `${compound.owner.firstName} ${compound.owner.lastName}`
                  : "—"}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                {t("compounds.form.manager", { defaultValue: "Manager" })}
              </span>
              <span className="text-end">
                {compound?.manager
                  ? `${compound.manager.firstName} ${compound.manager.lastName}`
                  : "—"}
              </span>
            </div>
            {compound?.totalArea != null && (
              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Ruler className="h-3.5 w-3.5" />
                  {t("compounds.form.totalArea", {
                    defaultValue: "Total area (m²)",
                  })}
                </span>
                <span>{compound.totalArea.toLocaleString()}</span>
              </div>
            )}
            {compound?.yearBuilt != null && (
              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {t("compounds.form.yearBuilt", { defaultValue: "Year built" })}
                </span>
                <span>{compound.yearBuilt}</span>
              </div>
            )}
            {compound?.createdAt && (
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">
                  {t("common.created", { defaultValue: "Created" })}
                </span>
                <span>{formatDate(compound.createdAt)}</span>
              </div>
            )}
            {compound?.description && (
              <div className="space-y-1 border-t pt-3">
                <p className="text-muted-foreground">
                  {t("compounds.form.description", {
                    defaultValue: "Description",
                  })}
                </p>
                <p className="whitespace-pre-wrap">{compound.description}</p>
              </div>
            )}
            {compound?.notes && (
              <div className="space-y-1 border-t pt-3">
                <p className="text-muted-foreground">
                  {t("compounds.form.notes", { defaultValue: "Internal notes" })}
                </p>
                <p className="whitespace-pre-wrap">{compound.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
