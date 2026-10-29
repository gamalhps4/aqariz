"use client";

/**
 * PropertyPro - Add a charge / edit a charge
 *
 * A charge is something the tenant owes — a maintenance bill, a utility, a
 * deposit — created unpaid. It is not a payment: money is recorded only
 * through the installment dialog (Record payment), which is where the date
 * it arrived, the method, the reference and the receipt belong.
 *
 * This form used to be "Add payment". It asked for a payment method, could
 * open a card payment in US dollars, offered every contract of every tenant
 * whatever tenant was picked, and sent an empty contract id when none was
 * chosen, which failed as "Related record does not exist". Now the contract
 * comes first and the tenant and building are taken from it; without a
 * contract they are picked by hand, and the server checks that whatever was
 * sent agrees (lib/payments/charge-links.ts).
 *
 * Editing shows the contract, tenant, building and installment but does not
 * change them: a charge stays on the contract it was added to.
 */

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileText, Link2, Loader2, Receipt } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PaymentType } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { CHARGE_TYPES, paymentTypeLabel } from "@/lib/payments/type-labels";
import type { InstallmentSchedule } from "@/types/installment";

/** A contract as /api/payments/filter-options lists it. */
export interface ChargeContractOption {
  id: string;
  tenantId: string;
  propertyId: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  contractNumber: string | null;
  status: string;
  startDate: string;
  endDate: string;
}

export interface ChargeOption {
  id: string;
  label: string;
  hint?: string;
}

/** What the form hands its page to send. */
export interface ChargeSubmission {
  tenantId?: string;
  propertyId?: string;
  leaseId?: string;
  invoiceId?: string;
  type: PaymentType;
  amount?: number;
  /** yyyy-MM-dd, the day the charge falls due. */
  dueDate: string;
  description: string;
  notes: string;
}

/** A charge being edited, with the names of what it is locked to. */
export interface ChargeInitialData {
  type: PaymentType;
  amount: number;
  dueDate: string;
  description?: string;
  notes?: string;
  tenantName?: string;
  propertyName?: string;
  contractLabel?: string;
  installmentLabel?: string;
}

interface ChargeFormProps {
  mode: "create" | "edit";
  onSubmit: (data: ChargeSubmission) => void;
  onCancel?: () => void;
  isLoading?: boolean;
  /** Create: the contracts, tenants and buildings to choose from. */
  contracts?: ChargeContractOption[];
  tenants?: ChargeOption[];
  properties?: ChargeOption[];
  /** Create: the contract to start on. */
  initialLeaseId?: string;
  /** Edit: the charge as it is. */
  initialData?: ChargeInitialData;
  /**
   * Money has been recorded against it, so its amount is shown but cannot
   * be changed — the review's rule; the correction is to delete it and add
   * a new one.
   */
  lockAmount?: boolean;
}

const NONE = "__none__";

