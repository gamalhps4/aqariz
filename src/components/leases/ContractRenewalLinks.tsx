"use client";

/**
 * PropertyPro - A contract's place in its chain of renewals
 *
 * A renewed contract did not say what renewed it: the old contract's page
 * read "Renewed" and led nowhere, and the office had to search the contracts
 * list for the unit to find the one in force. It now links to its renewal —
 * or, while the renewal waits as a draft, says that this contract stays in
 * force until the draft is activated — and a renewal links back to the
 * contract it came from.
 */

import Link from "next/link";
import { ArrowRight, History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { awaitsActivation, isLiveRenewal } from "@/lib/lease-lifecycle";
import type { LeaseRenewalLink, LeaseResponse } from "@/lib/services/lease.service";

interface ContractRenewalLinksProps {
  lease: Pick<LeaseResponse, "renewal">;
}

export function ContractRenewalLinks({ lease }: ContractRenewalLinksProps) {
  const { t, formatDate } = useLocalizationContext();
  const successor = lease.renewal?.successor ?? null;
  const predecessor = lease.renewal?.predecessor ?? null;
  const showSuccessor = isLiveRenewal(successor);

  if (!showSuccessor && !predecessor) return null;

  /** "Contract 10293847 · 1 Jan 2027 – 31 Dec 2027 · Active" */
  const describe = (link: LeaseRenewalLink) =>
    [
      link.contractNumber
        ? t("leases.renewal.contractNumber", {
            defaultValue: "Contract {number}",
            values: { number: link.contractNumber },
          })
        : null,
      `${formatDate(link.startDate)} – ${formatDate(link.endDate)}`,
      t(`leases.status.${link.status}`, { defaultValue: link.status }),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="space-y-3">
      {showSuccessor && successor && (
        <div className="flex flex-col gap-3 rounded-xl border border-info/20 bg-info/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <div>
              <p className="font-medium">
                {awaitsActivation(successor.status)
                  ? t("leases.renewal.pending", {
                      defaultValue: "A renewal is waiting to be activated",
                    })
                  : t("leases.renewal.renewedBy", {
                      defaultValue: "This contract was renewed",
                    })}
              </p>
              <p className="text-muted-foreground">{describe(successor)}</p>
              {awaitsActivation(successor.status) && (
                <p className="mt-1 text-muted-foreground">
                  {t("leases.renewal.pendingNote", {
                    defaultValue:
                      "This contract stays in force and keeps the unit until the renewal is signed or activated.",
                  })}
                </p>
              )}
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link href={`/dashboard/leases/${successor._id}`}>
              {t("leases.renewal.openRenewal", {
                defaultValue: "Open the renewal",
              })}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Link>
          </Button>
        </div>
      )}

      {predecessor && (
        <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">
                {t("leases.renewal.renewalOf", {
                  defaultValue: "This contract renews an earlier one",
                })}
              </p>
              <p className="text-muted-foreground">{describe(predecessor)}</p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link href={`/dashboard/leases/${predecessor._id}`}>
              {t("leases.renewal.openPrevious", {
                defaultValue: "Open the earlier contract",
              })}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
