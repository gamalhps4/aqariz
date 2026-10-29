"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  DollarSign,
  RefreshCw,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SecurityDepositStatus, DeductionCategory } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { toast } from "sonner";

interface Deduction {
  _id: string;
  category: string;
  description: string;
  amount: number;
  createdAt: string;
}

interface Deposit {
  _id: string;
  amount: number;
  status: SecurityDepositStatus;
  collectedDate?: string;
  deductions: Deduction[];
  refundAmount?: number;
  refundDate?: string;
  refundMethod?: string;
  notes?: string;
}

/** What a deduction from a deposit can be for, in the order offered. */
const DEDUCTION_CATEGORIES = [
  "damage",
  "unpaid_rent",
  "cleaning",
  "key_replacement",
  "lease_break",
  "other",
] as const;

interface LeaseDepositCardProps {
  leaseId: string;
  fallbackAmount: number;
}

export function LeaseDepositCard({
  leaseId,
  fallbackAmount,
}: LeaseDepositCardProps) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCollect, setShowCollect] = useState(false);
  const [showDeduction, setShowDeduction] = useState(false);
  const [showRefund, setShowRefund] = useState(false);

  const [createAmount, setCreateAmount] = useState(fallbackAmount.toString());
  const [deductionForm, setDeductionForm] = useState({
    category: DeductionCategory.DAMAGE as string,
    description: "",
    amount: "",
  });
  const [refundMethod, setRefundMethod] = useState("bank_transfer");
  const [refundNotes, setRefundNotes] = useState("");

  const fetchDeposit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/security-deposits?leaseId=${leaseId}`);
      const data = await res.json();
      if (data.success) {
        setDeposit(data.data.deposits?.[0] || null);
      }
    } catch {
      toast.error(t("leases.deposit.toasts.loadFailed", { defaultValue: "Could not load the deposit" }));
    } finally {
      setLoading(false);
    }
  }, [leaseId, t]);

  useEffect(() => {
    fetchDeposit();
  }, [fetchDeposit]);

  const handleCreate = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/security-deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseId,
          amount: parseFloat(createAmount),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(t("leases.deposit.toasts.created", { defaultValue: "Deposit record created" }));
        setShowCreate(false);
        fetchDeposit();
      } else {
        toast.error(data.error || t("leases.deposit.toasts.createFailed", { defaultValue: "Could not create the deposit record" }));
      }
    } catch {
      toast.error(t("leases.deposit.toasts.error", { defaultValue: "Something went wrong. Please try again." }));
    } finally {
      setActionLoading(false);
    }
  };

  const handleAction = async (action: string, body: any) => {
    if (!deposit) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/security-deposits/${deposit._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || t("leases.deposit.toasts.done", { defaultValue: "Done" }));
        setShowCollect(false);
        setShowDeduction(false);
        setShowRefund(false);
        fetchDeposit();
      } else if (data.code === "DEPOSIT_INSTALLMENT_UNPAID") {
        toast.error(t("leases.deposit.toasts.installmentUnpaid", { defaultValue: data.error }));
      } else if (data.code === "DEPOSIT_PAYMENT_MISMATCH") {
        toast.error(t("leases.deposit.toasts.paymentMismatch", { defaultValue: data.error }));
      } else {
        toast.error(data.error || t("leases.deposit.toasts.failed", { defaultValue: "That did not work" }));
      }
    } catch {
      toast.error(t("leases.deposit.toasts.error", { defaultValue: "Something went wrong. Please try again." }));
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: SecurityDepositStatus) => {
    const config: Record<SecurityDepositStatus, { label: string; className: string }> = {
      [SecurityDepositStatus.PENDING]: {
        label: t("leases.deposit.status.pending", { defaultValue: "Pending" }),
        className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200",
      },
      [SecurityDepositStatus.COLLECTED]: {
        label: t("leases.deposit.status.collected", { defaultValue: "Held" }),
        className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
      },
      [SecurityDepositStatus.PARTIALLY_REFUNDED]: {
        label: t("leases.deposit.status.partiallyRefunded", { defaultValue: "Partly refunded" }),
        className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
      },
      [SecurityDepositStatus.FULLY_REFUNDED]: {
        label: t("leases.deposit.status.refunded", { defaultValue: "Refunded" }),
        className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
      },
      [SecurityDepositStatus.FORFEITED]: {
        label: t("leases.deposit.status.forfeited", { defaultValue: "Forfeited" }),
        className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
      },
    };
    const c = config[status];
    return <Badge className={c.className}>{c.label}</Badge>;
  };

  const categoryLabel = (category: string) =>
    t(`leases.deposit.categories.${category}`, {
      defaultValue: category.replace(/_/g, " "),
    });

  const totalDeductions =
    deposit?.deductions?.reduce((s, d) => s + d.amount, 0) || 0;
  const refundAvailable = deposit ? deposit.amount - totalDeductions : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10">
              <ShieldCheck className="h-5 w-5 text-warning" />
            </div>
            {t("leases.deposit.title", { defaultValue: "Security deposit" })}
          </div>
          {deposit && getStatusBadge(deposit.status)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">
            {t("leases.deposit.loading", { defaultValue: "Loading the deposit…" })}
          </p>
        ) : !deposit ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("leases.deposit.none", { defaultValue: "No deposit has been recorded for this contract yet." })}
            </p>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 me-2" />
              {t("leases.deposit.create", { defaultValue: "Record deposit" })}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">
                  {t("leases.deposit.amount", { defaultValue: "Amount" })}
                </p>
                <p className="font-semibold text-base">
                  {formatCurrency(deposit.amount)}
                </p>
              </div>
              {deposit.collectedDate && (
                <div>
                  <p className="text-muted-foreground">
                    {t("leases.deposit.collectedOn", { defaultValue: "Collected" })}
                  </p>
                  <p>{formatDate(deposit.collectedDate)}</p>
                </div>
              )}
              {totalDeductions > 0 && (
                <div>
                  <p className="text-muted-foreground">
                    {t("leases.deposit.totalDeductions", { defaultValue: "Total deductions" })}
                  </p>
                  <p className="font-semibold text-red-600">
                    -{formatCurrency(totalDeductions)}
                  </p>
                </div>
              )}
              {deposit.refundAmount && deposit.refundAmount > 0 && (
                <div>
                  <p className="text-muted-foreground">
                    {t("leases.deposit.refundedAmount", { defaultValue: "Refunded" })}
                  </p>
                  <p className="font-semibold text-green-600">
                    {formatCurrency(deposit.refundAmount)}
                  </p>
                </div>
              )}
            </div>

            {deposit.deductions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t("leases.deposit.deductions", { defaultValue: "Deductions" })}
                </p>
                {deposit.deductions.map((d) => (
                  <div
                    key={d._id}
                    className="flex justify-between items-center p-2 rounded bg-muted text-sm"
                  >
                    <div>
                      <span className="font-medium">
                        {categoryLabel(d.category)}
                      </span>
                      <span className="text-muted-foreground ms-2">
                        {d.description}
                      </span>
                    </div>
                    <span className="text-red-600 font-medium">
                      -{formatCurrency(d.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              {deposit.status === SecurityDepositStatus.PENDING && (
                <Button size="sm" onClick={() => setShowCollect(true)}>
                  <DollarSign className="h-4 w-4 me-2" />
                  {t("leases.deposit.markCollected", { defaultValue: "Mark as collected" })}
                </Button>
              )}
              {deposit.status === SecurityDepositStatus.COLLECTED && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDeductionForm({
                        category: DeductionCategory.DAMAGE,
                        description: "",
                        amount: "",
                      });
                      setShowDeduction(true);
                    }}
                  >
                    <AlertTriangle className="h-4 w-4 me-2" />
                    {t("leases.deposit.addDeduction", { defaultValue: "Add deduction" })}
                  </Button>
                  <Button size="sm" onClick={() => setShowRefund(true)}>
                    <RefreshCw className="h-4 w-4 me-2" />
                    {t("leases.deposit.refund", { defaultValue: "Refund deposit" })}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </CardContent>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("leases.deposit.createDialog.title", { defaultValue: "Record the security deposit" })}
            </DialogTitle>
            <DialogDescription>
              {t("leases.deposit.createDialog.description", { defaultValue: "Enter the deposit amount to start tracking it." })}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>{t("leases.deposit.amount", { defaultValue: "Amount" })}</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={createAmount}
              onChange={(e) => setCreateAmount(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={actionLoading || !createAmount}
            >
              {actionLoading
                ? t("leases.deposit.saving", { defaultValue: "Saving…" })
                : t("leases.deposit.save", { defaultValue: "Save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collect Dialog */}
      <Dialog open={showCollect} onOpenChange={setShowCollect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("leases.deposit.collectDialog.title", { defaultValue: "Mark the deposit as collected" })}
            </DialogTitle>
            <DialogDescription>
              {t("leases.deposit.collectDialog.description", { defaultValue: "Confirm that the deposit of {amount} has been received.", values: { amount: deposit ? formatCurrency(deposit.amount) : "" } })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCollect(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              onClick={() => handleAction("collect", {})}
              disabled={actionLoading}
            >
              {actionLoading
                ? t("leases.deposit.processing", { defaultValue: "Working…" })
                : t("leases.deposit.confirmCollection", { defaultValue: "Confirm collection" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deduction Dialog */}
      <Dialog open={showDeduction} onOpenChange={setShowDeduction}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("leases.deposit.addDeduction", { defaultValue: "Add deduction" })}
            </DialogTitle>
            <DialogDescription>
              {t("leases.deposit.deductionDialog.description", { defaultValue: "Record a deduction against the security deposit." })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("leases.deposit.category", { defaultValue: "Category" })}</Label>
              <Select
                value={deductionForm.category}
                onValueChange={(v) =>
                  setDeductionForm({ ...deductionForm, category: v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEDUCTION_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {categoryLabel(category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("leases.deposit.description", { defaultValue: "Description" })}</Label>
              <Textarea
                value={deductionForm.description}
                onChange={(e) =>
                  setDeductionForm({
                    ...deductionForm,
                    description: e.target.value,
                  })
                }
                placeholder={t("leases.deposit.descriptionPlaceholder", { defaultValue: "What is the deduction for?" })}
              />
            </div>
            <div>
              <Label>{t("leases.deposit.amount", { defaultValue: "Amount" })}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={deductionForm.amount}
                onChange={(e) =>
                  setDeductionForm({
                    ...deductionForm,
                    amount: e.target.value,
                  })
                }
                placeholder="0.00"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeduction(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              onClick={() =>
                handleAction("add-deduction", {
                  category: deductionForm.category,
                  description: deductionForm.description,
                  amount: parseFloat(deductionForm.amount),
                })
              }
              disabled={
                actionLoading ||
                !deductionForm.description ||
                !deductionForm.amount
              }
            >
              {actionLoading
                ? t("leases.deposit.saving", { defaultValue: "Saving…" })
                : t("leases.deposit.addDeduction", { defaultValue: "Add deduction" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund Dialog */}
      <Dialog open={showRefund} onOpenChange={setShowRefund}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("leases.deposit.refund", { defaultValue: "Refund deposit" })}
            </DialogTitle>
            <DialogDescription>
              {t("leases.deposit.refundDialog.description", { defaultValue: "Return the deposit to the tenant, less any deductions." })}
            </DialogDescription>
          </DialogHeader>
          {deposit && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted p-4 space-y-2">
                <div className="flex justify-between">
                  <span>{t("leases.deposit.original", { defaultValue: "Deposit" })}</span>
                  <span className="font-medium">
                    {formatCurrency(deposit.amount)}
                  </span>
                </div>
                {deposit.deductions.map((d) => (
                  <div
                    key={d._id}
                    className="flex justify-between text-sm text-red-600"
                  >
                    <span>
                      {categoryLabel(d.category)} — {d.description}
                    </span>
                    <span>-{formatCurrency(d.amount)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>{t("leases.deposit.refundAmount", { defaultValue: "To refund" })}</span>
                  <span className="text-green-600">
                    {formatCurrency(refundAvailable)}
                  </span>
                </div>
              </div>
              <div>
                <Label>{t("leases.deposit.refundMethod", { defaultValue: "Refund method" })}</Label>
                <Select value={refundMethod} onValueChange={setRefundMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">
                      {t("leases.deposit.methods.bankTransfer", { defaultValue: "Bank transfer" })}
                    </SelectItem>
                    <SelectItem value="check">
                      {t("leases.deposit.methods.check", { defaultValue: "Cheque" })}
                    </SelectItem>
                    <SelectItem value="original_method">
                      {t("leases.deposit.methods.original", { defaultValue: "Same way it was paid" })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("leases.deposit.notes", { defaultValue: "Notes (optional)" })}</Label>
                <Textarea
                  value={refundNotes}
                  onChange={(e) => setRefundNotes(e.target.value)}
                  placeholder={t("leases.deposit.notesPlaceholder", { defaultValue: "Anything worth recording about the refund" })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRefund(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              onClick={() =>
                handleAction("refund", { refundMethod, refundNotes })
              }
              disabled={actionLoading}
            >
              {actionLoading
                ? t("leases.deposit.processing", { defaultValue: "Working…" })
                : t("leases.deposit.refund", { defaultValue: "Refund deposit" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
