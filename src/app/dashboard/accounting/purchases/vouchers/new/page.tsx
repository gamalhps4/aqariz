"use client";

/**
 * PropertyPro - Write a payment voucher (سند صرف)
 *
 * Money paid to a supplier out of one of the office's bank or cash accounts,
 * and the bills it settles. The bills listed are the supplier's approved
 * ones with something left to pay, oldest due first; each takes what is
 * typed beside it, or the amount can be spread over them oldest first. What
 * the bills do not take stays on account with the supplier, to be applied
 * to a bill later. The amount follows the bills paid until the person types
 * one of their own.
 *
 * The checks are the route's own (bill-math's checkAllocations), so the form
 * refuses exactly what the server would, in the reader's language, before
 * anything is sent. `?supplierId=` opens on a supplier; `?billId=` also puts
 * that bill's balance in its payment.
 */

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, ListOrdered, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toHalalas } from "@/lib/accounting/money";
import { checkAllocations, suggestAllocations } from "@/lib/accounting/purchases/bill-math";
import {
  VOUCHER_METHODS,
  bankDisplayName,
  type BillView,
  type VoucherMethod,
  type VoucherView,
} from "@/lib/accounting/purchases/types";
import { LedgerHeader, LedgerNotSetUp, Money } from "../../../setup/_shared/ledger-parts";
import { BANK_KIND_TEXT } from "../../../setup/_shared/ledger-ui";
import {
  SupplierPicker,
  VOUCHER_METHOD_TEXT,
  purchasesRequest,
  todayInput,
  useLedgerError,
  useLedgerText,
  usePurchasesAccess,
  useSupplierOptions,
} from "../../_shared/purchases-ui";
import {
  NoPurchasesAccess,
  RefusalState,
  SummaryTiles,
  isPositiveMoney,
  moneyInputText,
  parseMoneyInput,
  useBankAccounts,
  useOpenBills,
} from "../_parts/voucher-kit";

type Access = ReturnType<typeof usePurchasesAccess>;

interface Problem {
  message: string;
  /** "missing": something still to fill in; "error": something filled in wrong. */
  severity: "missing" | "error";
  billId?: string;
}

export default function NewPaymentVoucherPage() {
  // useSearchParams needs a boundary of its own under the dashboard layout.
  return (
    <Suspense fallback={null}>
      <NewPaymentVoucher />
    </Suspense>
  );
}

function NewPaymentVoucher() {
  const access = usePurchasesAccess();
  if (access.loading) return null;
  if (!access.canView) return <NoPurchasesAccess />;
  if (!access.canPay) return <NoPurchasesAccess right="pay" />;
  return <VoucherForm access={access} />;
}

