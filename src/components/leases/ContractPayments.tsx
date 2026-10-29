"use client";

/**
 * PropertyPro - A contract's payments
 *
 * The contract page's Payments tab, rebuilt around the installment schedule.
 *
 * What it replaced read everything off payment rows: its totals added up
 * whatever payment rows happened to exist (a 12,000 contract with one month
 * paid read "2,000 due, 50% paid"), its "create payment" button wrote a
 * pending row tied to no installment, and its "process" button called the
 * tenant's own payment portal — which refuses staff, so every attempt ended
 * in "Failed to process payment", the error the client review opens its
 * payments section with.
 *
 * Here the figures come from the schedule, every payment is recorded against
 * a chosen installment through the same path the schedule's own settle
 * button uses, and each row says which installment it paid. Rows the old
 * button left behind are shown for what they are and can be attached to an
 * installment or removed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Eye,
  Link2,
  Plus,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { ReportExportButton } from "@/components/reports/export-button";
import PaymentRecordDialog, {
  type InstallmentChoice,
} from "@/components/invoice/PaymentRecordDialog";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { paymentMethodLabel } from "@/lib/payments/methods";
import { describeCharge, describeChargeNote } from "@/lib/i18n/charge-description";
import {
  recordedByText,
  type PaymentRecorderFields,
} from "@/lib/payments/recorder";
import { showApiErrorToast } from "@/lib/toast-notifications";
import type {
  InstallmentRow,
  InstallmentSchedule as Schedule,
} from "@/types/installment";

/**
 * A payment row as `/api/payments` returns it — only what this tab reads.
 * `recordedBy` arrives for staff only.
 */
interface ContractPaymentRow extends PaymentRecorderFields {
  _id: string;
  amount: number;
  amountPaid?: number | null;
  status: string;
  paymentMethod?: string | null;
  paidDate?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  description?: string | null;
  notes?: string | null;
  invoiceId?: string | null;
  paymentHistory?: Array<{
    event?: string;
    reference?: string;
  }> | null;
}

/** Statuses that mean no money has been taken on the row yet. */
const UNPAID_STATUSES = new Set(["pending", "overdue", "failed"]);

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-success/10 text-success border-success/20",
  partial: "bg-info/10 text-info border-info/20",
  pending: "bg-warning/10 text-warning border-warning/20",
  overdue: "bg-error/10 text-error border-error/20",
  failed: "bg-error/10 text-error border-error/20",
  refunded: "bg-muted text-muted-foreground border-muted",
  cancelled: "bg-muted text-muted-foreground border-muted line-through",
};

/** The reference the office typed when the money was recorded, if any. */
function referenceOf(payment: ContractPaymentRow): string | undefined {
  const history = Array.isArray(payment.paymentHistory)
    ? payment.paymentHistory
    : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.reference) return entry.reference;
  }
  return undefined;
}

interface ContractPaymentsProps {
  leaseId: string;
  /** The tenant's own view: figures and history, nothing to act on. */
  readOnly?: boolean;
  /** Told when money moves, so the rest of the contract page can refresh. */
  onChanged?: () => void;
}

