"use client";

import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { useParams, useRouter } from "next/navigation";
import { MaintenancePriority } from "@/types";
import { MaintenanceRequestForm } from "@/components/forms/maintenance-request-form";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { MaintenanceFormSkeleton } from "@/components/maintenance/maintenance-skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";

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

interface Tenant {
  id: string;
  name: string;
  email: string;
  propertyName?: string;
}

interface Technician {
  id: string;
  name: string;
  email: string;
  role?: string;
  specialties?: string[];
}

interface MaintenanceRequestData {
  title: string;
  description: string;
  category: string;
  priority: MaintenancePriority;
  propertyId: string;
  unitId?: string;
  tenantId: string;
  assignedTo?: string;
  estimatedCost?: number;
  scheduledDate?: string;
  images?: string[];
}

export default function EditMaintenanceRequestPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { isTenant } = useAuthorization();
  const { t } = useLocalizationContext();
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [initialData, setInitialData] = useState<MaintenanceRequestData | null>(
    null
  );

  useEffect(() => {
    if (session) {
      fetchData();
    }
  }, [params.id, session]);

  const fetchData = async () => {
    try {
      setDataLoading(true);

      // Fetch maintenance request first
      const requestRes = await fetch(`/api/maintenance/${params.id}`);

      if (!requestRes.ok) {
        throw new Error("Failed to fetch maintenance request");
      }

      const requestData = await requestRes.json();
      const request = requestData.data;

      // Set initial form data
      setInitialData({
        title: request.title || "",
        description: request.description || "",
        category: request.category || "",
        priority: request.priority || "medium",
        propertyId: request.propertyId?._id || request.propertyId || "",
        unitId: request.unitId || "",
        tenantId: request.tenantId?._id || request.tenantId || "",
        assignedTo: request.assignedTo?._id || request.assignedTo || "",
        estimatedCost: request.estimatedCost || undefined,
        scheduledDate: request.scheduledDate
          ? new Date(request.scheduledDate).toISOString().slice(0, 16)
          : "",
        images: request.images || [],
      });

      // Only fetch additional data for admin/manager roles
      if (!isTenant) {
        const [propertiesRes, tenantsRes, techniciansRes] = await Promise.all([
          fetch("/api/properties?limit=100"),
          fetch("/api/tenants?limit=100"),
          fetch(
            "/api/users?excludeTenant=true&companyStaffOnly=true&isActive=true&limit=100"
          ),
        ]);

        if (propertiesRes.ok) {
          const propertiesData = await propertiesRes.json();
          setProperties(
            Array.isArray(propertiesData.data)
              ? propertiesData.data.map((property: any) => ({
                  id: property._id,
                  name: property.name,
                  address: `${property.address.street}, ${property.address.city}, ${property.address.state}`,
                  isMultiUnit: property.isMultiUnit,
                  units: property.units || [],
                }))
              : []
          );
        }

        if (tenantsRes.ok) {
          const tenantsData = await tenantsRes.json();
          const mappedTenants = Array.isArray(tenantsData.data)
            ? tenantsData.data
                .filter((tenant: any) => tenant && tenant._id) // Filter out invalid entries
                .map((tenant: any) => ({
                  id: tenant._id,
                  name:
                    `${tenant.firstName || ""} ${
                      tenant.lastName || ""
                    }`.trim() || "Unknown Tenant",
                  email: tenant.email || "",
                  propertyName:
                    tenant.propertyId?.name ||
                    tenant.currentLeaseId?.propertyId?.name ||
                    "No Property",
                }))
            : [];
          setTenants(mappedTenants);
        }

        if (techniciansRes.ok) {
          const techniciansData = await techniciansRes.json();
          const usersArray = Array.isArray(techniciansData.data)
            ? techniciansData.data
            : Array.isArray(techniciansData.data?.users)
            ? techniciansData.data.users
            : Array.isArray(techniciansData.users)
            ? techniciansData.users
            : [];

          setTechnicians(
            usersArray
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
              }))
          );
        }
      }
    } catch (error: any) {
      toast.error(error?.message || t("maintenance.edit.toasts.loadError"));
      const redirectPath = isTenant
        ? "/dashboard/maintenance/my-requests"
        : "/dashboard/maintenance";
      router.push(redirectPath);
    } finally {
      setDataLoading(false);
    }
  };

  const handleSubmit = async (data: any) => {
    try {
      setLoading(true);

      const response = await fetch(`/api/maintenance/${params.id}`, {
        method: "PUT",
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
          tenantId: data.tenantId,
          assignedTo: data.assignedTo || undefined,
          estimatedCost: data.estimatedCost || undefined,
          scheduledDate: data.scheduledDate || undefined,
          images: data.images || [],
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || t("maintenance.edit.toasts.updateError")
        );
      }

      toast.success(t("maintenance.edit.toasts.updateSuccess"));
      router.push(`/dashboard/maintenance/${params.id}`);
    } catch (error: any) {
      toast.error(error?.message || t("maintenance.edit.toasts.updateError"));
    } finally {
      setLoading(false);
    }
  };

  if (dataLoading) {
    return <MaintenanceFormSkeleton />;
  }

  if (!initialData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <h2 className="text-xl font-semibold">
          {t("maintenance.edit.notFound.title")}
        </h2>
        <p className="text-muted-foreground text-center">
          {t("maintenance.edit.notFound.description")}
        </p>
        <Link
          href={
            isTenant
              ? "/dashboard/maintenance/my-requests"
              : "/dashboard/maintenance"
          }
        >
          <Button variant="outline" size="sm">
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            {t("maintenance.edit.notFound.backButton")}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center space-x-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("maintenance.edit.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("maintenance.edit.header.description")}
          </p>
        </div>
        <Link href={`/dashboard/maintenance/${params.id}`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("maintenance.edit.header.back")}
          </Button>
        </Link>
      </div>

      {/* Form */}
      <MaintenanceRequestForm
        onSubmit={handleSubmit}
        isLoading={loading}
        initialData={initialData}
        isTenantView={isTenant}
        properties={properties}
        tenants={tenants}
        technicians={technicians}
      />
    </div>
  );
}
