"use client";

/**
 * PropertyPro - Banks and cash
 *
 * The office's bank, cash, POS and payment gateway accounts with their
 * balances from the books, and the transfers between them — cash banked, a
 * POS settlement reaching the bank, a gateway payout.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, ClipboardCheck, Landmark, MoreHorizontal, Pencil, Plus, Power, Undo2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BANK_ACCOUNT_KINDS, type BankAccountKind } from "@/lib/accounting/types";
import { LedgerHeader, LedgerNotSetUp, LedgerPagination, Money, NoLedgerAccess } from "../setup/_shared/ledger-parts";
import {
  BANK_KIND_TEXT,
  accountName,
  ledgerRequest,
  todayInput,
  useLedgerAccess,
  useLedgerError,
  useLedgerText,
} from "../setup/_shared/ledger-ui";

interface BankRow {
  id: string;
  kind: BankAccountKind;
  name: string;
  bankName: string | null;
  iban: string | null;
  accountNumber: string | null;
  currency: string;
  active: boolean;
  ledgerAccount: { id: string; code: string; nameAr: string; nameEn: string };
  balance: number;
  isDefault: boolean;
}

interface TransferRow {
  id: string;
  date: string;
  amount: number;
  reference: string | null;
  memo: string | null;
  status: string;
  from: { id: string; name: string; ledgerAccountName: { ar: string; en: string } };
  to: { id: string; name: string; ledgerAccountName: { ar: string; en: string } };
  journalNumber: number | null;
}

interface BankForm {
  id: string | null;
  name: string;
  kind: BankAccountKind;
  bankName: string;
  iban: string;
  accountNumber: string;
}

interface TransferForm {
  fromBankAccountId: string;
  toBankAccountId: string;
  amount: string;
  date: string;
  reference: string;
  memo: string;
}

export default function BanksPage() {
  const access = useLedgerAccess();
  const { tx, text, language, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [version, setVersion] = useState(0);
  const [bankForm, setBankForm] = useState<BankForm | null>(null);
  const [transferForm, setTransferForm] = useState<TransferForm | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!access.canView) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      const [bankResponse, transferResponse] = await Promise.all([
        ledgerRequest<{ accounts: BankRow[] }>("/banks", { signal: controller.signal }),
        ledgerRequest<{ transfers: TransferRow[] }>(`/transfers?page=${page}&limit=${limit}`, {
          signal: controller.signal,
        }),
      ]);
      if (controller.signal.aborted) return;
      setNotSetUp(bankResponse.code === "LEDGER_NOT_SET_UP");
      setBanks(bankResponse.ok ? (bankResponse.data?.accounts ?? []) : []);
      setTransfers(transferResponse.ok ? (transferResponse.data?.transfers ?? []) : []);
      setTotal(transferResponse.pagination?.total ?? 0);
      setLoading(false);
    })();
    return () => controller.abort();
  }, [access.canView, page, limit, version]);

  if (access.loading) return null;
  if (!access.canView) return <NoLedgerAccess />;
  if (notSetUp) return <LedgerNotSetUp canManage={access.canManage} />;

  const bankLabel = (bank: { name: string; ledgerAccountName?: { ar: string; en: string }; ledgerAccount?: { nameAr: string; nameEn: string } }) =>
    bank.name ||
    (bank.ledgerAccount
      ? accountName(bank.ledgerAccount, language)
      : bank.ledgerAccountName
        ? language === "ar"
          ? bank.ledgerAccountName.ar
          : bank.ledgerAccountName.en
        : "");

  async function saveBank() {
    if (!bankForm) return;
    setBusy(true);
    const body = {
      name: bankForm.name,
      kind: bankForm.kind,
      bankName: bankForm.bankName || null,
      iban: bankForm.iban || null,
      accountNumber: bankForm.accountNumber || null,
    };
    const response = bankForm.id
      ? await ledgerRequest(`/banks/${bankForm.id}`, { method: "PATCH", body })
      : await ledgerRequest("/banks", { method: "POST", body });
    setBusy(false);
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(bankForm.id ? tx("ledger.banks.saved", "Account saved") : tx("ledger.banks.opened", "Account opened"));
    setBankForm(null);
    setVersion((value) => value + 1);
  }

  async function toggleBank(bank: BankRow) {
    const response = await ledgerRequest(`/banks/${bank.id}`, { method: "PATCH", body: { active: !bank.active } });
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    setVersion((value) => value + 1);
  }

  async function saveTransfer() {
    if (!transferForm) return;
    setBusy(true);
    const response = await ledgerRequest<{ journalNumber: number }>("/transfers", {
      method: "POST",
      body: transferForm,
    });
    setBusy(false);
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(tx("ledger.banks.transferPosted", "Transfer posted as journal #{number}", { number: response.data?.journalNumber ?? "" }));
    setTransferForm(null);
    setVersion((value) => value + 1);
  }

  async function cancelTransfer(transfer: TransferRow) {
    if (!window.confirm(tx("ledger.banks.confirmCancel", "Cancel this transfer? Its entry is reversed today."))) return;
    const response = await ledgerRequest(`/transfers/${transfer.id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(tx("ledger.banks.transferCancelled", "Transfer cancelled"));
    setVersion((value) => value + 1);
  }

  const activeBanks = banks.filter((bank) => bank.active);

  const bankColumns: DataTableColumn<BankRow>[] = [
    {
      id: "name",
      header: tx("ledger.banks.account", "Account"),
      cell: (row) => (
        <div className="flex flex-col">
          <span className="flex items-center gap-2 text-sm font-medium">
            {bankLabel(row)}
            {row.isDefault && (
              <Badge variant="secondary" className="text-[10px]">
                {tx("ledger.banks.default", "Default")}
              </Badge>
            )}
            {!row.active && (
              <Badge variant="outline" className="text-[10px]">
                {tx("ledger.account.inactive", "Inactive")}
              </Badge>
            )}
          </span>
          <span className="font-mono text-xs text-muted-foreground" dir="ltr">
            {row.ledgerAccount.code}
          </span>
        </div>
      ),
      width: "min-w-[220px]",
    },
    {
      id: "kind",
      header: tx("ledger.banks.kind", "Kind"),
      cell: (row) => <span className="text-sm">{text(BANK_KIND_TEXT[row.kind])}</span>,
    },
    {
      id: "bank",
      header: tx("ledger.banks.bankDetails", "Bank details"),
      cell: (row) => (
        <div className="flex flex-col text-sm">
          <span>{row.bankName || "—"}</span>
          {row.iban && (
            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
              {row.iban}
            </span>
          )}
        </div>
      ),
      visibility: "md",
    },
    {
      id: "balance",
      header: tx("ledger.coa.balance", "Balance"),
      cell: (row) => <Money value={row.balance} className="text-sm font-semibold" />,
      align: "right",
    },
    {
      id: "actions",
      header: "",
      cell: (row) =>
        access.canView ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={tx("ledger.common.actions", "Actions")}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/accounting/banks/reconcile?bankAccountId=${row.id}`}>
                  <ClipboardCheck className="h-4 w-4" />
                  {tx("purchases.reconcile.action", "Reconcile")}
                </Link>
              </DropdownMenuItem>
              {access.canManage && (
                <>
                  <DropdownMenuItem
                    onClick={() =>
                      setBankForm({
                        id: row.id,
                        name: row.name || bankLabel(row),
                        kind: row.kind,
                        bankName: row.bankName ?? "",
                        iban: row.iban ?? "",
                        accountNumber: row.accountNumber ?? "",
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                    {tx("ledger.common.edit", "Edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleBank(row)}>
                    <Power className="h-4 w-4" />
                    {row.active ? tx("ledger.coa.deactivate", "Deactivate") : tx("ledger.coa.activate", "Activate")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
      width: "w-10",
      align: "center",
    },
  ];

  const transferColumns: DataTableColumn<TransferRow>[] = [
    {
      id: "date",
      header: tx("ledger.journals.date", "Date"),
      cell: (row) => <span className="text-sm">{formatDate(row.date)}</span>,
    },
    {
      id: "route",
      header: tx("ledger.banks.fromTo", "From → To"),
      cell: (row) => (
        <span className="text-sm">
          {bankLabel(row.from)} → {bankLabel(row.to)}
        </span>
      ),
      width: "min-w-[220px]",
    },
    {
      id: "reference",
      header: tx("ledger.journal.reference", "Reference"),
      cell: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.reference || "—"}
        </span>
      ),
      visibility: "md",
    },
    {
      id: "amount",
      header: tx("ledger.journals.amount", "Amount"),
      cell: (row) => <Money value={row.amount} className="text-sm font-medium" />,
      align: "right",
    },
    {
      id: "status",
      header: tx("ledger.journals.status", "Status"),
      cell: (row) =>
        row.status === "reversed" ? (
          <Badge variant="outline" className="text-xs">
            {tx("ledger.banks.cancelled", "Cancelled")}
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">
            {row.journalNumber
              ? tx("ledger.banks.journal", "Journal #{number}", { number: row.journalNumber })
              : tx("ledger.journals.posted", "Posted")}
          </Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: (row) =>
        access.canManage && row.status === "posted" ? (
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => cancelTransfer(row)}>
            <Undo2 className="h-4 w-4" />
            <span className="sr-only">{tx("ledger.banks.cancel", "Cancel transfer")}</span>
          </Button>
        ) : null,
      width: "w-10",
      align: "center",
    },
  ];

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("ledger.nav.banks", "Banks and cash")}
        subtitle={tx("ledger.banks.subtitle", "The office's bank, cash, POS and payment gateway accounts, with their balances in the books.")}
        actions={
          access.canManage ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={activeBanks.length < 2}
                onClick={() =>
                  setTransferForm({
                    fromBankAccountId: activeBanks[0]?.id ?? "",
                    toBankAccountId: activeBanks[1]?.id ?? "",
                    amount: "",
                    date: todayInput(),
                    reference: "",
                    memo: "",
                  })
                }
              >
                <ArrowLeftRight className="h-4 w-4" />
                {tx("ledger.banks.newTransfer", "New transfer")}
              </Button>
              <Button
                size="sm"
                onClick={() => setBankForm({ id: null, name: "", kind: "bank", bankName: "", iban: "", accountNumber: "" })}
              >
                <Plus className="h-4 w-4" />
                {tx("ledger.banks.add", "Add account")}
              </Button>
            </>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-5 w-5" />
            {tx("ledger.banks.accountsTitle", "Accounts")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={bankColumns}
            data={banks}
            loading={loading}
            getRowKey={(row) => row.id}
            emptyState={{ title: tx("ledger.banks.empty", "No bank or cash accounts yet") }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="h-5 w-5" />
            {tx("ledger.banks.transfersTitle", "Transfers")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            columns={transferColumns}
            data={transfers}
            loading={loading}
            getRowKey={(row) => row.id}
            emptyState={{ title: tx("ledger.banks.noTransfers", "No transfers yet") }}
          />
          <LedgerPagination page={page} limit={limit} total={total} onPageChange={setPage} onLimitChange={setLimit} />
        </CardContent>
      </Card>

      <Dialog open={bankForm !== null} onOpenChange={(open) => !open && setBankForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{bankForm?.id ? tx("ledger.banks.editTitle", "Edit account") : tx("ledger.banks.addTitle", "Open an account")}</DialogTitle>
            <DialogDescription>
              {tx("ledger.banks.formHint", "A new account gets its own sub-account under Cash and cash equivalents in the chart.")}
            </DialogDescription>
          </DialogHeader>
          {bankForm && (
            <div className="grid gap-3">
              <div className="space-y-2">
                <Label htmlFor="bank-name">{tx("ledger.banks.name", "Name")}</Label>
                <Input id="bank-name" value={bankForm.name} onChange={(event) => setBankForm({ ...bankForm, name: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{tx("ledger.banks.kind", "Kind")}</Label>
                <Select
                  value={bankForm.kind}
                  onValueChange={(value) => setBankForm({ ...bankForm, kind: value as BankAccountKind })}
                  disabled={Boolean(bankForm.id)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BANK_ACCOUNT_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {text(BANK_KIND_TEXT[kind])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-bank">{tx("ledger.banks.bankName", "Bank")}</Label>
                <Input id="bank-bank" value={bankForm.bankName} onChange={(event) => setBankForm({ ...bankForm, bankName: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-iban">{tx("ledger.banks.iban", "IBAN")}</Label>
                <Input id="bank-iban" dir="ltr" value={bankForm.iban} onChange={(event) => setBankForm({ ...bankForm, iban: event.target.value })} placeholder="SA00 0000 0000 0000 0000 0000" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-number">{tx("ledger.banks.accountNumber", "Account number")}</Label>
                <Input id="bank-number" dir="ltr" value={bankForm.accountNumber} onChange={(event) => setBankForm({ ...bankForm, accountNumber: event.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBankForm(null)}>
              {tx("ledger.common.cancel", "Cancel")}
            </Button>
            <Button onClick={saveBank} disabled={busy}>
              {busy ? tx("ledger.common.working", "Working…") : tx("ledger.common.save", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferForm !== null} onOpenChange={(open) => !open && setTransferForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tx("ledger.banks.newTransfer", "New transfer")}</DialogTitle>
            <DialogDescription>{tx("ledger.banks.transferHint", "Money moved between two of the office's own accounts.")}</DialogDescription>
          </DialogHeader>
          {transferForm && (
            <div className="grid gap-3">
              <div className="space-y-2">
                <Label>{tx("ledger.banks.from", "From")}</Label>
                <Select value={transferForm.fromBankAccountId} onValueChange={(value) => setTransferForm({ ...transferForm, fromBankAccountId: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBanks.map((bank) => (
                      <SelectItem key={bank.id} value={bank.id}>
                        {bankLabel(bank)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{tx("ledger.banks.to", "To")}</Label>
                <Select value={transferForm.toBankAccountId} onValueChange={(value) => setTransferForm({ ...transferForm, toBankAccountId: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBanks.map((bank) => (
                      <SelectItem key={bank.id} value={bank.id}>
                        {bankLabel(bank)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="tr-amount">{tx("ledger.journals.amount", "Amount")}</Label>
                  <Input id="tr-amount" dir="ltr" inputMode="decimal" value={transferForm.amount} onChange={(event) => setTransferForm({ ...transferForm, amount: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tr-date">{tx("ledger.journals.date", "Date")}</Label>
                  <Input id="tr-date" type="date" value={transferForm.date} onChange={(event) => setTransferForm({ ...transferForm, date: event.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tr-ref">{tx("ledger.journal.reference", "Reference")}</Label>
                <Input id="tr-ref" value={transferForm.reference} onChange={(event) => setTransferForm({ ...transferForm, reference: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tr-memo">{tx("ledger.journals.memo", "Description")}</Label>
                <Input id="tr-memo" value={transferForm.memo} onChange={(event) => setTransferForm({ ...transferForm, memo: event.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferForm(null)}>
              {tx("ledger.common.cancel", "Cancel")}
            </Button>
            <Button onClick={saveTransfer} disabled={busy}>
              {busy ? tx("ledger.common.working", "Working…") : tx("ledger.banks.postTransfer", "Post transfer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
