"use client";

/**
 * PropertyPro - One payment voucher (سند صرف)
 *
 * Who was paid, from which account, how and when; the bills it paid; and
 * what it left on account with the supplier, which can be applied to the
 * supplier's open bills here. A voucher is never edited: a wrong one is
 * cancelled (it keeps its number, the bills it paid are open again, the books
 * reverse it) and a right one written. The printable voucher opens in a new
 * tab, laid out in the reader's language.
 */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Ban, Download, HandCoins, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";
import { toHalalas } from "@/lib/accounting/money";
import { checkAllocations, suggestAllocations } from "@/lib/accounting/purchases/bill-math";
import { bankDisplayName, type VoucherMethod, type VoucherView } from "@/lib/accounting/purchases/types";
import { LedgerHeader, Money } from "../../../setup/_shared/ledger-parts";
import { BANK_KIND_TEXT, type LedgerResponse } from "../../../setup/_shared/ledger-ui";
import {
  VOUCHER_METHOD_TEXT,
  VoucherStatusBadge,
  purchasesRequest,
  useLedgerError,
  useLedgerText,
  usePurchasesAccess,
} from "../../_shared/purchases-ui";
import {
  CancelVoucherDialog,
  NoPurchasesAccess,
  PurchasesNotice,
  RefusalState,
  moneyInputText,
  parseMoneyInput,
  useOpenBills,
  voucherPdfHref,
} from "../_parts/voucher-kit";

type Access = ReturnType<typeof usePurchasesAccess>;
type Allocation = NonNullable<VoucherView["allocations"]>[number];

const NO_ALLOCATIONS: Allocation[] = [];

export default function PaymentVoucherPage() {
  const access = usePurchasesAccess();
  if (access.loading) return null;
  if (!access.canView) return <NoPurchasesAccess />;
  return <VoucherDetail access={access} />;
}

