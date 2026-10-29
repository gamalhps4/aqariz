"use client";

/**
 * PropertyPro - Record a payment against an installment
 *
 * The one dialog every screen uses to put money on an installment: the
 * contract's schedule, its payments tab, and the invoice screens. It posts to
 * the invoice's `add_payment` operation, which records the payment, what it
 * paid and the installment's new balance in one transaction.
 *
 * Three ways in. Given an `invoice`, it settles that one. Given the
 * contract's `installments`, it asks which one the money is for first — the
 * review wants every payment tied to "the correct contract and installment",
 * and the only reliable way to know which is to ask. With `pickContract` —
 * the payments page, where no contract is open — it asks for the contract
 * before that.
 *
 * The method starts empty. It decides who received the money (the office or
 * the owner), so it is chosen every time rather than left on Cash.
 */

import React, { useMemo, useState } from "react";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { showApiErrorToast } from "@/lib/toast-notifications";
import { usePathname } from "next/navigation";
import {
  GatewayPayOptions,
  useAvailableGateways,
} from "@/components/payments/GatewayPayOptions";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  RemoteOptionSelect,
  searchFilterOptions,
  type RemoteOption,
} from "@/components/payments/RemoteOptionSelect";
import type { InstallmentSchedule } from "@/types/installment";
import { describeCharge } from "@/lib/i18n/charge-description";

interface InvoiceToSettle {
  _id: string;
  currency?: string | null;
  invoiceNumber: string;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  tenantId?:
    | {
        firstName?: string | null;
        lastName?: string | null;
      }
    | null;
}

/** One open installment of a contract, as the picker offers it. */
export interface InstallmentChoice {
  invoiceId: string;
  /** "Installment 3 · RENT-000003" */
  label: string;
  dueDate: string;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
}

/**
 * What a contract can still take money on — its installments, then the
 * charges added to it by hand — oldest first, as the picker offers them. The
 * same list, and the same names, as the contract's own Payments tab:
 * "Installment 3" by its place in the schedule, a charge by its description.
 */
export function openInstallmentChoices(
  schedule: InstallmentSchedule,
  installmentLabel: (index: number) => string,
  /** The reader's language: a generated description is said in it. */
  language?: string,
): InstallmentChoice[] {
  const rowName = (row: InstallmentSchedule["installments"][number]) =>
    row.source === "manual" || row.source === "orphaned"
      ? language
        ? describeCharge(
            {
              description: row.description,
              periodStart: row.periodStart,
              periodEnd: row.periodEnd,
            },
            language,
          )
        : row.description
      : installmentLabel(row.index);
  return [...(schedule.installments ?? []), ...(schedule.charges ?? [])]
    .filter(
      (row) =>
        row.invoiceId && row.balanceRemaining > 0 && row.state !== "cancelled",
    )
    .sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
    )
    .map((row) => ({
      invoiceId: row.invoiceId as string,
      label: row.invoiceNumber
        ? `${rowName(row)} · ${row.invoiceNumber}`
        : rowName(row),
      dueDate: row.dueDate,
      totalAmount: row.totalAmount,
      amountPaid: row.amountPaid,
      balanceRemaining: row.balanceRemaining,
    }));
}

/** A contract the picker offers, as /api/payments/filter-options lists it. */
interface ContractChoice {
  id: string;
  tenantName: string;
  /** The tenant's mobile, so two tenants of one name can be told apart. */
  tenantPhone?: string;
  propertyName: string;
  unitNumber: string;
  contractNumber: string | null;
  status: string;
  startDate: string;
  endDate: string;
}

interface PaymentRecordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Settle this invoice. */
  invoice?: InvoiceToSettle | null;
  /** Or pick one of these first. Ignored when `invoice` is given. */
  installments?: InstallmentChoice[];
  /** Which installment the picker starts on. */
  initialInvoiceId?: string;
  /** Amount to start from, capped at what the installment still owes. */
  initialAmount?: number;
  /**
   * An unpaid payment row to turn into this receipt, rather than recording a
   * second entry beside it that would leave it reading as still owed.
   */
  convertPaymentId?: string;
  /**
   * The installment that row belongs to, when it has one. It is converted
   * only if that installment is the one chosen; picking another records a
   * new payment instead, which is what the server would insist on anyway.
   */
  convertInvoiceId?: string | null;
  /**
   * Ask for the contract first. Ignored when `invoice` or `installments` is
   * given. Mount the dialog per opening — it starts from these props.
   */
  pickContract?: boolean;
  /** The contract the picker starts on. */
  initialLeaseId?: string;
  onPaymentRecorded: () => void;
}

