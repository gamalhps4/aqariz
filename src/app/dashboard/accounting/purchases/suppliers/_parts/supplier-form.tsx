"use client";

/**
 * PropertyPro - Adding or changing a supplier
 *
 * The dialog the suppliers list opens: the supplier's name, VAT and
 * commercial registration numbers, a contact, the address, the bank details
 * to pay into, and the payment terms a bill's due date follows. The checks the
 * server makes (lib/accounting/purchases/schemas.ts and suppliers.service.ts)
 * are made here first; what only the server can know — another supplier
 * already holding the VAT number — comes back as a refusal shown in the
 * dialog, which stays open.
 */

import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import type { SupplierView } from "@/lib/accounting/purchases/types";
import { isSaudiVatNumber } from "@/lib/invoice/vat";
import { cn } from "@/lib/utils";
import { ERROR_TEXT, type Text } from "../../../setup/_shared/ledger-ui";
import { purchasesRequest, useLedgerError, useLedgerText } from "../../_shared/purchases-ui";

interface SupplierDraft {
  name: string;
  vatNumber: string;
  crNumber: string;
  phone: string;
  email: string;
  contactName: string;
  address: string;
  city: string;
  bankName: string;
  iban: string;
  paymentTermsDays: string;
  notes: string;
}

type DraftField = keyof SupplierDraft;