function VoucherDetail({ access }: { access: Access }) {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const { tx, text, language, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const [version, setVersion] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [result, setResult] = useState<{ id: string; response: LedgerResponse<VoucherView> } | null>(null);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void (async () => {
      const response = await purchasesRequest<VoucherView>(`/vouchers/${encodeURIComponent(id)}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResult({ id, response });
    })();
    return () => controller.abort();
  }, [id, version]);

  // A reload after a change keeps the voucher on screen until the new one comes.
  const current = result?.id === id ? result.response : null;
  const voucher = current?.ok ? current.data : null;
  const reload = () => setVersion((value) => value + 1);
  // The bills it paid sort by any column; their total stays in the footer.
  const allocationSort = useTableSort(voucher?.allocations ?? NO_ALLOCATIONS, {
    bill: (allocation) => allocation.billNumber,
    supplierInvoice: (allocation) => allocation.supplierInvoiceNumber,
    amount: (allocation) => allocation.amount,
  });

  const back = (
    <Button asChild variant="outline" size="sm">
      <Link href="/dashboard/accounting/purchases/vouchers">
        <ArrowRight className="h-4 w-4 ltr:rotate-180" aria-hidden="true" />
        {tx("purchases.voucher.back", "All vouchers")}
      </Link>
    </Button>
  );
  const plainTitle = tx("purchases.voucher.titlePlain", "Payment voucher");

  if (!current) {
    return (
      <div className="space-y-4">
        <LedgerHeader title={plainTitle} actions={back} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tx("ledger.common.loading", "Loading…")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!voucher) {
    const missing = current.code === "PURCHASE_VOUCHER_NOT_FOUND";
    return (
      <div className="space-y-4">
        <LedgerHeader title={plainTitle} actions={back} />
        {missing ? (
          <PurchasesNotice message={tx("purchases.voucher.notFound", "This payment voucher does not exist.")} />
        ) : (
          <RefusalState code={current.code} message={describeError(current)} canManageBooks={access.canManageBooks} />
        )}
      </div>
    );
  }

  const posted = voucher.status === "posted";
  const methodEntry = VOUCHER_METHOD_TEXT[voucher.method as VoucherMethod];
  const kindEntry = voucher.bankAccount ? BANK_KIND_TEXT[voucher.bankAccount.kind as keyof typeof BANK_KIND_TEXT] : undefined;
  const allocations = voucher.allocations ?? [];
  const pdf = voucherPdfHref(voucher.id, language);

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("purchases.voucher.title", "Payment voucher {number}", { number: voucher.displayNumber })}
        subtitle={voucher.supplier?.name}
        actions={
          <>
            {back}
            <Button asChild variant="outline" size="sm">
              <a href={pdf} target="_blank" rel="noopener noreferrer">
                <Printer className="h-4 w-4" aria-hidden="true" />
                {tx("purchases.voucher.print", "Print")}
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={pdf} download>
                <Download className="h-4 w-4" aria-hidden="true" />
                {tx("purchases.voucher.download", "Download PDF")}
              </a>
            </Button>
            {access.canPay && posted && (
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setCancelOpen(true)}>
                <Ban className="h-4 w-4" aria-hidden="true" />
                {tx("purchases.voucher.cancel", "Cancel voucher")}
              </Button>
            )}
          </>
        }
      />

      {!posted && (
        <div className="rounded-lg border border-muted bg-muted/40 p-4 text-sm">
          <p className="font-medium">
            {voucher.cancelledAt
              ? tx("purchases.voucher.cancelledOn", "This voucher was cancelled on {date}.", {
                  date: formatDate(voucher.cancelledAt),
                })
              : tx("purchases.voucher.cancelledBanner", "This voucher was cancelled.")}
          </p>
          <p className="mt-1 text-muted-foreground">
            {tx(
              "purchases.voucher.cancelledBody",
              "It keeps its number. The bills it paid are open again and the books reversed the payment.",
            )}
          </p>
          <p className="mt-2">
            <span className="text-muted-foreground">{tx("purchases.voucher.cancelReason", "Reason for cancelling")}: </span>
            {voucher.cancelReason || tx("purchases.voucher.noReason", "No reason given")}
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="font-mono" dir="ltr">
              {voucher.displayNumber}
            </span>
            <VoucherStatusBadge status={voucher.status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label={tx("purchases.voucher.supplier", "Supplier")}>
            <div className="font-medium">{voucher.supplier?.name ?? "—"}</div>
            {voucher.supplier?.vatNumber && (
              <div className="text-xs text-muted-foreground">
                {tx("purchases.voucher.vatNumber", "VAT number")}:{" "}
                <span className="font-mono" dir="ltr">
                  {voucher.supplier.vatNumber}
                </span>
              </div>
            )}
          </Field>
          <Field label={tx("purchases.voucher.date", "Voucher date")}>{formatDate(voucher.voucherDate)}</Field>
          <Field label={tx("purchases.voucher.account", "Paid from")}>
            {voucher.bankAccount ? (
              <>
                <div>{bankDisplayName(voucher.bankAccount, language)}</div>
                <div className="text-xs text-muted-foreground">
                  {kindEntry ? text(kindEntry) : voucher.bankAccount.kind}
                  {" · "}
                  <span className="font-mono" dir="ltr">
                    {voucher.bankAccount.ledgerAccount.code}
                  </span>
                </div>
              </>
            ) : (
              "—"
            )}
          </Field>
          <Field label={tx("purchases.voucher.method", "Method")}>{methodEntry ? text(methodEntry) : voucher.method}</Field>
          <Field label={tx("purchases.voucher.reference", "Cheque or transfer number")}>
            {voucher.reference ? (
              <span className="font-mono" dir="ltr">
                {voucher.reference}
              </span>
            ) : (
              "—"
            )}
          </Field>
          <Field label={tx("purchases.voucher.amount", "Amount")}>
            <Money value={voucher.amount} className="text-base font-semibold" />
          </Field>
          <Field label={tx("purchases.voucher.allocated", "Paid on bills")}>
            <Money value={voucher.allocated} />
          </Field>
          <Field label={tx("purchases.voucher.onAccount", "On account")}>
            <Money value={voucher.onAccount} />
          </Field>
          <Field label={tx("purchases.voucher.createdBy", "Written by")}>{voucher.createdByName ?? "—"}</Field>
          <Field label={tx("purchases.voucher.createdAt", "Written on")}>{formatDate(voucher.createdAt)}</Field>
          {voucher.notes && (
            <div className="sm:col-span-2 lg:col-span-4">
              <Field label={tx("purchases.voucher.notes", "Notes")}>
                <p className="whitespace-pre-line">{voucher.notes}</p>
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      {posted && voucher.onAccount > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
              <HandCoins className="h-4 w-4" aria-hidden="true" />
              {tx("purchases.voucher.onAccountTitle", "On account with the supplier")}
              <Money value={voucher.onAccount} className="font-semibold" />
            </p>
            <p className="max-w-2xl text-sm text-amber-800/80 dark:text-amber-200/80">
              {tx(
                "purchases.voucher.onAccountBody",
                "This part of the voucher has not been set against a bill yet. It already reduces what the office owes the supplier, and can be applied to a bill once one is approved.",
              )}
            </p>
          </div>
          {access.canPay && voucher.supplier && (
            <Button size="sm" onClick={() => setApplyOpen(true)}>
              {tx("purchases.voucher.applyToBills", "Apply to bills")}
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tx("purchases.voucher.allocationsTitle", "Bills paid")}</CardTitle>
        </CardHeader>
        <CardContent>
          {allocations.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {tx("purchases.voucher.noAllocations", "This voucher has not been applied to any bill.")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead sort={allocationSort} column="bill">
                      {tx("purchases.voucher.col.bill", "Bill")}
                    </SortableTableHead>
                    <SortableTableHead sort={allocationSort} column="supplierInvoice">
                      {tx("purchases.voucher.col.supplierInvoice", "Supplier invoice no.")}
                    </SortableTableHead>
                    <SortableTableHead sort={allocationSort} column="amount" className="text-end">
                      {tx("purchases.voucher.col.amount", "Paid")}
                    </SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocationSort.rows.map((allocation) => (
                    <TableRow key={allocation.billId}>
                      <TableCell>
                        <Link
                          href={`/dashboard/accounting/purchases/bills/${allocation.billId}`}
                          className="font-mono text-xs font-medium text-primary hover:underline"
                          dir="ltr"
                        >
                          {allocation.billDisplayNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {allocation.supplierInvoiceNumber ? (
                          <span className="font-mono text-xs" dir="ltr">
                            {allocation.supplierInvoiceNumber}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <Money value={allocation.amount} className="text-sm" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2} className="font-semibold">
                      {tx("purchases.voucher.totalAllocated", "Total paid on bills")}
                    </TableCell>
                    <TableCell className="text-end font-semibold">
                      <Money value={allocations.reduce((sum, row) => sum + toHalalas(row.amount), 0) / 100} />
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CancelVoucherDialog
        voucher={cancelOpen ? voucher : null}
        onClose={() => setCancelOpen(false)}
        onCancelled={() => {
          setCancelOpen(false);
          reload();
        }}
      />

      {applyOpen && voucher.supplier && (
        <ApplyToBillsDialog
          voucherId={voucher.id}
          supplierId={voucher.supplier.id}
          onAccount={voucher.onAccount}
          onClose={() => setApplyOpen(false)}
          onApplied={() => {
            setApplyOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/**
 * Set what the voucher left on account against the supplier's open bills:
 * each bill takes at most what is left on it and what is still on account.
 */
function ApplyToBillsDialog({
  voucherId,
  supplierId,
  onAccount,
  onClose,
  onApplied,
}: {
  voucherId: string;
  supplierId: string;
  onAccount: number;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { tx, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const openBills = useOpenBills(supplierId);
  const bills = openBills.bills;
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const onAccountHalalas = toHalalas(onAccount);
  const rows = bills.map((bill) => {
    const raw = allocations[bill.id] ?? "";
    return { bill, raw, value: parseMoneyInput(raw) };
  });
  const chosen = rows.filter((row) => row.value !== null && row.value !== 0);
  const allocatedHalalas = chosen.reduce(
    (sum, row) => sum + (row.value !== null && Number.isFinite(row.value) && row.value > 0 ? toHalalas(row.value) : 0),
    0,
  );
  const remaining = (onAccountHalalas - allocatedHalalas) / 100;

  /** The most this bill can take: what is left on it, and what the other bills leave on account. */
  const capOf = (billId: string, balance: number) => {
    const others = chosen
      .filter((row) => row.bill.id !== billId && row.value !== null && Number.isFinite(row.value) && row.value > 0)
      .reduce((sum, row) => sum + toHalalas(row.value as number), 0);
    return Math.max(0, Math.min(toHalalas(balance), onAccountHalalas - others)) / 100;
  };

  const problem =
    chosen.length === 0
      ? null
      : checkAllocations({
          voucherAmount: onAccount,
          supplierId,
          allocations: chosen.map((row) => ({ billId: row.bill.id, amount: row.value ?? Number.NaN })),
          bills: bills.map((bill) => ({
            id: bill.id,
            supplierId: bill.supplier?.id ?? supplierId,
            status: bill.status,
            totalAmount: bill.totalAmount,
            amountPaid: bill.amountPaid,
          })),
        });
  const ready = chosen.length > 0 && problem === null && !busy;

  const setAllocation = (billId: string, value: string) =>
    setAllocations((current) => ({ ...current, [billId]: value }));

  /** Cap what was typed once the person leaves the box. */
  const capOnBlur = (billId: string, balance: number) => {
    const value = parseMoneyInput(allocations[billId] ?? "");
    if (value === null || !Number.isFinite(value)) return;
    const cap = capOf(billId, balance);
    if (toHalalas(value) > toHalalas(cap)) setAllocation(billId, cap > 0 ? moneyInputText(cap) : "");
  };

  const payOldestFirst = () => {
    const suggested = suggestAllocations(
      onAccount,
      bills.map((bill) => ({ id: bill.id, dueDate: bill.dueDate, totalAmount: bill.totalAmount, amountPaid: bill.amountPaid })),
    );
    const next: Record<string, string> = {};
    for (const suggestion of suggested) next[suggestion.billId] = moneyInputText(suggestion.amount);
    setAllocations(next);
  };

  async function apply() {
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    const response = await purchasesRequest<VoucherView>(`/vouchers/${encodeURIComponent(voucherId)}/allocate`, {
      method: "POST",
      body: { allocations: chosen.map((row) => ({ billId: row.bill.id, amount: row.value })) },
    });
    setBusy(false);
    if (!response.ok) {
      setFailure(describeError(response));
      if (response.code?.startsWith("PURCHASE_ALLOCATION_")) openBills.reload();
      return;
    }
    toast.success(tx("purchases.voucher.applied", "Payment applied to the bills"));
    onApplied();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tx("purchases.voucher.applyTitle", "Apply the payment on account to bills")}</DialogTitle>
          <DialogDescription>
            {tx(
              "purchases.voucher.applyBody",
              "Choose how much each bill takes. The books do not change: the supplier's account already went down by the whole voucher.",
            )}
          </DialogDescription>
        </DialogHeader>

        {openBills.loading && bills.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{tx("ledger.common.loading", "Loading…")}</p>
        ) : openBills.code ? (
          <p className="py-6 text-center text-sm text-destructive">
            {describeError({ code: openBills.code, message: openBills.message })}
          </p>
        ) : bills.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {tx(
              "purchases.voucher.applyNone",
              "This supplier has no approved bill left to pay. The payment stays on account until one is approved.",
            )}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="text-muted-foreground">{tx("purchases.voucher.onAccountNow", "On account")}: </span>
                <Money value={onAccount} className="font-medium" />
              </span>
              <Button variant="outline" size="sm" onClick={payOldestFirst}>
                {tx("purchases.voucher.payOldestFirst", "Pay oldest first")}
              </Button>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tx("purchases.voucher.col.bill", "Bill")}</TableHead>
                    <TableHead>{tx("purchases.voucher.col.dueDate", "Due date")}</TableHead>
                    <TableHead className="text-end">{tx("purchases.voucher.col.balance", "Balance")}</TableHead>
                    <TableHead className="text-end">{tx("purchases.voucher.col.apply", "Apply")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ bill, raw }) => {
                    const flagged = problem?.billId === bill.id;
                    const cap = capOf(bill.id, bill.balance);
                    return (
                      <TableRow key={bill.id} className={flagged ? "bg-destructive/5" : undefined}>
                        <TableCell className="whitespace-nowrap">
                          <span className="font-mono text-xs font-medium" dir="ltr">
                            {bill.displayNumber}
                          </span>
                          {bill.supplierInvoiceNumber && (
                            <div className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                              {bill.supplierInvoiceNumber}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDate(bill.dueDate)}
                          {bill.overdue && (
                            <span className="ms-2 text-[11px] font-medium text-destructive">
                              {tx("purchases.status.overdue", "Overdue")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <Money value={bill.balance} className="text-sm" />
                        </TableCell>
                        <TableCell className="text-end">
                          <Input
                            dir="ltr"
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder={moneyInputText(cap)}
                            className="ms-auto h-9 w-32 text-end"
                            value={raw}
                            aria-invalid={flagged}
                            aria-label={tx("purchases.voucher.applyLabel", "Apply to {number}, at most {amount}", {
                              number: bill.displayNumber,
                              amount: moneyInputText(cap),
                            })}
                            onChange={(event) => setAllocation(bill.id, event.target.value)}
                            onBlur={() => capOnBlur(bill.id, bill.balance)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-sm">
              <span className="text-muted-foreground">{tx("purchases.voucher.remaining", "Left on account after this")}: </span>
              <Money value={remaining} className={remaining < 0 ? "font-medium text-destructive" : "font-medium"} />
            </p>
            {problem && (
              <p role="alert" className="text-sm text-destructive">
                {tx(`ledger.errors.${problem.code}`, problem.message)}
              </p>
            )}
          </div>
        )}

        {failure && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {failure}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tx("ledger.common.cancel", "Cancel")}
          </Button>
          <Button onClick={apply} disabled={!ready}>
            {busy ? tx("ledger.common.working", "Working…") : tx("purchases.voucher.applySubmit", "Apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
