"use client";

/**
 * PropertyPro - Add a charge
 *
 * Something the tenant owes, created unpaid. This page was "Add payment" and
 * read as if it recorded money; money is recorded through the installment
 * dialog on the payments page and on each contract. `?leaseId=` starts on
 * that contract, which is how the payments page links here when it is
 * showing one contract.
 */

import Link from "next/link";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Receipt } from "lucide-react";
import {
  ChargeForm,
  type ChargeContractOption,
  type ChargeOption,
  type ChargeSubmission,
} from "@/components/forms/payment-form";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { showApiErrorToast } from "@/lib/toast-notifications";

/** yyyy-MM-dd as the start of that day where the office is. */
function localDay(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

export default function NewChargePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { t } = useLocalizationContext();
  const initialLeaseId = searchParams?.get("leaseId") ?? undefined;

  const [isLoading, setIsLoading] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [contracts, setContracts] = useState<ChargeContractOption[]>([]);
  const [tenants, setTenants] = useState<ChargeOption[]>([]);
  const [properties, setProperties] = useState<ChargeOption[]>([]);

  const backHref = initialLeaseId
    ? `/dashboard/payments?leaseId=${encodeURIComponent(initialLeaseId)}`
    : "/dashboard/payments";

  // One request for every list the form offers, scoped like the payments
  // list itself — the same one the payments filter panel uses.
  useEffect(() => {
    if (!session) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/payments/filter-options");
        const result = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok || !result?.success) {
          showApiErrorToast(result, t("payments.new.toasts.dataLoadFailed"));
          return;
        }
        setContracts((result.data?.leases ?? []) as ChargeContractOption[]);
        setTenants((result.data?.tenants ?? []) as ChargeOption[]);
        setProperties((result.data?.properties ?? []) as ChargeOption[]);
      } catch {
        if (active) toast.error(t("payments.new.toasts.dataLoadFailed"));
      } finally {
        if (active) setIsDataLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [session, t]);

  const handleSubmit = async (data: ChargeSubmission) => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          dueDate: localDay(data.dueDate),
          description: data.description || undefined,
          notes: data.notes || undefined,
        }),
      });
      const result = await response.json().catch(() => null);

      if (response.ok && result?.success) {
        toast.success(
          t("payments.charge.created", { defaultValue: "Charge added" }),
        );
        router.push(
          data.leaseId
            ? `/dashboard/payments?leaseId=${encodeURIComponent(data.leaseId)}`
            : "/dashboard/payments",
        );
      } else {
        showApiErrorToast(result, t("payments.new.toasts.createFailed"));
      }
    } catch (error) {
      showApiErrorToast(error, t("payments.new.toasts.createFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Receipt className="h-6 w-6" />
            {t("payments.charge.title", { defaultValue: "Add a charge" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("payments.charge.subtitle", {
              defaultValue:
                "An amount the tenant owes — a bill, a fee, a deposit. Money received is recorded with Record payment.",
            })}
          </p>
        </div>
        <Link href={backHref}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            {t("payments.new.header.backButton")}
          </Button>
        </Link>
      </div>

      {isDataLoading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <ChargeForm
          mode="create"
          onSubmit={handleSubmit}
          onCancel={() => router.push(backHref)}
          isLoading={isLoading}
          contracts={contracts}
          tenants={tenants}
          properties={properties}
          initialLeaseId={
            initialLeaseId &&
            contracts.some((contract) => contract.id === initialLeaseId)
              ? initialLeaseId
              : undefined
          }
        />
      )}
    </div>
  );
}
