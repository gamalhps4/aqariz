"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmergencyRequestForm } from "@/components/forms/emergency-request-form";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface Property {
  id: string;
  name: string;
  address: string;
}

interface Tenant {
  id: string;
  name: string;
  email: string;
  phone: string;
  propertyName?: string;
}

export default function NewEmergencyRequestPage() {
  const router = useRouter();
  const { t } = useLocalizationContext();
  const [loading, setLoading] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch properties and tenants
        const [propertiesRes, tenantsRes] = await Promise.all([
          fetch("/api/properties?limit=100"),
          fetch("/api/tenants?limit=100"),
        ]);

        if (propertiesRes.ok) {
          const propertiesData = await propertiesRes.json();
          setProperties(
            propertiesData.data.properties?.map((p: any) => ({
              id: p._id,
              name: p.name,
              address: p.address,
            })) || []
          );
        }

        if (tenantsRes.ok) {
          const tenantsData = await tenantsRes.json();
          setTenants(
            tenantsData.data.tenants?.map((t: any) => ({
              id: t._id,
              name: `${t.userId?.firstName || ""} ${
                t.userId?.lastName || ""
              }`.trim(),
              email: t.userId?.email || "",
              phone: t.userId?.phone || "",
            })) || []
          );
        }
      } catch (error) {
        toast.error(t("maintenance.emergency.page.toasts.loadError"));
      } finally {
        setDataLoading(false);
      }
    };

    fetchData();
  }, [t]);

  const handleSubmit = async (data: any) => {
    try {
      setLoading(true);

      const response = await fetch("/api/maintenance/emergency", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          emergencyType: data.emergencyType,
          category: data.category,
          propertyId: data.propertyId,
          tenantId: data.tenantId,
          contactPhone: data.contactPhone,
          immediateAction: data.immediateAction,
          safetyRisk: data.safetyRisk,
          images: data.images || [],
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || t("maintenance.emergency.page.toasts.submitError")
        );
      }

      toast.success(t("maintenance.emergency.page.toasts.submitSuccess"));

      // Redirect to the emergency requests page
      router.push("/dashboard/maintenance/emergency");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("maintenance.emergency.page.toasts.submitError")
      );
    } finally {
      setLoading(false);
    }
  };

  if (dataLoading) {
    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/maintenance/emergency">
            <Button variant="outline" size="sm">
              <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
              {t("maintenance.emergency.page.backButtonShort")}
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("maintenance.emergency.page.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("maintenance.emergency.page.description")}
            </p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto space-y-6">
          {/* Loading skeleton */}
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="border rounded-lg p-6">
                <div className="space-y-4">
                  <div className="h-6 bg-gray-200 rounded w-1/4 animate-pulse" />
                  <div className="space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-full animate-pulse" />
                    <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/maintenance/emergency">
          <Button variant="outline" size="sm">
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            {t("maintenance.emergency.page.backButton")}
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("maintenance.emergency.page.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("maintenance.emergency.page.description")}
          </p>
        </div>
      </div>

      <EmergencyRequestForm
        onSubmit={handleSubmit}
        isLoading={loading}
        properties={properties}
        tenants={tenants}
      />
    </div>
  );
}
