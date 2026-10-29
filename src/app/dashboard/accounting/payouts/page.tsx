"use client";

/**
 * PropertyPro - Owners: balances, settlements and payouts
 *
 * What the office owes each owner, from the books: rent collected for them
 * less expenses on their buildings, the office's commission and what has
 * been paid out, carried forward from period to period. A period is settled
 * from the owner's statement (the commission and the VAT on it come off the
 * balance); a payout records the money leaving the office's bank or cash.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { HandCoins, Receipt, Undo2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LedgerHeader, LedgerNotSetUp, LedgerPagination, Money, NoLedgerAccess } from "../setup/_shared/ledger-parts";
import {
  accountName,
  ledgerRequest,
  todayInput,
  useLedgerAccess,
  useLedgerError,
  useLedgerText,
} from "../setup/_shared/ledger-ui";
import { addBusinessMonths, businessMonthRange } from "@/lib/dates/business-day";

interface BalanceRow {
  ownerId: string;
  name: string;
  companyName: string | null;
  balance: number;
  lastPayout: string | null;
}

interface PayoutRow {
  id: string;
  ownerId: string;
  ownerName: string;
  amount: number;
  date: string;
  bankAccount: { id: string; name: string; ledgerAccountName: { ar: string; en: string } };
  reference: string | null;
  status: string;
}

interface SettlementRow {
  id: string;
  ownerId: string;
  ownerName: string;
  periodStart: string;
  periodEnd: string;
  collected: number;
  commission: number;
  commissionVat: number;
  netDue: number;
  status: string;
  /** The period's tax invoice for the commission, once settlements issue one. */
  invoiceId: string | null;
  invoiceNumber: string | null;
}

interface BankOption {
  id: string;
  name: string;
  active: boolean;
  ledgerAccount: { nameAr: string; nameEn: string };
}

interface SettlementPreview {
  collected: number;
  ownerReceivedDirect: number;
  expenses: number;
  commission: number;
  managementFee: number;
  commissionVat: number;
  investmentRent: number;
  netDue: number;
  /** The owner's open invoices that could be the period's tax invoice. */
  openInvoices?: Array<{ id: string; invoiceNumber: string; issueDate: string; balanceRemaining: number }>;
}

/** Issue a new tax invoice rather than link one of the owner's open ones. */
const NEW_INVOICE = "new";

interface PayoutForm {
  ownerId: string;
  ownerName: string;
  amount: string;
  date: string;
  bankAccountId: string;
  reference: string;
  notes: string;
}

interface SettleForm {
  ownerId: string;
  ownerName: string;
  periodStart: string;
  periodEnd: string;
  /** An open invoice's id, NEW_INVOICE, or "" until chosen. */
  invoice: string;
}

function firstOfLastMonth(): { start: string; end: string } {
  const { from, to } = businessMonthRange(addBusinessMonths(todayInput(), -1));
  return { start: from, end: to };
}

