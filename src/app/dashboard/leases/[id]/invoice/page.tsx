"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { showSimpleError } from "@/lib/toast-notifications";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorAlert } from "@/components/ui/error-alert";
import { EnhancedLeaseInvoice } from "@/components/invoices/EnhancedLeaseInvoice";
import { leaseService, LeaseResponse } from "@/lib/services/lease.service";
import { getCompanyInfo, type CompanyInfo } from "@/lib/utils/company-info";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export default function LeaseInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [lease, setLease] = useState<LeaseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocalizationContext();
  // The office's own name, address and logo — the same branding the modal
  // version of this invoice reads. This page used to hard-code
  // "PropertyPro Management, 123 Business Avenue …" onto every invoice.
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | undefined>();

  const leaseId = params.id as string;

  useEffect(() => {
    if (leaseId) {
      fetchLease();
    }
  }, [leaseId]);

  useEffect(() => {
    getCompanyInfo()
      .then((info) => setCompanyInfo(info ?? undefined))
      .catch(() => setCompanyInfo(undefined));
  }, []);

  const fetchLease = async () => {
    try {
      setLoading(true);
      setError(null);
      const leaseData = await leaseService.getLeaseById(leaseId);
      setLease(leaseData);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : t("leases.invoiceDoc.loadFailed", { defaultValue: "Could not load the contract" });
      setError(errorMessage);
      showSimpleError(
        t("leases.invoiceDoc.loadFailed", { defaultValue: "Could not load the contract" }),
        errorMessage,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoBack = () => {
    router.back();
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* Header Skeleton */}
          <div className="flex items-center justify-between">
            <div className="h-10 bg-muted rounded animate-pulse w-24" />
            <div className="h-8 bg-muted rounded animate-pulse w-32" />
          </div>

          {/* Invoice Card Skeleton */}
          <Card>
            <CardHeader>
              <div className="h-6 bg-muted rounded animate-pulse w-48" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <div className="h-4 bg-muted rounded animate-pulse w-32" />
                    <div className="h-4 bg-muted rounded animate-pulse w-24" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !lease) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <Button
            variant="outline"
            onClick={handleGoBack}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            {t("tenants.ledger.back", { defaultValue: "Back" })}
          </Button>
        </div>

        <ErrorAlert
          title={t("leases.invoiceDoc.loadFailed", { defaultValue: "Could not load the contract" })}
          message={
            error ||
            t("leases.invoiceDoc.notFound", { defaultValue: "Contract not found" })
          }
          onRetry={fetchLease}
          className="max-w-md mx-auto"
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={handleGoBack}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            {t("leases.invoiceDoc.backToContract", { defaultValue: "Back to the contract" })}
          </Button>

          <div className="text-end">
            <h1 className="text-2xl font-bold text-gray-900">{t("leases.invoiceDoc.title", { defaultValue: "Lease invoice" })}</h1>
          </div>
        </div>
      </div>

      {/* Enhanced Invoice Component */}
      <EnhancedLeaseInvoice
        lease={lease}
        companyInfo={companyInfo}
        className="mb-8"
      />
    </div>
  );
}