export function ChargeForm({
  mode,
  onSubmit,
  onCancel,
  isLoading = false,
  contracts = [],
  tenants = [],
  properties = [],
  initialLeaseId,
  initialData,
  lockAmount = false,
}: ChargeFormProps) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const creating = mode === "create";

  const schema = useMemo(
    () =>
      z
        .object({
          leaseId: z.string(),
          invoiceId: z.string(),
          tenantId: z.string(),
          propertyId: z.string(),
          type: z.nativeEnum(PaymentType),
          amount: z
            .number({
              invalid_type_error: t("payments.charge.validation.amount", {
                defaultValue: "Enter an amount greater than zero",
              }),
            })
            .min(
              0.01,
              t("payments.charge.validation.amount", {
                defaultValue: "Enter an amount greater than zero",
              }),
            )
            .max(100_000_000),
          dueDate: z.string().min(
            1,
            t("payments.charge.validation.dueDate", {
              defaultValue: "Enter the date the charge is due",
            }),
          ),
          description: z.string().max(500),
          notes: z.string().max(1000),
        })
        // Without a contract, the tenant and building are what the charge is
        // attached to, so both have to be named.
        .superRefine((data, context) => {
          if (!creating || data.leaseId) return;
          if (!data.tenantId) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tenantId"],
              message: t("payments.charge.validation.tenant", {
                defaultValue: "Choose the tenant",
              }),
            });
          }
          if (!data.propertyId) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["propertyId"],
              message: t("payments.charge.validation.property", {
                defaultValue: "Choose the building",
              }),
            });
          }
        }),
    [t, creating],
  );
  type ChargeFormData = z.infer<typeof schema>;

  const form = useForm<ChargeFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      leaseId: creating ? (initialLeaseId ?? "") : "",
      invoiceId: "",
      tenantId: "",
      propertyId: "",
      type: initialData?.type ?? PaymentType.MAINTENANCE,
      amount: initialData?.amount ?? 0,
      dueDate: initialData?.dueDate ?? "",
      description: initialData?.description ?? "",
      notes: initialData?.notes ?? "",
    },
  });

  const leaseId = form.watch("leaseId");
  const chosenType = form.watch("type");
  const contract = contracts.find((option) => option.id === leaseId);

  // The chosen contract's billed installments, for the optional link.
  const [installments, setInstallments] = useState<{
    leaseId: string;
    rows: Array<{ id: string; label: string }>;
  } | null>(null);
  const installmentsLoading =
    creating && Boolean(leaseId) && installments?.leaseId !== leaseId;

  useEffect(() => {
    if (!creating || !leaseId || installments?.leaseId === leaseId) return;
    let active = true;
    void (async () => {
      const response = await fetch(
        `/api/payments/installments?leaseId=${encodeURIComponent(leaseId)}`,
      );
      const result = await response.json().catch(() => null);
      if (!active) return;
      const schedule = (response.ok && result?.success
        ? result.data
        : null) as InstallmentSchedule | null;
      setInstallments({
        leaseId,
        rows: (schedule?.installments ?? [])
          .filter((row) => row.invoiceId && row.state !== "cancelled")
          .map((row) => ({
            id: row.invoiceId as string,
            label: `${t("leases.installments.numbered", {
              defaultValue: "Installment {index}",
              values: { index: row.index },
            })} · ${formatDate(row.dueDate)} · ${formatCurrency(row.totalAmount)}`,
          })),
      });
    })();
    return () => {
      active = false;
    };
  }, [creating, leaseId, installments, t, formatDate, formatCurrency]);

  const contractOptions = useMemo(
    () =>
      contracts.map((option) => ({
        value: option.id,
        label: [
          option.tenantName,
          option.unitNumber ? `#${option.unitNumber}` : null,
        ]
          .filter(Boolean)
          .join(" "),
        subtitle: [
          option.propertyName,
          option.contractNumber
            ? t("payments.collect.contractNumber", {
                defaultValue: "No. {number}",
                values: { number: option.contractNumber },
              })
            : null,
          `${formatDate(option.startDate)} – ${formatDate(option.endDate)}`,
          t(`leases.status.${option.status}`, { defaultValue: option.status }),
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [contracts, t, formatDate],
  );

  const submit = (data: ChargeFormData) => {
    const common = {
      type: data.type,
      dueDate: data.dueDate,
      description: data.description.trim(),
      notes: data.notes.trim(),
      ...(lockAmount ? {} : { amount: data.amount }),
    };
    if (!creating) {
      onSubmit(common);
      return;
    }
    // With a contract, the tenant and building are the contract's — never
    // a separate pick that could disagree with it.
    onSubmit({
      ...common,
      leaseId: contract?.id,
      invoiceId: contract && data.invoiceId ? data.invoiceId : undefined,
      tenantId: contract ? contract.tenantId : data.tenantId,
      propertyId: contract ? contract.propertyId : data.propertyId,
    });
  };

  const lockedRow = (label: string, value?: string) =>
    value ? (
      <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
        <span className="text-sm text-muted-foreground sm:w-32">{label}</span>
        <span className="text-sm font-medium">{value}</span>
      </div>
    ) : null;

  const typeChoices = CHARGE_TYPES.includes(chosenType)
    ? CHARGE_TYPES
    : [...CHARGE_TYPES, chosenType];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-6">
        {/* What the charge is attached to */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              {t("payments.charge.linkTitle", {
                defaultValue: "Contract and tenant",
              })}
            </CardTitle>
            <CardDescription>
              {creating
                ? t("payments.charge.linkSubtitle", {
                    defaultValue:
                      "Choose the contract first — the tenant and building come from it. Leave it empty only for a charge that belongs to no contract.",
                  })
                : t("payments.charge.linkLocked", {
                    defaultValue:
                      "A charge stays on the contract it was added to. To move it, delete it and add it again on the right contract.",
                  })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {creating ? (
              <>
                <FormField
                  control={form.control}
                  name="leaseId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("payments.collect.contractLabel", {
                          defaultValue: "Contract",
                        })}
                      </FormLabel>
                      <SearchableSelect
                        value={field.value}
                        onValueChange={(next) => {
                          field.onChange(next);
                          form.setValue("invoiceId", "");
                        }}
                        options={contractOptions}
                        placeholder={t("payments.charge.noContract", {
                          defaultValue: "No contract",
                        })}
                        searchPlaceholder={t("payments.collect.contractSearch", {
                          defaultValue: "Tenant, unit or contract number",
                        })}
                        emptyMessage={t("payments.collect.noContracts", {
                          defaultValue: "No contract matches.",
                        })}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {contract ? (
                  <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                    {lockedRow(
                      t("payments.table.tenant"),
                      contract.tenantName,
                    )}
                    {lockedRow(
                      t("payments.filters.property", {
                        defaultValue: "Building",
                      }),
                      contract.propertyName,
                    )}
                    {lockedRow(
                      t("payments.filters.unit", { defaultValue: "Unit" }),
                      contract.unitNumber,
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="tenantId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("payments.table.tenant")}</FormLabel>
                          <SearchableSelect
                            value={field.value}
                            onValueChange={field.onChange}
                            options={tenants.map((option) => ({
                              value: option.id,
                              label: option.label,
                            }))}
                            placeholder={t("payments.charge.validation.tenant", {
                              defaultValue: "Choose the tenant",
                            })}
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="propertyId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("payments.filters.property", {
                              defaultValue: "Building",
                            })}
                          </FormLabel>
                          <SearchableSelect
                            value={field.value}
                            onValueChange={field.onChange}
                            options={properties.map((option) => ({
                              value: option.id,
                              label: option.label,
                              subtitle: option.hint,
                            }))}
                            placeholder={t("payments.charge.validation.property", {
                              defaultValue: "Choose the building",
                            })}
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {contract && (
                  <FormField
                    control={form.control}
                    name="invoiceId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("payments.collect.installmentLabel", {
                            defaultValue: "Installment",
                          })}
                        </FormLabel>
                        <Select
                          value={field.value || NONE}
                          onValueChange={(next) =>
                            field.onChange(next === NONE ? "" : next)
                          }
                          disabled={installmentsLoading}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NONE}>
                              {installmentsLoading
                                ? t("common.loading", { defaultValue: "Loading…" })
                                : t("payments.charge.noInstallment", {
                                    defaultValue: "Not for a particular installment",
                                  })}
                            </SelectItem>
                            {(installments?.leaseId === leaseId
                              ? installments.rows
                              : []
                            ).map((row) => (
                              <SelectItem key={row.id} value={row.id}>
                                {row.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          {t("payments.charge.installmentHint", {
                            defaultValue:
                              "Link it when the charge is part of one installment's bill.",
                          })}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </>
            ) : (
              <div className="space-y-2">
                {lockedRow(
                  t("payments.collect.contractLabel", { defaultValue: "Contract" }),
                  initialData?.contractLabel ??
                    t("payments.charge.noContract", {
                      defaultValue: "No contract",
                    }),
                )}
                {lockedRow(t("payments.table.tenant"), initialData?.tenantName)}
                {lockedRow(
                  t("payments.filters.property", { defaultValue: "Building" }),
                  initialData?.propertyName,
                )}
                {lockedRow(
                  t("payments.collect.installmentLabel", {
                    defaultValue: "Installment",
                  }),
                  initialData?.installmentLabel,
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* The charge itself */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              {t("payments.charge.detailsTitle", {
                defaultValue: "What is owed",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("payments.new.form.paymentDetails.typeLabel")}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {typeChoices.map((type) => (
                          <SelectItem key={type} value={type}>
                            {paymentTypeLabel(type, t)}
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
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("payments.new.form.paymentDetails.amountLabel")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        placeholder="0.00"
                        {...field}
                        disabled={lockAmount}
                        onChange={(event) =>
                          field.onChange(parseFloat(event.target.value) || 0)
                        }
                      />
                    </FormControl>
                    {lockAmount && (
                      <p className="text-xs text-muted-foreground">
                        {t("payments.edit.amountLocked", {
                          defaultValue:
                            "Money has been recorded against this payment, so its amount cannot be changed. To correct it, delete the payment and record a new one.",
                        })}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("payments.new.form.paymentDetails.dueDateLabel")}
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("payments.new.form.paymentDetails.descriptionLabel")}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t(
                        "payments.new.form.paymentDetails.descriptionPlaceholder",
                      )}
                      className="resize-none"
                      rows={2}
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
                    {t("payments.new.form.paymentDetails.notesLabel")}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t(
                        "payments.new.form.paymentDetails.notesPlaceholder",
                      )}
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              <FileText className="mt-0.5 h-4 w-4 shrink-0" />
              <Label className="font-normal leading-relaxed">
                {t("payments.charge.noMoneyHint", {
                  defaultValue:
                    "This adds an amount the tenant owes; it does not record money received. When the tenant pays, use Record payment on the payments page or on the contract.",
                })}
              </Label>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("payments.new.form.buttons.cancel")}
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {isLoading
              ? t("payments.new.form.buttons.saving")
              : creating
                ? t("payments.charge.save", { defaultValue: "Add charge" })
                : t("payments.new.form.buttons.update")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
