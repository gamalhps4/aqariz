"use client";

import { toast } from "sonner";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { TicketForm } from "@/components/forms/ticket-form";
import { useAuthorization } from "@/hooks/useAuthorization";
import { refreshTicketCounts } from "@/lib/sidebar-utils";
import { LeaseStatus } from "@/types";

interface Property {
  id: string;
  name: string;
  address: string;
  isMultiUnit?: boolean;
  units?: Array<{
    _id: string;
    unitNumber: string;
    unitType: string;
    status: string;
  }>;
}

interface LeaseInfo {
  propertyId: string;
  unitId?: string;
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
}

interface LeaseItem {
  _id: string;
  propertyId?: {
    _id?: string;
    name?: string;
    address?: any;
    isMultiUnit?: boolean;
  } | null;
  unitId?: string;
  tenantId?: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null;
  status?: string;
}

const isActiveLeaseStatus = (status?: string) =>
  (status ?? "").toLowerCase() === LeaseStatus.ACTIVE;

export default function NewTicketPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { isTenant, isLoading: roleLoading } = useAuthorization();
  const { t } = useLocalizationContext();
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [leases, setLeases] = useState<LeaseInfo[]>([]);
  const [tenantInitialData, setTenantInitialData] = useState<{
    propertyId?: string;
    unitId?: string;
    tenantId?: string;
  }>({});
  const [hasActiveLease, setHasActiveLease] = useState(false);

  const createdBy = session?.user
    ? {
        userId: session.user.id ?? "",
        role: (session.user.role as string) ?? "",
        name: session.user.name ?? "",
      }
    : undefined;

  useEffect(() => {
    // Until the session arrives the access profile reads as a tenant, so
    // staff would first ask the tenant-only API and get a 403.
    if (roleLoading) return;
    if (isTenant) {
      fetchTenantData();
    } else {
      fetchAdminData();
    }
  }, [isTenant, roleLoading]);

  const fetchAdminData = async () => {
    try {
      setDataLoading(true);
      const [propertiesRes, leasesRes] = await Promise.all([
        fetch("/api/properties?limit=100"),
        fetch("/api/leases?status=active&limit=500"),
      ]);

      if (propertiesRes.ok) {
        const data = await propertiesRes.json();
        setProperties(
          Array.isArray(data?.data)
            ? data.data.map((p: any) => ({
                id: p._id,
                name: p.name,
                address: `${p?.address?.street ?? ""}, ${p?.address?.city ?? ""}, ${p?.address?.state ?? ""}`,
                isMultiUnit: p.isMultiUnit,
                units: p?.units ?? [],
              }))
            : [],
        );
      }

      if (leasesRes.ok) {
        const data = await leasesRes.json();
        setLeases(
          Array.isArray(data?.data)
            ? data.data
                .filter(
                  (l: any) =>
                    l &&
                    l.tenantId &&
                    l.propertyId &&
                    isActiveLeaseStatus(l.status),
                )
                .map((l: any) => ({
                  propertyId:
                    typeof l.propertyId === "object"
                      ? l.propertyId._id
                      : l.propertyId,
                  unitId:
                    typeof l.unitId === "object" ? l.unitId?._id : l.unitId,
                  tenantId:
                    typeof l.tenantId === "object"
                      ? l.tenantId._id
                      : l.tenantId,
                  tenantName:
                    typeof l.tenantId === "object"
                      ? `${l.tenantId.firstName ?? ""} ${l.tenantId.lastName ?? ""}`.trim()
                      : "",
                  tenantEmail:
                    typeof l.tenantId === "object"
                      ? (l.tenantId.email ?? "")
                      : "",
                }))
            : [],
        );
      }
    } catch (error) {
      toast.error(t("tickets.new.loadError"));
    } finally {
      setDataLoading(false);
    }
  };

  const fetchTenantData = async () => {
    try {
      setDataLoading(true);
      const res = await fetch("/api/tenant/dashboard");
      const data = await res.json();
      if (res.ok && data?.success) {
        const tenantLeases: LeaseItem[] = Array.isArray(data?.data?.allLeases)
          ? data.data.allLeases
          : [];

        const activeLease =
          tenantLeases.find((l) => isActiveLeaseStatus(l.status)) ||
          tenantLeases[0];

        setHasActiveLease(
          tenantLeases.some((l) => isActiveLeaseStatus(l.status)),
        );

        const propertyId = activeLease?.propertyId?._id ?? undefined;
        const unitId = activeLease?.unitId ?? undefined;
        const tenantId = session?.user?.id ?? undefined;

        // Build properties from leases
        const propertyUnitMap = new Map<string, Set<string>>();
        for (const lease of tenantLeases) {
          const pid = lease?.propertyId?._id as string | undefined;
          const uid = lease?.unitId as string | undefined;
          if (!pid) continue;
          if (!propertyUnitMap.has(pid)) propertyUnitMap.set(pid, new Set());
          if (uid) propertyUnitMap.get(pid)!.add(uid);
        }

        const propertyIds = Array.from(propertyUnitMap.keys());
        const propertyResponses = await Promise.all(
          propertyIds.map((pid) => fetch(`/api/properties/${pid}`)),
        );
        const propertiesData = await Promise.all(
          propertyResponses.map(async (r) => {
            const j = await r.json();
            return r.ok ? j.data : null;
          }),
        );

        const tenantProperties: Property[] = [];
        for (let i = 0; i < propertyIds.length; i++) {
          const pid = propertyIds[i];
          const p = propertiesData[i];
          if (!p) continue;
          const address = p?.address as any;
          const addressStr =
            typeof address === "string"
              ? address
              : address && typeof address === "object"
                ? [address.street, address.city, address.state, address.zipCode]
                    .filter(Boolean)
                    .join(", ")
                : "";

          const leasedUnitIds = propertyUnitMap.get(pid)!;
          const filteredUnits = Array.isArray(p?.units)
            ? p.units.filter((u: any) => leasedUnitIds.has(u._id?.toString()))
            : [];

          tenantProperties.push({
            id: pid,
            name: p?.name ?? "",
            address: addressStr,
            isMultiUnit: !!p?.isMultiUnit || filteredUnits.length > 0,
            units: filteredUnits,
          });
        }

        setProperties(tenantProperties);
        setTenantInitialData({ propertyId, unitId, tenantId });
      } else {
        toast.error(t("tickets.new.loadTenantError"));
      }
    } catch (error) {
      toast.error(t("tickets.new.loadTenantError"));
    } finally {
      setDataLoading(false);
    }
  };

  const handleSubmit = async (data: {
    title: string;
    description: string;
    category: string;
    priority: string;
    propertyId?: string;
    unitId?: string;
    tenantId?: string;
    attachments?: string[];
  }) => {
    try {
      setLoading(true);
      const endpoint = isTenant ? "/api/tenant/tickets" : "/api/tickets";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          category: data.category,
          priority: data.priority,
          propertyId: data.propertyId || undefined,
          unitId: data.unitId || undefined,
          tenantId: isTenant ? undefined : data.tenantId,
          createdBy: {
            userId: session?.user?.id,
            role: session?.user?.role,
          },
          attachments: data.attachments ?? [],
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || t("tickets.new.createError"));
      }

      toast.success(t("tickets.new.success"));
      refreshTicketCounts();
      const createdId = result?.data?._id ?? result?._id;
      if (createdId) {
        router.push(`/dashboard/tickets/${createdId}`);
      } else {
        router.push(
          isTenant ? "/dashboard/tickets/my-tickets" : "/dashboard/tickets",
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : t("tickets.toasts.createFailed", { defaultValue: "Could not create the ticket" });
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("tickets.new.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("tickets.new.subtitle")}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="hover:bg-blue-50 hover:text-blue-600 border transition-colors"
          onClick={() =>
            router.push(
              isTenant ? "/dashboard/tickets/my-tickets" : "/dashboard/tickets",
            )
          }
        >
          <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
          {t("tickets.new.back")}
        </Button>
      </div>

      {/* No active lease warning for tenants */}
      {isTenant && !hasActiveLease && !dataLoading && (
        <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              {t("tickets.new.noLease")}
            </CardTitle>
            <CardDescription>{t("tickets.new.noLeaseDesc")}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Form */}
      <TicketForm
        onSubmit={handleSubmit}
        isLoading={loading}
        initialData={isTenant ? tenantInitialData : undefined}
        isTenantView={isTenant}
        submitLabel={t("tickets.new.submitLabel")}
        properties={properties}
        leases={isTenant ? undefined : leases}
        createdBy={createdBy}
      />
    </div>
  );
}
