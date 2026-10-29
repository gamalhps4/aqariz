"use client";

import { toast } from "sonner";
import { InspectionType } from "@/types";
import {
  ArrowLeft,
  ClipboardCheck,
  FileText,
  Home,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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

function getRefId(ref: LeasePropertyRef | LeaseTenantRef) {
  return typeof ref === "string" ? ref : ref?._id;
}

export default function NewInspectionPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { isCompanyStaff } = useAuthorization();
  const { t, formatDate: formatLocalizedDate } = useLocalizationContext();
  const [submitting, setSubmitting] = useState(false);
  const hasFetchedOptions = useRef(false);

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
  const [loadingOptions, setLoadingOptions] = useState(true);

  const fetchOptions = useCallback(async () => {
    try {
      setLoadingOptions(true);
      const [propertiesRes, usersRes, tenantsRes, leasesRes] =
        await Promise.all([
          fetch("/api/properties?limit=100"),
          fetch("/api/users?limit=100"),
          fetch("/api/tenants?limit=100"),
          fetch("/api/leases?limit=100"),
        ]);

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

        // Filter to company staff who can inspect
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
    } catch (error) {
      toast.error(t("inspections.create.toasts.failedToLoadOptions"));
    } finally {
      setLoadingOptions(false);
    }
  }, [t]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    if (!isCompanyStaff) {
      toast.info(t("inspections.create.toasts.accessDenied"));
      router.replace("/dashboard");
      return;
    }

    if (hasFetchedOptions.current) {
      return;
    }

    hasFetchedOptions.current = true;
    fetchOptions();
  }, [status, isCompanyStaff, router, fetchOptions, t]);

  // Auto-set inspector to current user if they're admin/manager
  useEffect(() => {
    const sessionUserId = session?.user?.id;
    if (sessionUserId && !inspectorId) {
      setInspectorId(sessionUserId);
    }
  }, [session?.user?.id, inspectorId]);

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
        label: t("inspections.create.options.moveInInspection"),
        icon: <ClipboardCheck className="h-4 w-4 text-muted-foreground" />,
      },
      {
        value: InspectionType.MOVE_OUT,
        label: t("inspections.create.options.moveOutInspection"),
        icon: <ClipboardCheck className="h-4 w-4 text-muted-foreground" />,
      },
      {
        value: InspectionType.ROUTINE,
        label: t("inspections.create.options.routineInspection"),
        icon: <ClipboardCheck className="h-4 w-4 text-muted-foreground" />,
      },
      {
        value: InspectionType.MAINTENANCE,
        label: t("inspections.create.options.maintenanceInspection"),
        icon: <ClipboardCheck className="h-4 w-4 text-muted-foreground" />,
      },
    ],
    [t],
  );

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
          .join(` ${t("inspections.create.labels.to")} `);
        const unitLabel = lease.unit?.unitNumber
          ? t("inspections.create.labels.unit", {
              values: { number: lease.unit.unitNumber },
            })
          : "";
        const label =
          [propertyName, unitLabel].filter(Boolean).join(" - ") ||
          (leaseStatus
            ? `${t("inspections.create.labels.lease")} (${leaseStatus})`
            : t("inspections.create.labels.lease"));
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
      toast.error(t("inspections.create.toasts.requiredFields"));
      return;
    }

    try {
      setSubmitting(true);

      const inspectionData: Record<string, unknown> = {
        propertyId,
        type,
        scheduledDate: new Date(scheduledDate).toISOString(),
        inspectorId,
        notes: notes || undefined,
      };

      if (tenantId) inspectionData.tenantId = tenantId;
      if (leaseId) inspectionData.leaseId = leaseId;

      const response = await fetch("/api/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inspectionData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || t("inspections.create.toasts.createError"));
      }

      const createdInspectionId = data?.data?._id;
      if (!createdInspectionId) {
        throw new Error(t("inspections.create.toasts.missingId"));
      }

      toast.success(t("inspections.create.toasts.createSuccess"));
      router.push(`/dashboard/inspections/${createdInspectionId}`);
    } catch (error: any) {
      toast.error(error?.message || t("inspections.create.toasts.scheduleError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="w-full space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("inspections.create.header.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("inspections.create.header.subtitle")}
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
              <CardTitle>{t("inspections.create.sections.details.title")}</CardTitle>
              <CardDescription>
                {t("inspections.create.sections.details.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="property">
                  {t("inspections.create.labels.propertyRequired")}
                </Label>
                <SearchableSelect
                  id="property"
                  value={propertyId}
                  onValueChange={setPropertyId}
                  options={propertyOptions}
                  placeholder={
                    loadingOptions
                      ? t("inspections.create.placeholders.loadingProperties")
                      : t("inspections.create.placeholders.selectProperty")
                  }
                  searchPlaceholder={t("inspections.create.placeholders.searchProperties")}
                  emptyMessage={t("inspections.create.placeholders.noPropertyFound")}
                  disabled={loadingOptions}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">
                  {t("inspections.create.labels.inspectionTypeRequired")}
                </Label>
                <SearchableSelect
                  id="type"
                  value={type}
                  onValueChange={setType}
                  options={inspectionTypeOptions}
                  placeholder={t("inspections.create.placeholders.selectInspectionType")}
                  searchPlaceholder={t(
                    "inspections.create.placeholders.searchInspectionTypes",
                  )}
                  emptyMessage={t(
                    "inspections.create.placeholders.noInspectionTypeFound",
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="scheduledDate">
                  {t("inspections.create.labels.scheduledDateRequired")}
                </Label>
                <Input
                  id="scheduledDate"
                  type="datetime-local"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                />
              </div>
            </CardContent>
          </Card>

          {/* People */}
          <Card>
            <CardHeader>
              <CardTitle>{t("inspections.create.sections.people.title")}</CardTitle>
              <CardDescription>
                {t("inspections.create.sections.people.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inspector">
                  {t("inspections.create.labels.inspectorRequired")}
                </Label>
                <SearchableSelect
                  id="inspector"
                  value={inspectorId}
                  onValueChange={setInspectorId}
                  options={inspectorOptions}
                  placeholder={
                    loadingOptions
                      ? t("inspections.create.placeholders.loadingInspectors")
                      : t("inspections.create.placeholders.selectInspector")
                  }
                  searchPlaceholder={t("inspections.create.placeholders.searchInspectors")}
                  emptyMessage={t("inspections.create.placeholders.noInspectorFound")}
                  disabled={loadingOptions}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tenant">
                  {t("inspections.create.labels.tenantOptional")}
                </Label>
                <SearchableSelect
                  id="tenant"
                  value={tenantId}
                  onValueChange={setTenantId}
                  options={tenantOptions}
                  placeholder={
                    loadingOptions
                      ? t("inspections.create.placeholders.loadingTenants")
                      : t("inspections.create.placeholders.noTenant")
                  }
                  searchPlaceholder={t("inspections.create.placeholders.searchTenants")}
                  emptyMessage={t("inspections.create.placeholders.noTenantFound")}
                  disabled={loadingOptions}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lease">
                  {t("inspections.create.labels.leaseOptional")}
                </Label>
                <SearchableSelect
                  id="lease"
                  value={leaseId}
                  onValueChange={setLeaseId}
                  options={leaseOptions}
                  placeholder={
                    loadingOptions
                      ? t("inspections.create.placeholders.loadingLeases")
                      : t("inspections.create.placeholders.noLease")
                  }
                  searchPlaceholder={t("inspections.create.placeholders.searchLeases")}
                  emptyMessage={t("inspections.create.placeholders.noLeaseFound")}
                  disabled={loadingOptions}
                />
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card className="gap-2">
            <CardHeader>
              <CardTitle>{t("inspections.create.sections.notes.title")}</CardTitle>
              <CardDescription>
                {t("inspections.create.sections.notes.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder={t("inspections.create.placeholders.notes")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("inspections.create.labels.charactersCount", {
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
                ? t("inspections.create.actions.scheduling")
                : t("inspections.create.actions.scheduleInspection")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
