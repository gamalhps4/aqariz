"use client";

import * as z from "zod";
import { useState, useEffect, useMemo } from "react";
import { MAX_MONEY } from "@/lib/validations";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams, useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  FileText,
  Calculator,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { showSimpleError, showSimpleSuccess } from "@/lib/toast-notifications";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

type Translate = (key: string, options?: { defaultValue?: string }) => string;

/**
 * Built in the reader's language, so the messages under each field read in
 * it. The ceilings only catch typos: one installment of an annual Saudi lease
 * is often above 100,000 SAR and its VAT above 10,000, which the old caps
 * (100,000 and 10,000, with messages in dollars) refused to save.
 */
function buildInvoiceEditSchema(t: Translate) {
  const lineItemSchema = z.object({
    description: z
      .string()
      .min(1, t("invoices.validation.descriptionRequired", { defaultValue: "Description is required" }))
      .max(200, t("invoices.validation.descriptionTooLong", { defaultValue: "The description is too long" })),
    amount: z
      .number()
      .min(0.01, t("invoices.validation.amountPositive", { defaultValue: "The amount must be more than zero" }))
      .max(MAX_MONEY, t("invoices.validation.amountTooHigh", { defaultValue: "The amount is too high" })),
    type: z.enum([
      "rent",
      "security_deposit",
      "utilities",
      "late_fee",
      "maintenance",
      "other",
    ]),
    quantity: z
      .number()
      .min(1, t("invoices.validation.quantityMin", { defaultValue: "The quantity must be at least 1" }))
      .max(1000, t("invoices.validation.quantityTooHigh", { defaultValue: "The quantity is too high" })),
    unitPrice: z
      .number()
      .min(0.01, t("invoices.validation.amountPositive", { defaultValue: "The amount must be more than zero" }))
      .max(MAX_MONEY, t("invoices.validation.amountTooHigh", { defaultValue: "The amount is too high" })),
  });

  return z
    .object({
      invoiceNumber: z
        .string()
        .min(1, t("invoices.validation.numberRequired", { defaultValue: "The invoice number is required" }))
        .max(50, t("invoices.validation.numberTooLong", { defaultValue: "The invoice number is too long" })),
      dueDate: z.string().min(1, t("invoices.validation.dueDateRequired", { defaultValue: "The due date is required" })),
      issueDate: z.string().min(1, t("invoices.validation.issueDateRequired", { defaultValue: "The issue date is required" })),
      status: z.enum([
        "scheduled",
        "issued",
        "paid",
        "partial",
        "overdue",
        "cancelled",
      ]),
      lineItems: z
        .array(lineItemSchema)
        .min(1, t("invoices.validation.itemsRequired", { defaultValue: "Add at least one item" }))
        .max(50, t("invoices.validation.tooManyItems", { defaultValue: "Too many items" })),
      notes: z.string().max(1000, t("invoices.validation.notesTooLong", { defaultValue: "The notes are too long" })).optional(),
      taxAmount: z
        .number()
        .min(0, t("invoices.validation.taxNegative", { defaultValue: "Tax cannot be negative" }))
        .max(MAX_MONEY, t("invoices.validation.amountTooHigh", { defaultValue: "The amount is too high" })),
    })
    .refine(
      (data) => {
        const issueDate = new Date(data.issueDate);
        const dueDate = new Date(data.dueDate);
        return dueDate >= issueDate;
      },
      {
        message: t("invoices.validation.dueBeforeIssue", { defaultValue: "The due date cannot be before the issue date" }),
        path: ["dueDate"],
      }
    );
}

type InvoiceEditFormData = z.infer<ReturnType<typeof buildInvoiceEditSchema>>;

// ============================================================================
// INTERFACES
// ============================================================================

interface InvoiceLineItem {
  description: string;
  amount: number;
  type: string;
  quantity: number;
  unitPrice: number;
  dueDate?: string;
}

