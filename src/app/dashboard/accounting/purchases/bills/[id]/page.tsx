"use client";

/**
 * PropertyPro - One purchase bill
 *
 * The supplier's bill as entered: who sent it and when it falls due, each
 * line with the account it is charged to, its VAT and the building and unit
 * it belongs to, the totals, and the payment vouchers that paid it. From here
 * it is approved, sent back, cancelled, changed or paid, as far as its state
 * and the reader's rights allow.
 */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { Ban, CheckCircle2, Pencil, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";
import type { BillLineView, BillView } from "@/lib/accounting/purchases/types";
import { cn } from "@/lib/utils";
import { LedgerHeader, Money } from "../../../setup/_shared/ledger-parts";
import { accountName } from "../../../setup/_shared/ledger-ui";
import {
  BillStatusBadge,
  VAT_CATEGORY_TEXT,
  VOUCHER_STATUS_TEXT,
  VoucherStatusBadge,
  purchasesRequest,
  useLedgerError,
  useLedgerText,
  usePurchasesAccess,
} from "../../_shared/purchases-ui";
import {
  BackToBills,
  NoBillAccess,
  PurchasesUnavailable,
  StateCard,
  allowedBillActions,
  billHref,
  payBillHref,
  useBillActions,
} from "../_parts/bill-form";

function Detail({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", strong && "font-semibold")}>
      <dt className={cn(!strong && "text-muted-foreground")}>{label}</dt>
      <dd>
        <Money value={value} className="tabular-nums" />
      </dd>
    </div>
  );
}

/** A rate as the bill stores it, without trailing zeros. */
function rateText(rate: number): string {
  return String(Math.round(rate * 100) / 100);
}

type BillPayment = NonNullable<BillView["payments"]>[number];

const NO_PAYMENTS: BillPayment[] = [];

function costCentre(line: BillLineView): string {
  return [line.propertyName, line.unitName].filter(Boolean).join(" / ") || "—";
}

export default function PurchaseBillPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const access = usePurchasesAccess();
  const { tx, text, language, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const [bill, setBill] = useState<BillView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ code: string | null; message: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const actions = useBillActions((updated) => {
    // The action routes answer with the whole bill; anything else is read again.
    if (updated?.lines) setBill(updated);
    else setVersion((value) => value + 1);
  });

  useEffect(() => {
    if (!access.canView || !id) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      const response = await purchasesRequest<BillView>(`/bills/${encodeURIComponent(id)}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.ok && response.data) {
        setBill(response.data);
        setFailure(null);
      } else {
        setBill(null);
        setFailure({ code: response.code, message: response.message });
      }
      setLoading(false);
    })();
    return () => controller.abort();
  }, [access.canView, id, version]);

  // The payments sort by any column. The lines above do not: they are the
  // bill as the supplier wrote it, in its own order.
  const paymentSort = useTableSort(bill?.payments ?? NO_PAYMENTS, {
    voucher: (payment) => payment.voucherNumber,
    date: (payment) => new Date(payment.voucherDate),
    amount: (payment) => payment.amount,
    status: (payment) => text(VOUCHER_STATUS_TEXT[payment.status] ?? VOUCHER_STATUS_TEXT.posted),
  });

  if (access.loading) return null;
  if (!access.canView) return <NoBillAccess />;
  if (failure?.code === "PURCHASES_UNAVAILABLE") return <PurchasesUnavailable />;

  if (!bill) {
    return (
      <div className="space-y-4">
        <LedgerHeader title={tx("purchases.bills.detailTitle", "Purchase bill")} actions={<BackToBills />} />
        <StateCard
          body={loading || !failure ? tx("ledger.common.loading", "Loading…") : describeError(failure)}
        />
      </div>
    );
  }

  const allowed = allowedBillActions(bill, access);
  const busy = actions.busyId === bill.id;
  const lines = bill.lines ?? [];
  const payments = paymentSort.rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            <span>{tx("purchases.bills.detailTitle", "Purchase bill")}</span>
            <span className="font-mono" dir="ltr">
              {bill.displayNumber}
            </span>
            <BillStatusBadge status={bill.status} overdue={bill.overdue} />
          </h1>
          {bill.supplier && <p className="text-sm text-muted-foreground">{bill.supplier.name}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BackToBills />
          {allowed.edit && (
            <Button asChild variant="outline" size="sm">
              <Link href={`${billHref(bill.id)}/edit`}>
                <Pencil className="h-4 w-4" />
                {tx("ledger.common.edit", "Edit")}
              </Link>
            </Button>
          )}
          {allowed.reopen && (
            <Button variant="outline" size="sm" onClick={() => actions.requestReopen(bill)} disabled={busy}>
              <Undo2 className="h-4 w-4" />
              {tx("purchases.bills.sendBack", "Send back")}
            </Button>
          )}
          {allowed.cancel && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => actions.requestCancel(bill)}
              disabled={busy}
            >
              <Ban className="h-4 w-4" />
              {tx("purchases.bills.cancel", "Cancel bill")}
            </Button>
          )}
          {allowed.approve && (
            <Button size="sm" onClick={() => actions.approve(bill)} disabled={busy}>
              <CheckCircle2 className="h-4 w-4" />
              {busy ? tx("ledger.common.working", "Working…") : tx("purchases.bills.approve", "Approve")}
            </Button>
          )}
          {allowed.pay && (
            <Button asChild size="sm">
              <Link href={payBillHref(bill)}>
                <Wallet className="h-4 w-4" />
                {tx("purchases.bills.pay", "Pay")}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label={tx("purchases.bills.col.supplier", "Supplier")}>
            {bill.supplier ? (
              <div className="flex flex-col items-start">
                <Link
                  href={`/dashboard/accounting/purchases/suppliers?${new URLSearchParams({ search: bill.supplier.name }).toString()}`}
                  className="font-medium hover:underline"
                >
                  {bill.supplier.name}
                </Link>
                {bill.supplier.vatNumber && (
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {bill.supplier.vatNumber}
                  </span>
                )}
              </div>
            ) : (
              "—"
            )}
          </Detail>
          <Detail label={tx("purchases.billForm.supplierInvoiceNumber", "Supplier's invoice number")}>
            {bill.supplierInvoiceNumber ? (
              <span className="font-mono" dir="ltr">
                {bill.supplierInvoiceNumber}
              </span>
            ) : (
              "—"
            )}
          </Detail>
          <Detail label={tx("purchases.billForm.billDate", "Bill date")}>{formatDate(bill.billDate)}</Detail>
          <Detail label={tx("purchases.billForm.dueDate", "Due date")}>
            <span className={cn(bill.overdue && "font-medium text-destructive")}>{formatDate(bill.dueDate)}</span>
          </Detail>
          <Detail label={tx("purchases.bills.enteredBy", "Entered by")}>
            <span>{bill.createdByName ?? "—"}</span>
            <span className="block text-xs text-muted-foreground">{formatDate(bill.createdAt)}</span>
          </Detail>
          <Detail label={tx("purchases.bills.approvedBy", "Approved by")}>
            {bill.approvedAt ? (
              <>
                <span>{bill.approvedByName ?? "—"}</span>
                <span className="block text-xs text-muted-foreground">{formatDate(bill.approvedAt)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{tx("purchases.bills.notApproved", "Not approved")}</span>
            )}
          </Detail>
          {bill.notes && (
            <Detail label={tx("purchases.billForm.notes", "Notes")} className="sm:col-span-2">
              <p className="whitespace-pre-wrap">{bill.notes}</p>
            </Detail>
          )}
          {bill.status === "cancelled" && (
            <div className="rounded-md border bg-muted/40 p-3 sm:col-span-2 lg:col-span-4">
              <p className="font-medium">
                {bill.cancelledAt
                  ? tx("purchases.bills.cancelledOn", "Cancelled on {date}", { date: formatDate(bill.cancelledAt) })
                  : tx("purchases.bills.cancelledNoDate", "Cancelled")}
              </p>
              <p className="text-muted-foreground">
                {bill.cancelReason
                  ? tx("purchases.bills.cancelledReason", "Reason: {reason}", { reason: bill.cancelReason })
                  : tx("purchases.bills.cancelledNoReason", "No reason was given.")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tx("purchases.bills.linesTitle", "Lines")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tx("purchases.billForm.description", "Description")}</TableHead>
                <TableHead>{tx("purchases.billForm.account", "Account")}</TableHead>
                <TableHead className="hidden lg:table-cell">{tx("purchases.bills.costCentre", "Cost centre")}</TableHead>
                <TableHead className="text-end">{tx("purchases.billForm.quantity", "Quantity")}</TableHead>
                <TableHead className="text-end">{tx("purchases.billForm.unitPrice", "Unit price")}</TableHead>
                <TableHead className="hidden text-end md:table-cell">
                  {tx("purchases.bills.lineDiscount", "Discount")}
                </TableHead>
                <TableHead className="hidden text-end md:table-cell">{tx("purchases.billForm.net", "Net")}</TableHead>
                <TableHead className="hidden lg:table-cell">{tx("purchases.billForm.vatCategory", "VAT treatment")}</TableHead>
                <TableHead className="text-end">{tx("purchases.billForm.vatAmount", "VAT")}</TableHead>
                <TableHead className="text-end">{tx("purchases.billForm.lineTotal", "Total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const vat = VAT_CATEGORY_TEXT[line.vatCategory];
                return (
                  <TableRow key={line.id}>
                    <TableCell className="min-w-[180px] whitespace-normal text-sm">{line.description}</TableCell>
                    <TableCell className="min-w-[180px] whitespace-normal text-sm">
                      {line.account ? `${line.account.code} — ${accountName(line.account, language)}` : "—"}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal text-sm lg:table-cell">{costCentre(line)}</TableCell>
                    <TableCell className="text-end text-sm">
                      <span dir="ltr">{line.quantity}</span>
                    </TableCell>
                    <TableCell className="text-end text-sm">
                      <Money value={line.unitPrice} />
                    </TableCell>
                    <TableCell className="hidden text-end text-sm md:table-cell">
                      {line.discountAmount > 0 ? <Money value={line.discountAmount} /> : "—"}
                    </TableCell>
                    <TableCell className="hidden text-end text-sm md:table-cell">
                      <Money value={line.netAmount} />
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">
                      {vat ? text(vat) : line.vatCategory}
                      {line.vatCategory === "S" && (
                        <span className="ms-1 text-muted-foreground" dir="ltr">
                          {rateText(line.vatRate)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end text-sm">
                      <Money value={line.vatAmount} />
                    </TableCell>
                    <TableCell className="text-end text-sm font-medium">
                      <Money value={line.totalAmount} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex justify-end">
            <dl className="w-full max-w-sm space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
              <TotalRow label={tx("purchases.billForm.subtotal", "Subtotal")} value={bill.subtotal} />
              {bill.discountAmount > 0 && (
                <TotalRow label={tx("purchases.billForm.discount", "Discount (before VAT)")} value={bill.discountAmount} />
              )}
              <TotalRow label={tx("purchases.billForm.vatTotal", "VAT")} value={bill.vatAmount} />
              <div className="border-t pt-2">
                <TotalRow label={tx("purchases.billForm.total", "Total")} value={bill.totalAmount} strong />
              </div>
              <TotalRow label={tx("purchases.bills.col.paid", "Paid")} value={bill.amountPaid} />
              <TotalRow label={tx("purchases.bills.col.balance", "Balance")} value={bill.balance} strong />
            </dl>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tx("purchases.bills.paymentsTitle", "Payments")}</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {bill.status === "pending"
                ? tx("purchases.bills.noPaymentsPending", "A bill can be paid once it is approved.")
                : tx("purchases.bills.noPayments", "Nothing has been paid on this bill.")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sort={paymentSort} column="voucher">
                    {tx("purchases.bills.paymentVoucher", "Payment voucher")}
                  </SortableTableHead>
                  <SortableTableHead sort={paymentSort} column="date">
                    {tx("purchases.bills.col.date", "Date")}
                  </SortableTableHead>
                  <SortableTableHead sort={paymentSort} column="amount" className="text-end">
                    {tx("purchases.bills.paymentAmount", "Amount")}
                  </SortableTableHead>
                  <SortableTableHead sort={paymentSort} column="status">
                    {tx("purchases.bills.col.status", "Status")}
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.voucherId}>
                    <TableCell>
                      <Link
                        href={`/dashboard/accounting/purchases/vouchers/${encodeURIComponent(payment.voucherId)}`}
                        className="font-mono text-xs font-medium text-primary hover:underline"
                        dir="ltr"
                      >
                        {payment.voucherDisplayNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(payment.voucherDate)}</TableCell>
                    <TableCell className="text-end text-sm">
                      <Money value={payment.amount} />
                    </TableCell>
                    <TableCell>
                      <VoucherStatusBadge status={payment.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {actions.dialogs}
    </div>
  );
}
