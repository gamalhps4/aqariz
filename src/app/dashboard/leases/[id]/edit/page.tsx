"use client";

import { showSimpleError, showSimpleWarning } from "@/lib/toast-notifications";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, FileText } from "lucide-react";
import SimplifiedLeaseCreation from "@/components/lease/SimplifiedLeaseCreation";
import { leaseService, LeaseResponse } from "@/lib/services/lease.service";
import { LeaseStatus } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface EditLeasePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function EditLeasePage({ params }: EditLeasePageProps) {
  const router = useRouter();
  const { t } = useLocalizationContext();
  const [lease, setLease] = useState<LeaseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const lastFetchedId = useRef<string | null>(null);

  useEffect(() => {
    const getParams = async () => {
      const resolvedParams = await params;
      setLeaseId(resolvedParams.id);
    };
    getParams();
  }, [params]);

  useEffect(() => {
    if (!leaseId || lastFetchedId.current === leaseId) {
      return;
    }

    lastFetchedId.current = leaseId;
    void fetchLease(leaseId);
  }, [leaseId]);

  const fetchLease = async (leaseId: string) => {
    try {
      setLoading(true);
      const leaseData = await leaseService.getLeaseById(leaseId);
      setLease(leaseData);

      // Check if lease can be edited - allow editing of draft and pending leases
      if (
        leaseData.status === LeaseStatus.ACTIVE ||
        leaseData.status === LeaseStatus.TERMINATED ||
        leaseData.status === LeaseStatus.EXPIRED
      ) {
        showSimpleWarning(
          t("leases.edit.limitedTitle", { defaultValue: "Limited editing" }),
          t("leases.edit.limitedDescription", { defaultValue: "Only some details of this contract can change in its current status." })
        );
      }
    } catch (error) {
      showSimpleError(
        t("leases.edit.loadFailedTitle", { defaultValue: "Could not load" }),
        t("leases.edit.loadFailed", { defaultValue: "Could not load the contract" })
      );
      router.push("/dashboard/leases");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-20" />
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!lease) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t("leases.edit.notFound", { defaultValue: "Contract not found" })}
          </h3>
          <p className="text-muted-foreground mb-4">
            {t("leases.edit.notFoundDescription", { defaultValue: "The contract does not exist or has been deleted." })}
          </p>
          <Button onClick={() => router.push("/dashboard/leases")}>
            {t("leases.edit.back", { defaultValue: "Back to contracts" })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("leases.edit.title", { defaultValue: "Edit contract" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lease.propertyId?.name
              ? t("leases.edit.subtitleFor", { defaultValue: "Update the contract for {property}", values: { property: lease.propertyId.name } })
              : t("leases.edit.subtitle", { defaultValue: "Update the contract details" })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.back()}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
          {t("leases.edit.back", { defaultValue: "Back to contracts" })}
        </Button>
      </div>

      <SimplifiedLeaseCreation
        mode="edit"
        leaseId={leaseId ?? undefined}
        initialLease={lease}
        onSuccess={(updatedId) => {
          const targetId = updatedId ?? lease._id ?? leaseId ?? undefined;

          if (targetId) {
            router.push(`/dashboard/leases/${targetId}`);
          } else {
            router.push("/dashboard/leases");
          }
        }}
      />
    </div>
  );
}
