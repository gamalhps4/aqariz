"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Edit,
  Trash2,
  Calendar,
  Building2,
  DollarSign,
  FileText,
  Tag,
  CreditCard,
  Hash,
  User,
  CheckCircle,
} from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface ExpenseDetail {
  _id: string;
  expenseNumber: string;
  propertyId?: {
    _id: string;
    name: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zipCode?: string;
    };
  };
  category: string;
  description: string;
  amount: number;
  date: string;
  status: string;
  paymentMethod?: string;
  referenceNumber?: string;
  notes?: string;
  taxDeductible: boolean;
  // Accounting phase 0: the VAT inside the amount and who supplied it.
  vatAmount?: number;
  vatCategory?: string | null;
  supplier?: { id: string; name: string; vatNumber?: string | null } | null;
  supplierInvoiceNumber?: string | null;
  createdBy?: { firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
}

export default function ExpenseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const expenseId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [expense, setExpense] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchExpense = async () => {
      try {
        const res = await fetch(`/api/accounting/expenses/${expenseId}`);
        const data = await res.json();
        if (data?.success) {
          setExpense(data?.data ?? null);
        } else {
          toast.error(data?.error || t("expenses.toasts.notFound", { defaultValue: "Expense not found" }));
          router.push("/dashboard/accounting/expenses");
        }
      } catch (error) {
        console.error("Failed to fetch expense:", error);
        toast.error(t("expenses.toasts.loadFailed", { defaultValue: "Could not load the expense" }));
        router.push("/dashboard/accounting/expenses");
      } finally {
        setLoading(false);
      }
    };

    if (expenseId) {
      fetchExpense();
    }
  }, [expenseId, router, t]);

  const handleDelete = async () => {
    if (
      !confirm(
        t("expenses.actions.confirmDelete", {
          defaultValue: "Are you sure you want to delete this expense?",
        }),
      )
    )
      return;

    try {
      const res = await fetch(`/api/accounting/expenses/${expenseId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success(
          t("expenses.toasts.deleteSuccess", {
            defaultValue: "Expense deleted successfully",
          }),
        );
        router.push("/dashboard/accounting/expenses");
      } else {
        toast.error(t("expenses.toasts.deleteFailed", { defaultValue: "Could not delete the expense" }));
      }
    } catch (error) {
      toast.error(t("expenses.toasts.deleteFailed", { defaultValue: "Could not delete the expense" }));
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      paid: "bg-success/10 text-success border-success/20",
      approved: "bg-info/10 text-info border-info/20",
      pending: "bg-warning/10 text-warning border-warning/20",
      cancelled: "bg-muted text-muted-foreground border-muted",
    };
    return colors[status] || "bg-muted text-muted-foreground border-muted";
  };

  const formatPropertyAddress = (property?: ExpenseDetail["propertyId"]) => {
    if (!property?.address) return "";
    const { street, city, state, zipCode } = property.address;
    return [street, city, state, zipCode].filter(Boolean).join(", ");
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-20" />
          </div>
        </div>
        <Card>
          <CardContent className="p-6 space-y-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!expense) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {expense.expenseNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("expenses.detail.subtitle", {
              defaultValue: "Expense details and information",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/accounting/expenses">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
              {t("common.back", { defaultValue: "Back" })}
            </Button>
          </Link>
          <Link href={`/dashboard/accounting/expenses/${expense._id}/edit`}>
            <Button variant="outline" size="sm">
              <Edit className="h-4 w-4 me-2" />
              {t("common.edit", { defaultValue: "Edit" })}
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 me-2" />
            {t("common.delete", { defaultValue: "Delete" })}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Details */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                {t("expenses.detail.information", {
                  defaultValue: "Expense Information",
                })}
              </CardTitle>
              <Badge
                variant="outline"
                className={`capitalize ${getStatusColor(expense.status)}`}
              >
                {t(`exports.value.${expense.status || "unknown"}`, {
                  defaultValue: (expense.status || "unknown").replace(/_/g, " "),
                })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <DetailRow
                icon={Tag}
                label={t("expenses.detail.category", {
                  defaultValue: "Category",
                })}
                value={
                  <span className="capitalize">
                    {t(`expenses.categories.${expense.category || "other"}`, {
                      defaultValue: (expense.category || "unknown").replace(/_/g, " "),
                    })}
                  </span>
                }
              />
              <DetailRow
                icon={DollarSign}
                label={t("expenses.detail.amount", {
                  defaultValue: "Amount",
                })}
                value={
                  <span className="font-semibold text-error">
                    -{formatCurrency(expense.amount)}
                  </span>
                }
              />
              <DetailRow
                icon={Calendar}
                label={t("expenses.detail.date", { defaultValue: "Date" })}
                value={formatDate(expense.date)}
              />
              <DetailRow
                icon={Building2}
                label={t("expenses.detail.property", {
                  defaultValue: "Property",
                })}
                value={
                  expense.propertyId ? (
                    <div>
                      <div>{expense.propertyId?.name || "—"}</div>
                      {formatPropertyAddress(expense.propertyId) && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatPropertyAddress(expense.propertyId)}
                        </div>
                      )}
                    </div>
                  ) : (
                    "—"
                  )
                }
              />
              <DetailRow
                icon={CreditCard}
                label={t("expenses.detail.paymentMethod", {
                  defaultValue: "Payment Method",
                })}
                value={
                  expense.paymentMethod ? (
                    <span className="capitalize">
                      {t(`exports.value.${expense.paymentMethod}`, {
                        defaultValue: expense.paymentMethod.replace(/_/g, " "),
                      })}
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <DetailRow
                icon={Hash}
                label={t("expenses.detail.reference", {
                  defaultValue: "Reference",
                })}
                value={expense.referenceNumber || "—"}
              />
              <DetailRow
                icon={Hash}
                label={t("expenses.vat.category", { defaultValue: "VAT category" })}
                value={
                  expense.vatCategory
                    ? `${t(`invoices.vat.category.${expense.vatCategory}`, {
                        defaultValue: expense.vatCategory,
                      })}${
                        expense.vatAmount
                          ? ` · ${formatCurrency(expense.vatAmount)}`
                          : ""
                      }`
                    : "—"
                }
              />
              <DetailRow
                icon={User}
                label={t("expenses.supplier.label", { defaultValue: "Supplier" })}
                value={
                  expense.supplier
                    ? `${expense.supplier.name}${
                        expense.supplier.vatNumber ? ` · ${expense.supplier.vatNumber}` : ""
                      }${
                        expense.supplierInvoiceNumber
                          ? ` · ${expense.supplierInvoiceNumber}`
                          : ""
                      }`
                    : expense.supplierInvoiceNumber || "—"
                }
              />
              <DetailRow
                icon={CheckCircle}
                label={t("expenses.detail.taxDeductible", {
                  defaultValue: "Tax Deductible",
                })}
                value={
                  expense.taxDeductible
                    ? t("exports.value.yes", { defaultValue: "Yes" })
                    : t("exports.value.no", { defaultValue: "No" })
                }
              />
              <DetailRow
                icon={User}
                label={t("expenses.detail.createdBy", {
                  defaultValue: "Created By",
                })}
                value={
                  expense.createdBy
                    ? `${expense.createdBy?.firstName || ""} ${expense.createdBy?.lastName || ""}`.trim() || "—"
                    : "—"
                }
              />
            </div>

            {/* Description */}
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <FileText className="h-4 w-4" />
                {t("expenses.detail.description", {
                  defaultValue: "Description",
                })}
              </div>
              <p className="text-sm">{expense.description || "—"}</p>
            </div>

            {/* Notes */}
            {expense.notes && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    {t("expenses.detail.notes", { defaultValue: "Notes" })}
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {expense.notes}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("expenses.detail.timeline", { defaultValue: "Timeline" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("expenses.detail.created", { defaultValue: "Created" })}
                </span>
                <span>{formatDate(expense.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("expenses.detail.updated", {
                    defaultValue: "Last Updated",
                  })}
                </span>
                <span>{formatDate(expense.updatedAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("expenses.detail.expenseDate", {
                    defaultValue: "Expense Date",
                  })}
                </span>
                <span>{formatDate(expense.date)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}
