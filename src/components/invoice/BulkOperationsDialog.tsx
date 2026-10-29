"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  MANUAL_PAYMENT_METHODS,
  isManualPaymentMethod,
} from "@/lib/payments/methods";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  CreditCard,
  Mail,
  Download,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

const bulkOperationSchema = z
  .object({
    operation: z.enum([
      "mark_paid",
      "send_reminders",
      "update_status",
      "generate_pdfs",
      "delete",
    ]),
    paymentMethod: z.string().optional(),
    status: z.string().optional(),
    reminderType: z.string().optional(),
    notes: z.string().optional(),
  })
  // Marking installments paid records money, and how it arrived decides
  // whether the office or the owner received it — so it is asked for, not
  // assumed. The server refuses anything else in the same way.
  .refine(
    (data) =>
      data.operation !== "mark_paid" ||
      isManualPaymentMethod(data.paymentMethod ?? ""),
    { path: ["paymentMethod"], message: "method" },
  );

type BulkOperationForm = z.infer<typeof bulkOperationSchema>;

interface BulkOperationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedInvoices: string[];
  onOperationComplete: () => void;
}

interface OperationResult {
  successful: Array<{
    invoiceId: string;
    invoiceNumber?: string;
    [key: string]: any;
  }>;
  failed: Array<{
    invoiceId: string;
    error: string;
  }>;
  totalProcessed: number;
}

