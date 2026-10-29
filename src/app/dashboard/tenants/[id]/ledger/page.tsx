"use client";

import React, { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, User, FileText } from "lucide-react";
import TenantLedger from "@/components/tenant/TenantLedger";
import { toast } from "sonner";
import { LeaseStatus } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface Tenant {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

interface Lease {
  _id: string;
  propertyId: {
    name: string;
    address: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
  };
  startDate: string;
  endDate: string;
  status: string;
  terms: {
    rentAmount: number;
  };
}

interface TenantLedgerPageProps {
  // A promise in this version of Next.js — read synchronously the id was
  // undefined and every request this page made went to /undefined.
  params: Promise<{
    id: string;
  }>;
}

export default function TenantLedgerPage({
  params: paramsPromise,
}: TenantLedgerPageProps) {
  const { id: tenantId } = use(paramsPromise);
  const router = useRouter();
  const { t, formatCurrency, formatDate } = useLocalizationContext();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [selectedLeaseId, setSelectedLeaseId] = useState<string>("");
  const [currentBalance, setCurrentBalance] = useState<{
    currentBalance: number;
    totalOutstanding: number;
    overdueAmount: number;
    lastPaymentDate?: string;
    lastPaymentAmount?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const formatAddress = (address: any) => {
    if (!address) return t("tenants.ledger.noAddress", { defaultValue: "No address" });
    if (typeof address === "string") return address;
    if (typeof address === "object") {
      const { street, city, state, zipCode } = address;
      return `${street || ""}, ${city || ""}, ${state || ""} ${zipCode || ""}`
        .replace(/,\s*,/g, ",")
        .replace(/^\s*,\s*|\s*,\s*$/g, "");
    }
    return t("tenants.ledger.noAddress", { defaultValue: "No address" });
  };

  useEffect(() => {
    fetchTenantData();
    fetchTenantLeases();
    fetchCurrentBalance();
  }, [tenantId]);

  const fetchTenantData = async () => {
    try {
      // The tenant route, not /api/users: that one asks for the Employees
      // rights, which someone given the tenant and finance rights does not
      // hold — they were told the tenant could not be found.
      const response = await fetch(`/api/tenants/${tenantId}`);
      const data = await response.json();

      if (data.success && data.data) {
        setTenant(data.data);
      } else {
        toast.error(t("tenants.ledger.toasts.tenantFailed", { defaultValue: "Could not load the tenant" }));
      }
    } catch (error) {
      toast.error(t("tenants.ledger.toasts.tenantFailed", { defaultValue: "Could not load the tenant" }));
    }
  };

  const fetchTenantLeases = async () => {
    try {
      const response = await fetch(`/api/leases?tenantId=${tenantId}`);
      const data = await response.json();

      if (data.success && data.data) {
        // The list endpoint answers with an array; reading `.leases` off it
        // left this page believing the tenant had no contracts at all.
        const tenantLeases: Lease[] = Array.isArray(data.data)
          ? data.data
          : (data.data.leases ?? []);
        setLeases(tenantLeases);

        // Auto-select active lease if exists
        const activeLease = tenantLeases.find(
          (lease: Lease) => lease.status === LeaseStatus.ACTIVE
        );
        if (activeLease) {
          setSelectedLeaseId(activeLease._id);
        }
      } else {
        toast.error(t("tenants.ledger.toasts.leasesFailed", { defaultValue: "Could not load the tenant's contracts" }));
      }
    } catch (error) {
      toast.error(t("tenants.ledger.toasts.leasesFailed", { defaultValue: "Could not load the tenant's contracts" }));
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentBalance = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedLeaseId) params.append("leaseId", selectedLeaseId);

      const response = await fetch(
        `/api/tenants/${tenantId}/ledger?${params}`,
        {
          method: "PATCH",
        }
      );
      const data = await response.json();

      if (data.success && data.data) {
        setCurrentBalance(data.data);
      }
    } catch (error) {
      toast.error(t("tenants.ledger.toasts.balanceFailed", { defaultValue: "Could not load the balance" }));
    }
  };

  useEffect(() => {
    if (selectedLeaseId) {
      fetchCurrentBalance();
    }
  }, [selectedLeaseId]);

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      [LeaseStatus.ACTIVE]: {
        variant: "default" as const,
        label: t("tenants.ledger.leaseStatus.active", { defaultValue: "Active" }),
      },
      [LeaseStatus.EXPIRED]: {
        variant: "secondary" as const,
        label: t("tenants.ledger.leaseStatus.expired", { defaultValue: "Expired" }),
      },
      [LeaseStatus.TERMINATED]: {
        variant: "destructive" as const,
        label: t("tenants.ledger.leaseStatus.terminated", { defaultValue: "Cancelled" }),
      },
      [LeaseStatus.PENDING]: {
        variant: "outline" as const,
        label: t("tenants.ledger.leaseStatus.pending", { defaultValue: "Pending" }),
      },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || {
      variant: "outline" as const,
      label: t(`leases.status.${status}`, { defaultValue: status }),
    };

    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("tenants.ledger.title", { defaultValue: "Tenant ledger" })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("tenants.ledger.loading", { defaultValue: "Loading…" })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("tenants.ledger.notFound", { defaultValue: "Tenant not found" })}
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.back()}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            {t("tenants.ledger.back", { defaultValue: "Back" })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("tenants.ledger.title", { defaultValue: "Tenant ledger" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tenant.firstName} {tenant.lastName}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.back()}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
          {t("tenants.ledger.back", { defaultValue: "Back" })}
        </Button>
      </div>

      {/* Tenant Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t("tenants.ledger.tenantInfo", { defaultValue: "Tenant" })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-medium text-lg">
                {tenant.firstName} {tenant.lastName}
              </h3>
              <p className="text-muted-foreground">{tenant.email}</p>
              {tenant.phone && (
                <p className="text-muted-foreground">{tenant.phone}</p>
              )}
            </div>

            {currentBalance && (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>{t("tenants.ledger.currentBalance", { defaultValue: "Balance" })}</span>
                  <span
                    className={`font-medium ${
                      currentBalance.currentBalance > 0
                        ? "text-red-600"
                        : "text-green-600"
                    }`}
                  >
                    {currentBalance.currentBalance > 0
                      ? t("tenants.ledger.owed", { defaultValue: "{amount} owed", values: { amount: formatCurrency(Math.abs(currentBalance.currentBalance)) } })
                      : t("tenants.ledger.credit", { defaultValue: "{amount} in credit", values: { amount: formatCurrency(Math.abs(currentBalance.currentBalance)) } })}
                  </span>
                </div>

                {currentBalance.overdueAmount > 0 && (
                  <div className="flex justify-between">
                    <span>{t("tenants.ledger.overdue", { defaultValue: "Overdue" })}</span>
                    <span className="font-medium text-red-600">
                      {formatCurrency(currentBalance.overdueAmount)}
                    </span>
                  </div>
                )}

                {currentBalance.lastPaymentDate && (
                  <div className="flex justify-between">
                    <span>{t("tenants.ledger.lastPayment", { defaultValue: "Last payment" })}</span>
                    <span>
                      {t("tenants.ledger.amountOn", { defaultValue: "{amount} on {date}", values: { amount: formatCurrency(currentBalance.lastPaymentAmount || 0), date: formatDate(currentBalance.lastPaymentDate) } })}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lease Selection */}
      {leases.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("tenants.ledger.contracts", { defaultValue: "Contracts" })}
            </CardTitle>
            <CardDescription>
              {t("tenants.ledger.contractsHint", { defaultValue: "Choose a contract to see its account alone" })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              {leases.map((lease) => (
                <div
                  key={lease._id}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    selectedLeaseId === lease._id
                      ? "border-primary bg-primary/5"
                      : "hover:border-primary/50"
                  }`}
                  onClick={() => setSelectedLeaseId(lease._id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">{lease.propertyId.name}</h4>
                      <p className="text-sm text-muted-foreground">
                        {formatAddress(lease.propertyId.address)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(lease.startDate)} – {formatDate(lease.endDate)}
                      </p>
                    </div>
                    <div className="text-end">
                      {getStatusBadge(lease.status)}
                      <p className="text-sm text-muted-foreground mt-1">
                        {formatCurrency(lease.terms?.rentAmount ?? 0)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tenant Ledger Component */}
      <TenantLedger
        tenantId={tenantId}
        leaseId={selectedLeaseId || undefined}
      />
    </div>
  );
}