export default function OwnerPayoutsPage() {
  const access = useLedgerAccess();
  const { tx, language, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [version, setVersion] = useState(0);
  const [payoutForm, setPayoutForm] = useState<PayoutForm | null>(null);
  const [settleForm, setSettleForm] = useState<SettleForm | null>(null);
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!access.canView) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      const [payoutResponse, settlementResponse, bankResponse] = await Promise.all([
        ledgerRequest<{ balances: BalanceRow[]; payouts: PayoutRow[] }>(`/payouts?page=${page}&limit=${limit}`, {
          signal: controller.signal,
        }),
        ledgerRequest<{ settlements: SettlementRow[] }>("/settlements?limit=50", { signal: controller.signal }),
        ledgerRequest<{ accounts: BankOption[] }>("/banks", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setNotSetUp(payoutResponse.code === "LEDGER_NOT_SET_UP");
      setBalances(payoutResponse.ok ? (payoutResponse.data?.balances ?? []) : []);
      setPayouts(payoutResponse.ok ? (payoutResponse.data?.payouts ?? []) : []);
      setTotal(payoutResponse.pagination?.total ?? 0);
      setSettlements(settlementResponse.ok ? (settlementResponse.data?.settlements ?? []) : []);
      setBanks(bankResponse.ok ? (bankResponse.data?.accounts ?? []).filter((bank) => bank.active) : []);
      setLoading(false);
    })();
    return () => controller.abort();
  }, [access.canView, page, limit, version]);

  if (access.loading) return null;
  if (!access.canView) return <NoLedgerAccess />;
  if (notSetUp) return <LedgerNotSetUp canManage={access.canManage} />;

  const bankName = (bank: { name: string; ledgerAccount?: { nameAr: string; nameEn: string }; ledgerAccountName?: { ar: string; en: string } }) =>
    bank.name ||
    (bank.ledgerAccount
      ? accountName(bank.ledgerAccount, language)
      : bank.ledgerAccountName
        ? language === "ar"
          ? bank.ledgerAccountName.ar
          : bank.ledgerAccountName.en
        : "");

  async function loadPreview(form: SettleForm) {
    setPreview(null);
    const params = new URLSearchParams({ ownerId: form.ownerId, periodStart: form.periodStart, periodEnd: form.periodEnd });
    const response = await ledgerRequest<SettlementPreview>(`/settlements/preview?${params}`);
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    setPreview(response.data);
  }

  async function settle() {
    if (!settleForm) return;
    setBusy(true);
    const response = await ledgerRequest<{ journalNumber: number | null }>("/settlements", {
      method: "POST",
      body: {
        ownerId: settleForm.ownerId,
        periodStart: settleForm.periodStart,
        periodEnd: settleForm.periodEnd,
        ...(settleForm.invoice && settleForm.invoice !== NEW_INVOICE
          ? { invoiceId: settleForm.invoice }
          : { newInvoice: true }),
      },
    });
    setBusy(false);
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(tx("ledger.payouts.settled", "Period settled"));
    setSettleForm(null);
    setPreview(null);
    setVersion((value) => value + 1);
  }

  async function pay() {
    if (!payoutForm) return;
    setBusy(true);
    const response = await ledgerRequest<{ journalNumber: number }>("/payouts", {
      method: "POST",
      body: {
        ownerId: payoutForm.ownerId,
        amount: payoutForm.amount,
        date: payoutForm.date,
        bankAccountId: payoutForm.bankAccountId,
        reference: payoutForm.reference,
        notes: payoutForm.notes,
      },
    });
    setBusy(false);
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(tx("ledger.payouts.paid", "Payout posted as journal #{number}", { number: response.data?.journalNumber ?? "" }));
    setPayoutForm(null);
    setVersion((value) => value + 1);
  }

  async function cancel(kind: "payouts" | "settlements", id: string) {
    const question =
      kind === "payouts"
        ? tx("ledger.payouts.confirmCancelPayout", "Cancel this payout? Its entry is reversed.")
        : tx("ledger.payouts.confirmCancelSettlement", "Cancel this settlement? Its entry is reversed and the period can be settled again.");
    if (!window.confirm(question)) return;
    const response = await ledgerRequest(`/${kind}/${id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(tx("ledger.payouts.cancelled", "Cancelled"));
    setVersion((value) => value + 1);
  }

  const balanceColumns: DataTableColumn<BalanceRow>[] = [
    {
      id: "owner",
      header: tx("ledger.party.owner", "Owner"),
      cell: (row) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium">{row.name}</span>
          {row.companyName && <span className="text-xs text-muted-foreground">{row.companyName}</span>}
        </div>
      ),
      width: "min-w-[200px]",
    },
    {
      id: "balance",
      header: tx("ledger.payouts.balance", "Balance"),
      cell: (row) => (
        <div className="flex flex-col items-end">
          <Money value={Math.abs(row.balance)} className="text-sm font-semibold" />
          <span className="text-xs text-muted-foreground">
            {row.balance > 0.004
              ? tx("ledger.payouts.officeOwes", "The office owes the owner")
              : row.balance < -0.004
                ? tx("ledger.payouts.ownerOwes", "The owner owes the office")
                : tx("ledger.payouts.settledUp", "Settled")}
          </span>
        </div>
      ),
      align: "right",
    },
    {
      id: "lastPayout",
      header: tx("ledger.payouts.lastPayout", "Last payout"),
      cell: (row) => <span className="text-sm">{row.lastPayout ? formatDate(row.lastPayout) : "—"}</span>,
      visibility: "md",
    },
    {
      id: "actions",
      header: "",
      cell: (row) =>
        access.canManage ? (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const period = firstOfLastMonth();
                const form = { ownerId: row.ownerId, ownerName: row.name, periodStart: period.start, periodEnd: period.end, invoice: "" };
                setSettleForm(form);
                void loadPreview(form);
              }}
            >
              <Receipt className="h-4 w-4" />
              {tx("ledger.payouts.settle", "Settle a period")}
            </Button>
            <Button
              size="sm"
              disabled={banks.length === 0}
              onClick={() =>
                setPayoutForm({
                  ownerId: row.ownerId,
                  ownerName: row.name,
                  amount: row.balance > 0 ? row.balance.toFixed(2) : "",
                  date: todayInput(),
                  bankAccountId: banks[0]?.id ?? "",
                  reference: "",
                  notes: "",
                })
              }
            >
              <HandCoins className="h-4 w-4" />
              {tx("ledger.payouts.pay", "Pay out")}
            </Button>
          </div>
        ) : null,
      width: "min-w-[260px]",
    },
  ];

  const payoutColumns: DataTableColumn<PayoutRow>[] = [
    { id: "date", header: tx("ledger.journals.date", "Date"), cell: (row) => <span className="text-sm">{formatDate(row.date)}</span> },
    { id: "owner", header: tx("ledger.party.owner", "Owner"), cell: (row) => <span className="text-sm">{row.ownerName}</span> },
    { id: "bank", header: tx("ledger.payouts.paidFrom", "Paid from"), cell: (row) => <span className="text-sm">{bankName(row.bankAccount)}</span>, visibility: "md" },
    { id: "amount", header: tx("ledger.journals.amount", "Amount"), cell: (row) => <Money value={row.amount} className="text-sm font-medium" />, align: "right" },
    {
      id: "status",
      header: tx("ledger.journals.status", "Status"),
      cell: (row) =>
        row.status === "reversed" ? (
          <Badge variant="outline" className="text-xs">{tx("ledger.banks.cancelled", "Cancelled")}</Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">{tx("ledger.journals.posted", "Posted")}</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: (row) =>
        access.canManage && row.status === "posted" ? (
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => cancel("payouts", row.id)}>
            <Undo2 className="h-4 w-4" />
            <span className="sr-only">{tx("ledger.payouts.cancelPayout", "Cancel payout")}</span>
          </Button>
        ) : null,
      width: "w-10",
      align: "center",
    },
  ];

  const settlementColumns: DataTableColumn<SettlementRow>[] = [
    {
      id: "period",
      header: tx("ledger.payouts.period", "Period"),
      cell: (row) => (
        <span className="text-sm">
          {formatDate(row.periodStart)} — {formatDate(row.periodEnd)}
        </span>
      ),
    },
    { id: "owner", header: tx("ledger.party.owner", "Owner"), cell: (row) => <span className="text-sm">{row.ownerName}</span> },
    { id: "collected", header: tx("ledger.payouts.collected", "Collected"), cell: (row) => <Money value={row.collected} className="text-sm" />, align: "right", visibility: "md" },
    { id: "commission", header: tx("ledger.payouts.commission", "Commission + VAT"), cell: (row) => <Money value={row.commission + row.commissionVat} className="text-sm" />, align: "right" },
    { id: "net", header: tx("ledger.payouts.netDue", "Net for the period"), cell: (row) => <Money value={row.netDue} className="text-sm font-medium" />, align: "right", visibility: "lg" },
    {
      id: "invoice",
      header: tx("ledger.payouts.taxInvoice", "Tax invoice"),
      cell: (row) =>
        row.invoiceId && row.invoiceNumber ? (
          <Link href={`/dashboard/accounting/invoices/${row.invoiceId}`} className="font-mono text-sm underline">
            <bdi dir="ltr">{row.invoiceNumber}</bdi>
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
      visibility: "md",
    },
    {
      id: "status",
      header: tx("ledger.journals.status", "Status"),
      cell: (row) =>
        row.status === "reversed" ? (
          <Badge variant="outline" className="text-xs">{tx("ledger.banks.cancelled", "Cancelled")}</Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">{tx("ledger.payouts.closed", "Settled")}</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: (row) =>
        access.canManage && row.status === "closed" ? (
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => cancel("settlements", row.id)}>
            <Undo2 className="h-4 w-4" />
            <span className="sr-only">{tx("ledger.payouts.cancelSettlement", "Cancel settlement")}</span>
          </Button>
        ) : null,
      width: "w-10",
      align: "center",
    },
  ];

  const previewRows: Array<[string, number]> = preview
    ? [
        [tx("ledger.payouts.collected", "Collected"), preview.collected],
        [tx("ledger.payouts.ownerReceived", "Of which the owner received directly"), preview.ownerReceivedDirect],
        [tx("ledger.payouts.expenses", "Expenses"), preview.expenses],
        [tx("ledger.payouts.commissionOnly", "Commission"), preview.commission],
        [tx("ledger.payouts.managementFee", "Fixed management fee"), preview.managementFee],
        [tx("ledger.payouts.vat", "VAT on the commission"), preview.commissionVat],
        [tx("ledger.payouts.investmentRent", "Investment rent owed to the owner"), preview.investmentRent],
      ]
    : [];

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("ledger.nav.payouts", "Owner payouts")}
        subtitle={tx(
          "ledger.payouts.subtitle",
          "What the office owes each owner from the books: rent collected for them, less expenses, the office's commission and what has been paid out.",
        )}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5" />
            {tx("ledger.payouts.balancesTitle", "Owners' balances")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={balanceColumns}
            data={balances}
            loading={loading}
            getRowKey={(row) => row.ownerId}
            emptyState={{ title: tx("ledger.payouts.noOwners", "No owners yet") }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tx("ledger.payouts.payoutsTitle", "Payouts")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            columns={payoutColumns}
            data={payouts}
            loading={loading}
            getRowKey={(row) => row.id}
            emptyState={{ title: tx("ledger.payouts.noPayouts", "No payouts yet") }}
          />
          <LedgerPagination page={page} limit={limit} total={total} onPageChange={setPage} onLimitChange={setLimit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tx("ledger.payouts.settlementsTitle", "Settled periods")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={settlementColumns}
            data={settlements}
            loading={loading}
            getRowKey={(row) => row.id}
            emptyState={{ title: tx("ledger.payouts.noSettlements", "No settled periods yet") }}
          />
        </CardContent>
      </Card>

      <Dialog open={payoutForm !== null} onOpenChange={(open) => !open && setPayoutForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tx("ledger.payouts.payTitle", "Pay out to {name}", { name: payoutForm?.ownerName ?? "" })}</DialogTitle>
            <DialogDescription>{tx("ledger.payouts.payHint", "Records the money leaving the office's account and takes it off what the office owes the owner.")}</DialogDescription>
          </DialogHeader>
          {payoutForm && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="po-amount">{tx("ledger.journals.amount", "Amount")}</Label>
                  <Input id="po-amount" dir="ltr" inputMode="decimal" value={payoutForm.amount} onChange={(event) => setPayoutForm({ ...payoutForm, amount: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="po-date">{tx("ledger.journals.date", "Date")}</Label>
                  <Input id="po-date" type="date" value={payoutForm.date} onChange={(event) => setPayoutForm({ ...payoutForm, date: event.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{tx("ledger.payouts.paidFrom", "Paid from")}</Label>
                <Select value={payoutForm.bankAccountId} onValueChange={(value) => setPayoutForm({ ...payoutForm, bankAccountId: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {banks.map((bank) => (
                      <SelectItem key={bank.id} value={bank.id}>
                        {bankName(bank)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-ref">{tx("ledger.journal.reference", "Reference")}</Label>
                <Input id="po-ref" value={payoutForm.reference} onChange={(event) => setPayoutForm({ ...payoutForm, reference: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-notes">{tx("ledger.payouts.notes", "Notes")}</Label>
                <Input id="po-notes" value={payoutForm.notes} onChange={(event) => setPayoutForm({ ...payoutForm, notes: event.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoutForm(null)}>{tx("ledger.common.cancel", "Cancel")}</Button>
            <Button onClick={pay} disabled={busy}>{busy ? tx("ledger.common.working", "Working…") : tx("ledger.payouts.pay", "Pay out")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={settleForm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSettleForm(null);
            setPreview(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tx("ledger.payouts.settleTitle", "Settle a period for {name}", { name: settleForm?.ownerName ?? "" })}</DialogTitle>
            <DialogDescription>
              {tx(
                "ledger.payouts.settleHint",
                "The figures are the owner's statement's for the period. Settling posts the office's commission and the VAT on it, and any investment rent owed.",
              )}
            </DialogDescription>
          </DialogHeader>
          {settleForm && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="st-start">{tx("ledger.journals.from", "From")}</Label>
                  <Input id="st-start" type="date" value={settleForm.periodStart} onChange={(event) => setSettleForm({ ...settleForm, periodStart: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="st-end">{tx("ledger.journals.to", "To")}</Label>
                  <Input id="st-end" type="date" value={settleForm.periodEnd} max={todayInput()} onChange={(event) => setSettleForm({ ...settleForm, periodEnd: event.target.value })} />
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => loadPreview(settleForm)}>
                {tx("ledger.payouts.preview", "Show the figures")}
              </Button>
              {preview && (preview.openInvoices?.length ?? 0) > 0 && preview.commission + preview.managementFee > 0 && (
                <div className="space-y-2">
                  <Label>{tx("ledger.payouts.taxInvoice", "Tax invoice")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {tx(
                      "ledger.payouts.chooseInvoice",
                      "This owner has open invoices. Choose the one that is this period's tax invoice, or issue a new one.",
                    )}
                  </p>
                  <Select value={settleForm.invoice} onValueChange={(value) => setSettleForm({ ...settleForm, invoice: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder={tx("ledger.payouts.taxInvoice", "Tax invoice")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NEW_INVOICE}>{tx("ledger.payouts.newInvoice", "Issue a new tax invoice")}</SelectItem>
                      {preview.openInvoices!.map((invoice) => (
                        <SelectItem key={invoice.id} value={invoice.id}>
                          {invoice.invoiceNumber} · {formatDate(invoice.issueDate)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {preview && (
                <div className="space-y-1 rounded-lg border p-3 text-sm">
                  {previewRows.map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{label}</span>
                      <Money value={value} />
                    </div>
                  ))}
                  <div className="flex justify-between gap-4 border-t pt-2 font-semibold">
                    <span>
                      {preview.netDue >= 0
                        ? tx("ledger.payouts.dueToOwner", "Due to the owner for the period")
                        : tx("ledger.payouts.dueToOffice", "Due to the office for the period")}
                    </span>
                    <Money value={Math.abs(preview.netDue)} />
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleForm(null)}>{tx("ledger.common.cancel", "Cancel")}</Button>
            <Button
              onClick={settle}
              disabled={
                busy ||
                !preview ||
                ((preview.openInvoices?.length ?? 0) > 0 &&
                  preview.commission + preview.managementFee > 0 &&
                  !settleForm?.invoice)
              }
            >{busy ? tx("ledger.common.working", "Working…") : tx("ledger.payouts.settleAction", "Settle the period")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
