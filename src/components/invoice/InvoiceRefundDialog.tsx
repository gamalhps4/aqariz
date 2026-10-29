"use client";

/**
 * PropertyPro - Record a refund paid back on an overpaid invoice
 *
 * A credit note issued against an invoice that was already paid leaves the
 * customer owed money (the "refund due" the invoice shows). When the office
 * pays it back, it records it here: the books take it out of the account it
 * was paid from — or, for an owner, put it back on what the office holds for
 * them — and the refund due comes down. Posts to the invoice's
 * `record_refund` operation.
 */

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MANUAL_PAYMENT_METHODS, isReceivedByOwner } from "@/lib/payments/methods";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { businessToday } from "@/lib/dates/business-day";

/** Paid back from what the office holds for the owner. */
const OWNER_BALANCE = "owner_balance";

export interface InvoiceRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  refundDue: number;
  /** An owner's invoice may be refunded onto their balance. */
  forOwner: boolean;
  onRecorded: () => void;
}

export default function InvoiceRefundDialog({
  open,
  onOpenChange,
  invoiceId,
  refundDue,
  forOwner,
  onRecorded,
}: InvoiceRefundDialogProps) {
  const { t, formatCurrency } = useLocalizationContext();
  const [amount, setAmount] = useState(String(refundDue));
  const [paidDate, setPaidDate] = useState(businessToday());
  const [method, setMethod] = useState(forOwner ? OWNER_BALANCE : "");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  // The office pays a refund: nothing the owner received themselves.
  const methods = MANUAL_PAYMENT_METHODS.filter((option) => !isReceivedByOwner(option.value));

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "record_refund",
          amount: Number(amount),
          paidDate,
          paymentMethod: method,
          reference: reference.trim() || undefined,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.error || body?.message || t("errors.dashboard.unknown.title", { defaultValue: "Something went wrong" }));
        return;
      }
      toast.success(t("invoices.creditNote.refundRecorded", { defaultValue: "Refund recorded" }));
      onRecorded();
    } finally {
      setSaving(false);
    }
  }

  const value = Number(amount);
  const valid = value > 0 && value <= refundDue + 0.005 && Boolean(method) && Boolean(paidDate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("invoices.creditNote.refundTitle", { defaultValue: "Record the refund paid" })}
          </DialogTitle>
          <DialogDescription>
            {t("invoices.creditNote.refundHint", {
              defaultValue:
                "What the credit note left overpaid, paid back. It is taken out of the account it was paid from — or, for an owner, put back on their balance.",
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            {t("invoices.creditNote.refundDue", {
              defaultValue: "Refund due to the customer: {amount}",
              values: { amount: formatCurrency(refundDue) },
            })}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="refund-amount">
                {t("payments.collect.fields.amount", { defaultValue: "Amount" })}
              </Label>
              <Input
                id="refund-amount"
                dir="ltr"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="refund-date">
                {t("payments.collect.fields.paidAt", { defaultValue: "Payment date" })}
              </Label>
              <Input
                id="refund-date"
                type="date"
                value={paidDate}
                max={businessToday()}
                onChange={(event) => setPaidDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("payments.collect.fields.method", { defaultValue: "Payment method" })}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t("payments.collect.fields.methodPlaceholder", {
                    defaultValue: "Select method",
                  })}
                />
              </SelectTrigger>
              <SelectContent>
                {forOwner && (
                  <SelectItem value={OWNER_BALANCE}>
                    {t("invoices.creditNote.refundOwnerBalance", {
                      defaultValue: "Back on the owner's balance",
                    })}
                  </SelectItem>
                )}
                {methods.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey, { defaultValue: option.fallback })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="refund-reference">
              {t("payments.collect.fields.reference", { defaultValue: "Reference number" })}
            </Label>
            <Input
              id="refund-reference"
              value={reference}
              placeholder={t("payments.collect.fields.referencePlaceholder", {
                defaultValue: "Transfer, cheque or receipt number",
              })}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button onClick={save} disabled={saving || !valid}>
            {saving
              ? t("common.saving", { defaultValue: "Saving..." })
              : t("invoices.creditNote.refundSubmit", { defaultValue: "Record refund" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
