"use client";

/**
 * PropertyPro - Accounting setup
 *
 * Where the office sets its books up — the chart of accounts from the Saudi
 * template, the cut-over date the books start on, VAT registration, who
 * holds tenants' deposits — and keeps them: which account does each posting
 * job, the period lock, and posting the documents now.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BookOpen, CalendarCheck, Lock, RefreshCw, Settings2, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SYSTEM_KEY_TYPES, type SystemKey } from "@/lib/accounting/system-keys";
import { AccountPicker, LedgerHeader, NoLedgerAccess } from "./_shared/ledger-parts";
import {
  SYSTEM_KEY_TEXT,
  ledgerRequest,
  todayInput,
  useLedgerAccess,
  useLedgerError,
  useLedgerText,
} from "./_shared/ledger-ui";
import { useLedgerAccounts, useLedgerSetup, type LedgerSettingsView } from "./_shared/use-ledger-data";

interface SweepSummary {
  examined: number;
  created: number;
  replaced: number;
  reversed: number;
  unchanged: number;
  failed: number;
  remaining: number;
  complete: boolean;
}

/** The posting jobs, grouped the way an accountant reads them. */
const MAP_GROUPS: Array<{ id: string; title: readonly [string, string]; keys: SystemKey[] }> = [
  {
    id: "money",
    title: ["ledger.setup.mapGroup.money", "Where money is received"],
    keys: ["cash_on_hand", "bank", "pos_clearing", "gateway_clearing"],
  },
  {
    id: "receivables",
    title: ["ledger.setup.mapGroup.receivables", "What others owe the office"],
    keys: ["tenant_receivables", "customer_receivables", "input_vat"],
  },
  {
    id: "payables",
    title: ["ledger.setup.mapGroup.payables", "What the office owes"],
    keys: [
      "owner_payable",
      "owner_uncollected_rent",
      "security_deposits",
      "output_vat",
      "supplier_payables",
      "accrued_expenses",
    ],
  },
  {
    id: "equity",
    title: ["ledger.setup.mapGroup.equity", "Equity"],
    keys: ["opening_balance_equity", "retained_earnings"],
  },
  {
    id: "income",
    title: ["ledger.setup.mapGroup.income", "The office's income"],
    keys: ["commission_income", "management_fee_income", "rent_income", "investment_rent_income", "other_income"],
  },
  {
    id: "expenses",
    title: ["ledger.setup.mapGroup.expenses", "The office's costs"],
    keys: [
      "investment_rent_expense",
      "expense_maintenance",
      "expense_repair",
      "expense_utilities",
      "expense_cleaning",
      "expense_landscaping",
      "expense_insurance",
      "expense_taxes",
      "expense_legal",
      "expense_supplies",
      "expense_management_fee",
      "expense_advertising",
      "expense_capital_improvement",
      "expense_other",
    ],
  },
];

function firstOfMonthInput(): string {
  return `${todayInput().slice(0, 7)}-01`;
}

