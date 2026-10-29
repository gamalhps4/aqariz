"use client";

import { z } from "zod";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { FileSignature, RotateCcw } from "lucide-react";
import {
  leaseService,
  LeaseResponse,
  LeaseRenewalData,
} from "@/lib/services/lease.service";
import { LeaseStatus } from "@/types";
import { FormDatePicker } from "@/components/ui/date-picker";
import { TerminateContractDialog } from "@/components/leases/TerminateContractDialog";
import { notifyInstallmentGeneration } from "@/components/leases/installment-generation-notice";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  FREQUENCY_LABELS,
  installmentCount,
  normalizeFrequency,
  splitContractAmount,
} from "@/lib/lease-installments";
import { isLiveRenewal } from "@/lib/lease-lifecycle";
import { leaseContractAmount, leaseRentAmount } from "@/lib/lease-money";

type Translate = ReturnType<typeof useLocalizationContext>["t"];

// Validation schemas — built with the reader's language, since their
// messages are what the form shows.
const signatureSchemaFor = (t: Translate) =>
  z.object({
    signatureData: z
      .string()
      .min(1, t("leases.actions.validation.signature", { defaultValue: "Type your name to sign" })),
    ipAddress: z.string().optional(),
  });

const renewalSchemaFor = (t: Translate) =>
  z.object({
    newStartDate: z
      .string()
      .min(1, t("leases.actions.validation.startDate", { defaultValue: "Choose the new start date" })),
    newEndDate: z
      .string()
      .min(1, t("leases.actions.validation.endDate", { defaultValue: "Choose the new end date" })),
    // Read the same way as the contract form: one installment, or the whole
    // new term. Empty keeps the current contract's figure and basis.
    amountBasis: z.enum(["installment", "total"]),
    newRentAmount: z
      .number()
      .min(0, t("leases.actions.validation.rent", { defaultValue: "Rent cannot be negative" }))
      .optional(),
    renewalType: z.enum(["automatic", "manual"]),
    notes: z.string().optional(),
  });

type SignatureFormData = z.infer<ReturnType<typeof signatureSchemaFor>>;
type RenewalFormData = z.infer<ReturnType<typeof renewalSchemaFor>>;

interface LeaseActionsProps {
  lease: LeaseResponse;
  onUpdate: () => void;
}

