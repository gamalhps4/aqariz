"use client";

import { toast } from "sonner";
import {
  ArrowLeft,
  ClipboardCheck,
  FileText,
  Home,
  UserRound,
} from "lucide-react";
import { InspectionType } from "@/types";
import { useSession } from "@/lib/auth-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useParams, useRouter } from "next/navigation";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useAuthorization } from "@/hooks/useAuthorization";
import { createAccessProfile } from "@/lib/permissions-manager";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface PropertyOption {
  _id: string;
  name: string;
  address: { street: string; city: string; state: string };
}

interface UserOption {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface TenantOption {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
}

type LeasePropertyRef =
  | string
  | {
      _id?: string;
      name?: string;
      address?: PropertyOption["address"];
    };

type LeaseTenantRef =
  | string
  | {
      _id?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
    };

interface LeaseOption {
  _id: string;
  startDate: string;
  endDate: string;
  status: string;
  propertyId: LeasePropertyRef;
  tenantId: LeaseTenantRef;
  unit?: {
    unitNumber?: string;
  };
}

function formatAddress(address?: PropertyOption["address"]) {
  return [address?.street, address?.city, address?.state]
    .filter(Boolean)
    .join(", ");
}

function formatName(firstName?: string, lastName?: string) {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function getRefId(ref: LeasePropertyRef | LeaseTenantRef | undefined) {
  return typeof ref === "string" ? ref : ref?._id;
}

export default function EditInspectionPage() {
  const router = useRouter();
  const params = useParams();
  const inspectionId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { data: session, status } = useSession();
  const { isCompanyStaff } = useAuthorization();
  const { t, formatDate: formatLocalizedDate } = useLocalizationContext();

  const [loading, setLoading] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [inspectionStatus, setInspectionStatus] = useState("");

  // Form state
  const [propertyId, setPropertyId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [leaseId, setLeaseId] = useState("");
  const [type, setType] = useState<string>("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [inspectorId, setInspectorId] = useState("");
  const [notes, setNotes] = useState("");

  // Options
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [inspectors, setInspectors] = useState<UserOption[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [leases, setLeases] = useState<LeaseOption[]>([]);

  const fetchData = useCallback(async () => {
    if (!inspectionId) {
      return;
    }

    try {
      setLoading(true);
      setLoadingOptions(true);

      const [inspectionRes, propertiesRes, usersRes, tenantsRes, leasesRes] =
        await Promise.all([
          fetch(`/api/inspections/${inspectionId}`),
          fetch("/api/properties?limit=100"),
          fetch("/api/users?limit=100"),
          fetch("/api/tenants?limit=100"),
          fetch("/api/leases?limit=100"),
        ]);

      if (!inspectionRes.ok) {
        throw new Error(t("inspections.edit.toasts.failedToLoad"));
      }

      const inspectionData = await inspectionRes.json();
      const inspection = inspectionData?.data;

      if (!inspection) {
        throw new Error(t("inspections.edit.toasts.notFound"));
      }

      if (
        inspection.status === "completed" ||
        inspection.status === "cancelled"
      ) {
        toast.error(t("inspections.edit.toasts.cannotEditClosed"));
        router.replace(`/dashboard/inspections/${inspectionId}`);
        return;
      }

      setInspectionStatus(inspection.status ?? "");

      // Set form values
      setPropertyId(
        inspection.propertyId?._id ?? inspection.property?._id ?? "",
      );
      setTenantId(
        inspection.tenantId?._id ?? inspection.tenant?.user?._id ?? "",
      );
      setLeaseId(inspection.leaseId?._id ?? inspection.lease?._id ?? "");
      setType(inspection.type ?? "");
      setScheduledDate(
        inspection.scheduledDate
          ? new Date(inspection.scheduledDate).toISOString().slice(0, 16)
          : "",
      );
      setInspectorId(
        inspection.inspectorId?._id ?? inspection.inspector?._id ?? "",
      );
      setNotes(inspection.notes ?? "");

      // Set options
      if (propertiesRes.ok) {
        const data = await propertiesRes.json();
        setProperties(data?.data ?? []);
      }

      if (usersRes.ok) {
        const data = await usersRes.json();
        const allUsers = Array.isArray(data?.data?.users)
          ? data.data.users
          : Array.isArray(data?.data)
            ? data.data
            : [];

        setInspectors(
          allUsers.filter(
            (u: any) =>
              createAccessProfile(
                u.role,
                Array.isArray(u.permissions) ? u.permissions : [],
              ).isCompanyStaff,
          ),
        );
      }

      if (tenantsRes.ok) {
        const data = await tenantsRes.json();
        setTenants(data?.data ?? []);
      }

      if (leasesRes.ok) {
        const data = await leasesRes.json();
        setLeases(data?.data ?? []);
      }
    } catch (error: any) {
      toast.error(error?.message || t("inspections.edit.toasts.failedToLoad"));
      router.replace("/dashboard/inspections");
    } finally {
      setLoading(false);
      setLoadingOptions(false);
    }
  }, [inspectionId, router, t]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    if (!isCompanyStaff) {
      toast.info(t("inspections.edit.toasts.accessDenied"));
      router.replace("/dashboard");
      return;
    }

    fetchData();
  }, [status, isCompanyStaff, router, fetchData, t]);

  const getLeaseStatusLabel = useCallback(
    (statusValue: string | undefined) => {
      if (!statusValue) return "";

      const normalized = statusValue.toLowerCase();
      const fallback = statusValue
        .split("_")
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ");

      return t(`leases.status.${normalized}`, { defaultValue: fallback });
    },
    [t],
  );

  const inspectionTypeOptions = useMemo<SearchableSelectOption[]>(
    () => [
      {
        value: InspectionType.MOVE_IN,
        label: t("inspections.edit.options.moveInInspection"),
        icon: <ClipboardCheck className="h-4 w-4 text-muted-foreground" />,
      },
      {
        value: InspectionType.MOVE_OUT,
        label: t("inspections.edit.options.moveOutInspection"),
        icon: <ClipboardCheck className="h-4 w-4 text-muted-foreground" />,
      },
      {
        value: InspectionType.ROUTINE,
        label: t("inspections.edit.options.routineInspection"),
        icon: <ClipboardCheck className="h-4 w-4 text-muted-foreground" />,
      },
      {
        value: InspectionType.MAINTENANCE,
        label: t("inspections.edit.options.maintenanceInspection"),
        icon: <ClipboardCheck className="h-4 w-4 text-muted-foreground" />,
      },
    ],
    [t],
  );

  // Fallback default inspector if API doesn't include one
  useEffect(() => {
    const sessionUserId = session?.user?.id;
    if (sessionUserId && !inspectorId && !loading) {
      setInspectorId(sessionUserId);
    }
  }, [session?.user?.id, inspectorId, loading]);

  const propertyOptions = useMemo<SearchableSelectOption[]>(
    () =>
      properties.map((property) => ({
        value: property._id,
        label: property.name,
        subtitle: formatAddress(property.address),
        icon: <Home className="h-4 w-4 text-muted-foreground" />,
      })),
    [properties],
  );

  const inspectorOptions = useMemo<SearchableSelectOption[]>(
    () =>
      inspectors.map((inspector) => {
        const name = formatName(inspector.firstName, inspector.lastName);

        return {
          value: inspector._id,
          label: name || inspector.email,
          subtitle: inspector.email,
          icon: <UserRound className="h-4 w-4 text-muted-foreground" />,
        };
      }),
    [inspectors],
  );

  const tenantOptions = useMemo<SearchableSelectOption[]>(
    () =>
      tenants.map((tenant) => {
        const name = formatName(tenant.firstName, tenant.lastName);

        return {
          value: tenant._id,
          label: name || tenant.email,
          subtitle: tenant.email,
          icon: <UserRound className="h-4 w-4 text-muted-foreground" />,
        };
      }),
    [tenants],
  );

  const leaseOptions = useMemo<SearchableSelectOption[]>(
    () =>
      leases.map((lease) => {
        const leasePropertyId = getRefId(lease.propertyId);
        const leaseTenantId = getRefId(lease.tenantId);
        const populatedProperty =
          typeof lease.propertyId === "string" ? undefined : lease.propertyId;
        const populatedTenant =
          typeof lease.tenantId === "string" ? undefined : lease.tenantId;
        const property = properties.find(
          (propertyOption) => propertyOption._id === leasePropertyId,
        );
        const tenant = tenants.find(
          (tenantOption) => tenantOption._id === leaseTenantId,
        );
        const propertyName = populatedProperty?.name || property?.name;
        const tenantName = formatName(
          populatedTenant?.firstName || tenant?.firstName,
          populatedTenant?.lastName || tenant?.lastName,
        );
        const leaseStatus = getLeaseStatusLabel(lease.status);
        const dateRange = [
          formatLocalizedDate(lease.startDate, { format: "medium" }),
          formatLocalizedDate(lease.endDate, { format: "medium" }),
        ]
          .filter(Boolean)
          .join(` ${t("inspections.edit.labels.to")} `);
        const unitLabel = lease.unit?.unitNumber
          ? t("inspections.edit.labels.unit", {
              values: { number: lease.unit.unitNumber },
            })
          : "";
        const label =
          [propertyName, unitLabel].filter(Boolean).join(" - ") ||
          (leaseStatus
            ? `${t("inspections.edit.labels.lease")} (${leaseStatus})`
            : t("inspections.edit.labels.lease"));
        const subtitle = [tenantName, leaseStatus, dateRange]
          .filter(Boolean)
          .join(" | ");

        return {
          value: lease._id,
          label,
          subtitle,
          icon: <FileText className="h-4 w-4 text-muted-foreground" />,
        };
      }),
    [leases, properties, tenants, formatLocalizedDate, t, getLeaseStatusLabel],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!propertyId || !type || !scheduledDate || !inspectorId) {
      toast.error(t("inspections.edit.toasts.requiredFields"));
      return;
    }

    try {
      setSubmitting(true);

      const updateData: Record<string, unknown> = {
        type,
        scheduledDate: new Date(scheduledDate).toISOString(),
        inspectorId,
        notes: notes || undefined,
      };

      // Only allow property updates while still scheduled.
      if (inspectionStatus === "scheduled") {
        updateData.propertyId = propertyId;
      }

      if (tenantId) {
        updateData.tenantId = tenantId;
      }

      if (leaseId) {
        updateData.leaseId = leaseId;
      }

      const response = await fetch(`/api/inspections/${inspectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || t("inspections.edit.toasts.updateError"));
      }

      toast.success(t("inspections.edit.toasts.updateSuccess"));
      router.push(`/dashboard/inspections/${inspectionId}`);
    } catch (error: any) {
      toast.error(error?.message || t("inspections.edit.toasts.updateError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex w-full justify-center">
        <div className="w-full max-w-2xl">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-muted-foreground">
              {t("inspections.details.loading")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const lockInspectionBasics = inspectionStatus === "in_progress";

  return (
    <div className="flex w-full justify-center">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("inspections.edit.header.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("inspections.edit.header.subtitle")}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("inspections.details.actions.back")}
          </Button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="w-full space-y-6 sm:mt-2 lg:mt-6"
        >
          {/* Property & Type */}
          <Card>
            <CardHeader>
              <CardTitle>{t("inspections.edit.sections.details.title")}</CardTitle>
              <CardDescription>
                {t("inspections.edit.sections.details.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="property">
                  {t("inspections.edit.labels.propertyRequired")}
                </Label>
                <SearchableSelect
                  id="property"
                  value={propertyId}
                  onValueChange={setPropertyId}
                  options={propertyOptions}
                  placeholder={
                    loadingOptions
                      ? t("inspections.edit.placeholders.loadingProperties")
                      : t("inspections.edit.placeholders.selectProperty")
                  }
                  searchPlaceholder={t("inspections.edit.placeholders.searchProperties")}
                  emptyMessage={t("inspections.edit.placeholders.noPropertyFound")}
                  disabled={loadingOptions || lockInspectionBasics}
                />
                {lockInspectionBasics && (
                  <p className="text-xs text-muted-foreground">
                    {t("inspections.edit.messages.propertyLockedAfterStart")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">
                  {t("inspections.edit.labels.inspectionTypeRequired")}
                </Label>
                <SearchableSelect
                  id="type"
                  value={type}
                  onValueChange={setType}
                  options={inspectionTypeOptions}
                  placeholder={t("inspections.edit.placeholders.selectInspectionType")}
                  searchPlaceholder={t(
                    "inspections.edit.placeholders.searchInspectionTypes",
                  )}
                  emptyMessage={t(
                    "inspections.edit.placeholders.noInspectionTypeFound",
                  )}
                  disabled={lockInspectionBasics}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="scheduledDate">
                  {t("inspections.edit.labels.scheduledDateRequired")}
                </Label>
                <Input
                  id="scheduledDate"
                  type="datetime-local"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  disabled={lockInspectionBasics}
                />
              </div>
            </CardContent>
          </Card>

          {/* People */}
          <Card>
            <CardHeader>
              <CardTitle>{t("inspections.edit.sections.people.title")}</CardTitle>
              <CardDescription>
                {t("inspections.edit.sections.people.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inspector">
                  {t("inspections.edit.labels.inspectorRequired")}
                </Label>
                <SearchableSelect
                  id="inspector"
                  value={inspectorId}
                  onValueChange={setInspectorId}
                  options={inspectorOptions}
                  placeholder={
                    loadingOptions
                      ? t("inspections.edit.placeholders.loadingInspectors")
                      : t("inspections.edit.placeholders.selectInspector")
                  }
                  searchPlaceholder={t("inspections.edit.placeholders.searchInspectors")}
                  emptyMessage={t("inspections.edit.placeholders.noInspectorFound")}
                  disabled={loadingOptions}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tenant">
                  {t("inspections.edit.labels.tenantOptional")}
                </Label>
                <SearchableSelect
                  id="tenant"
                  value={tenantId}
                  onValueChange={setTenantId}
                  options={tenantOptions}
                  placeholder={
                    loadingOptions
                      ? t("inspections.edit.placeholders.loadingTenants")
                      : t("inspections.edit.placeholders.noTenant")
                  }
                  searchPlaceholder={t("inspections.edit.placeholders.searchTenants")}
                  emptyMessage={t("inspections.edit.placeholders.noTenantFound")}
                  disabled={loadingOptions}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lease">
                  {t("inspections.edit.labels.leaseOptional")}
                </Label>
                <SearchableSelect
                  id="lease"
                  value={leaseId}
                  onValueChange={setLeaseId}
                  options={leaseOptions}
                  placeholder={
                    loadingOptions
                      ? t("inspections.edit.placeholders.loadingLeases")
                      : t("inspections.edit.placeholders.noLease")
                  }
                  searchPlaceholder={t("inspections.edit.placeholders.searchLeases")}
                  emptyMessage={t("inspections.edit.placeholders.noLeaseFound")}
                  disabled={loadingOptions}
                />
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card className="gap-2">
            <CardHeader>
              <CardTitle>{t("inspections.edit.sections.notes.title")}</CardTitle>
              <CardDescription>
                {t("inspections.edit.sections.notes.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder={t("inspections.edit.placeholders.notes")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("inspections.edit.labels.charactersCount", {
                  values: { count: notes.length, max: 2000 },
                })}
              </p>
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex items-center justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={submitting || loadingOptions}>
              {submitting
                ? t("inspections.edit.actions.saving")
                : t("inspections.edit.actions.saveChanges")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
