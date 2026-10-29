"use client";

/**
 * PropertyPro - Review and confirm a contract amendment
 *
 * The edit form, in amendment mode, hands over the contract as edited. This
 * asks the server what the amendment would do (POST .../amend, no `apply`),
 * shows it — installments kept, cancelled and billed again, the contract's
 * value before and after, anything that stops it — and writes it only once
 * the operator gives a reason and confirms that preview. If a payment comes
 * in meanwhile, the server refuses the stale preview and sends the new one,
 * which is shown for another look.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { AmendmentPreview, AmendmentProblem } from "@/lib/lease-amendment";

interface LeaseAmendmentDialogProps {
  leaseId: string;
  /** The contract as edited — the edit form's own payload. */
  payload: Record<string, unknown> | null;
  onClose: () => void;
  onAmended: (result: { cancelled: number; billed: number; errors: string[] }) => void;
}

export function LeaseAmendmentDialog({
  leaseId,
  payload,
  onClose,
  onAmended,
}: LeaseAmendmentDialogProps) {
  const { t, formatCurrency, isRTL } = useLocalizationContext();
  /**
   * What the server answered, and for which payload: a preview shown is
   * always the one for the contract as it is being saved now, never the
   * last one's.
   */
  const [loaded, setLoaded] = useState<{
    payload: Record<string, unknown>;
    preview: AmendmentPreview | null;
    error: string | null;
    stale: boolean;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);

  const current = loaded && loaded.payload === payload ? loaded : null;
  const preview = current?.preview ?? null;
  const loadError = current?.error ?? null;
  const stale = current?.stale ?? false;

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/leases/${leaseId}/amend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, apply: false }),
        });
        const result = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || t("leases.amend.dialog.failed"));
        }
        setLoaded({ payload, preview: result.data.preview, error: null, stale: false });
      } catch (error) {
        if (cancelled) return;
        setLoaded({
          payload,
          preview: null,
          error: error instanceof Error ? error.message : t("leases.amend.dialog.failed"),
          stale: false,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `t` changes with the language; the preview does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseId, payload]);

  const problemText = (problem: AmendmentProblem) => {
    switch (problem.code) {
      case "paid_period_changed":
        return t("leases.amend.problem.paid_period_changed", {
          values: { invoice: problem.invoiceNumber },
        });
      case "total_below_paid":
        return t("leases.amend.problem.total_below_paid", {
          values: { paid: formatCurrency(problem.paidRent) },
        });
      default:
        return t(`leases.amend.problem.${problem.code}`);
    }
  };

  const confirm = async () => {
    if (!payload || !preview) return;
    setApplying(true);
    try {
      const response = await fetch(`/api/leases/${leaseId}/amend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          apply: true,
          reason: reason.trim(),
          fingerprint: preview.fingerprint,
        }),
      });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.success) {
        onAmended(result.data.applied);
        return;
      }
      // Something came in since this preview: show the new one instead.
      if (result?.code === "AMENDMENT_STALE" && result.data?.preview) {
        setLoaded({ payload, preview: result.data.preview, error: null, stale: true });
        return;
      }
      throw new Error(result?.error || t("leases.amend.dialog.failed"));
    } catch (error) {
      toast.error(t("leases.amend.dialog.failed"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setApplying(false);
    }
  };

  const canConfirm =
    Boolean(preview) &&
    preview!.problems.length === 0 &&
    reason.trim().length >= 3 &&
    !applying;

  return (
    <Dialog open={payload !== null} onOpenChange={(open) => !open && !applying && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("leases.amend.dialog.title")}</DialogTitle>
          <DialogDescription>{t("leases.amend.dialog.description")}</DialogDescription>
        </DialogHeader>

        {!preview && !loadError && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("leases.amend.dialog.loading")}
          </div>
        )}

        {loadError && (
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {preview && (
          <div className="space-y-4 text-sm">
            {stale && (
              <Alert>
                <AlertDescription>{t("leases.amend.dialog.stale")}</AlertDescription>
              </Alert>
            )}

            <Badge variant={preview.level === "correction" ? "secondary" : "outline"}>
              {t(`leases.amend.level.${preview.level}`)}
            </Badge>

            {preview.changed.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">{t("leases.amend.dialog.changed")}</p>
                <p className="text-muted-foreground">
                  {preview.changed
                    .map((term) => t(`leases.amend.term.${term}`))
                    .join(isRTL ? "، " : ", ")}
                </p>
              </div>
            )}

            <ul className="space-y-1.5">
              <li>
                {preview.keep.length > 0
                  ? t("leases.amend.dialog.kept", {
                      values: {
                        count: preview.keep.length,
                        paid: formatCurrency(preview.totals.paid),
                      },
                    })
                  : t("leases.amend.dialog.keptNone")}
              </li>
              <li>
                {t("leases.amend.dialog.cancelled", {
                  values: { count: preview.cancelCount },
                })}
              </li>
              <li>
                {t("leases.amend.dialog.created", {
                  values: { count: preview.create.length },
                })}
              </li>
              <li className="font-medium">
                {t("leases.amend.dialog.value", {
                  values: {
                    before: formatCurrency(preview.totals.before),
                    after: formatCurrency(preview.totals.after),
                  },
                })}
              </li>
            </ul>

            {preview.problems.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <ul className="list-disc space-y-1 ps-4">
                    {preview.problems.map((problem, index) => (
                      <li key={`${problem.code}-${index}`}>{problemText(problem)}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {preview.problems.length === 0 && (
              <div className="space-y-2">
                <Label htmlFor="amendment-reason">{t("leases.amend.dialog.reason")}</Label>
                <Textarea
                  id="amendment-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("leases.amend.dialog.reasonPlaceholder")}
                  maxLength={1000}
                  rows={3}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={applying}>
            {t("leases.amend.dialog.back")}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={!canConfirm}>
            {applying && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {applying ? t("leases.amend.dialog.applying") : t("leases.amend.dialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