export default function AccountingSetupPage() {
  const access = useLedgerAccess();
  const { tx, text, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const { view, setView, loading, reload } = useLedgerSetup(access.canView);
  const accountsState = useLedgerAccounts(access.canView && Boolean(view?.isSetUp));

  const [cutOverInput, setCutOverInput] = useState<string | null>(null);
  const [vatRegistered, setVatRegistered] = useState<boolean | null>(null);
  const [vatNumber, setVatNumber] = useState<string | null>(null);
  const [depositHolder, setDepositHolder] = useState<string | null>(null);
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});
  const [closeInput, setCloseInput] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sweep, setSweep] = useState<SweepSummary | null>(null);

  const settings = view?.settings ?? null;
  const cutOver = cutOverInput ?? settings?.cutOverDate ?? firstOfMonthInput();
  const vat = vatRegistered ?? settings?.vatRegistered ?? false;
  const vatNo = vatNumber ?? settings?.vatNumber ?? "";
  const holder = depositHolder ?? settings?.depositHolder ?? "owner";

  const mapByKey = useMemo(
    () => new Map((view?.map ?? []).map((row) => [row.key, row])),
    [view?.map],
  );

  if (access.loading) return null;
  if (!access.canView) return <NoLedgerAccess />;

  async function run<T>(label: string, action: () => Promise<{ ok: boolean; data: T | null; code: string | null; message: string | null }>) {
    setBusy(label);
    const response = await action();
    setBusy(null);
    if (!response.ok) toast.error(describeError(response));
    return response;
  }

  async function setUp() {
    const response = await run("setup", () =>
      ledgerRequest<{ view: LedgerSettingsView; accountsCreated: number }>("/setup", {
        method: "POST",
        body: { cutOverDate: cutOver, vatRegistered: vat, vatNumber: vatNo || null },
      }),
    );
    if (response.ok && response.data) {
      toast.success(
        tx("ledger.setup.done", "Accounting is set up: {count} accounts created", {
          count: response.data.accountsCreated,
        }),
      );
      setView(response.data.view);
      accountsState.reload();
    }
  }

  async function saveSettings() {
    const response = await run("settings", () =>
      ledgerRequest<LedgerSettingsView>("/setup", {
        method: "PUT",
        body: {
          cutOverDate: cutOver,
          vatRegistered: vat,
          vatNumber: vatNo || null,
          depositHolder: holder,
        },
      }),
    );
    if (response.ok && response.data) {
      toast.success(tx("ledger.setup.saved", "Settings saved"));
      setView(response.data);
      setCutOverInput(null);
      setVatRegistered(null);
      setVatNumber(null);
      setDepositHolder(null);
    }
  }

  async function saveMap() {
    const response = await run("map", () =>
      ledgerRequest<LedgerSettingsView>("/setup", { method: "PUT", body: { accountMap: mapDraft } }),
    );
    if (response.ok && response.data) {
      toast.success(tx("ledger.setup.mapSaved", "Account map saved"));
      setView(response.data);
      setMapDraft({});
      accountsState.reload();
    }
  }

  async function savePeriod(closedThrough: string | null) {
    const response = await run("period", () =>
      ledgerRequest<LedgerSettingsView>("/period", { method: "PUT", body: { closedThrough } }),
    );
    if (response.ok && response.data) {
      toast.success(
        closedThrough
          ? tx("ledger.setup.periodClosed", "The books are closed through {date}", { date: formatDate(closedThrough) })
          : tx("ledger.setup.periodReopened", "All periods are open again"),
      );
      setView(response.data);
      setCloseInput("");
    }
  }

  async function runSweep() {
    const response = await run("sweep", () => ledgerRequest<SweepSummary>("/sweep", { method: "POST" }));
    if (response.ok && response.data) {
      setSweep(response.data);
      toast.success(
        response.data.complete
          ? tx("ledger.setup.sweepDone", "The books are up to date")
          : tx("ledger.setup.sweepPartial", "Partly posted; run it again to finish"),
      );
      reload();
    }
  }

  const header = (
    <LedgerHeader
      title={tx("ledger.setup.title", "Accounting setup")}
      subtitle={tx(
        "ledger.setup.subtitle",
        "How the office's books are kept: when they start, VAT, the period lock and which account does each job.",
      )}
      actions={
        view?.isSetUp ? (
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/accounting/chart-of-accounts">
                {tx("ledger.nav.chartOfAccounts", "Chart of accounts")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/accounting/journals/opening">
                {tx("ledger.setup.openingBalances", "Opening balances")}
              </Link>
            </Button>
          </>
        ) : null
      }
    />
  );

  if (loading && !view) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tx("ledger.common.loading", "Loading…")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!view?.isSetUp) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              {tx("ledger.setup.startTitle", "Set up the office's books")}
            </CardTitle>
            <CardDescription>
              {tx(
                "ledger.setup.startBody",
                "This creates the standard Saudi chart of accounts (Arabic and English, four levels), which you can then edit freely, and opens the office's cash, bank, POS and payment gateway accounts. Documents dated from the cut-over date are posted to the books; everything before it is carried by the opening balances.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cutover">{tx("ledger.setup.cutOver", "Cut-over date")}</Label>
              <Input
                id="cutover"
                type="date"
                value={cutOver}
                onChange={(event) => setCutOverInput(event.target.value)}
                disabled={!access.canManage}
              />
            </div>
            <div className="space-y-2">
              <Label>{tx("ledger.setup.vatRegistered", "VAT-registered")}</Label>
              <div className="flex h-10 items-center">
                <Switch checked={vat} onCheckedChange={setVatRegistered} disabled={!access.canManage} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vatno">{tx("ledger.setup.vatNumber", "VAT number")}</Label>
              <Input
                id="vatno"
                value={vatNo}
                inputMode="numeric"
                dir="ltr"
                onChange={(event) => setVatNumber(event.target.value)}
                disabled={!access.canManage || !vat}
                placeholder="3XXXXXXXXXXXXX3"
              />
            </div>
            <div className="sm:col-span-3">
              <Button onClick={setUp} disabled={!access.canManage || busy !== null}>
                {busy === "setup"
                  ? tx("ledger.common.working", "Working…")
                  : tx("ledger.setup.startAction", "Set up accounting")}
              </Button>
              {!access.canManage && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {tx("ledger.setup.needManage", "Setting up needs the Keep the books permission.")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const accounts = accountsState.accounts;
  const hasEntries = (view?.entryCount ?? 0) > 0;
  const mapDirty = Object.keys(mapDraft).length > 0;

  return (
    <div className="space-y-4">
      {header}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {tx("ledger.setup.generalTitle", "How the books are kept")}
          </CardTitle>
          <CardDescription>
            {tx("ledger.setup.generalBody", "Accrual basis: income and costs are recorded when they fall due, not when cash moves.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="cutover-edit">{tx("ledger.setup.cutOver", "Cut-over date")}</Label>
            <Input
              id="cutover-edit"
              type="date"
              value={cutOver}
              onChange={(event) => setCutOverInput(event.target.value)}
              disabled={!access.canManage || hasEntries}
            />
            {hasEntries && (
              <p className="text-xs text-muted-foreground">
                {tx("ledger.setup.cutOverLocked", "Fixed once the books have entries.")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{tx("ledger.setup.vatRegistered", "VAT-registered")}</Label>
            <div className="flex h-10 items-center">
              <Switch checked={vat} onCheckedChange={setVatRegistered} disabled={!access.canManage} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vatno-edit">{tx("ledger.setup.vatNumber", "VAT number")}</Label>
            <Input
              id="vatno-edit"
              value={vatNo}
              dir="ltr"
              inputMode="numeric"
              onChange={(event) => setVatNumber(event.target.value)}
              disabled={!access.canManage || !vat}
              placeholder="3XXXXXXXXXXXXX3"
            />
          </div>
          <div className="space-y-2">
            <Label>{tx("ledger.setup.depositHolder", "Deposits on owners' buildings")}</Label>
            <Select value={holder} onValueChange={setDepositHolder} disabled={!access.canManage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">
                  {tx("ledger.setup.depositHolderOwner", "Go to the owner with the rent")}
                </SelectItem>
                <SelectItem value="office">
                  {tx("ledger.setup.depositHolderOffice", "Are held by the office until refunded")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {access.canManage && (
            <div className="md:col-span-2 lg:col-span-4">
              <Button onClick={saveSettings} disabled={busy !== null}>
                {busy === "settings" ? tx("ledger.common.working", "Working…") : tx("ledger.common.save", "Save")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              {tx("ledger.setup.periodTitle", "Period lock")}
            </CardTitle>
            <CardDescription>
              {settings?.closedThrough
                ? tx("ledger.setup.closedThrough", "Closed through {date}. Nothing can be posted on or before it.", {
                    date: formatDate(settings.closedThrough),
                  })
                : tx("ledger.setup.noPeriodClosed", "No period is closed. Close a month once its figures are final.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="close-through">{tx("ledger.setup.closeThrough", "Close the books through")}</Label>
              <Input
                id="close-through"
                type="date"
                value={closeInput}
                max={todayInput()}
                onChange={(event) => setCloseInput(event.target.value)}
                disabled={!access.canClose}
              />
            </div>
            <Button
              onClick={() => savePeriod(closeInput)}
              disabled={!access.canClose || !closeInput || busy !== null}
            >
              <CalendarCheck className="h-4 w-4" />
              {tx("ledger.setup.closeAction", "Close period")}
            </Button>
            {settings?.closedThrough && (
              <Button variant="outline" onClick={() => savePeriod(null)} disabled={!access.canClose || busy !== null}>
                <Unlock className="h-4 w-4" />
                {tx("ledger.setup.reopenAction", "Reopen all periods")}
              </Button>
            )}
            {!access.canClose && (
              <p className="w-full text-xs text-muted-foreground">
                {tx("ledger.setup.needClose", "Closing a period needs the Close accounting periods permission.")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              {tx("ledger.setup.sweepTitle", "Posting the office's documents")}
            </CardTitle>
            <CardDescription>
              {settings?.lastSweepAt
                ? tx("ledger.setup.lastSweep", "Last brought up to date {date}.", {
                    date: formatDate(settings.lastSweepAt),
                  })
                : tx("ledger.setup.neverSwept", "Installments, payments, expenses and deposits have not been posted yet.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={runSweep} disabled={!access.canManage || busy !== null}>
              <RefreshCw className="h-4 w-4" />
              {busy === "sweep"
                ? tx("ledger.common.working", "Working…")
                : tx("ledger.setup.sweepAction", "Post documents now")}
            </Button>
            {sweep && (
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{tx("ledger.setup.sweep.created", "Posted: {count}", { count: sweep.created })}</Badge>
                <Badge variant="outline">{tx("ledger.setup.sweep.replaced", "Updated: {count}", { count: sweep.replaced })}</Badge>
                <Badge variant="outline">{tx("ledger.setup.sweep.reversed", "Reversed: {count}", { count: sweep.reversed })}</Badge>
                <Badge variant="outline">{tx("ledger.setup.sweep.unchanged", "Already up to date: {count}", { count: sweep.unchanged })}</Badge>
                {sweep.failed > 0 && (
                  <Badge variant="destructive">{tx("ledger.setup.sweep.failed", "Failed: {count}", { count: sweep.failed })}</Badge>
                )}
                {!sweep.complete && (
                  <Badge variant="secondary">{tx("ledger.setup.sweep.remaining", "Left for the next run: {count}", { count: sweep.remaining })}</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tx("ledger.setup.mapTitle", "Account map")}</CardTitle>
          <CardDescription>
            {tx(
              "ledger.setup.mapBody",
              "Which account each automatic posting uses. Each job starts on the account the template made for it; point it at another account of the same kind if the office keeps it elsewhere.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {MAP_GROUPS.map((group) => (
            <div key={group.id} className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">{text(group.title)}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {group.keys.map((key) => {
                  const current = mapByKey.get(key);
                  const value = mapDraft[key] ?? current?.accountId ?? "";
                  return (
                    <div key={key} className="flex flex-col gap-1 rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{text(SYSTEM_KEY_TEXT[key])}</span>
                        {current?.chosen && (
                          <Badge variant="secondary" className="text-[10px]">
                            {tx("ledger.setup.mapChosen", "Chosen by the office")}
                          </Badge>
                        )}
                      </div>
                      <AccountPicker
                        accounts={accounts}
                        value={value}
                        types={SYSTEM_KEY_TYPES[key]}
                        onChange={(accountId) =>
                          setMapDraft((draft) => ({ ...draft, [key]: accountId }))
                        }
                        disabled={!access.canManage}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {access.canManage && (
            <Button onClick={saveMap} disabled={!mapDirty || busy !== null}>
              {busy === "map" ? tx("ledger.common.working", "Working…") : tx("ledger.setup.mapSave", "Save the account map")}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
