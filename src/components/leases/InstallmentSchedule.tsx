"use client";

/**
 * PropertyPro - Contract installment schedule
 *
 * The contract page's answer to "what is due, what is paid, what is late".
 * Rows come straight from the lease's invoices, so this view and the ledger
 * are the same numbers — an installment IS an invoice here, not a copy.
 *
 * Laid out as the client's own system lays it out: one row per installment,
 * numbered by its place in the schedule, with the due date, the amount, what
 * is paid, what remains and whether it is due, overdue or upcoming — every
 * column at every screen size. Charges added by hand are not installments of
 * the schedule and are listed apart, so adding one never renumbers the rows.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  ListPlus,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportExportButton } from "@/components/reports/export-button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import PaymentRecordDialog from "@/components/invoice/PaymentRecordDialog";
import { FREQUENCY_LABELS } from "@/lib/lease-installments";
import { describeCharge } from "@/lib/i18n/charge-description";
import {
  awaitsActivation,
  canBillInstallments,
} from "@/lib/lease-lifecycle";
import type {
  InstallmentGenerationOutcome,
  InstallmentRow,
  InstallmentSchedule as Schedule,
  InstallmentState,
  ScheduleViewerRights,
} from "@/types/installment";

/**
 * Format an ISO timestamp for an `<input type="date">`.
 *
 * Contract dates are UTC calendar days (see lease-installments.ts), so they
 * must be read back with UTC getters. Using local ones would show — and save
 * — the day before for any viewer west of UTC.
 */