export function ContractPayments({
  leaseId,
  readOnly = false,
  onChanged,
}: ContractPaymentsProps) {
  const { t, formatCurrency, formatDate, language } = useLocalizationContext();

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [payments, setPayments] = useState<ContractPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The dialog, and — when attaching an old unlinked row — which row. */
  const [recording, setRecording] = useState<{
    convert?: ContractPaymentRow;
  } | null>(null);

  // The rights the server worked out for this viewer, sent with the
  // schedule: the permissions the recording and deleting routes ask for,
  // with any grant or denial made for this one person. The browser's copy of
  // the role's permissions does not know about those.
  const canRecord = !readOnly && Boolean(schedule?.viewer?.recordPayments);
  const canDelete = !readOnly && Boolean(schedule?.viewer?.deletePayments);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [scheduleResponse, paymentsResponse] = await Promise.all([
        fetch(`/api/leases/${leaseId}/installments`),
        fetch(`/api/payments?leaseId=${leaseId}&limit=100`),
      ]);
      const [schedulePayload, paymentsPayload] = await Promise.all([
        scheduleResponse.json().catch(() => null),
        paymentsResponse.json().catch(() => null),
      ]);
      if (!schedulePayload?.success || !paymentsPayload?.success) {
        setError(
          t("leases.contractPayments.errors.load", {
            defaultValue: "Could not load this contract's payments",
          }),
        );
        return;
      }
      setSchedule(schedulePayload.data as Schedule);
      setPayments((paymentsPayload.data ?? []) as ContractPaymentRow[]);
      setError(null);
    } catch (loadError) {
      console.error("Failed to load contract payments:", loadError);
      setError(
        t("leases.contractPayments.errors.load", {
          defaultValue: "Could not load this contract's payments",
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [leaseId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const installmentLabel = useCallback(
    (index: number) =>
      t("leases.installments.numbered", {
        defaultValue: "Installment {index}",
        values: { index },
      }),
    [t],
  );

  /**
   * How a row of the schedule is named: "Installment 3" by its place in the
   * schedule, or a charge added by hand by its description.
   */
  const rowName = useCallback(
    (row: InstallmentRow) =>
      row.source === "manual" || row.source === "orphaned"
        ? // A generated wording ("Security Deposit") in the reader's language;
          // a description typed by hand as typed.
          describeCharge({ description: row.description }, language)
        : installmentLabel(row.index),
    [installmentLabel, language],
  );

  /** Everything payable on the contract: its installments, then its charges. */
  const payable = useMemo(
    () => [...(schedule?.installments ?? []), ...(schedule?.charges ?? [])],
    [schedule],
  );

  /** invoice id → its row in the schedule, to name the installment a payment paid. */
  const byInvoice = useMemo(() => {
    const map = new Map<string, InstallmentRow>();
    for (const row of payable) {
      if (row.invoiceId) map.set(row.invoiceId, row);
    }
    return map;
  }, [payable]);

  /** Installments and charges that can still take money, oldest first. */
  const openInstallments: InstallmentChoice[] = useMemo(
    () =>
      payable
        .filter(
          (row) =>
            row.invoiceId &&
            row.balanceRemaining > 0 &&
            row.state !== "cancelled",
        )
        .sort(
          (a, b) =>
            new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
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
        })),
    [payable, rowName],
  );

  /** The next installment still owed that is not already late. */
  const nextDue = useMemo(
    () =>
      payable
        .filter(
          (row) =>
            row.balanceRemaining > 0 &&
            row.state !== "cancelled" &&
            row.state !== "overdue",
        )
        .sort(
          (a, b) =>
            new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
        )[0],
    [payable],
  );

  const isUnlinked = (payment: ContractPaymentRow) =>
    !payment.invoiceId &&
    Number(payment.amountPaid ?? 0) === 0 &&
    UNPAID_STATUSES.has(payment.status);

  const methodLabel = useCallback(
    (method?: string | null) => paymentMethodLabel(method, t) || "—",
    [t],
  );

  const deletePayment = useCallback(
    async (payment: ContractPaymentRow) => {
      const response = await fetch(`/api/payments/${payment._id}`, {
        method: "DELETE",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        showApiErrorToast(
          result,
          t("leases.contractPayments.toasts.deleteFailed", {
            defaultValue: "Could not delete the payment",
          }),
        );
        return;
      }
      toast.success(
        t("leases.contractPayments.toasts.deleted", {
          defaultValue:
            "Payment deleted and moved to the archive. Its installment is owed again.",
        }),
      );
      await load();
      onChanged?.();
    },
    [load, onChanged, t],
  );

  const columns: DataTableColumn<ContractPaymentRow>[] = useMemo(
    () => [
      {
        id: "installment",
        header: t("leases.contractPayments.columns.installment", {
          defaultValue: "Installment",
        }),
        cell: (payment) => {
          const row = payment.invoiceId
            ? byInvoice.get(payment.invoiceId)
            : undefined;
          if (row) {
            return (
              <div className="text-sm">
                <span className="font-medium">{rowName(row)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("leases.contractPayments.dueOn", {
                    defaultValue: "Due {date}",
                    values: { date: formatDate(row.dueDate) },
                  })}
                </span>
              </div>
            );
          }
          return isUnlinked(payment) ? (
            <Badge
              variant="outline"
              className="border-warning/30 bg-warning/10 text-xs font-normal text-warning"
            >
              {t("leases.contractPayments.unlinked", {
                defaultValue: "Not linked to an installment",
              })}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          );
        },
        width: "min-w-[150px]",
      },
      {
        id: "paidDate",
        header: t("leases.contractPayments.columns.paidDate", {
          defaultValue: "Payment date",
        }),
        cell: (payment) => (
          <span className="text-sm">
            {payment.paidDate ? formatDate(payment.paidDate) : "—"}
          </span>
        ),
        width: "min-w-[120px]",
      },
      {
        id: "method",
        header: t("leases.contractPayments.columns.method", {
          defaultValue: "Method",
        }),
        cell: (payment) => (
          <span className="text-sm">{methodLabel(payment.paymentMethod)}</span>
        ),
        visibility: "md",
        width: "min-w-[130px]",
      },
      // The office's own information: the tenant's read-only view leaves it out.
      ...(readOnly
        ? []
        : [
            {
              id: "recordedBy",
              header: t("leases.contractPayments.columns.recordedBy", {
                defaultValue: "Recorded by",
              }),
              cell: (payment: ContractPaymentRow) => (
                <span className="text-sm">
                  {recordedByText(
                    payment,
                    t("payments.table.recordedOnline", {
                      defaultValue: "Online",
                    }),
                  ) ?? "—"}
                </span>
              ),
              visibility: "lg" as const,
              width: "min-w-[130px]",
            },
          ]),
      {
        id: "reference",
        header: t("leases.contractPayments.columns.reference", {
          defaultValue: "Reference",
        }),
        cell: (payment) => (
          <div className="max-w-[220px] text-sm">
            <span className="font-mono text-xs">
              {referenceOf(payment) ?? "—"}
            </span>
            {payment.notes && (
              <span
                className="block truncate text-xs text-muted-foreground"
                title={describeChargeNote(payment.notes, language)}
              >
                {describeChargeNote(payment.notes, language)}
              </span>
            )}
          </div>
        ),
        visibility: "lg",
      },
      {
        id: "amount",
        header: t("leases.contractPayments.columns.amount", {
          defaultValue: "Amount",
        }),
        cell: (payment) => {
          const received = Number(payment.amountPaid ?? 0);
          return (
            <span className="text-sm font-medium">
              {formatCurrency(received > 0 ? received : payment.amount)}
            </span>
          );
        },
        align: "right",
        width: "min-w-[120px]",
      },
      {
        id: "status",
        header: t("leases.contractPayments.columns.status", {
          defaultValue: "Status",
        }),
        cell: (payment) => (
          <Badge
            variant="outline"
            className={`text-xs font-normal ${STATUS_STYLES[payment.status] ?? ""}`}
          >
            {t(`leases.details.payments.status.${payment.status}`, {
              defaultValue: payment.status,
            })}
          </Badge>
        ),
        width: "min-w-[110px]",
      },
      {
        id: "actions",
        header: "",
        cell: (payment) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title={t("leases.contractPayments.actions.view", {
                defaultValue: "View payment",
              })}
            >
              <Link href={`/dashboard/payments/${payment._id}`}>
                <Eye className="h-3.5 w-3.5" />
              </Link>
            </Button>
            {canRecord && isUnlinked(payment) && openInstallments.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                onClick={() => setRecording({ convert: payment })}
                title={t("leases.contractPayments.actions.attach", {
                  defaultValue: "Record against an installment",
                })}
                aria-label={t("leases.contractPayments.actions.attach", {
                  defaultValue: "Record against an installment",
                })}
              >
                <Link2 className="h-3.5 w-3.5" />
              </Button>
            )}
            {canDelete && payment.status !== "cancelled" && (
              <ConfirmationDialog
                title={t("leases.contractPayments.deleteConfirm.title", {
                  defaultValue: "Delete this payment?",
                })}
                description={
                  Number(payment.amountPaid ?? 0) > 0
                    ? t("leases.contractPayments.deleteConfirm.withMoney", {
                        defaultValue:
                          "{amount} comes back off the installment it paid, which will read as owed again. The payment moves to the archive. Record the correct payment afterwards.",
                        values: {
                          amount: formatCurrency(Number(payment.amountPaid)),
                        },
                      })
                    : t("leases.contractPayments.deleteConfirm.noMoney", {
                        defaultValue:
                          "This entry has no money recorded on it. It moves to the archive.",
                      })
                }
                confirmText={t("leases.contractPayments.deleteConfirm.confirm", {
                  defaultValue: "Delete payment",
                })}
                cancelText={t("common.cancel", { defaultValue: "Cancel" })}
                variant="destructive"
                onConfirm={() => deletePayment(payment)}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-destructive"
                  aria-label={t("leases.contractPayments.deleteConfirm.confirm", {
                    defaultValue: "Delete payment",
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </ConfirmationDialog>
            )}
          </div>
        ),
        align: "right",
        width: "w-28",
      },
    ],
    // isUnlinked and referenceOf read only their argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      byInvoice,
      rowName,
      formatDate,
      formatCurrency,
      methodLabel,
      canRecord,
      canDelete,
      openInstallments.length,
      deletePayment,
      readOnly,
      language,
    ],
  );

  const summary = schedule?.summary;
  const unlinkedCount = payments.filter(isUnlinked).length;

  // Newest money first; an unlinked entry sorts by when it was created.
  const rows = useMemo(
    () =>
      [...payments].sort((a, b) => {
        const at = (payment: ContractPaymentRow) =>
          new Date(
            payment.paidDate ?? payment.createdAt ?? payment.dueDate ?? 0,
          ).getTime();
        return at(b) - at(a);
      }),
    [payments],
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
          title={t("leases.contractPayments.stats.contractValue", {
            defaultValue: "Contract value",
          })}
          value={formatCurrency(summary?.contractValue ?? 0)}
          icon={Receipt}
          iconColor="primary"
          description={
            summary
              ? t("leases.contractPayments.stats.installments", {
                  defaultValue: "Installments: {count}",
                  values: { count: summary.totalInstallments },
                })
              : undefined
          }
        />
        <AnalyticsCard
          title={t("leases.contractPayments.stats.collected", {
            defaultValue: "Collected",
          })}
          value={formatCurrency(summary?.collectedTotal ?? 0)}
          icon={CheckCircle2}
          iconColor="success"
          description={
            summary
              ? t("leases.contractPayments.stats.paidInstallments", {
                  defaultValue: "Paid installments: {count}",
                  values: { count: summary.paidCount },
                })
              : undefined
          }
        />
        <AnalyticsCard
          title={t("leases.contractPayments.stats.overdue", {
            defaultValue: "Overdue",
          })}
          value={formatCurrency(summary?.overdueTotal ?? 0)}
          icon={AlertTriangle}
          iconColor="error"
          description={
            summary
              ? t("leases.contractPayments.stats.overdueInstallments", {
                  defaultValue: "Late installments: {count}",
                  values: { count: summary.overdueCount },
                })
              : undefined
          }
        />
        <AnalyticsCard
          title={t("leases.contractPayments.stats.nextDue", {
            defaultValue: "Next due",
          })}
          value={nextDue ? formatCurrency(nextDue.balanceRemaining) : "—"}
          icon={nextDue ? CalendarClock : Clock}
          iconColor="warning"
          description={
            nextDue
              ? t("leases.contractPayments.stats.nextDueOn", {
                  defaultValue: "{installment} on {date}",
                  values: {
                    installment: rowName(nextDue),
                    date: formatDate(nextDue.dueDate),
                  },
                })
              : t("leases.contractPayments.stats.nothingDue", {
                  defaultValue: "Nothing left to pay",
                })
          }
        />
      </AnalyticsCardGrid>

      {canRecord && unlinkedCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            {t("leases.contractPayments.unlinkedNotice", {
              defaultValue:
                "Some payment entries on this contract ({count}) are not linked to any installment, so the schedule does not count them. Attach each one to the installment it was for, or delete it.",
              values: { count: unlinkedCount },
            })}
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              {t("leases.contractPayments.title", {
                defaultValue: "Payments on this contract",
              })}
            </span>
            <span className="flex items-center gap-2">
              <ReportExportButton
                endpoint="/api/payments"
                params={new URLSearchParams({ leaseId })}
              />
              {canRecord && (
                <Button
                  size="sm"
                  onClick={() => setRecording({})}
                  disabled={openInstallments.length === 0}
                >
                  <Plus className="h-4 w-4" />
                  {t("leases.contractPayments.record", {
                    defaultValue: "Record payment",
                  })}
                </Button>
              )}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            getRowKey={(payment) => payment._id}
            emptyState={{
              icon: <Wallet className="h-10 w-10 text-muted-foreground" />,
              title: t("leases.contractPayments.empty.title", {
                defaultValue: "No payments recorded yet",
              }),
              description: t("leases.contractPayments.empty.description", {
                defaultValue:
                  "Payments recorded against this contract's installments appear here.",
              }),
            }}
          />
        </CardContent>
      </Card>

      <PaymentRecordDialog
        open={recording !== null}
        onOpenChange={(open) => !open && setRecording(null)}
        installments={openInstallments}
        convertPaymentId={recording?.convert?._id}
        initialAmount={recording?.convert?.amount}
        onPaymentRecorded={() => {
          setRecording(null);
          void load();
          onChanged?.();
        }}
      />
    </div>
  );
}
