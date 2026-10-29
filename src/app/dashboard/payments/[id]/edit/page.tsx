"use client";

/**
 * PropertyPro - Edit a charge
 *
 * What is owed, when, and why can change; what it is attached to cannot.
 * The contract, tenant, building and installment are shown, not offered: the
 * old form let a payment be moved onto another contract (and the API
 * accepted it). A charge on the wrong contract is deleted and added again.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import {
  ChargeForm,
  type ChargeInitialData,
  type ChargeSubmission,
} from "@/components/forms/payment-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PaymentType } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { showApiErrorToast } from "@/lib/toast-notifications";

interface LoadedCharge extends ChargeInitialData {
  id: string;
  /** Money already taken on this payment — its amount is then fixed. */
  amountPaid: number;
  status?: string;
}

/** yyyy-MM-dd as the start of that day where the office is. */
function localDay(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

export default function EditPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const { t, formatDate } = useLocalizationContext();

  const [isLoading, setIsLoading] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [charge, setCharge] = useState<LoadedCharge | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ id }) => setPaymentId(id));
  }, [params]);

  useEffect(() => {
    if (!session || !paymentId) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/payments/${paymentId}`);
        const result = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok || !result?.data) {
          throw new Error(result?.error || t("payments.edit.toasts.loadFailed"));
        }
        const payment = result.data;
        const lease =
          payment.leaseId && typeof payment.leaseId === "object"
            ? payment.leaseId
            : null;
        const unit = lease?.unit?.unitNumber as string | undefined;
        setCharge({
          id: payment._id ?? payment.id,
          amount: Number(payment.amount ?? 0),
          amountPaid: Number(payment.amountPaid ?? 0),
          status: payment.status,
          type: (payment.type as PaymentType) ?? PaymentType.OTHER,
          dueDate: payment.dueDate
            ? format(new Date(payment.dueDate), "yyyy-MM-dd")
            : "",
          description: payment.description ?? "",
          notes: payment.notes ?? "",
          tenantName: [payment.tenantId?.firstName, payment.tenantId?.lastName]
            .filter(Boolean)
            .join(" "),
          propertyName: payment.propertyId?.name ?? undefined,
          contractLabel: lease
            ? [
                lease.contractNumber
                  ? t("payments.collect.contractNumber", {
                      defaultValue: "No. {number}",
                      values: { number: lease.contractNumber },
                    })
                  : null,
                unit
                  ? t("payments.table.unitContract", {
                      defaultValue: "Unit {unit}",
                      values: { unit },
                    })
                  : null,
                `${formatDate(lease.startDate)} – ${formatDate(lease.endDate)}`,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined,
          installmentLabel: payment.invoice?.invoiceNumber
            ? `${payment.invoice.invoiceNumber} · ${formatDate(payment.invoice.dueDate)}`
            : undefined,
        });
      } catch (error) {
        if (active) {
          toast.error(
            error instanceof Error
              ? error.message
              : t("payments.edit.toasts.loadFailed"),
          );
        }
      } finally {
        if (active) setIsDataLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [session, paymentId, t, formatDate]);

  const handleSubmit = async (data: ChargeSubmission) => {
    if (!charge) return;
    try {
      setIsLoading(true);
      const response = await fetch(`/api/payments/${charge.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: data.type,
          ...(data.amount !== undefined ? { amount: data.amount } : {}),
          dueDate: localDay(data.dueDate),
          description: data.description,
          notes: data.notes,
        }),
      });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.success) {
        toast.success(t("payments.edit.toasts.updateSuccess"));
        router.push(`/dashboard/payments/${charge.id}`);
      } else {
        showApiErrorToast(result, t("payments.edit.toasts.updateFailed"));
      }
    } catch (error) {
      showApiErrorToast(error, t("payments.edit.toasts.updateFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const backHref = charge
    ? `/dashboard/payments/${charge.id}`
    : "/dashboard/payments";

  if (isDataLoading) {
    return (
      <div className="container mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!charge) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold">
            {t("payments.edit.notFound.title")}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t("payments.edit.notFound.message")}
          </p>
          <Link href="/dashboard/payments">
            <Button className="mt-4">
              <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
              {t("payments.edit.notFound.button")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("payments.edit.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("payments.edit.header.subtitle")}
          </p>
        </div>
        <Link href={backHref}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            {t("payments.edit.header.backButton")}
          </Button>
        </Link>
      </div>

      <ChargeForm
        mode="edit"
        onSubmit={handleSubmit}
        onCancel={() => router.push(backHref)}
        isLoading={isLoading}
        initialData={charge}
        lockAmount={charge.status === "partial" || charge.amountPaid > 0}
      />
    </div>
  );
}
