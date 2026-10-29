"use client";

/**
 * An expense's VAT and supplier, as the new and edit forms ask for them.
 *
 * The amount is what was paid, VAT included; the VAT is recorded inside it,
 * with its category, so the office can reclaim it (the VAT summary's input
 * VAT). The supplier is picked from the office's list, or added on the spot
 * — a name, a VAT number and a phone — with the supplier's own invoice
 * number beside it.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select";
import { Loader2, Plus } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { vatInsideAmount } from "@/lib/invoice/expense-vat";
import {
  isSaudiVatNumber,
  STANDARD_VAT_RATE,
  VAT_CATEGORIES,
  type VatCategory,
} from "@/lib/invoice/vat";

export interface ExpenseVatValue {
  /** "" when not recorded. */
  vatCategory: VatCategory | "";
  /** As typed. */
  vatAmount: string;
  supplierId: string;
  supplierInvoiceNumber: string;
}

export const EMPTY_EXPENSE_VAT: ExpenseVatValue = {
  vatCategory: "",
  vatAmount: "",
  supplierId: "",
  supplierInvoiceNumber: "",
};

/** The fields as the expense API takes them. */
export function expenseVatBody(value: ExpenseVatValue) {
  const vat = parseFloat(value.vatAmount) || 0;
  return {
    vatCategory: value.vatCategory || null,
    vatAmount: value.vatCategory === "S" ? vat : 0,
    supplierId: value.supplierId || null,
    supplierInvoiceNumber: value.supplierInvoiceNumber.trim() || null,
  };
}

interface Supplier {
  id: string;
  name: string;
  vatNumber: string | null;
  phone: string | null;
}

const CATEGORY_LABELS: Record<VatCategory, string> = {
  S: "Standard rate",
  Z: "Zero-rated",
  E: "Exempt",
  O: "Out of scope",
};

export function VatSupplierFields({
  value,
  onChange,
  amount,
}: {
  value: ExpenseVatValue;
  onChange: (next: ExpenseVatValue) => void;
  /** The expense's amount as typed, VAT included. */
  amount: string;
}) {
  const { t, formatCurrency } = useLocalizationContext();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: "", vatNumber: "", phone: "" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/accounting/suppliers");
        const body = await response.json();
        if (!cancelled && response.ok) setSuppliers(body?.data?.suppliers ?? []);
      } catch {
        // The picker stays empty; a supplier can still be added.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const supplierOptions: SearchableSelectOption[] = useMemo(
    () =>
      suppliers.map((supplier) => ({
        value: supplier.id,
        label: supplier.name,
        subtitle: supplier.vatNumber ?? supplier.phone ?? undefined,
      })),
    [suppliers],
  );

  const set = (patch: Partial<ExpenseVatValue>) => onChange({ ...value, ...patch });

  const addSupplier = async () => {
    if (!draft.name.trim()) {
      toast.error(t("expenses.supplier.nameRequired", { defaultValue: "Enter the supplier's name" }));
      return;
    }
    if (draft.vatNumber.trim() && !isSaudiVatNumber(draft.vatNumber)) {
      toast.error(
        t("invoices.vat.numberInvalid", {
          defaultValue: "A VAT number is 15 digits that begin and end with 3",
        }),
      );
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/accounting/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          vatNumber: draft.vatNumber.trim() || null,
          phone: draft.phone.trim() || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error);
      const created = body.data as Supplier;
      setSuppliers((previous) =>
        [...previous, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      set({ supplierId: created.id });
      setDraft({ name: "", vatNumber: "", phone: "" });
      setAdding(false);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("expenses.supplier.addFailed", { defaultValue: "Could not add the supplier" }),
      );
    } finally {
      setSaving(false);
    }
  };

  const gross = parseFloat(amount) || 0;

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <p className="text-sm font-medium">
        {t("expenses.vat.title", { defaultValue: "VAT and supplier" })}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("expenses.vat.category", { defaultValue: "VAT category" })}</Label>
          <Select
            value={value.vatCategory || "none"}
            onValueChange={(next) => {
              const category = next === "none" ? "" : (next as VatCategory);
              set({
                vatCategory: category,
                vatAmount:
                  category === "S"
                    ? value.vatAmount || String(vatInsideAmount(gross, STANDARD_VAT_RATE) || "")
                    : "",
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t("expenses.vat.notRecorded", { defaultValue: "No VAT recorded" })}
              </SelectItem>
              {VAT_CATEGORIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {t(`invoices.vat.category.${code}`, { defaultValue: CATEGORY_LABELS[code] })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vatAmount">
            {t("expenses.vat.amount", { defaultValue: "VAT included in the amount" })}
          </Label>
          <div className="flex gap-2">
            <Input
              id="vatAmount"
              type="number"
              step="0.01"
              min="0"
              value={value.vatCategory === "S" ? value.vatAmount : ""}
              disabled={value.vatCategory !== "S"}
              onChange={(e) => set({ vatAmount: e.target.value })}
              placeholder="0.00"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={value.vatCategory !== "S" || gross <= 0}
              onClick={() => set({ vatAmount: String(vatInsideAmount(gross, STANDARD_VAT_RATE)) })}
            >
              {STANDARD_VAT_RATE}%
            </Button>
          </div>
          {value.vatCategory === "S" && gross > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("expenses.vat.netOf", {
                defaultValue: "Before VAT: {amount}",
                values: { amount: formatCurrency(gross - (parseFloat(value.vatAmount) || 0)) },
              })}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label>{t("expenses.supplier.label", { defaultValue: "Supplier" })}</Label>
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchableSelect
                value={value.supplierId}
                onValueChange={(next) => set({ supplierId: next })}
                options={supplierOptions}
                placeholder={t("expenses.supplier.choose", { defaultValue: "Select a supplier..." })}
                searchPlaceholder={t("expenses.supplier.search", { defaultValue: "Search suppliers..." })}
                emptyMessage={t("expenses.supplier.none", { defaultValue: "No supplier found." })}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setAdding((on) => !on)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="supplierInvoiceNumber">
            {t("expenses.supplier.invoiceNumber", { defaultValue: "Supplier's invoice no." })}
          </Label>
          <Input
            id="supplierInvoiceNumber"
            value={value.supplierInvoiceNumber}
            onChange={(e) => set({ supplierInvoiceNumber: e.target.value })}
            maxLength={100}
          />
        </div>
      </div>

      {adding && (
        <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/30 p-3 md:grid-cols-4">
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t("expenses.supplier.name", { defaultValue: "Supplier name" })}
            maxLength={200}
          />
          <Input
            value={draft.vatNumber}
            onChange={(e) => setDraft({ ...draft, vatNumber: e.target.value })}
            placeholder={t("expenses.supplier.vatNumber", { defaultValue: "VAT number" })}
            inputMode="numeric"
            maxLength={20}
          />
          <Input
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder={t("expenses.supplier.phone", { defaultValue: "Phone" })}
            maxLength={40}
          />
          <Button type="button" onClick={addSupplier} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("expenses.supplier.add", { defaultValue: "Add supplier" })}
          </Button>
        </div>
      )}
    </div>
  );
}