export function LeaseActions({ lease, onUpdate }: LeaseActionsProps) {
  const [isSigningOpen, setIsSigningOpen] = useState(false);
  const [isRenewalOpen, setIsRenewalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { t, formatCurrency } = useLocalizationContext();
  const signatureSchema = useMemo(() => signatureSchemaFor(t), [t]);
  const renewalSchema = useMemo(() => renewalSchemaFor(t), [t]);

  const signatureForm = useForm<SignatureFormData>({
    resolver: zodResolver(signatureSchema),
    defaultValues: {
      signatureData: "",
      ipAddress: "",
    },
  });

  // What the renewal carries over when the dialog leaves it alone.
  const currentTotal = leaseContractAmount(lease);
  const currentRent = leaseRentAmount(lease);
  const frequency = normalizeFrequency(lease.paymentFrequency);

  const renewalForm = useForm<RenewalFormData>({
    resolver: zodResolver(renewalSchema),
    defaultValues: {
      newStartDate: "",
      newEndDate: "",
      amountBasis: currentTotal !== null ? "total" : "installment",
      newRentAmount: currentTotal ?? currentRent,
      renewalType: "manual",
      notes: "",
    },
  });

  /**
   * Whether the renewal comes into force at once — it takes the unit over and
   * its installments are billed — or is saved as a draft to review first. On
   * unless the office says otherwise: a renewal left as a draft and forgotten
   * is a contract nobody can collect on.
   */
  const [activateNow, setActivateNow] = useState(true);
  const thisYear = new Date().getFullYear();

  // How the renewal will bill over its new dates, on the contract's own
  // cycle — a total copied onto a longer or shorter term divides
  // differently, and this is where that shows.
  const [renewalStart, renewalEnd, renewalBasis, renewalAmount] = useWatch({
    control: renewalForm.control,
    name: ["newStartDate", "newEndDate", "amountBasis", "newRentAmount"],
  });
  const renewalCount = installmentCount({
    startDate: renewalStart,
    endDate: renewalEnd,
    frequency,
  });
  const renewalSplit =
    renewalBasis === "total"
      ? splitContractAmount(renewalAmount ?? 0, renewalCount)
      : {
          count: renewalCount,
          share: renewalAmount ?? 0,
          last: renewalAmount ?? 0,
        };
  const frequencyLabel = t(`leases.contract.frequency.${frequency}`, {
    defaultValue: FREQUENCY_LABELS[frequency],
  });

  /** Read the figure the other way round, keeping the renewal's rent. */
  const switchRenewalBasis = (basis: "installment" | "total") => {
    if (basis === renewalBasis) return;
    renewalForm.setValue("amountBasis", basis);
    const amount = renewalAmount ?? 0;
    // Without dates there is no installment count to convert through.
    if (!amount || renewalCount < 1) return;
    renewalForm.setValue(
      "newRentAmount",
      basis === "installment"
        ? splitContractAmount(amount, renewalCount).share
        : Math.round(amount * renewalCount * 100) / 100,
    );
  };

  const handleSignLease = async (data: SignatureFormData) => {
    try {
      setIsLoading(true);
      const signed = await leaseService.signLease(lease._id, data);
      toast.success(t("leases.actions.toasts.signed", { defaultValue: "Contract signed" }));
      // Signing brings the contract into force, which bills it.
      notifyInstallmentGeneration(signed?.invoiceGeneration, t);
      setIsSigningOpen(false);
      signatureForm.reset();
      onUpdate();
    } catch (error) {
      console.error("Error signing lease:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("leases.actions.toasts.signFailed", { defaultValue: "Could not sign the contract" })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRenewLease = async (data: RenewalFormData) => {
    try {
      setIsLoading(true);
      const renewalData: LeaseRenewalData = {
        newStartDate: data.newStartDate,
        newEndDate: data.newEndDate,
        renewalType: data.renewalType,
        notes: data.notes,
        activate: activateNow,
      };

      // An amount is sent the way it was typed; none at all lets the
      // renewal carry the current contract's figure and basis over.
      if (data.newRentAmount) {
        if (data.amountBasis === "total") {
          renewalData.newContractAmount = data.newRentAmount;
        } else {
          renewalData.newContractAmount = null;
          renewalData.newTerms = { rentAmount: data.newRentAmount };
        }
      }

      const renewed = await leaseService.renewLease(lease._id, renewalData);
      toast.success(
        activateNow
          ? t("leases.actions.toasts.renewed", { defaultValue: "Contract renewed" })
          : t("leases.actions.toasts.renewedDraft", {
              defaultValue:
                "Renewal saved as a draft. This contract stays active until the renewal is activated.",
            })
      );
      // Activated at once, the new contract was billed there and then.
      notifyInstallmentGeneration(renewed?.invoiceGeneration, t);
      setIsRenewalOpen(false);
      renewalForm.reset();
      setActivateNow(true);
      onUpdate();
    } catch (error) {
      console.error("Error renewing lease:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("leases.actions.toasts.renewFailed", { defaultValue: "Could not renew the contract" })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const canSign = lease.status === LeaseStatus.DRAFT && !lease.signedDate;
  const canTerminate = lease.status === LeaseStatus.ACTIVE;
  // One renewal at a time: while one waits as a draft, the contract page
  // links to it instead (and the server refuses a second).
  const canRenew =
    (lease.status === LeaseStatus.ACTIVE ||
      lease.status === LeaseStatus.EXPIRED) &&
    !isLiveRenewal(lease.renewal?.successor);

  const propertyName =
    lease.propertyId?.name ??
    t("leases.actions.thisProperty", { defaultValue: "this property" });

  return (
    <div className="flex items-center gap-2">
      {/* Sign Lease */}
      {canSign && (
        <Dialog open={isSigningOpen} onOpenChange={setIsSigningOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="cursor-pointer">
              <FileSignature className="me-2 h-4 w-4" />
              {t("leases.actions.sign", { defaultValue: "Sign contract" })}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("leases.actions.sign", { defaultValue: "Sign contract" })}</DialogTitle>
              <DialogDescription>
                {t("leases.actions.signDescription", { defaultValue: "Sign the contract for {property}.", values: { property: propertyName } })}
              </DialogDescription>
            </DialogHeader>
            <Form {...signatureForm}>
              <form
                onSubmit={signatureForm.handleSubmit(handleSignLease)}
                className="space-y-4"
              >
                <FormField
                  control={signatureForm.control}
                  name="signatureData"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.actions.signature", { defaultValue: "Signature" })}
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t("leases.actions.signaturePlaceholder", { defaultValue: "Your full name" })}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t("leases.actions.signatureHint", { defaultValue: "Your typed full name is your signature." })}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsSigningOpen(false)}
                  >
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </Button>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading
                      ? t("leases.actions.signing", { defaultValue: "Signing…" })
                      : t("leases.actions.sign", { defaultValue: "Sign contract" })}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}

      {/* Renew Lease */}
      {canRenew && (
        <Dialog open={isRenewalOpen} onOpenChange={setIsRenewalOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="cursor-pointer">
              <RotateCcw className="me-2 h-4 w-4" />
              {t("leases.actions.renew", { defaultValue: "Renew contract" })}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("leases.actions.renew", { defaultValue: "Renew contract" })}</DialogTitle>
              <DialogDescription>
                {t("leases.actions.renewDescription", { defaultValue: "Create a renewal of the contract for {property}.", values: { property: propertyName } })}
              </DialogDescription>
            </DialogHeader>
            <Form {...renewalForm}>
              <form
                onSubmit={
                  renewalForm.handleSubmit(
                    handleRenewLease
                  ) as React.FormEventHandler<HTMLFormElement>
                }
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <FormField<RenewalFormData>
                    control={renewalForm.control}
                    name="newStartDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("leases.actions.newStart", { defaultValue: "New start date" })}
                        </FormLabel>
                        <FormControl>
                          <FormDatePicker
                            value={
                              field.value ? new Date(field.value) : undefined
                            }
                            onChange={(date) => {
                              if (date) {
                                // Format date as YYYY-MM-DD without timezone conversion
                                const year = date.getFullYear();
                                const month = String(
                                  date.getMonth() + 1
                                ).padStart(2, "0");
                                const day = String(date.getDate()).padStart(
                                  2,
                                  "0"
                                );
                                field.onChange(`${year}-${month}-${day}`);
                              } else {
                                field.onChange("");
                              }
                            }}
                            placeholder={t("leases.actions.pickDate", { defaultValue: "Pick a date" })}
                            disabled={(date) =>
                              date <
                              new Date(
                                new Date().setDate(new Date().getDate() - 1)
                              )
                            }
                            // Without a range the calendar stops at the end
                            // of this year, so a contract ending next year
                            // could not be renewed from here at all. The
                            // same spans the contract form gives its dates.
                            fromYear={thisYear}
                            toYear={thisYear + 5}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField<RenewalFormData>
                    control={renewalForm.control}
                    name="newEndDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("leases.actions.newEnd", { defaultValue: "New end date" })}
                        </FormLabel>
                        <FormControl>
                          <FormDatePicker
                            value={
                              field.value ? new Date(field.value) : undefined
                            }
                            onChange={(date) => {
                              if (date) {
                                // Format date as YYYY-MM-DD without timezone conversion
                                const year = date.getFullYear();
                                const month = String(
                                  date.getMonth() + 1
                                ).padStart(2, "0");
                                const day = String(date.getDate()).padStart(
                                  2,
                                  "0"
                                );
                                field.onChange(`${year}-${month}-${day}`);
                              } else {
                                field.onChange("");
                              }
                            }}
                            placeholder={t("leases.actions.pickDate", { defaultValue: "Pick a date" })}
                            disabled={(date) => {
                              const startDate =
                                renewalForm.watch("newStartDate");
                              return startDate
                                ? date <= new Date(startDate)
                                : date < new Date();
                            }}
                            fromYear={thisYear}
                            toYear={thisYear + 10}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField<RenewalFormData>
                  control={renewalForm.control}
                  name="newRentAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.actions.newRent", { defaultValue: "New rent (optional)" })}
                      </FormLabel>
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            className="min-w-0 flex-1"
                            placeholder={String(currentTotal ?? currentRent)}
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                parseFloat(e.target.value) || undefined
                              )
                            }
                          />
                        </FormControl>
                        <Select
                          value={renewalBasis}
                          onValueChange={(value) =>
                            switchRenewalBasis(value as "installment" | "total")
                          }
                        >
                          <SelectTrigger className="w-[150px] shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="installment">
                              {t("leases.contract.basis.installment", {
                                defaultValue: "Per installment",
                              })}
                            </SelectItem>
                            <SelectItem value="total">
                              {t("leases.contract.basis.total", {
                                defaultValue: "Total",
                              })}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <FormDescription>
                        {!renewalAmount
                          ? t("leases.actions.keepRent", {
                              defaultValue:
                                "Leave empty to keep the current rent of {amount}",
                              values: {
                                amount: formatCurrency(currentTotal ?? currentRent),
                              },
                            })
                          : renewalSplit.count === 0
                            ? t("leases.contract.basis.needDates", {
                                defaultValue:
                                  "Choose the start and end dates to see the installments.",
                              })
                            : `${frequencyLabel} · ${
                                renewalSplit.last === renewalSplit.share
                                  ? t("leases.contract.basis.hint", {
                                      defaultValue: "{count} installments of {each}",
                                      values: {
                                        count: renewalSplit.count,
                                        each: formatCurrency(renewalSplit.share),
                                      },
                                    })
                                  : t("leases.contract.basis.hintRemainder", {
                                      defaultValue:
                                        "{count} installments of {each} and a last one of {last}",
                                      values: {
                                        count: renewalSplit.count - 1,
                                        each: formatCurrency(renewalSplit.share),
                                        last: formatCurrency(renewalSplit.last),
                                      },
                                    })
                              }`}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* In force at once, or a draft to review first. */}
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
                  <Checkbox
                    checked={activateNow}
                    onCheckedChange={(checked) =>
                      setActivateNow(checked === true)
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium">
                      {t("leases.actions.activateNow", {
                        defaultValue: "Activate the new contract now",
                      })}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {activateNow
                        ? t("leases.actions.activateNowOn", {
                            defaultValue:
                              "The new contract takes effect at once: the unit passes to it and its installments are billed.",
                          })
                        : t("leases.actions.activateNowOffKeeps", {
                            defaultValue:
                              "The new contract is saved as a draft. This contract stays in force and keeps the unit until the draft is activated; its installments are billed then.",
                          })}
                    </span>
                  </span>
                </label>

                <FormField<RenewalFormData>
                  control={renewalForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("leases.actions.notes", { defaultValue: "Renewal notes" })}
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t("leases.actions.notesPlaceholder", { defaultValue: "Anything worth recording about this renewal" })}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsRenewalOpen(false)}
                  >
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </Button>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading
                      ? t("leases.actions.renewing", { defaultValue: "Renewing…" })
                      : t("leases.actions.renew", { defaultValue: "Renew contract" })}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}

      {/* Terminate contract — the working implementation, with the
          outstanding-rent warning the contract module requires. */}
      {canTerminate && (
        <TerminateContractDialog
          leaseId={lease._id}
          propertyName={propertyName}
          onTerminated={onUpdate}
        />
      )}

    </div>
  );
}