function toLocalDateTimeInput(date: Date): string {
  const tzOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

export default function PaymentRecordDialog({
  open,
  onOpenChange,
  invoice: givenInvoice,
  installments,
  initialInvoiceId,
  initialAmount,
  convertPaymentId,
  convertInvoiceId,
  pickContract = false,
  initialLeaseId,
  onPaymentRecorded,
}: PaymentRecordDialogProps) {
  const { t, formatCurrency, formatDate, language } = useLocalizationContext();
  const choosingContract =
    pickContract && !givenInvoice && installments === undefined;
  const [leaseId, setLeaseId] = useState(initialLeaseId ?? "");
  const [loaded, setLoaded] = useState<{
    leaseId: string;
    installments: InstallmentChoice[];
    failed: boolean;
  } | null>(null);
  // Derived, not stored: loading is exactly "a contract is chosen and its
  // installments are not in yet".
  const installmentsLoading =
    choosingContract && Boolean(leaseId) && loaded?.leaseId !== leaseId;
  const choices: InstallmentChoice[] | undefined =
    installments ??
    (choosingContract && loaded?.leaseId === leaseId && leaseId
      ? loaded.installments
      : undefined);
  const [submitting, setSubmitting] = useState(false);
  const pathname = usePathname();
  const [chosenInvoiceId, setChosenInvoiceId] = useState<string | undefined>(
    initialInvoiceId,
  );

  const picking = !givenInvoice && choices !== undefined;
  const chosen = picking
    ? choices?.find((choice) => choice.invoiceId === chosenInvoiceId)
    : undefined;
  const invoice: InvoiceToSettle | null = givenInvoice
    ? givenInvoice
    : chosen
      ? {
          _id: chosen.invoiceId,
          invoiceNumber: chosen.label,
          totalAmount: chosen.totalAmount,
          amountPaid: chosen.amountPaid,
          balanceRemaining: chosen.balanceRemaining,
        }
      : null;

  // The office's gateways that can take this invoice's currency (PayPal
  // never the riyal): allowed by the platform and package, and connected.
  const { gateways: onlineGateways } = useAvailableGateways(invoice?.currency);
  const online = onlineGateways.length > 0;

  const hasTenantProfile = Boolean(invoice?.tenantId);
  const tenantName =
    [invoice?.tenantId?.firstName, invoice?.tenantId?.lastName]
      .map((name) => name?.trim())
      .filter(Boolean)
      .join(" ") || "";

  const balance = invoice?.balanceRemaining ?? 0;

  // Built here rather than at module scope so its messages are in the
  // reader's language, and so the amount is checked against what this
  // installment still owes rather than only in the server's reply.
  const schema = useMemo(
    () =>
      z.object({
        amount: z
          .number({
            invalid_type_error: t("payments.collect.validation.amount", {
              defaultValue: "Enter an amount greater than zero",
            }),
          })
          .min(
            0.01,
            t("payments.collect.validation.amount", {
              defaultValue: "Enter an amount greater than zero",
            }),
          )
          .max(
            balance > 0 ? balance : Number.MAX_SAFE_INTEGER,
            t("payments.collect.validation.amountTooHigh", {
              defaultValue: "The amount is more than what is left ({balance})",
              values: { balance: formatCurrency(balance) },
            }),
          ),
        // The same six the server accepts (manualPaymentMethodSchema). A plain
        // boolean, not the type guard, so the form's input and output types
        // stay the same for the resolver.
        paymentMethod: z.string().refine(
          (value): boolean => isManualPaymentMethod(value),
          {
            message: t("payments.collect.validation.method", {
              defaultValue: "Choose a payment method",
            }),
          },
        ),
        paidDate: z.string().min(
          1,
          t("payments.collect.validation.date", {
            defaultValue: "Enter the payment date",
          }),
        ),
        transactionId: z.string().max(200).optional(),
        notes: z.string().max(2000).optional(),
      }),
    [t, formatCurrency, balance],
  );
  type PaymentForm = z.infer<typeof schema>;

  // The amount asked for belongs to the installment it was asked for on;
  // any other installment starts from what it still owes.
  const startingAmount = (owed: number, invoiceId?: string) =>
    initialAmount &&
    initialAmount > 0 &&
    (!initialInvoiceId || !invoiceId || invoiceId === initialInvoiceId)
      ? Math.min(initialAmount, owed)
      : owed;

  const form = useForm<PaymentForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: startingAmount(balance),
      paymentMethod: "",
      paidDate: toLocalDateTimeInput(new Date()),
      transactionId: "",
      notes: "",
    },
  });

  // Start each opening from the installment asked for (or the oldest one
  // still owing), not from whatever the last use of the dialog left behind.
  React.useEffect(() => {
    if (!open) return;
    if (picking) {
      const start =
        choices?.find((choice) => choice.invoiceId === initialInvoiceId) ??
        choices?.[0];
      setChosenInvoiceId(start?.invoiceId);
    }
  }, [open, picking, choices, initialInvoiceId]);

  const installmentLabel = React.useCallback(
    (index: number) =>
      t("leases.installments.numbered", {
        defaultValue: "Installment {index}",
        values: { index },
      }),
    [t],
  );


  // The chosen contract's installments that can still take money.
  React.useEffect(() => {
    if (!choosingContract || !open || !leaseId || loaded?.leaseId === leaseId) {
      return;
    }
    let active = true;
    void (async () => {
      const response = await fetch(
        `/api/payments/installments?leaseId=${encodeURIComponent(leaseId)}`,
      );
      const result = await response.json().catch(() => null);
      if (!active) return;
      setLoaded(
        response.ok && result?.success
          ? {
              leaseId,
              installments: openInstallmentChoices(
                result.data as InstallmentSchedule,
                installmentLabel,
                language,
              ),
              failed: false,
            }
          : { leaseId, installments: [], failed: true },
      );
    })();
    return () => {
      active = false;
    };
  }, [choosingContract, open, leaseId, loaded, installmentLabel, language]);

  // The row being settled is attached to its own installment, and only on
  // its own contract; anywhere else the money is a new payment.
  const converting =
    Boolean(convertPaymentId) &&
    Boolean(invoice) &&
    (!convertInvoiceId || convertInvoiceId === invoice?._id) &&
    (!choosingContract || !initialLeaseId || leaseId === initialLeaseId);
  // That row's installment is already paid up — a leftover entry, which
  // recording money against it cannot fix.
  const convertTargetClosed =
    Boolean(convertPaymentId && convertInvoiceId) &&
    choices !== undefined &&
    !choices.some((choice) => choice.invoiceId === convertInvoiceId) &&
    (!choosingContract || !initialLeaseId || leaseId === initialLeaseId);

  // The contracts this caller can record against, searched on the server —
  // the payments filter's own source, so the two can never offer different
  // contracts, and an office with hundreds of them can reach every one. The
  // mobile, the building and the unit each have a column of their own.
  const loadContracts = React.useCallback(
    async (search: string, chosen: string[]): Promise<RemoteOption[]> =>
      (await searchFilterOptions<ContractChoice>("leases", search, chosen)).map(
        (contract) => ({
          value: contract.id,
          label: contract.tenantName || "—",
          subtitle: [
            contract.contractNumber
              ? t("payments.collect.contractNumber", {
                  defaultValue: "No. {number}",
                  values: { number: contract.contractNumber },
                })
              : null,
            `${formatDate(contract.startDate)} – ${formatDate(contract.endDate)}`,
            t(`leases.status.${contract.status}`, {
              defaultValue: contract.status,
            }),
          ]
            .filter(Boolean)
            .join(" · "),
          cells: [contract.tenantPhone, contract.propertyName, contract.unitNumber],
          // A tenant can hold several contracts: the button names the unit.
          buttonLabel: [
            contract.tenantName,
            contract.unitNumber ? `#${contract.unitNumber}` : null,
          ]
            .filter(Boolean)
            .join(" "),
        }),
      ),
    [t, formatDate],
  );
  const contractColumns = [
    {
      header: t("payments.reports.columns.mobile", { defaultValue: "Mobile" }),
      ltr: true,
    },
    { header: t("payments.reports.columns.building", { defaultValue: "Building" }) },
    { header: t("payments.reports.columns.unit", { defaultValue: "Unit" }) },
  ];

  React.useEffect(() => {
    if (invoice && open) {
      form.reset({
        amount: startingAmount(invoice.balanceRemaining, invoice._id),
        paymentMethod: "",
        paidDate: toLocalDateTimeInput(new Date()),
        transactionId: "",
        notes: "",
      });
    }
    // Reset when the installment changes, not on every render of `invoice`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?._id, open]);

  const onSubmit = async (data: PaymentForm) => {
    if (!invoice) return;
    // Checked here as well as in the schema: the resolver is built once, and
    // the installment can change under it when picking.
    if (data.amount > invoice.balanceRemaining + 0.005) {
      form.setError("amount", {
        message: t("payments.collect.validation.amountTooHigh", {
          defaultValue: "The amount is more than what is left ({balance})",
          values: { balance: formatCurrency(invoice.balanceRemaining) },
        }),
      });
      return;
    }

    try {
      setSubmitting(true);
      const response = await fetch(`/api/invoices/${invoice._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "add_payment",
          amount: data.amount,
          paymentMethod: data.paymentMethod,
          paidDate: new Date(data.paidDate).toISOString(),
          transactionId: data.transactionId || undefined,
          notes: data.notes || undefined,
          ...(converting ? { paymentId: convertPaymentId } : {}),
        }),
      });

      const result = await response.json().catch(() => null);
      if (response.ok && result?.success) {
        toast.success(
          t("payments.collect.toasts.recorded", {
            defaultValue: "Payment recorded",
          }),
        );
        onPaymentRecorded();
        onOpenChange(false);
      } else {
        showApiErrorToast(
          result,
          t("payments.collect.toasts.failed", {
            defaultValue: "Could not record the payment",
          }),
        );
      }
    } catch (error) {
      console.error("Error recording payment:", error);
      showApiErrorToast(
        error,
        t("payments.collect.toasts.failed", {
          defaultValue: "Could not record the payment",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!givenInvoice && !picking && !choosingContract) return null;

  const gatewayAmount = form.watch("amount") || balance;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-160 max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {t("payments.collect.title", { defaultValue: "Record a payment" })}
          </DialogTitle>
          <DialogDescription>
            {invoice
              ? tenantName
                ? t("payments.collect.descriptionWithTenant", {
                    defaultValue:
                      "Record a payment against {invoice} from {tenant}",
                    values: { invoice: invoice.invoiceNumber, tenant: tenantName },
                  })
                : t("payments.collect.description", {
                    defaultValue: "Record a payment against {invoice}",
                    values: { invoice: invoice.invoiceNumber },
                  })
              : choosingContract
                ? t("payments.collect.pickContractDescription", {
                    defaultValue:
                      "Choose the contract and the installment this payment is for, then enter what was received.",
                  })
                : t("payments.collect.pickDescription", {
                    defaultValue:
                      "Choose the installment this payment is for, then enter what was received.",
                  })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1 space-y-5">
          {choosingContract && (
            <div className="space-y-2">
              <Label htmlFor="record-payment-contract">
                {t("payments.collect.contractLabel", {
                  defaultValue: "Contract",
                })}
              </Label>
              <RemoteOptionSelect
                id="record-payment-contract"
                value={leaseId}
                onValueChange={(next) => {
                  setLeaseId(next);
                  setChosenInvoiceId(undefined);
                }}
                load={loadContracts}
                labelHeader={t("payments.reports.columns.tenant", {
                  defaultValue: "Tenant",
                })}
                columns={contractColumns}
                placeholder={t("payments.collect.contractPlaceholder", {
                  defaultValue: "Choose the contract",
                })}
                searchPlaceholder={t("payments.collect.contractSearchMobile", {
                  defaultValue: "Tenant, mobile, unit or contract number",
                })}
                emptyMessage={t("payments.collect.noContracts", {
                  defaultValue: "No contract matches.",
                })}
                loadingMessage={t("common.loading", { defaultValue: "Loading…" })}
              />
              {installmentsLoading && (
                <p className="text-sm text-muted-foreground">
                  {t("payments.collect.loadingInstallments", {
                    defaultValue: "Loading this contract's installments…",
                  })}
                </p>
              )}
              {loaded?.leaseId === leaseId && loaded.failed && (
                <p className="text-sm text-destructive">
                  {t("payments.collect.installmentsFailed", {
                    defaultValue:
                      "Could not load this contract's installments. Try again.",
                  })}
                </p>
              )}
            </div>
          )}

          {picking && !(loaded?.leaseId === leaseId && loaded.failed) && (
            <div className="space-y-2">
              <Label>
                {t("payments.collect.installmentLabel", {
                  defaultValue: "Installment",
                })}
              </Label>
              {choices && choices.length > 0 ? (
                <Select
                  value={chosenInvoiceId}
                  onValueChange={setChosenInvoiceId}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("payments.collect.installmentPlaceholder", {
                        defaultValue: "Choose the installment",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((choice) => (
                      <SelectItem key={choice.invoiceId} value={choice.invoiceId}>
                        {t("payments.collect.installmentOption", {
                          defaultValue: "{label} — due {date} — {balance} left",
                          values: {
                            label: choice.label,
                            date: formatDate(choice.dueDate),
                            balance: formatCurrency(choice.balanceRemaining),
                          },
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  {t("payments.collect.noOpenInstallments", {
                    defaultValue:
                      "Every installment on this contract is already paid.",
                  })}
                </p>
              )}
              {converting && (
                <p className="text-xs text-muted-foreground">
                  {t("payments.collect.convertNotice", {
                    defaultValue:
                      "The unlinked payment entry will be attached to this installment instead of a second entry being added.",
                  })}
                </p>
              )}
              {convertTargetClosed && (
                <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
                  {t("payments.collect.convertTargetPaid", {
                    defaultValue:
                      "The installment this entry was for is already paid, so what you record here is a new payment on the installment you choose. If the entry is a leftover, delete it from the payments list.",
                  })}
                </p>
              )}
            </div>
          )}

          {invoice && online && (
            <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
              <div>
                <p className="text-sm font-medium">
                  {t("payments.collect.online.title", {
                    defaultValue: "Collect online",
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("payments.collect.online.description", {
                    defaultValue:
                      "Opens the payment service's secure page for {amount}. The payment is recorded as soon as it goes through.",
                    values: { amount: formatCurrency(gatewayAmount) },
                  })}
                </p>
              </div>
              {hasTenantProfile ? (
                <GatewayPayOptions
                  invoiceId={invoice._id}
                  amount={gatewayAmount}
                  currency={invoice.currency}
                  returnPath={pathname}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("payments.collect.noTenantProfile", {
                    defaultValue:
                      "Online checkout is unavailable because this invoice is not linked to an active tenant profile.",
                  })}
                </p>
              )}
            </div>
          )}

          {invoice && (
            <>
              <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>
                  {online
                    ? t("payments.collect.orManual", {
                        defaultValue: "or record manually",
                      })
                    : t("payments.collect.recordHeading", {
                        defaultValue: "Record payment",
                      })}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("payments.collect.summary.total", {
                      defaultValue: "Installment total",
                    })}
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatCurrency(invoice.totalAmount)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("payments.collect.summary.paid", {
                      defaultValue: "Already paid",
                    })}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-emerald-600">
                    {formatCurrency(invoice.amountPaid)}
                  </p>
                </div>
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/30">
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {t("payments.collect.summary.remaining", {
                      defaultValue: "Remaining",
                    })}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-amber-700 dark:text-amber-400">
                    {formatCurrency(invoice.balanceRemaining)}
                  </p>
                </div>
              </div>

              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                  id="collect-payment-form"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <FormField
                      control={form.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("payments.collect.fields.amount", {
                              defaultValue: "Amount",
                            })}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max={invoice.balanceRemaining}
                              placeholder="0.00"
                              {...field}
                              onChange={(e) =>
                                field.onChange(parseFloat(e.target.value) || 0)
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="paymentMethod"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("payments.collect.fields.method", {
                              defaultValue: "Payment method",
                            })}
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
                                  {t(method.labelKey, {
                                    defaultValue: method.fallback,
                                  })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="paidDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("payments.collect.fields.paidAt", {
                              defaultValue: "Payment date",
                            })}
                          </FormLabel>
                          <FormControl>
                            <Input type="datetime-local" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="transactionId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("payments.collect.fields.reference", {
                              defaultValue: "Reference number",
                            })}
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t(
                                "payments.collect.fields.referencePlaceholder",
                                {
                                  defaultValue:
                                    "Transfer, cheque or receipt number",
                                },
                              )}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("payments.collect.fields.notes", {
                              defaultValue: "Notes (optional)",
                            })}
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder={t(
                                "payments.collect.fields.notesPlaceholder",
                                {
                                  defaultValue:
                                    "Anything worth knowing about this payment",
                                },
                              )}
                              className="min-h-10"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </form>
              </Form>
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("payments.collect.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="submit"
            form="collect-payment-form"
            disabled={submitting || !invoice}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {submitting
              ? t("payments.collect.saving", { defaultValue: "Saving…" })
              : t("payments.collect.save", { defaultValue: "Save payment" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
