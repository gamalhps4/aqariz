"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ExpenseCategory, ExpenseStatus, PaymentMethod } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  EMPTY_EXPENSE_VAT,
  expenseVatBody,
  VatSupplierFields,
  type ExpenseVatValue,
} from "../_parts/vat-supplier-fields";
import { businessToday } from "@/lib/dates/business-day";

interface Property {
  id: string;
  name: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
}

export default function NewExpensePage() {
  const router = useRouter();
  const { t } = useLocalizationContext();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);

  // Form state
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(businessToday);
  const [propertyId, setPropertyId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [status, setStatus] = useState(ExpenseStatus.PAID);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [taxDeductible, setTaxDeductible] = useState(false);
  const [vat, setVat] = useState<ExpenseVatValue>(EMPTY_EXPENSE_VAT);

  useEffect(() => {
    const fetchProperties = async () => {
      try {
        const res = await fetch("/api/properties");
        if (res.ok) {
          const data = await res.json();
          setProperties(
            (Array.isArray(data?.data) ? data.data : []).map((p: any) => ({
              id: p?._id || "",
              name: p?.name || "Unknown Property",
              address: p?.address,
            })),
          );
        }
      } catch (error) {
        console.error("Failed to fetch properties:", error);
      } finally {
        setIsLoadingData(false);
      }
    };
    fetchProperties();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!category || !description || !amount || !date) {
      toast.error(t("expenses.toasts.required", { defaultValue: "Fill in the category, description, amount and date" }));
      return;
    }

    if (parseFloat(amount) <= 0) {
      toast.error(t("expenses.toasts.amountPositive", { defaultValue: "The amount must be more than zero" }));
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/accounting/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          description,
          amount: parseFloat(amount),
          date: new Date(date),
          propertyId: propertyId || undefined,
          paymentMethod: paymentMethod || undefined,
          status,
          referenceNumber: referenceNumber || undefined,
          notes: notes || undefined,
          taxDeductible,
          ...expenseVatBody(vat),
        }),
      });

      const result = await res.json();

      if (res.ok) {
        toast.success(
          t("expenses.toasts.createSuccess", {
            defaultValue: "Expense created successfully",
          }),
        );
        router.push("/dashboard/accounting/expenses");
      } else {
        throw new Error(result.error || t("expenses.toasts.createFailed", { defaultValue: "Could not record the expense" }));
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("expenses.toasts.createFailed", { defaultValue: "Could not record the expense" }),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCategoryLabel = (cat?: string | null) => {
    const normalizedCategory = (cat ?? "unknown").toLowerCase();
    return t(`expenses.categories.${normalizedCategory}`, {
      defaultValue: normalizedCategory.replace(/_/g, " "),
    });
  };

  const getPropertyOptionLabel = (property: Property) => {
    const address = property.address;
    if (!address) return property.name;

    const addressText = [address.street, address.city, address.state]
      .filter(Boolean)
      .join(", ");

    return addressText ? `${property.name} - ${addressText}` : property.name;
  };

  if (isLoadingData) {
    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-24" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("expenses.new.title", { defaultValue: "Add Expense" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("expenses.new.subtitle", {
              defaultValue: "Record a new property expense",
            })}
          </p>
        </div>
        <Link href="/dashboard/accounting/expenses">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("common.back", { defaultValue: "Back" })}
          </Button>
        </Link>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>
              {t("expenses.new.details", { defaultValue: "Expense Details" })}
            </CardTitle>
            <CardDescription>
              {t("expenses.new.detailsDescription", {
                defaultValue:
                  "Fill in the expense information. Fields marked with * are required.",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Row 1: Category + Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="category">
                  {t("expenses.form.category", { defaultValue: "Category" })} *
                </Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="category">
                    <SelectValue
                      placeholder={t("expenses.form.selectCategory", {
                        defaultValue: "Select category",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(ExpenseCategory).map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        <span className="capitalize">
                          {getCategoryLabel(cat)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">
                  {t("expenses.form.status", { defaultValue: "Status" })}
                </Label>
                <Select
                  value={status}
                  onValueChange={(val) => setStatus(val as ExpenseStatus)}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(ExpenseStatus).map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className="capitalize">
                          {t(`expenses.status.${s}`, {
                            defaultValue: s.replace(/_/g, " "),
                          })}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: Description */}
            <div className="space-y-2">
              <Label htmlFor="description">
                {t("expenses.form.description", {
                  defaultValue: "Description",
                })}{" "}
                *
              </Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("expenses.form.descriptionPlaceholder", {
                  defaultValue: "e.g., Plumbing repair for Unit 3B",
                })}
                maxLength={500}
              />
            </div>

            {/* Row 3: Amount + Date */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount">
                  {t("expenses.form.amount", { defaultValue: "Amount" })} *
                </Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="date">
                  {t("expenses.form.date", { defaultValue: "Date" })} *
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            {/* Row 4: Property + Payment Method */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="property">
                  {t("expenses.form.property", { defaultValue: "Property" })}
                </Label>
                <Select
                  value={propertyId || "none"}
                  onValueChange={(value) =>
                    setPropertyId(value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger id="property">
                    <SelectValue
                      placeholder={t("expenses.form.selectProperty", {
                        defaultValue: "Select property (optional)",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {t("expenses.form.noProperty", {
                        defaultValue: "No specific property",
                      })}
                    </SelectItem>
                    {properties.map((prop) => (
                      <SelectItem key={prop.id} value={prop.id}>
                        {getPropertyOptionLabel(prop)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="paymentMethod">
                  {t("expenses.form.paymentMethod", {
                    defaultValue: "Payment Method",
                  })}
                </Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="paymentMethod">
                    <SelectValue
                      placeholder={t("expenses.form.selectPaymentMethod", {
                        defaultValue: "Select method (optional)",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(PaymentMethod).map((method) => (
                      <SelectItem key={method} value={method}>
                        <span className="capitalize">
                          {t(`exports.value.${method}`, {
                            defaultValue: method.replace(/_/g, " "),
                          })}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 5: Reference Number */}
            <div className="space-y-2">
              <Label htmlFor="referenceNumber">
                {t("expenses.form.referenceNumber", {
                  defaultValue: "Reference Number",
                })}
              </Label>
              <Input
                id="referenceNumber"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder={t("expenses.form.referenceNumberPlaceholder", {
                  defaultValue: "e.g., Check #1234, Invoice #5678",
                })}
              />
            </div>

            {/* The VAT inside the amount and who supplied it */}
            <VatSupplierFields value={vat} onChange={setVat} amount={amount} />

            {/* Row 6: Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">
                {t("expenses.form.notes", { defaultValue: "Notes" })}
              </Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("expenses.form.notesPlaceholder", {
                  defaultValue: "Additional notes about this expense...",
                })}
                rows={3}
                maxLength={2000}
              />
            </div>

            {/* Row 7: Tax Deductible */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="taxDeductible" className="text-base">
                  {t("expenses.form.taxDeductible", {
                    defaultValue: "Tax Deductible",
                  })}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("expenses.form.taxDeductibleDescription", {
                    defaultValue:
                      "Mark this expense as tax deductible for reporting",
                  })}
                </p>
              </div>
              <Switch
                id="taxDeductible"
                checked={taxDeductible}
                onCheckedChange={setTaxDeductible}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-4 border-t">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                )}
                {t("expenses.form.submit", { defaultValue: "Create Expense" })}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/dashboard/accounting/expenses")}
              >
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