function VoucherForm({ access }: { access: Access }) {
  const router = useRouter();
  const search = useSearchParams();
  const presetSupplierId = search.get("supplierId") ?? "";
  const presetBillId = search.get("billId") ?? "";
  const { tx, text, language, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const { suppliers } = useSupplierOptions(true, true);
  const bankList = useBankAccounts(true);

  const [supplierId, setSupplierId] = useState(presetSupplierId);
  const [bankAccountId, setBankAccountId] = useState("");
  const [voucherDate, setVoucherDate] = useState(todayInput);
  const [method, setMethod] = useState<VoucherMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [amountText, setAmountText] = useState("");
  const [amountTyped, setAmountTyped] = useState(false);
  // What is typed beside each bill; a bill with nothing typed pays nothing.
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  // `?billId=` puts that bill's balance in its payment until the person
  // changes supplier or reworks the payments.
  const [prefill, setPrefill] = useState(Boolean(presetBillId));
  const [busy, setBusy] = useState(false);
  const [submitCode, setSubmitCode] = useState<string | null>(null);

  const openBills = useOpenBills(supplierId);
  const bills = openBills.bills;

  // `?billId=` alone: the bill says whose it is. A supplier the person has
  // chosen meanwhile is kept.
  useEffect(() => {
    if (!presetBillId || presetSupplierId) return;
    const controller = new AbortController();
    void (async () => {
      const response = await purchasesRequest<BillView>(`/bills/${encodeURIComponent(presetBillId)}`, {
        signal: controller.signal,
      });
      const owner = response.ok ? response.data?.supplier?.id : undefined;
      if (controller.signal.aborted || !owner) return;
      setSupplierId((current) => current || owner);
    })();
    return () => controller.abort();
  }, [presetBillId, presetSupplierId]);

  if (bankList.notSetUp) {
    return (
      <div className="space-y-4">
        <LedgerHeader title={tx("purchases.voucherForm.title", "New payment voucher")} />
        <LedgerNotSetUp canManage={access.canManageBooks} />
      </div>
    );
  }
  if (submitCode === "LEDGER_NOT_SET_UP" || submitCode === "PURCHASES_UNAVAILABLE") {
    return (
      <div className="space-y-4">
        <LedgerHeader title={tx("purchases.voucherForm.title", "New payment voucher")} />
        <RefusalState
          code={submitCode}
          message={describeError({ code: submitCode, message: null })}
          canManageBooks={access.canManageBooks}
        />
      </div>
    );
  }

  const supplier = suppliers.find((option) => option.id === supplierId) ?? null;
  const activeBanks = bankList.banks.filter((bank) => bank.active && bank.ledgerAccount.active !== false);
  const effectiveBankId = bankAccountId || (activeBanks.length === 1 ? activeBanks[0].id : "");
  const bank = activeBanks.find((option) => option.id === effectiveBankId) ?? null;

  const textFor = (bill: BillView) =>
    allocations[bill.id] ?? (prefill && bill.id === presetBillId ? moneyInputText(bill.balance) : "");
  const rows = bills.map((bill) => {
    const raw = textFor(bill);
    return { bill, raw, value: parseMoneyInput(raw) };
  });
  // A bill with nothing (or zero) typed pays nothing; anything else is sent,
  // and checked, as typed.
  const chosen = rows.filter((row) => row.value !== null && row.value !== 0);
  const allocatedHalalas = chosen.reduce(
    (sum, row) => sum + (row.value !== null && Number.isFinite(row.value) && row.value > 0 ? toHalalas(row.value) : 0),
    0,
  );
  const allocated = allocatedHalalas / 100;

  const amountValue = amountTyped ? parseMoneyInput(amountText) : allocated > 0 ? allocated : null;
  const amountShown = amountTyped ? amountText : allocated > 0 ? moneyInputText(allocated) : "";
  const amountValid = isPositiveMoney(amountValue);
  const onAccount = amountValid ? (toHalalas(amountValue) - allocatedHalalas) / 100 : 0;

  function findProblem(): Problem | null {
    if (!supplierId) return { message: tx("purchases.voucherForm.problems.supplier", "Choose the supplier."), severity: "missing" };
    if (!effectiveBankId) {
      return {
        message: tx("purchases.voucherForm.problems.account", "Choose the account the money is paid from."),
        severity: "missing",
      };
    }
    if (!voucherDate) return { message: tx("purchases.voucherForm.problems.date", "Choose the voucher's date."), severity: "missing" };
    if (amountValue === null) {
      return { message: tx("purchases.voucherForm.problems.amountMissing", "Enter the amount paid."), severity: "missing" };
    }
    if (!amountValid) {
      return {
        message: tx(
          "purchases.voucherForm.problems.amount",
          "The amount must be a number above zero, with at most two decimals.",
        ),
        severity: "error",
      };
    }
    const problem = checkAllocations({
      voucherAmount: amountValue,
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
    if (problem) {
      return { message: tx(`ledger.errors.${problem.code}`, problem.message), severity: "error", billId: problem.billId };
    }
    return null;
  }

  const problem = findProblem();
  const ready = problem === null && !openBills.loading && !busy;

  const chooseSupplier = (next: string) => {
    setSupplierId(next);
    setAllocations({});
    setPrefill(false);
    setSubmitCode(null);
  };

  const setAllocation = (billId: string, value: string) => {
    setAllocations((current) => ({ ...current, [billId]: value }));
  };

  /** Spread the amount over the bills, oldest due first. */
  const payOldestFirst = () => {
    if (!amountValid) return;
    const suggested = suggestAllocations(
      amountValue,
      bills.map((bill) => ({ id: bill.id, dueDate: bill.dueDate, totalAmount: bill.totalAmount, amountPaid: bill.amountPaid })),
    );
    const next: Record<string, string> = {};
    for (const bill of bills) next[bill.id] = "";
    for (const suggestion of suggested) next[suggestion.billId] = moneyInputText(suggestion.amount);
    setAllocations(next);
    setPrefill(false);
  };

  const clearAllocations = () => {
    const next: Record<string, string> = {};
    for (const bill of bills) next[bill.id] = "";
    setAllocations(next);
    setPrefill(false);
  };

  async function submit() {
    if (problem || busy || !amountValid) return;
    setBusy(true);
    setSubmitCode(null);
    const response = await purchasesRequest<VoucherView>("/vouchers", {
      method: "POST",
      body: {
        supplierId,
        bankAccountId: effectiveBankId,
        voucherDate,
        amount: amountValue,
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        allocations: chosen.map((row) => ({ billId: row.bill.id, amount: row.value })),
      },
    });
    if (!response.ok || !response.data) {
      setBusy(false);
      setSubmitCode(response.code);
      toast.error(describeError(response));
      // Someone paid or changed one of these bills a moment ago: show them as they are now.
      if (response.code?.startsWith("PURCHASE_ALLOCATION_")) openBills.reload();
      return;
    }
    // Stays busy while the page changes, so a second click writes nothing.
    toast.success(
      tx("purchases.voucherForm.written", "Payment voucher {number} written", { number: response.data.displayNumber }),
    );
    router.push(`/dashboard/accounting/purchases/vouchers/${response.data.id}`);
  }

  const kindText = (kind: string) => {
    const entry = BANK_KIND_TEXT[kind as keyof typeof BANK_KIND_TEXT];
    return entry ? text(entry) : kind;
  };

  const back = (
    <Button asChild variant="outline" size="sm">
      <Link href="/dashboard/accounting/purchases/vouchers">
        <ArrowRight className="h-4 w-4 ltr:rotate-180" aria-hidden="true" />
        {tx("purchases.voucherForm.back", "All vouchers")}
      </Link>
    </Button>
  );

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("purchases.voucherForm.title", "New payment voucher")}
        subtitle={tx(
          "purchases.voucherForm.subtitle",
          "Pay a supplier from one of the office's bank or cash accounts, and choose the bills the payment settles. The voucher is posted to the books as soon as it is written.",
        )}
        actions={back}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-5 w-5" aria-hidden="true" />
            {tx("purchases.voucherForm.detailsTitle", "Payment")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="voucher-supplier">{tx("purchases.voucherForm.supplier", "Supplier")}</Label>
            <SupplierPicker id="voucher-supplier" suppliers={suppliers} value={supplierId} onChange={chooseSupplier} />
            {supplier && !supplier.isActive && (
              <p className="text-xs text-muted-foreground">
                {tx(
                  "purchases.voucherForm.inactiveSupplier",
                  "This supplier is inactive. A voucher can still pay what the office owes them.",
                )}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="voucher-account">{tx("purchases.voucherForm.account", "Paid from")}</Label>
            {bankList.code !== null ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {tx(
                  "purchases.voucherForm.banksFailed",
                  "The office's bank and cash accounts could not be loaded. Reload the page to try again.",
                )}
              </p>
            ) : !bankList.loading && activeBanks.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {tx(
                  "purchases.voucherForm.noAccounts",
                  "There is no active bank or cash account to pay from. Open one under Banks and cash.",
                )}
              </p>
            ) : (
              <Select value={effectiveBankId} onValueChange={setBankAccountId} disabled={bankList.loading}>
                <SelectTrigger id="voucher-account">
                  <SelectValue placeholder={tx("purchases.voucherForm.accountPlaceholder", "Choose a bank or cash account")} />
                </SelectTrigger>
                <SelectContent>
                  {activeBanks.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span>{bankDisplayName(option, language)}</span>
                        <span className="text-xs text-muted-foreground">{kindText(option.kind)}</span>
                        {option.balance !== null && (
                          <Money value={option.balance} className="text-xs text-muted-foreground" />
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {bank && bank.balance !== null && amountValid && toHalalas(amountValue) > toHalalas(bank.balance) && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {tx(
                  "purchases.voucherForm.overBalance",
                  "The amount is more than this account's balance in the books.",
                )}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="voucher-date">{tx("purchases.voucherForm.date", "Voucher date")}</Label>
            <Input id="voucher-date" type="date" value={voucherDate} onChange={(event) => setVoucherDate(event.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="voucher-method">{tx("purchases.voucherForm.method", "Method")}</Label>
            <Select value={method} onValueChange={(value) => setMethod(value as VoucherMethod)}>
              <SelectTrigger id="voucher-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOUCHER_METHODS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {text(VOUCHER_METHOD_TEXT[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="voucher-reference">{tx("purchases.voucherForm.reference", "Cheque or transfer number")}</Label>
            <Input
              id="voucher-reference"
              dir="ltr"
              maxLength={100}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="voucher-amount">{tx("purchases.voucherForm.amount", "Amount")}</Label>
            <Input
              id="voucher-amount"
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amountShown}
              aria-invalid={amountValue !== null && !amountValid}
              onChange={(event) => {
                setAmountText(event.target.value);
                // An emptied box goes back to following the bills paid.
                setAmountTyped(event.target.value.trim() !== "");
              }}
            />
            {amountTyped && allocated > 0 && amountValid && toHalalas(amountValue) !== allocatedHalalas ? (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  setAmountTyped(false);
                  setAmountText("");
                }}
              >
                {tx("purchases.voucherForm.matchBills", "Use the total paid on the bills")}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">
                {tx(
                  "purchases.voucherForm.amountHint",
                  "It follows the bills paid below until you type an amount of your own.",
                )}
              </p>
            )}
          </div>

          <div className="space-y-2 md:col-span-2 lg:col-span-3">
            <Label htmlFor="voucher-notes">{tx("purchases.voucherForm.notes", "Notes")}</Label>
            <Textarea
              id="voucher-notes"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListOrdered className="h-5 w-5" aria-hidden="true" />
              {tx("purchases.voucherForm.billsTitle", "Bills to pay")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {tx(
                "purchases.voucherForm.billsHint",
                "The supplier's approved bills that still have something to pay, oldest due first.",
              )}
            </p>
          </div>
          {bills.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={payOldestFirst}
                disabled={!amountValid}
                title={amountValid ? undefined : tx("purchases.voucherForm.payOldestHint", "Enter the amount first")}
              >
                {tx("purchases.voucherForm.payOldestFirst", "Pay oldest first")}
              </Button>
              <Button variant="ghost" size="sm" onClick={clearAllocations} disabled={allocatedHalalas === 0 && chosen.length === 0}>
                {tx("purchases.voucherForm.clear", "Clear the payments")}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {!supplierId ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {tx("purchases.voucherForm.chooseSupplierFirst", "Choose a supplier to see their bills.")}
            </p>
          ) : openBills.loading && bills.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{tx("ledger.common.loading", "Loading…")}</p>
          ) : openBills.code ? (
            <RefusalState
              code={openBills.code}
              message={describeError({ code: openBills.code, message: openBills.message })}
              canManageBooks={access.canManageBooks}
            />
          ) : bills.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {tx(
                "purchases.voucherForm.noOpenBills",
                "This supplier has no approved bill left to pay. The whole voucher stays on account.",
              )}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tx("purchases.voucherForm.col.bill", "Bill")}</TableHead>
                      <TableHead className="hidden md:table-cell">
                        {tx("purchases.voucherForm.col.supplierInvoice", "Supplier invoice no.")}
                      </TableHead>
                      <TableHead>{tx("purchases.voucherForm.col.dueDate", "Due date")}</TableHead>
                      <TableHead className="hidden text-end lg:table-cell">{tx("purchases.voucherForm.col.total", "Total")}</TableHead>
                      <TableHead className="hidden text-end lg:table-cell">{tx("purchases.voucherForm.col.paid", "Already paid")}</TableHead>
                      <TableHead className="text-end">{tx("purchases.voucherForm.col.balance", "Balance")}</TableHead>
                      <TableHead className="min-w-[150px] text-end">{tx("purchases.voucherForm.col.payNow", "Pay now")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(({ bill, raw, value }) => {
                      const flagged = problem?.billId === bill.id;
                      const full = value !== null && toHalalas(value) === toHalalas(bill.balance);
                      return (
                        <TableRow key={bill.id} className={flagged ? "bg-destructive/5" : undefined}>
                          <TableCell className="whitespace-nowrap">
                            <Link
                              href={`/dashboard/accounting/purchases/bills/${bill.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs font-medium text-primary hover:underline"
                              dir="ltr"
                            >
                              {bill.displayNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {bill.supplierInvoiceNumber ? (
                              <span className="font-mono text-xs" dir="ltr">
                                {bill.supplierInvoiceNumber}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            <span>{formatDate(bill.dueDate)}</span>
                            {bill.overdue && (
                              <span className="ms-2 rounded-md border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                                {tx("purchases.status.overdue", "Overdue")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden text-end lg:table-cell">
                            <Money value={bill.totalAmount} className="text-sm" />
                          </TableCell>
                          <TableCell className="hidden text-end lg:table-cell">
                            <Money value={bill.amountPaid} className="text-sm text-muted-foreground" />
                          </TableCell>
                          <TableCell className="text-end">
                            <Money value={bill.balance} className="text-sm font-medium" />
                          </TableCell>
                          <TableCell className="text-end">
                            <div className="flex items-center justify-end gap-1">
                              {!full && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-xs"
                                  onClick={() => setAllocation(bill.id, moneyInputText(bill.balance))}
                                  aria-label={tx("purchases.voucherForm.payInFullLabel", "Pay {number} in full", {
                                    number: bill.displayNumber,
                                  })}
                                >
                                  {tx("purchases.voucherForm.payInFull", "In full")}
                                </Button>
                              )}
                              <Input
                                dir="ltr"
                                inputMode="decimal"
                                autoComplete="off"
                                placeholder="0.00"
                                className="h-9 w-32 text-end"
                                value={raw}
                                aria-invalid={flagged}
                                aria-label={tx("purchases.voucherForm.payNowLabel", "Pay now on {number}", {
                                  number: bill.displayNumber,
                                })}
                                onChange={(event) => setAllocation(bill.id, event.target.value)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {openBills.total > bills.length && (
                <p className="text-xs text-muted-foreground">
                  {tx(
                    "purchases.voucherForm.tooMany",
                    "Only part of the open bills is listed, the oldest due first: {count} of {total}.",
                    { count: bills.length, total: openBills.total },
                  )}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <SummaryTiles
          items={[
            {
              label: tx("purchases.voucherForm.summary.amount", "Voucher amount"),
              value: <Money value={amountValid ? amountValue : 0} />,
            },
            {
              label: tx("purchases.voucherForm.summary.allocated", "Paid on bills"),
              value: <Money value={allocated} />,
            },
            {
              label: tx("purchases.voucherForm.summary.onAccount", "Left on account"),
              value: <Money value={onAccount} />,
              tone: onAccount < 0 ? "bad" : onAccount > 0 ? "warn" : undefined,
            },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {tx(
            "purchases.voucherForm.summary.note",
            "What is not paid on a bill stays on account with the supplier and can be applied to a bill later.",
          )}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm" aria-live="polite">
          {problem && (
            <p className={problem.severity === "error" ? "text-destructive" : "text-muted-foreground"}>{problem.message}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.push("/dashboard/accounting/purchases/vouchers")} disabled={busy}>
            {tx("ledger.common.cancel", "Cancel")}
          </Button>
          <Button onClick={submit} disabled={!ready}>
            {busy ? tx("ledger.common.working", "Working…") : tx("purchases.voucherForm.submit", "Write voucher")}
          </Button>
        </div>
      </div>
    </div>
  );
}
