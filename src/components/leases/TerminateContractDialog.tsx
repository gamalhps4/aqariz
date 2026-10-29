"use client";

/**
 * PropertyPro - Contract termination
 *
 * Ending a tenancy is the last moment an office can act on unpaid rent, so
 * this dialog refuses to be a one-click action: it fetches what the tenant
 * still owes at the chosen date and makes the operator decide, explicitly,
 * whether that balance stays payable or is written off.
 *
 * The server enforces the same rule — a contract with a balance is rejected
 * until `acknowledgeOutstanding` is sent — so the warning cannot be skipped
 * by calling the API directly.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { OutstandingSummary } from "@/types/installment";

interface TerminateContractDialogProps {
  leaseId: string;
  propertyName: string;
  onTerminated: () => void;
  /**
   * Set by a caller that opens the dialog itself — a menu item on the
   * contracts list, the contract card, the status changer. The dialog then
   * draws no button of its own. Every way of cancelling a contract comes
   * through here, so every cancellation carries its date and reason; the
   * shortcuts those screens used to take set the status and nothing else.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Today as a date-input value. Local parts on purpose: this is the operator
 * picking "today" in their own calendar, not a stored contract date.
 */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function TerminateContractDialog({
  leaseId,
  propertyName,
  onTerminated,
  open: controlledOpen,
  onOpenChange,
}: TerminateContractDialogProps) {
  const { t, formatCurrency } = useLocalizationContext();

  const controlled = controlledOpen !== undefined;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlled ? controlledOpen : ownOpen;
  /**
   * The date the operator chose, or null while they have chosen none — and
   * then the form shows today, read afresh each time it renders. "Today" used
   * to be fixed when the component mounted. The contract card and the status
   * changer mount this dialog with their page, so a page left open overnight
   * opened the form on yesterday, a date the route refuses.
   */
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const terminationDate = pickedDate ?? todayIso();
  const setOpen = (next: boolean) => {
    // Closing forgets the chosen date: the next opening starts from today.
    if (!next) setPickedDate(null);
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [retainOutstanding, setRetainOutstanding] = useState(true);
  const [outstanding, setOutstanding] = useState<OutstandingSummary | null>(null);
  const [loadingOutstanding, setLoadingOutstanding] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Re-fetched whenever the date moves: which installments count as "already
  // earned" depends entirely on where the tenancy is cut.
  const loadOutstanding = useCallback(async () => {
    if (!open || !terminationDate) return;
    setLoadingOutstanding(true);
    try {
      const response = await fetch(
        `/api/leases/${leaseId}/terminate?terminationDate=${terminationDate}`,
      );
      const payload = await response.json();
      if (payload?.success) {
        setOutstanding(
          payload.data?.terminationInfo?.outstanding ?? null,
        );
      }
    } catch (error) {
      console.error("Failed to load outstanding balance:", error);
    } finally {
      setLoadingOutstanding(false);
    }
  }, [leaseId, terminationDate, open]);

  useEffect(() => {
    loadOutstanding();
  }, [loadOutstanding]);

  const submit = async () => {
    if (!reason.trim()) {
      toast.error(
        t("leases.terminate.reasonRequired", {
          defaultValue: "A termination reason is required",
        }),
      );
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/leases/${leaseId}/terminate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terminationDate,
          reason,
          notice: notice || undefined,
          retainOutstanding,
          // The operator has now seen the figure below; without this the
          // server refuses a contract that still carries a balance.
          acknowledgeOutstanding: true,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result?.success) {
        toast.error(
          result?.error ??
            t("leases.terminate.failed", {
              defaultValue: "Could not terminate the contract",
            }),
        );
        return;
      }

      const details = result.data?.terminationDetails;
      const retained = details?.outstandingRetained ?? 0;
      toast.success(
        retained > 0
          ? t("leases.terminate.successWithBalance", {
              defaultValue:
                "Contract terminated. {amount} remains payable by the tenant.",
              values: { amount: formatCurrency(retained) },
            })
          : t("leases.terminate.success", {
              defaultValue: "Contract terminated",
            }),
      );

      setOpen(false);
      setReason("");
      setNotice("");
      onTerminated();
    } catch (error) {
      console.error("Failed to terminate contract:", error);
      toast.error(
        t("leases.terminate.failed", {
          defaultValue: "Could not terminate the contract",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const hasOutstanding = (outstanding?.outstandingTotal ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-orange-600 hover:text-orange-700"
          >
            <XCircle className="me-2 h-4 w-4" />
            {t("leases.terminate.action", { defaultValue: "Terminate contract" })}
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            {t("leases.terminate.title", {
              defaultValue: "Terminate contract",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("leases.terminate.description", {
              defaultValue:
                "This ends the tenancy for {property}. It cannot be undone.",
              values: { property: propertyName },
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="terminationDate">
              {t("leases.terminate.date", { defaultValue: "Termination date" })}
            </Label>
            <Input
              id="terminationDate"
              type="date"
              value={terminationDate}
              onChange={(event) => setPickedDate(event.target.value)}
            />
          </div>

          {/* The outstanding-rent warning. */}
          {loadingOutstanding ? (
            <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("leases.terminate.checkingBalance", {
                defaultValue: "Checking outstanding rent…",
              })}
            </div>
          ) : hasOutstanding ? (
            <div className="space-y-3 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm dark:border-orange-900 dark:bg-orange-950/30">
              <p className="flex items-start gap-2 font-medium text-orange-900 dark:text-orange-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {t("leases.terminate.outstandingWarning", {
                  defaultValue:
                    "{amount} is still outstanding on this contract across {count} installment(s), {overdue} of them overdue.",
                  values: {
                    amount: formatCurrency(outstanding!.outstandingTotal),
                    count: outstanding!.openInstallments,
                    overdue: outstanding!.overdueCount,
                  },
                })}
              </p>

              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  checked={retainOutstanding}
                  onCheckedChange={(checked) =>
                    setRetainOutstanding(checked === true)
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">
                    {t("leases.terminate.retainLabel", {
                      defaultValue: "Keep this balance payable by the tenant",
                    })}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {retainOutstanding
                      ? t("leases.terminate.retainOn", {
                          defaultValue:
                            "Rent already earned stays on the tenant's ledger; only installments covering time after this date are cancelled.",
                        })
                      : t("leases.terminate.retainOff", {
                          defaultValue:
                            "The full outstanding balance will be written off and disappear from the tenant's ledger.",
                        })}
                  </span>
                </span>
              </label>
            </div>
          ) : (
            outstanding && (
              <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                {t("leases.terminate.noOutstanding", {
                  defaultValue:
                    "Nothing is outstanding on this contract at that date.",
                })}
              </p>
            )
          )}

          {(outstanding?.futureInstallments ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("leases.terminate.futureNote", {
                defaultValue:
                  "{count} unbilled installment(s) worth {amount} cover time after this date and will be cancelled.",
                values: {
                  count: outstanding!.futureInstallments,
                  amount: formatCurrency(outstanding!.futureTotal),
                },
              })}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="terminationReason">
              {t("leases.terminate.reason", {
                defaultValue: "Reason for termination",
              })}
            </Label>
            <Textarea
              id="terminationReason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("leases.terminate.reasonPlaceholder", {
                defaultValue: "Explain why this contract is ending…",
              })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="terminationNotice">
              {t("leases.terminate.notice", {
                defaultValue: "Notice to tenant (optional)",
              })}
            </Label>
            <Textarea
              id="terminationNotice"
              rows={2}
              value={notice}
              onChange={(event) => setNotice(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={submitting || !reason.trim()}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("leases.terminate.confirm", {
              defaultValue: "Terminate contract",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