function draftOf(supplier: SupplierView | null): SupplierDraft {
  return {
    name: supplier?.name ?? "",
    vatNumber: supplier?.vatNumber ?? "",
    crNumber: supplier?.crNumber ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    contactName: supplier?.contactName ?? "",
    address: supplier?.address ?? "",
    city: supplier?.city ?? "",
    bankName: supplier?.bankName ?? "",
    iban: supplier?.iban ?? "",
    paymentTermsDays:
      supplier?.paymentTermsDays === null || supplier?.paymentTermsDays === undefined
        ? ""
        : String(supplier.paymentTermsDays),
    notes: supplier?.notes ?? "",
  };
}

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/** Arabic-Indic digits as ASCII ones: the server reads only the latter. */
function asciiDigits(value: string): string {
  return value.replace(ARABIC_INDIC, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The server's own pattern (suppliers.service.ts), after spaces are taken out. */
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

const compactVat = (value: string) => asciiDigits(value).replace(/\s+/g, "");
const compactIban = (value: string) => asciiDigits(value).replace(/\s+/g, "").toUpperCase();

/** Whole days from 0 to 365; null when left empty. */
function readTerms(value: string): number | null | "invalid" {
  const text = asciiDigits(value).trim();
  if (!text) return null;
  if (!/^\d{1,3}$/.test(text)) return "invalid";
  const days = Number(text);
  return days <= 365 ? days : "invalid";
}

function checkDraft(draft: SupplierDraft): Partial<Record<DraftField, Text>> {
  const problems: Partial<Record<DraftField, Text>> = {};
  if (!draft.name.trim()) problems.name = ["purchases.supplierForm.nameRequired", "Enter the supplier's name."];
  const vat = compactVat(draft.vatNumber);
  if (vat && !isSaudiVatNumber(vat)) problems.vatNumber = ERROR_TEXT.LEDGER_VAT_NUMBER_INVALID;
  if (draft.email.trim() && !EMAIL.test(draft.email.trim())) {
    problems.email = ["purchases.supplierForm.emailInvalid", "The email address does not look right."];
  }
  const iban = compactIban(draft.iban);
  if (iban && !IBAN.test(iban)) problems.iban = ERROR_TEXT.LEDGER_IBAN_INVALID;
  if (readTerms(draft.paymentTermsDays) === "invalid") {
    problems.paymentTermsDays = ["purchases.supplierForm.termsInvalid", "Payment terms are whole days, from 0 to 365."];
  }
  return problems;
}

/** The refusals that belong to one field; the rest are shown above the buttons. */
const FIELD_OF_CODE: Record<string, DraftField> = {
  LEDGER_VAT_NUMBER_INVALID: "vatNumber",
  PURCHASE_SUPPLIER_VAT_TAKEN: "vatNumber",
  LEDGER_IBAN_INVALID: "iban",
};

export function SupplierFormDialog({
  target,
  onClose,
  onSaved,
}: {
  /** null: closed; `{ supplier: null }`: a new supplier. */
  target: { supplier: SupplierView | null } | null;
  onClose: () => void;
  onSaved: (supplier: SupplierView) => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {target && (
          <SupplierForm
            key={target.supplier?.id ?? "new"}
            supplier={target.supplier}
            onCancel={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function SupplierForm({
  supplier,
  onCancel,
  onSaved,
}: {
  supplier: SupplierView | null;
  onCancel: () => void;
  onSaved: (supplier: SupplierView) => void;
}) {
  const { tx, text } = useLedgerText();
  const describeError = useLedgerError();
  const [draft, setDraft] = useState<SupplierDraft>(() => draftOf(supplier));
  const [attempted, setAttempted] = useState(false);
  const [refusal, setRefusal] = useState<{ field: DraftField | null; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = checkDraft(draft);

  const change = (field: DraftField) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setDraft((current) => ({ ...current, [field]: value }));
    if (refusal?.field === field) setRefusal(null);
  };

  const errorOf = (field: DraftField): string | undefined => {
    if (refusal?.field === field) return refusal.message;
    const problem = attempted ? problems[field] : undefined;
    return problem ? text(problem) : undefined;
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setRefusal(null);
    const terms = readTerms(draft.paymentTermsDays);
    const body = {
      name: draft.name.trim(),
      vatNumber: compactVat(draft.vatNumber) || null,
      crNumber: asciiDigits(draft.crNumber).trim() || null,
      phone: asciiDigits(draft.phone).trim() || null,
      email: draft.email.trim() || null,
      contactName: draft.contactName.trim() || null,
      address: draft.address.trim() || null,
      city: draft.city.trim() || null,
      bankName: draft.bankName.trim() || null,
      iban: compactIban(draft.iban) || null,
      // Sent as null when empty: the route reads an empty string as zero days.
      paymentTermsDays: terms === "invalid" ? null : terms,
      notes: draft.notes.trim() || null,
    };
    const response = supplier
      ? await purchasesRequest<SupplierView>(`/suppliers/${encodeURIComponent(supplier.id)}`, { method: "PATCH", body })
      : await purchasesRequest<SupplierView>("/suppliers", { method: "POST", body });
    setBusy(false);
    if (!response.ok || !response.data) {
      setRefusal({
        field: (response.code && FIELD_OF_CODE[response.code]) || null,
        message: describeError(response),
      });
      return;
    }
    toast.success(
      supplier
        ? tx("purchases.supplierForm.saved", "Supplier saved")
        : tx("purchases.supplierForm.added", "Supplier added"),
    );
    onSaved(response.data);
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {supplier
            ? tx("purchases.supplierForm.editTitle", "Edit supplier")
            : tx("purchases.supplierForm.addTitle", "Add a supplier")}
        </DialogTitle>
        <DialogDescription>
          {tx(
            "purchases.supplierForm.hint",
            "Only the name is required. The payment terms set when the supplier's bills fall due.",
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="supplier-name" label={tx("purchases.supplierForm.name", "Name")} className="sm:col-span-2">
          <Input
            id="supplier-name"
            value={draft.name}
            onChange={change("name")}
            maxLength={200}
            error={errorOf("name")}
            disabled={busy}
          />
        </Field>
        <Field
          id="supplier-vat"
          label={tx("purchases.supplierForm.vatNumber", "VAT number")}
          hint={tx("purchases.supplierForm.vatHint", "15 digits that begin and end with 3.")}
        >
          <Input
            id="supplier-vat"
            dir="ltr"
            inputMode="numeric"
            value={draft.vatNumber}
            onChange={change("vatNumber")}
            maxLength={32}
            aria-describedby="supplier-vat-hint"
            error={errorOf("vatNumber")}
            disabled={busy}
          />
        </Field>
        <Field id="supplier-cr" label={tx("purchases.supplierForm.crNumber", "Commercial registration number")}>
          <Input
            id="supplier-cr"
            dir="ltr"
            value={draft.crNumber}
            onChange={change("crNumber")}
            maxLength={50}
            disabled={busy}
          />
        </Field>
        <Field id="supplier-contact" label={tx("purchases.supplierForm.contactName", "Contact person")}>
          <Input
            id="supplier-contact"
            value={draft.contactName}
            onChange={change("contactName")}
            maxLength={200}
            disabled={busy}
          />
        </Field>
        <Field id="supplier-phone" label={tx("purchases.supplierForm.phone", "Phone")}>
          <Input
            id="supplier-phone"
            type="tel"
            dir="ltr"
            value={draft.phone}
            onChange={change("phone")}
            maxLength={40}
            disabled={busy}
          />
        </Field>
        <Field id="supplier-email" label={tx("purchases.supplierForm.email", "Email")}>
          <Input
            id="supplier-email"
            type="email"
            dir="ltr"
            value={draft.email}
            onChange={change("email")}
            maxLength={200}
            error={errorOf("email")}
            disabled={busy}
          />
        </Field>
        <Field id="supplier-city" label={tx("purchases.supplierForm.city", "City")}>
          <Input id="supplier-city" value={draft.city} onChange={change("city")} maxLength={100} disabled={busy} />
        </Field>
        <Field id="supplier-address" label={tx("purchases.supplierForm.address", "Address")} className="sm:col-span-2">
          <Input
            id="supplier-address"
            value={draft.address}
            onChange={change("address")}
            maxLength={500}
            disabled={busy}
          />
        </Field>
        <Field id="supplier-bank" label={tx("ledger.banks.bankName", "Bank")}>
          <Input
            id="supplier-bank"
            value={draft.bankName}
            onChange={change("bankName")}
            maxLength={100}
            disabled={busy}
          />
        </Field>
        <Field id="supplier-iban" label={tx("ledger.banks.iban", "IBAN")}>
          <Input
            id="supplier-iban"
            dir="ltr"
            value={draft.iban}
            onChange={change("iban")}
            maxLength={40}
            placeholder="SA00 0000 0000 0000 0000 0000"
            error={errorOf("iban")}
            disabled={busy}
          />
        </Field>
        <Field
          id="supplier-terms"
          label={tx("purchases.supplierForm.paymentTerms", "Payment terms (days)")}
          hint={tx(
            "purchases.supplierForm.termsHint",
            "Days from the bill's date to its due date, 0 to 365. Leave it empty and bills fall due on their own date.",
          )}
          className="sm:col-span-2"
        >
          <Input
            id="supplier-terms"
            dir="ltr"
            inputMode="numeric"
            value={draft.paymentTermsDays}
            onChange={change("paymentTermsDays")}
            maxLength={3}
            aria-describedby="supplier-terms-hint"
            error={errorOf("paymentTermsDays")}
            className="sm:w-40"
            disabled={busy}
          />
        </Field>
        <Field id="supplier-notes" label={tx("purchases.supplierForm.notes", "Notes")} className="sm:col-span-2">
          <Textarea
            id="supplier-notes"
            rows={3}
            value={draft.notes}
            onChange={change("notes")}
            maxLength={2000}
            disabled={busy}
          />
        </Field>
      </div>

      {refusal && !refusal.field && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {refusal.message}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {tx("ledger.common.cancel", "Cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? tx("ledger.common.working", "Working…") : tx("ledger.common.save", "Save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