interface Invoice {
  _id: string;
  invoiceNumber: string;
  tenantId: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  propertyId: {
    _id: string;
    name: string;
    address: any;
  };
  leaseId: {
    _id: string;
    startDate: string;
    endDate: string;
  };
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal: number;
  taxAmount?: number;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  lineItems: InvoiceLineItem[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function InvoiceEditPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;
  const { t, formatCurrency } = useLocalizationContext();
  const invoiceEditSchema = useMemo(() => buildInvoiceEditSchema(t), [t]);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  const form = useForm<InvoiceEditFormData>({
    resolver: zodResolver(invoiceEditSchema),
    defaultValues: {
      lineItems: [
        {
          description: "",
          amount: 0,
          type: "rent",
          quantity: 1,
          unitPrice: 0,
        },
      ],
      taxAmount: 0,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lineItems",
  });

  // ============================================================================
  // EFFECTS
  // ============================================================================

  useEffect(() => {
    fetchInvoice();
  }, [invoiceId]);

  useEffect(() => {
    const subscription = form.watch(() => {
      setHasChanges(true);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // ============================================================================
  // API FUNCTIONS
  // ============================================================================

  const fetchInvoice = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/invoices/${invoiceId}`);
      const data = await response.json();

      if (data.success && data.data) {
        const invoiceData = data.data;
        setInvoice(invoiceData);

        const lineItems = Array.isArray(invoiceData.lineItems)
          ? invoiceData.lineItems
          : [];

        // Populate form with invoice data
        form.reset({
          invoiceNumber: invoiceData.invoiceNumber,
          dueDate: format(new Date(invoiceData.dueDate), "yyyy-MM-dd"),
          issueDate: format(new Date(invoiceData.issueDate), "yyyy-MM-dd"),
          status: invoiceData.status,
          lineItems: lineItems.map((item: InvoiceLineItem) => ({
            description: item.description,
            amount: item.amount,
            type: item.type,
            quantity: item.quantity || 1,
            unitPrice: item.unitPrice || item.amount,
          })),
          notes: invoiceData.notes || "",
          taxAmount: invoiceData.taxAmount || 0,
        });
        setHasChanges(false);
      } else {
        showSimpleError("Load Error", t("leases.invoices.details.toasts.fetchError"));
        router.push("/dashboard/leases/invoices");
      }
    } catch (error) {
      showSimpleError("Load Error", t("leases.invoices.details.toasts.fetchError"));
      router.push("/dashboard/leases/invoices");
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // FORM HANDLERS
  // ============================================================================

  const onSubmit = async (data: InvoiceEditFormData) => {
    try {
      setSaving(true);

      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...data,
          dueDate: new Date(data.dueDate).toISOString(),
          issueDate: new Date(data.issueDate).toISOString(),
        }),
      });

      const result = await response.json();

      if (result.success) {
        showSimpleSuccess(
          "Invoice Updated",
          t("leases.invoices.edit.toasts.updateSuccess", {
            values: { invoiceNumber: result.data?.invoiceNumber ?? "" },
          })
        );
        setHasChanges(false);
        router.push(`/dashboard/leases/invoices/${invoiceId}`);
      } else {
        showSimpleError(
          "Update Failed",
          result.error || t("leases.invoices.edit.toasts.updateError")
        );
      }
    } catch (error) {
      showSimpleError("Update Failed", t("leases.invoices.edit.toasts.updateError"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      setShowUnsavedDialog(true);
    } else {
      router.push(`/dashboard/leases/invoices/${invoiceId}`);
    }
  };

  const confirmCancel = () => {
    setShowUnsavedDialog(false);
    router.push(`/dashboard/leases/invoices/${invoiceId}`);
  };

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  const calculateTotals = () => {
    const lineItems = form.watch("lineItems");
    const taxAmount = form.watch("taxAmount") || 0;

    const subtotal = lineItems.reduce(
      (sum, item) => sum + (item.amount || 0),
      0
    );
    const totalAmount = subtotal + taxAmount;

    return { subtotal, totalAmount };
  };

  const addLineItem = () => {
    append({
      description: "",
      amount: 0,
      type: "rent",
      quantity: 1,
      unitPrice: 0,
    });
  };

  const removeLineItem = (index: number) => {
    if (fields.length > 1) {
      remove(index);
    } else {
      showSimpleError("Validation Error", t("leases.invoices.edit.toasts.atLeastOneLineItemRequired"));
    }
  };

  // ============================================================================
  // LOADING STATE
  // ============================================================================

  if (loading) {
    return (
      <div className="container mx-auto py-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
          <div className="h-96 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t("leases.invoices.details.notFound.title")}
              </h3>
              <p className="text-gray-600 mb-4">
                {t("leases.invoices.details.notFound.description")}
              </p>
              <Button onClick={() => router.push("/dashboard/leases/invoices")}>
                {t("leases.invoices.details.notFound.backButton")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { subtotal, totalAmount } = calculateTotals();

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {t("leases.invoices.edit.header.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("leases.invoices.edit.header.subtitle")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {invoice.tenantId && (
            <Badge variant="outline">
              {invoice.tenantId.firstName} {invoice.tenantId.lastName}
            </Badge>
          )}
          {invoice.propertyId && (
            <Badge variant="outline">{invoice.propertyId.name}</Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            {t("leases.invoices.details.header.backToInvoices")}
          </Button>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Invoice Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {t("leases.invoices.edit.summary.title")}
              </CardTitle>
              <CardDescription>
                {t("leases.invoices.edit.summary.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Invoice Number */}
                <FormField
                  control={form.control}
                  name="invoiceNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.invoices.edit.form.invoiceNumber.label")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t(
                            "leases.invoices.edit.form.invoiceNumber.placeholder"
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Status */}
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.invoices.edit.form.status.label")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "leases.invoices.edit.form.status.placeholder"
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="scheduled">
                            {t("leases.invoices.status.scheduled")}
                          </SelectItem>
                          <SelectItem value="issued">
                            {t("leases.invoices.status.issued")}
                          </SelectItem>
                          <SelectItem value="partial">
                            {t("leases.invoices.status.partial")}
                          </SelectItem>
                          <SelectItem value="overdue">
                            {t("leases.invoices.status.overdue")}
                          </SelectItem>
                          <SelectItem value="cancelled">
                            {t("leases.invoices.status.cancelled")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Issue Date */}
                <FormField
                  control={form.control}
                  name="issueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.invoices.edit.form.issueDate.label")}
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Due Date */}
                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.invoices.edit.form.dueDate.label")}
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Notes */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("leases.invoices.edit.form.notes.label")}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t(
                          "leases.invoices.edit.form.notes.placeholder"
                        )}
                        rows={3}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("leases.invoices.edit.form.notes.description")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="h-5 w-5" />
                    {t("leases.invoices.edit.lineItems.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("leases.invoices.edit.lineItems.description")}
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLineItem}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  {t("leases.invoices.edit.lineItems.addItem")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">
                      {t("leases.invoices.edit.lineItems.itemTitle", {
                        values: { index: index + 1 },
                      })}
                    </h4>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLineItem(index)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Description */}
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.description`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t(
                              "leases.invoices.edit.lineItems.description.label"
                            )}
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder={t(
                                "leases.invoices.edit.lineItems.description.placeholder"
                              )}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Type */}
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.type`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("leases.invoices.edit.lineItems.type.label")}
                          </FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="rent">
                                {t(
                                  "leases.invoices.details.lineItems.type.rent"
                                )}
                              </SelectItem>
                              <SelectItem value="security_deposit">
                                {t(
                                  "leases.invoices.details.lineItems.type.securityDeposit"
                                )}
                              </SelectItem>
                              <SelectItem value="utilities">
                                {t(
                                  "leases.invoices.details.lineItems.type.utilities"
                                )}
                              </SelectItem>
                              {/* Late fees are no longer charged: offered only
                                  on a line that already is one, so an older
                                  invoice still shows and saves it. */}
                              {field.value === "late_fee" && (
                                <SelectItem value="late_fee">
                                  {t(
                                    "leases.invoices.details.lineItems.type.lateFee"
                                  )}
                                </SelectItem>
                              )}
                              <SelectItem value="maintenance">
                                {t(
                                  "leases.invoices.details.lineItems.type.maintenance"
                                )}
                              </SelectItem>
                              <SelectItem value="other">
                                {t(
                                  "leases.invoices.details.lineItems.type.other"
                                )}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Quantity */}
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.quantity`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("leases.invoices.edit.lineItems.quantity.label")}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="1"
                              {...field}
                              onChange={(e) =>
                                field.onChange(Number(e.target.value))
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Unit Price */}
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.unitPrice`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t(
                              "leases.invoices.edit.lineItems.unitPrice.label"
                            )}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              {...field}
                              onChange={(e) => {
                                const unitPrice = Number(e.target.value);
                                const quantity =
                                  form.getValues(
                                    `lineItems.${index}.quantity`
                                  ) || 1;
                                field.onChange(unitPrice);
                                form.setValue(
                                  `lineItems.${index}.amount`,
                                  unitPrice * quantity
                                );
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Amount (calculated) */}
                  <div className="flex justify-end">
                    <div className="text-end">
                      <Label className="text-sm text-muted-foreground">
                        {t("leases.invoices.edit.lineItems.totalAmount.label")}
                      </Label>
                      <div className="text-lg font-semibold">
                        {formatCurrency(
                          (form.watch(`lineItems.${index}.quantity`) || 1) *
                          (form.watch(`lineItems.${index}.unitPrice`) || 0)
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Totals and Tax */}
          <Card>
            <CardHeader>
              <CardTitle>{t("leases.invoices.edit.totals.title")}</CardTitle>
              <CardDescription>
                {t("leases.invoices.edit.totals.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Tax Amount */}
                <FormField
                  control={form.control}
                  name="taxAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.invoices.edit.totals.taxAmount.label")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          {...field}
                          onChange={(e) =>
                            field.onChange(Number(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t("leases.invoices.edit.totals.taxAmount.description")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Totals Display */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">
                      {t("leases.invoices.edit.totals.subtotal.label")}
                    </span>
                    <span className="font-medium">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">
                      {t("leases.invoices.edit.totals.tax.label")}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(form.watch("taxAmount") || 0)}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold">
                      {t("leases.invoices.edit.totals.totalAmount.label")}
                    </span>
                    <span className="text-lg font-bold text-green-600">
                      {formatCurrency(totalAmount)}
                    </span>
                  </div>
                  {invoice.amountPaid > 0 && (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          {t("leases.invoices.edit.totals.amountPaid.label")}
                        </span>
                        <span className="font-medium text-green-600">
                          {formatCurrency(invoice.amountPaid)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          {t(
                            "leases.invoices.edit.totals.balanceRemaining.label"
                          )}
                        </span>
                        <span className="font-medium text-red-600">
                          {formatCurrency(totalAmount - invoice.amountPaid)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Form Actions */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {hasChanges && (
                    <div className="flex items-center gap-2 text-amber-600">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm">
                        {t("leases.invoices.edit.unsavedChanges.banner")}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={saving}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving || !hasChanges}
                    className="flex items-center gap-2"
                  >
                    {saving ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        {t("leases.invoices.edit.actions.saving")}
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        {t("leases.invoices.edit.actions.saveChanges")}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </form>
      </Form>

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("leases.invoices.edit.unsavedChanges.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("leases.invoices.edit.unsavedChanges.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("leases.invoices.edit.unsavedChanges.stayButton")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancel}
              className="bg-red-600 hover:bg-red-700"
            >
              {t("leases.invoices.edit.unsavedChanges.leaveButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