function toDateInputValue(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (!Number.isFinite(date.getTime())) return "";
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * What a row's badge says. A row not billed yet is split by its date: one
 * whose due date has passed is a gap to close, and says so, where "Not billed
 * yet" alone read the same for next month and for last year.
 */
type RowLabel = InstallmentState | "plannedPastDue";

function rowLabel(row: InstallmentRow): RowLabel {
  return row.state === "planned" && row.dueDatePassed
    ? "plannedPastDue"
    : row.state;
}

const LABEL_STYLES: Record<RowLabel, string> = {
  paid: "bg-success/10 text-success border-success/20",
  partial: "bg-info/10 text-info border-info/20",
  overdue: "bg-error/10 text-error border-error/20",
  due: "bg-warning/10 text-warning border-warning/20",
  upcoming: "bg-muted text-muted-foreground border-muted",
  cancelled: "bg-muted text-muted-foreground border-muted line-through",
  planned: "bg-muted/50 text-muted-foreground border-dashed",
  plannedPastDue: "bg-warning/10 text-warning border-warning/30 border-dashed",
};

const LABEL_FALLBACK: Record<RowLabel, string> = {
  paid: "Paid",
  partial: "Partially paid",
  overdue: "Overdue",
  due: "Due",
  upcoming: "Upcoming",
  cancelled: "Cancelled",
  planned: "Not billed yet",
  plannedPastDue: "Past due, not billed",
};

/** The tenant's view, and the moment before the schedule has loaded. */
const NO_RIGHTS: ScheduleViewerRights = {
  editContract: false,
  recordPayments: false,
  deletePayments: false,
  editInstallments: false,
  generateInstallments: false,
  viewInvoices: false,
  amendTerms: false,
  exportSchedule: false,
};

interface InstallmentScheduleProps {
  leaseId: string;
  /** Hides every editing affordance — used for the tenant's own view. */
  readOnly?: boolean;
  /**
   * The contract's status. It decides what a "Not billed yet" row means: on
   * a contract in force it is something to put right here; on a draft it is
   * simply how a draft looks until it becomes active.
   */
  leaseStatus?: string;
}

export function InstallmentSchedule({
  leaseId,
  readOnly = false,
  leaseStatus,
}: InstallmentScheduleProps) {
  const { t, formatCurrency, formatDate, language } = useLocalizationContext();

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<InstallmentRow | null>(null);
  /**
   * The installment being settled.
   *
   * "Make payment settlement available from the Installments page" — until
   * now the only way to settle one was to leave the contract, find the same
   * row again on the payments screen, and hope it was the right one. An
   * installment IS an invoice here, so the payments screen's own dialog
   * settles it; nothing about how a payment is recorded is duplicated.
   */
  const [settling, setSettling] = useState<InstallmentRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmingGenerate, setConfirmingGenerate] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/leases/${leaseId}/installments`);
      const payload = await response.json();
      if (payload?.success) {
        setSchedule(payload.data as Schedule);
        setError(null);
      } else {
        setError(
          payload?.error ??
            t("leases.installments.errors.load", {
              defaultValue: "Could not load the schedule",
            }),
        );
      }
    } catch (loadError) {
      console.error("Failed to load installments:", loadError);
      setError(
        t("leases.installments.errors.load", {
          defaultValue: "Could not load the schedule",
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [leaseId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = schedule?.summary;
  const installments = useMemo(() => schedule?.installments ?? [], [schedule]);
  const charges = useMemo(() => schedule?.charges ?? [], [schedule]);

  /**
   * What this viewer may do, as the server worked it out from their own
   * permissions — the ones the routes behind these buttons ask for, with any
   * grant or denial made for this person. The buttons used to show for every
   * member of staff, and the server refused whoever lacked the right.
   */
  const rights: ScheduleViewerRights =
    !readOnly && schedule?.viewer ? schedule.viewer : NO_RIGHTS;

  const stateLabel = useCallback(
    (row: InstallmentRow) => {
      const label = rowLabel(row);
      return t(`leases.installments.state.${label}`, {
        defaultValue: LABEL_FALLBACK[label],
      });
    },
    [t],
  );

  const removeInstallment = useCallback(
    async (row: InstallmentRow) => {
      if (!row.invoiceId) return;
      setBusy(true);
      try {
        const response = await fetch(
          `/api/leases/${leaseId}/installments/${row.invoiceId}`,
          { method: "DELETE" },
        );
        const result = await response.json();
        if (!response.ok || !result?.success) {
          setError(
            result?.error ??
              t("leases.installments.errors.remove", {
                defaultValue: "Could not remove the installment",
              }),
          );
          return;
        }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [leaseId, load, t],
  );

  /**
   * Installments the contract calls for that were never invoiced. They
   * cannot be paid, edited or removed — there is nothing there yet — so on a
   * contract that is (or was) in force they are a gap to close, not a state
   * to leave standing.
   */
  const unbilled = installments.filter((row) => row.state === "planned");
  const unbilledCount = unbilled.length;
  const unbilledPastDueCount = unbilled.filter((row) => row.dueDatePassed)
    .length;
  const unbilledTotal =
    Math.round(unbilled.reduce((sum, row) => sum + row.totalAmount, 0) * 100) /
    100;

  /**
   * Charges on the contract that belong to no period of its schedule — added
   * by hand, or left over from a schedule that has since changed. Billing the
   * schedule leaves them as they are, so where any exist the office is asked
   * to check they do not already cover the same months: a contract invoiced
   * by hand would otherwise be billed for those months twice.
   */
  const offScheduleCount = charges.filter((row) => row.state !== "cancelled")
    .length;

  // The permissions the generate route itself asks for: whoever may already
  // change this contract's installments or record payments against them.
  const canGenerate =
    unbilledCount > 0 &&
    canBillInstallments(leaseStatus) &&
    rights.generateInstallments;

  /**
   * Bill what is not billed yet.
   *
   * Coming into force does this on its own; this is for the contract that
   * predates that, or whose billing failed part-way. The route bills each
   * period once, so a second press — or a press racing the automatic run —
   * creates nothing twice.
   */
  const generateInstallments = useCallback(async () => {
    const failed = t("leases.installments.errors.generate", {
      defaultValue: "Could not generate the installments",
    });
    setBusy(true);
    try {
      const response = await fetch(`/api/leases/${leaseId}/generate-invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error ?? failed);
        return;
      }

      const outcome = result.data as InstallmentGenerationOutcome;
      if ((outcome?.invoicesGenerated ?? 0) > 0) {
        toast.success(
          t("leases.installments.generated", {
            defaultValue: "Installments billed: {count}",
            values: { count: outcome.invoicesGenerated },
          }),
        );
      }
      await load();
      // Some billed and some not: show both, never a plain success. Set
      // after the reload, which clears the banner.
      const problems = outcome?.errors ?? [];
      if (problems.length > 0) {
        setError(`${failed}: ${problems.join(" · ")}`);
      }
    } catch (generateError) {
      console.error("Failed to generate installments:", generateError);
      setError(failed);
    } finally {
      setBusy(false);
    }
  }, [leaseId, load, t]);

  /** "Installment 3" — the review's own wording, twice over. */
  const installmentLabel = useCallback(
    (index: number) =>
      t("leases.installments.numbered", {
        defaultValue: "Installment {index}",
        values: { index },
      }),
    [t],
  );

  /**
   * A row's description in the reader's language. The generators stored
   * English ("Monthly Rent", "Security Deposit"); a description typed by
   * hand is shown as typed. The period is printed beside an installment
   * already, so only a charge's own text carries it.
   */
  const scheduleFrequency = schedule?.summary?.frequency;
  const chargeText = useCallback(
    (row: InstallmentRow) =>
      describeCharge(
        { description: row.description, frequency: scheduleFrequency },
        language,
      ),
    [language, scheduleFrequency],
  );

  /** How a row is named in dialogs: "Installment 3", or a charge by its description. */
  const rowName = useCallback(
    (row: InstallmentRow) =>
      row.source === "manual" || row.source === "orphaned"
        ? chargeText(row)
        : installmentLabel(row.index),
    [installmentLabel, chargeText],
  );

  const showActions = rights.recordPayments || rights.editInstallments;

  /**
   * The money and status columns, the same for installments and charges:
   * due date, amount, paid, remaining, status — visible at every width. The
   * paid figure and a small "left" line used to fold away below tablet size,
   * which on a phone left an amount and a status with nothing between them.
   */
  const moneyColumns: DataTableColumn<InstallmentRow>[] = useMemo(
    () => [
      {
        id: "dueDate",
        header: t("leases.installments.dueDate", { defaultValue: "Due date" }),
        cell: (row) => (
          <div className="flex items-center gap-2 whitespace-nowrap text-sm">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {formatDate(row.dueDate)}
          </div>
        ),
        width: "min-w-[130px]",
      },
      {
        id: "amount",
        header: t("leases.installments.amount", { defaultValue: "Amount" }),
        cell: (row) => (
          <div className="text-end text-sm">
            <span className="whitespace-nowrap font-medium">
              {formatCurrency(row.totalAmount)}
            </span>
            {row.taxAmount > 0 && (
              <span className="block whitespace-nowrap text-xs text-muted-foreground">
                {t("leases.installments.inclTax", {
                  defaultValue: "incl. {tax} tax",
                  values: { tax: formatCurrency(row.taxAmount) },
                })}
              </span>
            )}
          </div>
        ),
        align: "right",
        width: "min-w-[120px]",
      },
      {
        id: "paid",
        header: t("leases.installments.paid", { defaultValue: "Paid" }),
        cell: (row) => (
          <span className="whitespace-nowrap text-sm">
            {row.state === "cancelled" ? "—" : formatCurrency(row.amountPaid)}
          </span>
        ),
        align: "right",
        width: "min-w-[110px]",
      },
      {
        id: "remaining",
        header: t("leases.installments.remaining", {
          defaultValue: "Remaining",
        }),
        cell: (row) =>
          row.state === "cancelled" ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <span
              className={`whitespace-nowrap text-sm ${
                row.balanceRemaining > 0 && row.state !== "planned"
                  ? "font-medium"
                  : "text-muted-foreground"
              }`}
            >
              {formatCurrency(row.balanceRemaining)}
            </span>
          ),
        align: "right",
        width: "min-w-[110px]",
      },
      {
        id: "state",
        header: t("leases.installments.status", { defaultValue: "Status" }),
        cell: (row) => (
          <Badge
            variant="outline"
            className={`whitespace-nowrap text-xs font-normal ${LABEL_STYLES[rowLabel(row)]}`}
          >
            {stateLabel(row)}
          </Badge>
        ),
        width: "min-w-[120px]",
      },
      ...(showActions
        ? [
            {
              id: "actions",
              header: "",
              cell: (row: InstallmentRow) =>
                // A planned row has no invoice yet, so there is nothing to
                // settle or edit; generate the schedule first.
                row.invoiceId && row.state !== "cancelled" ? (
                  <div className="flex items-center justify-end gap-1">
                    {/* Settle from here rather than from the payments screen.
                        Offered while anything is still owed, so a partly paid
                        installment can take the rest. */}
                    {rights.recordPayments && row.balanceRemaining > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                        onClick={() => setSettling(row)}
                        title={t("leases.installments.settle", {
                          defaultValue: "Record a payment",
                        })}
                        aria-label={t("leases.installments.settle", {
                          defaultValue: "Record a payment",
                        })}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {rights.editInstallments && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setEditing(row)}
                        title={t("leases.installments.editTitle", {
                          defaultValue: "Edit installment",
                        })}
                        aria-label={t("leases.installments.editTitle", {
                          defaultValue: "Edit installment",
                        })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {/* Removing an installment changes what the contract
                        bills, so it asks first — the review wants
                        confirmation on every financial deletion. */}
                    {rights.editInstallments && row.amountPaid === 0 && (
                      <ConfirmationDialog
                        title={t("leases.installments.removeConfirm.title", {
                          defaultValue: "Remove {installment}?",
                          values: { installment: rowName(row) },
                        })}
                        description={t(
                          "leases.installments.removeConfirm.description",
                          {
                            defaultValue:
                              "{amount} due on {date} will no longer be billed to the tenant.",
                            values: {
                              amount: formatCurrency(row.totalAmount),
                              date: formatDate(row.dueDate),
                            },
                          },
                        )}
                        confirmText={t("leases.installments.removeConfirm.confirm", {
                          defaultValue: "Remove",
                        })}
                        cancelText={t("common.cancel", { defaultValue: "Cancel" })}
                        variant="destructive"
                        onConfirm={() => removeInstallment(row)}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive"
                          aria-label={t("leases.installments.removeConfirm.confirm", {
                            defaultValue: "Remove",
                          })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </ConfirmationDialog>
                    )}
                  </div>
                ) : null,
              width: "w-32",
              align: "right" as const,
            },
          ]
        : []),
    ],
    [
      t,
      formatCurrency,
      formatDate,
      stateLabel,
      removeInstallment,
      rowName,
      showActions,
      rights.recordPayments,
      rights.editInstallments,
    ],
  );

  const installmentColumns: DataTableColumn<InstallmentRow>[] = useMemo(
    () => [
      {
        id: "index",
        header: t("leases.installments.installment", {
          defaultValue: "Installment",
        }),
        cell: (row) => (
          <span className="whitespace-nowrap text-sm font-medium">
            {installmentLabel(row.index)}
          </span>
        ),
        width: "min-w-[110px]",
      },
      {
        id: "period",
        header: t("leases.installments.period", { defaultValue: "Period" }),
        cell: (row) => (
          <div className="text-sm">
            {row.periodStart ? (
              <>
                <span>{formatDate(row.periodStart)}</span>
                {row.periodEnd && (
                  <span className="text-muted-foreground">
                    {" – "}
                    {formatDate(row.periodEnd)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">
                {t("leases.installments.oneOff", { defaultValue: "One-off" })}
              </span>
            )}
            <span className="block text-xs text-muted-foreground">
              {chargeText(row)}
            </span>
          </div>
        ),
        visibility: "md",
        width: "min-w-[200px]",
      },
      ...moneyColumns,
    ],
    [t, formatDate, installmentLabel, moneyColumns, chargeText],
  );

  const chargeColumns: DataTableColumn<InstallmentRow>[] = useMemo(
    () => [
      {
        id: "charge",
        header: t("leases.installments.charges.charge", {
          defaultValue: "Charge",
        }),
        cell: (row) => (
          <div className="text-sm">
            <span className="font-medium">{chargeText(row)}</span>
            <span className="block text-xs text-muted-foreground">
              {[
                row.invoiceNumber,
                row.source === "orphaned"
                  ? t("leases.installments.charges.earlierTerms", {
                      defaultValue: "Billed under earlier terms",
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ),
        width: "min-w-[180px]",
      },
      ...moneyColumns,
    ],
    [t, moneyColumns, chargeText],
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("leases.installments.stats.total", {
            defaultValue: "Installments",
          })}
          value={String(summary?.totalInstallments ?? 0)}
          icon={Receipt}
          iconColor="primary"
          description={
            summary
              ? t("leases.installments.stats.frequency", {
                  defaultValue: "{frequency} schedule",
                  values: {
                    frequency: t(
                      `leases.contract.frequency.${summary.frequency}`,
                      { defaultValue: FREQUENCY_LABELS[summary.frequency] },
                    ),
                  },
                })
              : undefined
          }
        />
        <AnalyticsCard
          title={t("leases.installments.stats.paid", { defaultValue: "Paid" })}
          value={String(summary?.paidCount ?? 0)}
          icon={CheckCircle2}
          iconColor="success"
          description={
            summary
              ? t("leases.installments.stats.collected", {
                  defaultValue: "{amount} collected",
                  values: { amount: formatCurrency(summary.collectedTotal) },
                })
              : undefined
          }
        />
        <AnalyticsCard
          title={t("leases.installments.stats.overdue", {
            defaultValue: "Overdue",
          })}
          value={String(summary?.overdueCount ?? 0)}
          icon={AlertTriangle}
          iconColor="error"
          description={
            summary
              ? formatCurrency(summary.overdueTotal)
              : undefined
          }
        />
        <AnalyticsCard
          title={t("leases.installments.stats.outstanding", {
            defaultValue: "Outstanding",
          })}
          value={formatCurrency(summary?.outstandingTotal ?? 0)}
          icon={Clock}
          iconColor="warning"
          description={
            summary
              ? t("leases.installments.stats.contractValue", {
                  defaultValue: "{value} contract value",
                  values: { value: formatCurrency(summary.contractValue) },
                })
              : undefined
          }
        />
      </AnalyticsCardGrid>

      {/* A contract in force with installments nobody has billed: say so,
          and offer the way out. It used to be a dead end — the rows could
          not be settled or edited and no screen could bill them. */}
      {canGenerate && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <p className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              {t("leases.installments.unbilledNotice", {
                defaultValue:
                  "Some installments of this contract ({count}) are not billed yet, so they cannot be paid or edited.",
                values: { count: unbilledCount },
              })}
              {unbilledPastDueCount > 0 && (
                <span className="mt-1 block font-medium">
                  {t("leases.installments.unbilledPastDue", {
                    defaultValue:
                      "Installments already past their due date: {count}. They are not counted as overdue until they are billed.",
                    values: { count: unbilledPastDueCount },
                  })}
                </span>
              )}
            </span>
          </p>
          <Button
            size="sm"
            onClick={() => setConfirmingGenerate(true)}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ListPlus className="h-4 w-4" />
            )}
            {t("leases.installments.generate", {
              defaultValue: "Generate installments",
            })}
          </Button>
        </div>
      )}

      {/* A draft is not billed, by design; tell the office when it will be. */}
      {!readOnly && unbilledCount > 0 && awaitsActivation(leaseStatus) && (
        <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {t("leases.installments.billedOnActivation", {
            defaultValue:
              "Installments are billed when the contract becomes active.",
          })}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              {t("leases.installments.title", {
                defaultValue: "Installment schedule",
              })}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {/* One contract's schedule as a file — the endpoint resolves the
                  lease under the caller's scope, so an export can only ever
                  hold this contract's installments. */}
              {rights.exportSchedule && (
                <ReportExportButton
                  endpoint={`/api/leases/${leaseId}/installments`}
                  params={new URLSearchParams()}
                />
              )}
              {summary?.taxEnabled && (
                <Badge variant="outline" className="text-xs font-normal">
                  {t("leases.installments.taxBadge", {
                    defaultValue: "Tax {rate}%",
                    values: { rate: summary.taxRate },
                  })}
                </Badge>
              )}
              {rights.editInstallments && (
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                  <Plus className="h-4 w-4" />
                  {t("leases.installments.addCharge", {
                    defaultValue: "Add charge",
                  })}
                </Button>
              )}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={installmentColumns}
            data={installments}
            loading={loading || busy}
            getRowKey={(row) => `installment-${row.index}`}
            emptyState={{
              icon: <Receipt className="h-10 w-10 text-muted-foreground" />,
              title: t("leases.installments.empty.title", {
                defaultValue: "No installments yet",
              }),
              description: t("leases.installments.empty.description", {
                defaultValue:
                  "Set the contract's rent, term and frequency to build a schedule",
              }),
            }}
          />
        </CardContent>
      </Card>

      {/* Charges billed on the contract outside its schedule. Listed apart
          so that the schedule's numbering never moves: they used to sit
          between the installments, sorted by date, and push every number
          after them up by one. */}
      {charges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-col gap-1 text-base">
              <span className="flex items-center gap-2">
                <ListPlus className="h-4 w-4" />
                {t("leases.installments.charges.title", {
                  defaultValue: "Other charges on this contract",
                })}
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                {t("leases.installments.charges.description", {
                  defaultValue:
                    "Charged in addition to the installment schedule. Paid and recorded the same way.",
                })}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={chargeColumns}
              data={charges}
              loading={loading || busy}
              getRowKey={(row) => row.invoiceId ?? `charge-${row.index}`}
            />
          </CardContent>
        </Card>
      )}

      {/* An installment IS an invoice here, so the payments screen's own
          dialog settles it — same validation, same partial-payment rule,
          same fields (date, method, amount, reference, notes). */}
      <PaymentRecordDialog
        open={settling !== null}
        onOpenChange={(open) => !open && setSettling(null)}
        invoice={
          settling?.invoiceId
            ? {
                _id: settling.invoiceId,
                invoiceNumber: settling.invoiceNumber
                  ? `${rowName(settling)} · ${settling.invoiceNumber}`
                  : rowName(settling),
                totalAmount: settling.totalAmount,
                amountPaid: settling.amountPaid,
                balanceRemaining: settling.balanceRemaining,
              }
            : null
        }
        onPaymentRecorded={() => {
          setSettling(null);
          void load();
        }}
      />

      {/* Generating asks first, with the count and the amount: it writes a
          row per installment, and the overdue ones land in the arrears
          reports the moment they exist. A plain dialog rather than the
          confirmation component, whose button is the destructive red. */}
      <Dialog open={confirmingGenerate} onOpenChange={setConfirmingGenerate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("leases.installments.generateConfirm.title", {
                defaultValue: "Generate the installments not billed yet?",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("leases.installments.generateConfirm.description", {
                defaultValue:
                  "Installments to bill: {count}, worth {amount} in total. Installments already billed are left as they are.",
                values: {
                  count: unbilledCount,
                  amount: formatCurrency(unbilledTotal),
                },
              })}
              {offScheduleCount > 0 && (
                <span className="mt-2 block">
                  {t("leases.installments.generateConfirm.offSchedule", {
                    defaultValue:
                      "This contract also has charges outside its schedule ({count}). They stay as they are, so check that they do not already cover the same periods.",
                    values: { count: offScheduleCount },
                  })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingGenerate(false)}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            {/* Closes at once: the figures above describe what is about to
                be billed, and would read "0" the moment it has been. The
                schedule itself shows the work in progress. */}
            <Button
              onClick={() => {
                setConfirmingGenerate(false);
                void generateInstallments();
              }}
            >
              {t("leases.installments.generate", {
                defaultValue: "Generate installments",
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditInstallmentDialog
        leaseId={leaseId}
        installment={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
        onError={setError}
      />

      <AddInstallmentDialog
        leaseId={leaseId}
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={async () => {
          setAdding(false);
          await load();
        }}
        onError={setError}
      />
    </div>
  );
}

function EditInstallmentDialog({
  leaseId,
  installment,
  onClose,
  onSaved,
  onError,
}: {
  leaseId: string;
  installment: InstallmentRow | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useLocalizationContext();
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!installment) return;
    setAmount(String(installment.subtotal));
    setDueDate(toDateInputValue(installment.dueDate));
    setDescription(installment.description);
  }, [installment]);

  const save = async () => {
    if (!installment?.invoiceId) return;
    setSaving(true);
    try {
      const response = await fetch(
        `/api/leases/${leaseId}/installments/${installment.invoiceId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Number(amount),
            dueDate,
            description,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || !result?.success) {
        onError(
        result?.error ??
          t("leases.installments.errors.update", { defaultValue: "Could not update the installment" }),
      );
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!installment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("leases.installments.editTitle", {
              defaultValue: "Edit installment",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("leases.installments.editDescription", {
              defaultValue:
                "Tax is recalculated from the new amount using the contract's rate.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-description">
              {t("leases.installments.descriptionLabel", {
                defaultValue: "Description",
              })}
            </Label>
            <Input
              id="edit-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-amount">
                {t("leases.installments.amountLabel", {
                  defaultValue: "Amount (before tax)",
                })}
              </Label>
              <Input
                id="edit-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-due">
                {t("leases.installments.dueDate", { defaultValue: "Due date" })}
              </Label>
              <Input
                id="edit-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("common.saveChanges", { defaultValue: "Save changes" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddInstallmentDialog({
  leaseId,
  open,
  onClose,
  onSaved,
  onError,
}: {
  leaseId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useLocalizationContext();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDescription("");
    setAmount("");
    setDueDate("");
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/leases/${leaseId}/installments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          amount: Number(amount),
          dueDate,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        onError(
        result?.error ??
          t("leases.installments.errors.add", { defaultValue: "Could not add the installment" }),
      );
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const canSave = description.trim() && Number(amount) > 0 && dueDate;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("leases.installments.addChargeTitle", {
              defaultValue: "Add a charge",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("leases.installments.addChargeDescription", {
              defaultValue:
                "A one-off charge outside the installment schedule, listed under the contract's other charges. The contract's tax rate is applied automatically.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="add-description">
              {t("leases.installments.descriptionLabel", {
                defaultValue: "Description",
              })}
            </Label>
            <Input
              id="add-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("leases.installments.descriptionPlaceholder", {
                defaultValue: "Maintenance contribution",
              })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="add-amount">
                {t("leases.installments.amountLabel", {
                  defaultValue: "Amount (before tax)",
                })}
              </Label>
              <Input
                id="add-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-due">
                {t("leases.installments.dueDate", { defaultValue: "Due date" })}
              </Label>
              <Input
                id="add-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button onClick={save} disabled={saving || !canSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("leases.installments.addCharge", { defaultValue: "Add charge" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
