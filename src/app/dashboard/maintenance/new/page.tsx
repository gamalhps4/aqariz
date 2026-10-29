"use client";

import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { LeaseStatus } from "@/types";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { MaintenanceRequestForm } from "@/components/forms/maintenance-request-form";

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
    currentTenantId?: string;
    currentLeaseId?: string;
  }>;
}

interface PropertyApiResponse {
  _id: string;
  name: string;
  address: {
    street: string;
    city: string;
    state: string;
  };
  isMultiUnit?: boolean;
  units?: Array<{
    _id: string;
    unitNumber: string;
    unitType: string;
    status: string;
    currentTenantId?: string;
    currentLeaseId?: string;
  }>;
}

interface Tenant {
  id: string;
  name: string;
  email: string;
  propertyName?: string;
  phone?: string;
  tenantStatus?: string;
}

interface TenantApiResponse {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  tenantStatus?: string;
  currentLeaseId?: {
    propertyId?: {
      name: string;
    };
  };
}

interface TechnicianApiResponse {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role?: string;
  specialties?: string[];
}

interface Technician {
  id: string;
  name: string;
  email: string;
  role?: string;
  specialties?: string[];
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
  status?: string;
}

const isActiveLeaseStatus = (status?: string) =>
  (status || "").toLowerCase() === LeaseStatus.ACTIVE;