export default function BulkOperationsDialog({
  open,
  onOpenChange,
  selectedInvoices,
  onOperationComplete,
}: BulkOperationsDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OperationResult | null>(null);
  const { t } = useLocalizationContext();

  const form = useForm<BulkOperationForm>({
    resolver: zodResolver(bulkOperationSchema),
    defaultValues: {
      operation: "mark_paid",
      // Chosen every time: a preselected Cash was recorded whenever nobody
      // changed it, putting owner-received money on the office's side.
      paymentMethod: "",
      status: "issued",
      reminderType: "reminder",
      notes: "",
    },
  });

  const selectedOperation = form.watch("operation");

  const onSubmit = async (data: BulkOperationForm) => {
    try {
      setSubmitting(true);
      setResult(null);

      const requestData: any = {
        operation: data.operation,
        invoiceIds: selectedInvoices,
        data: {},
      };

      // Add operation-specific data
      switch (data.operation) {
        case "mark_paid":
          requestData.data.paymentMethod = data.paymentMethod;
          break;
        case "update_status":
          requestData.data.status = data.status;
          break;
        case "send_reminders":
          requestData.data.type = data.reminderType;
          requestData.data.method = "email";
          break;
      }

      const response = await fetch("/api/invoices/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });

      const responseData = await response.json();
      if (responseData.success) {
        setResult(responseData.data);
        toast.success(t("leases.bulk.done", { defaultValue: "Bulk action finished" }));
        onOperationComplete();
      } else {
        toast.error(responseData.error || t("leases.bulk.failed", { defaultValue: "Could not complete the bulk action" }));
      }
    } catch (error) {
      console.error("Error performing bulk operation:", error);
      toast.error(t("leases.bulk.failed", { defaultValue: "Could not complete the bulk action" }));
    } finally {
      setSubmitting(false);
    }
  };

  const getOperationIcon = (operation: string) => {
    switch (operation) {
      case "mark_paid":
        return <CreditCard className="h-4 w-4" />;
      case "send_reminders":
        return <Mail className="h-4 w-4" />;
      case "generate_pdfs":
        return <Download className="h-4 w-4" />;
      case "delete":
        return <Trash2 className="h-4 w-4" />;
      default:
        return <CheckCircle className="h-4 w-4" />;
    }
  };

  const getOperationDescription = (operation: string) => {
    switch (operation) {
      case "mark_paid":
        return t("leases.bulk.desc.markPaid", { defaultValue: "Records a payment for what is left on each selected invoice" });
      case "send_reminders":
        return t("leases.bulk.desc.sendReminders", { defaultValue: "Sends the tenants of the selected invoices a payment reminder" });
      case "update_status":
        return t("leases.bulk.desc.updateStatus", { defaultValue: "Paid and partly paid come from recorded payments, and overdue from the due date — only scheduled, issued and cancelled are set here" });
      case "generate_pdfs":
        return t("leases.bulk.desc.generatePdfs", { defaultValue: "Creates a PDF of each selected invoice" });
      case "delete":
        return t("leases.bulk.desc.delete", { defaultValue: "Moves the selected invoices to the archive" });
      default:
        return "";
    }
  };

  const handleClose = () => {
    setResult(null);
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("leases.bulk.title", { defaultValue: "Bulk actions" })}
          </DialogTitle>
          <DialogDescription>
            {t("leases.bulk.subtitle", { defaultValue: "{count} invoices selected", values: { count: selectedInvoices.length } })}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="operation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("leases.bulk.operation", { defaultValue: "Action" })}
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
                        <SelectItem value="mark_paid">
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4" />
                            {t("leases.bulk.op.markPaid", { defaultValue: "Record as paid" })}
                          </div>
                        </SelectItem>
                        <SelectItem value="send_reminders">
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4" />
                            {t("leases.bulk.op.sendReminders", { defaultValue: "Send reminders" })}
                          </div>
                        </SelectItem>
                        <SelectItem value="update_status">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4" />
                            {t("leases.bulk.op.updateStatus", { defaultValue: "Change status" })}
                          </div>
                        </SelectItem>
                        <SelectItem value="generate_pdfs">
                          <div className="flex items-center gap-2">
                            <Download className="h-4 w-4" />
                            {t("leases.bulk.op.generatePdfs", { defaultValue: "Generate PDFs" })}
                          </div>
                        </SelectItem>
                        {/* DISABLED: Delete functionality temporarily disabled */}
                        {/* <SelectItem value="delete">
                          <div className="flex items-center gap-2">
                            <Trash2 className="h-4 w-4" />
                            Delete Invoices
                          </div>
                        </SelectItem> */}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="flex items-start gap-2">
                  {getOperationIcon(selectedOperation)}
                  <div>
                    <p className="text-sm font-medium text-blue-900">
                      {({
                        mark_paid: t("leases.bulk.op.markPaid", { defaultValue: "Record as paid" }),
                        send_reminders: t("leases.bulk.op.sendReminders", { defaultValue: "Send reminders" }),
                        update_status: t("leases.bulk.op.updateStatus", { defaultValue: "Change status" }),
                        generate_pdfs: t("leases.bulk.op.generatePdfs", { defaultValue: "Generate PDFs" }),
                      } as Record<string, string>)[selectedOperation] ??
                        selectedOperation}
                    </p>
                    <p className="text-xs text-blue-700">
                      {getOperationDescription(selectedOperation)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Operation-specific fields */}
              {selectedOperation === "mark_paid" && (
                <FormField
                  control={form.control}
                  name="paymentMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.bulk.paymentMethod", { defaultValue: "Payment method" })}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "payments.collect.fields.methodPlaceholder",
                                { defaultValue: "Select method" },
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {MANUAL_PAYMENT_METHODS.map((method) => (
                            <SelectItem key={method.value} value={method.value}>
                              {t(method.labelKey, { defaultValue: method.fallback })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {form.formState.errors.paymentMethod && (
                        <p className="text-sm font-medium text-destructive">
                          {t("payments.collect.validation.method", {
                            defaultValue: "Choose a payment method",
                          })}
                        </p>
                      )}
                    </FormItem>
                  )}
                />
              )}

              {selectedOperation === "update_status" && (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.bulk.newStatus", { defaultValue: "New status" })}
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
                          {/* Paid, partly paid and overdue are not offered:
                              they follow from payments and due dates. */}
                          {(["scheduled", "issued", "cancelled"] as const).map(
                            (status) => (
                              <SelectItem key={status} value={status}>
                                {t(`leases.invoices.status.${status}`, {
                                  defaultValue: status,
                                })}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {selectedOperation === "send_reminders" && (
                <FormField
                  control={form.control}
                  name="reminderType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.bulk.reminderType", { defaultValue: "Reminder" })}
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
                          <SelectItem value="reminder">
                            {t("leases.bulk.reminder.reminder", { defaultValue: "Payment reminder" })}
                          </SelectItem>
                          <SelectItem value="overdue">
                            {t("leases.bulk.reminder.overdue", { defaultValue: "Overdue notice" })}
                          </SelectItem>
                          <SelectItem value="final_notice">
                            {t("leases.bulk.reminder.final", { defaultValue: "Final notice" })}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {selectedOperation === "delete" && (
                <div className="bg-red-50 p-3 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-900">
                        {t("leases.bulk.warning", { defaultValue: "Warning" })}
                      </p>
                      <p className="text-xs text-red-700">
                        {t("leases.bulk.deleteWarning", { defaultValue: "The selected invoices move to the archive. An invoice with payments recorded against it cannot be deleted until they are." })}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={submitting}
                >
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting
                    ? t("leases.bulk.working", { defaultValue: "Working…" })
                    : t("leases.bulk.run", { defaultValue: "Run" })}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        ) : (
          // Results display
          <div className="space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-semibold">
                {t("leases.bulk.done", { defaultValue: "Bulk action finished" })}
              </h3>
              <p className="text-sm text-gray-600">
                {t("leases.bulk.processed", { defaultValue: "{count} invoices processed", values: { count: result.totalProcessed } })}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-green-50 p-3 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-900">
                    {t("leases.bulk.succeeded", { defaultValue: "Succeeded" })}
                  </span>
                </div>
                <p className="text-lg font-bold text-green-600">
                  {result.successful.length}
                </p>
              </div>

              <div className="bg-red-50 p-3 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span className="text-sm font-medium text-red-900">
                    {t("leases.bulk.failedCount", { defaultValue: "Failed" })}
                  </span>
                </div>
                <p className="text-lg font-bold text-red-600">
                  {result.failed.length}
                </p>
              </div>
            </div>

            {result.failed.length > 0 && (
              <div>
                <h4 className="font-medium text-red-900 mb-2">
                  {t("leases.bulk.failures", { defaultValue: "Not done" })}
                </h4>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {result.failed.map((failure, index) => (
                    <div key={index} className="text-xs bg-red-50 p-2 rounded">
                      <span className="font-mono">{failure.invoiceId}</span>:{" "}
                      {failure.error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleClose}>
                {t("leases.invoiceDoc.close", { defaultValue: "Close" })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