export default function NewMaintenanceRequestPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { isTenant, isLoading: roleLoading } = useAuthorization();
  const { t } = useLocalizationContext();
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [tenantLeases, setTenantLeases] = useState<LeaseItem[]>([]);
  const [tenantInitialData, setTenantInitialData] = useState<{
    propertyId?: string;
    unitId?: string;
    tenantId?: string;
  }>({});
  const [hasActiveLease, setHasActiveLease] = useState<boolean>(false);

  useEffect(() => {
    // Until the session arrives the access profile reads as a tenant, so
    // staff would first ask the tenant-only API and get a 403.
    if (roleLoading) return;
    // Only fetch form data for admin/manager users
    if (!isTenant) {
      fetchFormData();
    } else {
      fetchTenantData();
    }
  }, [isTenant, roleLoading]);

  const fetchFormData = async () => {
    try {
      setDataLoading(true);

      // Fetch properties, tenants, and potential assignees (managers/technicians) in parallel
      const [propertiesRes, tenantsRes, techniciansRes] = await Promise.all([
        fetch("/api/properties?limit=100"),
        fetch("/api/tenants?limit=100"),
        fetch(
          "/api/users?excludeTenant=true&companyStaffOnly=true&isActive=true&limit=100",
        ),
      ]);

      if (propertiesRes.ok) {
        const propertiesData = await propertiesRes.json();
        setProperties(
          Array.isArray(propertiesData.data)
            ? propertiesData.data.map((property: PropertyApiResponse) => ({
                id: property._id,
                name: property.name,
                address: `${property.address.street}, ${property.address.city}, ${property.address.state}`,
                isMultiUnit: property.isMultiUnit,
                units: property.units || [],
              }))
            : [],
        );
      } else {
        toast.error(t("maintenance.new.toasts.loadPropertiesError"));
      }

      if (tenantsRes.ok) {
        const tenantsData = await tenantsRes.json();

        // Handle the new User model structure for tenants
        setTenants(
          Array.isArray(tenantsData.data)
            ? tenantsData.data
                .filter((tenant: TenantApiResponse) => tenant && tenant._id) // Filter out invalid entries
                .map((tenant: TenantApiResponse) => ({
                  id: tenant._id,
                  name:
                    `${tenant.firstName || ""} ${
                      tenant.lastName || ""
                    }`.trim() || "Unknown Tenant",
                  email: tenant.email || "",
                  propertyName:
                    tenant.currentLeaseId?.propertyId?.name ||
                    t("maintenance.tenant.form.noLeases.title", {
                      defaultValue: "No Active Leases",
                    }),
                  phone: tenant.phone || "",
                  tenantStatus: tenant.tenantStatus || "",
                }))
            : [],
        );
      } else {
        toast.error(t("maintenance.new.toasts.loadTenantsError"));
      }

      if (techniciansRes.ok) {
        const techniciansData = await techniciansRes.json();
        // Handle varying API response shapes
        const usersArray = Array.isArray(techniciansData?.data)
          ? techniciansData.data
          : Array.isArray(techniciansData?.data?.users)
            ? techniciansData.data.users
            : Array.isArray(techniciansData?.users)
              ? techniciansData.users
              : [];

        const assignees = usersArray
          .filter((u: any) => {
            if (!u || (!u._id && !u.id)) return false;
            if (u.isActive === false) return false;
            return true;
          })
          .map((tech: any) => ({
            id: tech._id || tech.id,
            name: `${tech.firstName || ""} ${tech.lastName || ""}`.trim(),
            email: tech.email || "",
            role: tech.role,
            specialties: tech.specialties || [],
          }));

        setTechnicians(assignees);
      } else {
        toast.error(t("maintenance.new.toasts.loadTechniciansError"));
      }
    } catch (error) {
      toast.error(t("maintenance.new.toasts.loadFormDataError"));
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
        const leases: LeaseItem[] = Array.isArray(data?.data?.allLeases)
          ? data.data.allLeases
          : [];
        setTenantLeases(leases);

        const activeLeases = leases.filter((l) => isActiveLeaseStatus(l.status));
        const candidateLeases = activeLeases.length > 0 ? activeLeases : leases;

        setHasActiveLease(leases.some((l) => isActiveLeaseStatus(l.status)));
        if (!leases.some((l) => isActiveLeaseStatus(l.status))) {
          toast.error(
            t("maintenance.new.toasts.noActiveLease", {
              defaultValue:
                "You can't submit a request because you have no active leases.",
            }),
          );
        }

        const tenantId = session?.user?.id || undefined;
        const uniquePropertyIds = Array.from(
          new Set(
            candidateLeases
              .map((lease) => lease?.propertyId?._id)
              .filter((value): value is string => Boolean(value)),
          ),
        );
        const propertyId =
          uniquePropertyIds.length === 1 ? uniquePropertyIds[0] : undefined;
        const uniqueUnitIds = propertyId
          ? Array.from(
              new Set(
                candidateLeases
                  .filter((lease) => lease?.propertyId?._id === propertyId)
                  .map((lease) => lease?.unitId)
                  .filter((value): value is string => Boolean(value)),
              ),
            )
          : [];
        const unitId = uniqueUnitIds.length === 1 ? uniqueUnitIds[0] : undefined;

        // Build map of propertyId -> set of unitIds leased by this tenant
        const propertyUnitMap = new Map<string, Set<string>>();
        for (const lease of leases) {
          const pid = lease?.propertyId?._id as string | undefined;
          const uid = lease?.unitId as string | undefined;
          if (!pid) continue;
          if (!propertyUnitMap.has(pid)) propertyUnitMap.set(pid, new Set());
          if (uid) propertyUnitMap.get(pid)!.add(uid);
        }

        // Fetch property details (including units) and filter units to tenant’s leased units
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

          // Filter units to only those leased by tenant for this property
          const leasedUnitIds = propertyUnitMap.get(pid)!;
          const filteredUnits = Array.isArray(p?.units)
            ? p.units.filter((u: any) => leasedUnitIds.has(u._id?.toString()))
            : [];

          tenantProperties.push({
            id: pid,
            name: p?.name || "",
            address: addressStr,
            isMultiUnit: !!p?.isMultiUnit || filteredUnits.length > 0,
            units: filteredUnits,
          });
        }

        setProperties(tenantProperties);

        setTenants([
          {
            id: tenantId || "",
            name: session?.user?.name || "",
            email: session?.user?.email || "",
            phone: session?.user?.phone || "",
          },
        ]);

        // Auto-select only when the tenant has a single leased property/unit.
        setTenantInitialData({ propertyId, unitId, tenantId });
      } else {
        toast.error(t("maintenance.new.toasts.loadFormDataError"));
      }
    } catch (error) {
      toast.error(t("maintenance.new.toasts.loadFormDataError"));
    } finally {
      setDataLoading(false);
    }
  };

  const handleSubmit = async (data: {
    title: string;
    description: string;
    category: string;
    priority: string;
    propertyId: string;
    unitId?: string;
    tenantId: string;
    assignedTo?: string;
    estimatedCost?: number;
    scheduledDate?: string;
    images?: string[];
  }) => {
    try {
      if (isTenant && !hasActiveLease) {
        toast.error(
          t("maintenance.new.toasts.noActiveLease", {
            defaultValue:
              "You can't submit a request because you have no active leases.",
          }),
        );
        return;
      }
      setLoading(true);
      const endpoint = isTenant
        ? "/api/tenant/maintenance"
        : "/api/maintenance";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          category: data.category,
          priority: data.priority,
          propertyId: data.propertyId,
          unitId: data.unitId || undefined,
          ...(isTenant
            ? {}
            : {
                tenantId: data.tenantId,
                assignedTo: data.assignedTo || undefined,
                estimatedCost: data.estimatedCost || undefined,
                scheduledDate: data.scheduledDate || undefined,
              }),
          images: data.images || [],
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || t("maintenance.new.toasts.createError"),
        );
      }

      toast.success(t("maintenance.new.toasts.createSuccess"));
      const createdId = result?.data?._id || result?._id;
      if (createdId) {
        router.push(`/dashboard/maintenance/${createdId}`);
      } else {
        router.push(
          isTenant
            ? "/dashboard/maintenance/my-requests"
            : "/dashboard/maintenance",
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("maintenance.new.toasts.createError");
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="space-y-6 max-w-240 w-full">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("maintenance.new.header.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("maintenance.new.header.subtitle")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="hover:bg-blue-50 hover:text-blue-600 border transition-colors"
            onClick={() =>
              router.push(
                isTenant
                  ? "/dashboard/maintenance/my-requests"
                  : "/dashboard/maintenance",
              )
            }
          >
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("maintenance.new.header.back")}
          </Button>
        </div>

        {/* Form Container */}
        {isTenant && !hasActiveLease && (
          <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                {t("maintenance.tenant.form.noLeases.title", {
                  defaultValue: "No Active Leases",
                })}
              </CardTitle>
              <CardDescription>
                {t("maintenance.tenant.form.noLeases.description", {
                  defaultValue:
                    "You need an active lease to submit maintenance requests.",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t("maintenance.new.noActiveLease.help", {
                  defaultValue:
                    "Please contact your property manager or review your leases.",
                })}
              </p>
            </CardContent>
          </Card>
        )}
        <MaintenanceRequestForm
          onSubmit={handleSubmit}
          isLoading={loading}
          initialData={isTenant ? tenantInitialData : undefined}
          isTenantView={isTenant}
          showPropertyTenantSection={true}
          showAssignmentSchedulingSection={!isTenant}
          submitLabel={t("maintenance.form.buttons.submitRequest")}
          submitDisabled={isTenant && !hasActiveLease}
          properties={properties}
          tenants={tenants}
          technicians={technicians}
        />
      </div>
    </div>
  );
}
