"use client";

/**
 * PropertyPro - Bank reconciliation (تسوية بنكية)
 *
 * One bank, cash, POS or gateway account ticked off by hand against its bank
 * statement. The book balance at a day (every line up to it) stands beside
 * the reconciled balance (only the ticked lines); between them is what the
 * books hold that the bank has not cleared yet — a cheque not presented, a
 * deposit in transit. The statement's own closing balance is typed here and
 * never saved: the difference to it says whether the books agree with the
 * bank.
 *
 * Reads and writes /api/accounting/ledger/reconciliation. The banks page
 * links here with `?bankAccountId=`; the account chosen stays in the address,
 * so a reload or a link sent on opens the same one.
 */

import Link from "next/link";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCheck,
  CircleCheck,
  ClipboardCheck,
  Info,
  Landmark,
  RefreshCw,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn, type DataTableEmptyState } from "@/components/ui/data-table";
import GlobalSearch from "@/components/ui/global-search";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { replaceQuery } from "@/components/reports/use-report-filters";
import { cn } from "@/lib/utils";
import { parseAmount } from "@/lib/accounting/journal-validation";
import { fromHalalas, toHalalas } from "@/lib/accounting/money";
import {
  RECONCILIATION_STATUSES,
  type ReconciliationLine,
  type ReconciliationStatus,
  type ReconciliationView,
} from "@/lib/accounting/reconciliation-types";
import type { BankAccountKind, SourceType } from "@/lib/accounting/types";
import { LedgerHeader, LedgerNotSetUp, LedgerPagination, Money, NoLedgerAccess } from "../../setup/_shared/ledger-parts";
import {
  BANK_KIND_TEXT,
  SOURCE_TYPE_TEXT,
  accountName,
  ledgerRequest,
  todayInput,
  useLedgerAccess,
  useLedgerError,
  useLedgerText,
  type Text,
} from "../../setup/_shared/ledger-ui";
import { useLedgerSetup } from "../../setup/_shared/use-ledger-data";
import { describeCharge } from "@/lib/i18n/charge-description";

/** A bank account as GET /banks lists it: what the picker shows. */
interface BankOption {
  id: string;
  kind: BankAccountKind;
  name: string;
  active: boolean;
  balance: number;
  ledgerAccount: { id: string; code: string; nameAr: string; nameEn: string };
}

/** What GET /reconciliation answers: the view, with its total in `pagination`. */
type ReconciliationData = Omit<ReconciliationView, "total">;

/** An answer from the API, kept with the request it answers. */
interface Answer<T> {
  key: string;
  data: T | null;
  total: number;
  code: string | null;
  message: string | null;
}

const STATUS_TEXT: Record<ReconciliationStatus, Text> = {
  unreconciled: ["purchases.reconcile.status.unreconciled", "Not reconciled"],
  reconciled: ["purchases.reconcile.status.reconciled", "Reconciled"],
  all: ["purchases.reconcile.status.all", "All"],
};

const PAGE_SIZE = 50;

/** The list's request: the account, the day, the tab, the page, and what narrows it. */
function linesQuery(values: {
  bankAccountId: string;
  asOf: string;
  from: string;
  status: ReconciliationStatus;
  search: string;
  page: number;
  limit: number;
}): string {
  const params = new URLSearchParams({
    bankAccountId: values.bankAccountId,
    asOf: values.asOf,
    status: values.status,
    page: String(values.page),
    limit: String(values.limit),
  });
  if (values.from) params.set("from", values.from);
  if (values.search) params.set("search", values.search);
  return params.toString();
}

/**
 * A statement balance as typed — "12,500.50", "١٢٥٠٠٫٥", or "-300" for an
 * overdrawn account — in halalas: null when blank, NaN when unreadable.
 */
function parseStatementBalance(value: string): number | null {
  const typed = value.trim();
  const negative = /^[-−]/.test(typed);
  const amount = parseAmount(negative ? typed.slice(1) : typed);
  if (amount === null) return negative ? Number.NaN : null;
  return negative ? -amount : amount;
}

/** One figure above the lines. */
function SummaryTile({
  label,
  value,
  hint,
  tone,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "success";
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-28" />
      ) : (
        <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "success" && "text-success")}>{value}</p>
      )}
      {hint && !loading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function BankReconciliationPage() {
  // useSearchParams needs a boundary of its own under the dashboard layout.
  return (
    <Suspense fallback={null}>
      <BankReconciliation />
    </Suspense>
  );
}

function BankReconciliation() {
  const access = useLedgerAccess();
  const { tx, text, language, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const searchParams = useSearchParams();
  const requestedBankId = searchParams.get("bankAccountId") ?? "";
  const setup = useLedgerSetup(access.canView);

  // The day the page opened, in the office's calendar: where "as of" and the
  // reconcile day start, and the latest day a line can be reconciled on.
  const [today] = useState(todayInput);
  const [asOf, setAsOf] = useState(today);
  const [from, setFrom] = useState("");
  const [status, setStatus] = useState<ReconciliationStatus>("unreconciled");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [reloads, setReloads] = useState(0);
  const [banksReloads, setBanksReloads] = useState(0);
  const [banksAnswer, setBanksAnswer] = useState<Answer<BankOption[]> | null>(null);
  const [answer, setAnswer] = useState<Answer<ReconciliationData> | null>(null);
  const [selection, setSelection] = useState<{ key: string | null; ids: string[] }>({ key: null, ids: [] });
  // The day the bank cleared what is ticked: the statement's day (the balances' day) until the person types one.
  const [clearedOnEdited, setClearedOnEdited] = useState<string | null>(null);
  const [statementText, setStatementText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!access.canView) return;
    const key = String(banksReloads);
    const controller = new AbortController();
    void (async () => {
      const response = await ledgerRequest<{ accounts: BankOption[] }>("/banks", { signal: controller.signal });
      if (controller.signal.aborted) return;
      setBanksAnswer({
        key,
        data: response.ok ? (response.data?.accounts ?? []) : null,
        total: 0,
        code: response.ok ? null : response.code,
        message: response.ok ? null : response.message,
      });
    })();
    return () => controller.abort();
  }, [access.canView, banksReloads]);

  // Active accounts, and the one the address asks for even when it has been
  // deactivated since: its lines can still be ticked off.
  const banks = banksAnswer?.data ?? [];
  const choices = banks.filter((row) => row.active || row.id === requestedBankId);
  const bankId = choices.some((row) => row.id === requestedBankId)
    ? requestedBankId
    : (choices.find((row) => row.active)?.id ?? "");
  const bank = choices.find((row) => row.id === bankId) ?? null;

  // The account shown is the one in the address. None asked for, or one that
  // is gone, becomes the first active account, written back without adding a
  // history entry.
  useEffect(() => {
    if (bankId && bankId !== requestedBankId) replaceQuery({ bankAccountId: bankId });
  }, [bankId, requestedBankId]);

  const asOfDay = asOf || today;
  const clearedOn = clearedOnEdited ?? (asOfDay < today ? asOfDay : today);
  // "#12", as the table writes a journal number, finds journal 12.
  const searchTerm = search.trim().replace(/^#(?=\d+$)/, "");
  const query = bankId
    ? linesQuery({ bankAccountId: bankId, asOf: asOfDay, from, status, search: searchTerm, page, limit })
    : null;
  const requestKey = query === null ? null : `${query}#${reloads}`;

  useEffect(() => {
    if (!access.canView || query === null || requestKey === null) return;
    const controller = new AbortController();
    void (async () => {
      const response = await ledgerRequest<ReconciliationData>(`/reconciliation?${query}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setAnswer({
        key: requestKey,
        data: response.ok ? response.data : null,
        total: response.pagination?.total ?? 0,
        code: response.ok ? null : response.code,
        message: response.ok ? null : response.message,
      });
      // Ticking off the last lines of the last page leaves that page empty:
      // step back to the last page there is.
      const paging = response.pagination;
      if (response.ok && paging && paging.page > paging.totalPages) setPage(paging.totalPages);
    })();
    return () => controller.abort();
  }, [access.canView, query, requestKey]);

  const answered = answer !== null && answer.key === requestKey;
  const loading = requestKey !== null && !answered;
  const lines = answered ? (answer?.data?.lines ?? []) : [];
  const failure = answered && answer && !answer.data ? { code: answer.code, message: answer.message } : null;
  // The figures stay up, dimmed, while the same account's next answer loads.
  const figures = answer?.data && answer.data.bank.id === bankId ? answer.data : null;
  const total = answer?.data ? answer.total : 0;

  // The lines ticked in the table belong to the list as it is shown now: any
  // change of account, day, tab, search or page, and the reload after an
  // action, starts a new selection. It never reaches across pages.
  const selectedIds = selection.key !== null && selection.key === requestKey ? selection.ids : [];
  const selected = lines.filter((line) => selectedIds.includes(line.id));
  const toTick = selected.filter((line) => !line.reconciledOn);
  const toUntick = selected.filter((line) => line.reconciledOn);
  const selectedNet = fromHalalas(
    selected.reduce((sum, line) => sum + toHalalas(line.debit) - toHalalas(line.credit), 0),
  );
  const select = (ids: string[]) => setSelection({ key: requestKey, ids });

  const clearedOnProblem = !clearedOn
    ? describeError({ code: "LEDGER_DATE_INVALID", message: null })
    : clearedOn > today
      ? describeError({ code: "RECONCILE_DATE_FUTURE", message: null })
      : null;
  const fromProblem =
    from && from > asOfDay
      ? tx("purchases.reconcile.fromAfterAsOf", "Choose a day on or before the day of the balances.")
      : null;

  const statement = parseStatementBalance(statementText);
  const statementInvalid = statement !== null && Number.isNaN(statement);
  const difference =
    figures && statement !== null && !statementInvalid
      ? statement - toHalalas(figures.summary.reconciledBalance)
      : null;

  if (access.loading) return null;
  if (!access.canView) return <NoLedgerAccess />;
  if (
    setup.view?.isSetUp === false ||
    banksAnswer?.code === "LEDGER_NOT_SET_UP" ||
    answer?.code === "LEDGER_NOT_SET_UP"
  ) {
    return <LedgerNotSetUp canManage={access.canManage} />;
  }

  const bankLabel = (row: BankOption) => row.name || accountName(row.ledgerAccount, language);
  const sourceText = (type: string) => {
    const entry = SOURCE_TYPE_TEXT[type as SourceType];
    return entry ? text(entry) : type;
  };

  function chooseBank(id: string) {
    replaceQuery({ bankAccountId: id });
    // The statement typed was this account's; another account has its own.
    setStatementText("");
    setPage(1);
  }

  function clearFilters() {
    setAsOf(today);
    setFrom("");
    setSearch("");
    setPage(1);
  }

  async function reconcile(reconciled: boolean) {
    const targets = reconciled ? toTick : toUntick;
    if (!bankId || targets.length === 0 || (reconciled && clearedOnProblem)) return;
    setBusy(true);
    const response = await ledgerRequest<{ changed: number; requested: number }>("/reconciliation", {
      method: "POST",
      body: {
        bankAccountId: bankId,
        lineIds: targets.map((line) => line.id),
        reconciled,
        ...(reconciled ? { reconciledOn: clearedOn } : {}),
      },
    });
    setBusy(false);
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    const count = response.data?.changed ?? 0;
    toast.success(
      reconciled
        ? tx("purchases.reconcile.reconciledToast", "Lines reconciled: {count}", { count })
        : tx("purchases.reconcile.unreconciledToast", "Lines taken off the reconciliation: {count}", { count }),
    );
    setSelection({ key: null, ids: [] });
    setReloads((value) => value + 1);
  }

  const header = (
    <LedgerHeader
      title={tx("purchases.reconcile.title", "Bank reconciliation")}
      subtitle={tx(
        "purchases.reconcile.subtitle",
        "Tick an account's lines off against its bank statement, and compare the reconciled balance with the statement's closing balance.",
      )}
      actions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/accounting/banks">
              <Landmark className="h-4 w-4" />
              {tx("ledger.nav.banks", "Banks and cash")}
            </Link>
          </Button>
          {bankId && (
            <Button variant="outline" size="sm" onClick={() => setReloads((value) => value + 1)} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              {tx("purchases.reconcile.refresh", "Refresh")}
            </Button>
          )}
        </>
      }
    />
  );

  // The office has not had the database update reconciliation needs.
  if (answer?.code === "PURCHASES_UNAVAILABLE") {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Info className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">{tx("purchases.reconcile.unavailableTitle", "Bank reconciliation is not available yet")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{describeError(answer)}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const banksLoaded = banksAnswer !== null && banksAnswer.key === String(banksReloads);
  if (!banksLoaded || (banksAnswer.data && choices.length === 0 && setup.loading)) {
    return (
      <div className="space-y-4">
        {header}
        <Skeleton className="h-24" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!banksAnswer.data) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <TriangleAlert className="h-8 w-8 text-destructive" />
            <p className="max-w-md text-sm text-destructive">{describeError(banksAnswer)}</p>
            <Button variant="outline" size="sm" onClick={() => setBanksReloads((value) => value + 1)}>
              {tx("purchases.reconcile.retry", "Try again")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (choices.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Landmark className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">{tx("purchases.reconcile.noAccounts", "No active bank or cash account to reconcile")}</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {tx("purchases.reconcile.noAccountsHint", "Open an account, or reactivate one, on the Banks and cash page.")}
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/accounting/banks">{tx("ledger.nav.banks", "Banks and cash")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const asOfText = formatDate(asOfDay);
  const narrowed = Boolean(searchTerm || from);
  const filtersSet = asOf !== today || from !== "" || search !== "";
  // On the All tab a selection can hold both kinds; each button then says
  // how many lines it acts on.
  const mixed = toTick.length > 0 && toUntick.length > 0;
  const emptyState: DataTableEmptyState = (() => {
    const counts = answer?.data?.summary;
    if (counts && counts.unreconciledCount + counts.reconciledCount === 0) {
      return {
        icon: <Landmark className="h-10 w-10 text-muted-foreground" />,
        title: tx("purchases.reconcile.empty.noLines", "This account has no lines up to {date}", { date: asOfText }),
        description: tx(
          "purchases.reconcile.empty.noLinesHint",
          "Money received or paid through this account shows here once it is in the books.",
        ),
      };
    }
    if (counts && status === "unreconciled" && counts.unreconciledCount === 0) {
      return {
        icon: <CircleCheck className="h-10 w-10 text-success" />,
        title: tx("purchases.reconcile.empty.allDone", "Nothing left to reconcile"),
        description: tx(
          "purchases.reconcile.empty.allDoneHint",
          "Every line up to {date} is ticked off against the bank statement.",
          { date: asOfText },
        ),
      };
    }
    if (narrowed) {
      return {
        title: tx("purchases.reconcile.empty.filtered", "No line matches the search or the dates"),
        description: tx("purchases.reconcile.empty.filteredHint", "Clear the search or choose other dates."),
      };
    }
    if (status === "reconciled") {
      return {
        title: tx("purchases.reconcile.empty.noneReconciled", "No line is reconciled yet"),
        description: tx(
          "purchases.reconcile.empty.noneReconciledHint",
          "Tick lines on the Not reconciled tab once they appear on the bank statement.",
        ),
      };
    }
    return { title: tx("purchases.reconcile.empty.none", "No lines to show") };
  })();

  const columns: DataTableColumn<ReconciliationLine>[] = [
    {
      id: "date",
      header: tx("purchases.reconcile.col.date", "Date"),
      cell: (row) => <span className="whitespace-nowrap text-sm">{formatDate(row.date)}</span>,
    },
    {
      id: "entry",
      header: tx("purchases.reconcile.col.entry", "Entry"),
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Link
            href={`/dashboard/accounting/journals/${row.entryId}`}
            className="text-sm font-medium text-primary tabular-nums hover:underline"
          >
            #{row.entryNumber}
          </Link>
          {row.reversed && (
            <Badge variant="outline" className="text-[10px]">
              {tx("purchases.reconcile.reversed", "Reversed")}
            </Badge>
          )}
          {row.isReversal && (
            <Badge variant="warning" className="text-[10px]">
              {tx("purchases.reconcile.reversal", "Reversal")}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "source",
      header: tx("purchases.reconcile.col.source", "Source"),
      cell: (row) => <span className="text-sm">{sourceText(row.sourceType)}</span>,
      visibility: "md",
    },
    {
      id: "reference",
      header: tx("purchases.reconcile.col.reference", "Reference"),
      cell: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.sourceRef || "—"}
        </span>
      ),
      visibility: "lg",
    },
    {
      id: "memo",
      header: tx("purchases.reconcile.col.description", "Description"),
      cell: (row) => (
        <span className="line-clamp-2 text-sm">
          {(row.memo && describeCharge({ description: row.memo }, language)) || "—"}
        </span>
      ),
      width: "min-w-[180px]",
    },
    {
      id: "party",
      header: tx("purchases.reconcile.col.party", "Party"),
      cell: (row) => <span className="text-sm">{row.partyName || "—"}</span>,
      visibility: "lg",
    },
    {
      id: "in",
      header: tx("purchases.reconcile.col.moneyIn", "Money in"),
      cell: (row) => (row.debit ? <Money value={row.debit} className="text-sm font-medium" /> : null),
      align: "right",
    },
    {
      id: "out",
      header: tx("purchases.reconcile.col.moneyOut", "Money out"),
      cell: (row) => (row.credit ? <Money value={row.credit} className="text-sm font-medium" /> : null),
      align: "right",
    },
    {
      id: "reconciledOn",
      header: tx("purchases.reconcile.col.reconciledOn", "Reconciled on"),
      cell: (row) =>
        row.reconciledOn ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-success">
            <CircleCheck className="h-3.5 w-3.5" />
            {formatDate(row.reconciledOn)}
          </span>
        ) : null,
      visibility: "md",
    },
  ];

  const summary = figures?.summary ?? null;
  const allReconciled = summary !== null && summary.unreconciledCount === 0 && summary.reconciledCount > 0;

  return (
    <div className="space-y-4">
      {header}

      <Card className="gap-0 py-4">
        <CardContent className="grid gap-4 px-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="reconcile-account">{tx("purchases.reconcile.account", "Account")}</Label>
            <Select value={bankId} onValueChange={chooseBank}>
              <SelectTrigger id="reconcile-account" className="h-10">
                <SelectValue placeholder={tx("purchases.reconcile.chooseAccount", "Choose an account")}>
                  {bank ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{bankLabel(bank)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{text(BANK_KIND_TEXT[bank.kind])}</span>
                    </span>
                  ) : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {choices.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    <span className="flex w-full min-w-0 items-center justify-between gap-4">
                      <span className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-2 font-medium">
                          <span className="truncate">{bankLabel(row)}</span>
                          {!row.active && (
                            <Badge variant="outline" className="text-[10px]">
                              {tx("ledger.account.inactive", "Inactive")}
                            </Badge>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">{text(BANK_KIND_TEXT[row.kind])}</span>
                      </span>
                      <Money value={row.balance} className="shrink-0 text-xs text-muted-foreground tabular-nums" />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {tx("purchases.reconcile.accountHint", "Each account is listed with its kind and its balance in the books.")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reconcile-as-of">{tx("purchases.reconcile.asOf", "Balances as of")}</Label>
            <Input
              id="reconcile-as-of"
              type="date"
              value={asOf}
              onChange={(event) => {
                setAsOf(event.target.value);
                setPage(1);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {tx("purchases.reconcile.asOfHint", "The balances are read at this day. Choose the statement's date.")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reconcile-from">{tx("purchases.reconcile.from", "Lines from (optional)")}</Label>
            <Input
              id="reconcile-from"
              type="date"
              value={from}
              max={asOfDay}
              error={fromProblem ?? undefined}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
            {!fromProblem && (
              <p className="text-xs text-muted-foreground">
                {tx("purchases.reconcile.fromHint", "The lines are listed from this day.")}
              </p>
            )}
          </div>
          {filtersSet && (
            <Button variant="ghost" size="sm" className="h-10 justify-self-start lg:mt-6" onClick={clearFilters}>
              <X className="h-4 w-4" />
              {tx("purchases.reconcile.clearFilters", "Clear")}
            </Button>
          )}
        </CardContent>
      </Card>

      {!failure && (
        <div className={cn("grid grid-cols-2 gap-4 lg:grid-cols-4", loading && summary && "opacity-60 transition-opacity")}>
          <SummaryTile
            label={tx("purchases.reconcile.bookBalance", "Book balance")}
            value={summary ? <Money value={summary.bookBalance} /> : null}
            hint={tx("purchases.reconcile.bookBalanceHint", "Every line up to {date}", { date: asOfText })}
            loading={!summary}
          />
          <SummaryTile
            label={tx("purchases.reconcile.reconciledBalance", "Reconciled balance")}
            value={summary ? <Money value={summary.reconciledBalance} /> : null}
            hint={
              summary
                ? tx("purchases.reconcile.reconciledBalanceHint", "Only the ticked lines. Count: {count}", {
                    count: summary.reconciledCount,
                  })
                : undefined
            }
            loading={!summary}
          />
          <SummaryTile
            label={tx("purchases.reconcile.unreconciledBalance", "Not yet reconciled")}
            value={summary ? <Money value={summary.unreconciledBalance} /> : null}
            hint={
              summary
                ? tx("purchases.reconcile.unreconciledHint", "Book balance less the reconciled balance. Lines not ticked: {count}", {
                    count: summary.unreconciledCount,
                  })
                : undefined
            }
            tone={allReconciled ? "success" : undefined}
            loading={!summary}
          />
          <SummaryTile
            label={tx("purchases.reconcile.lastReconciled", "Last reconciled on")}
            value={
              summary?.lastReconciledOn
                ? formatDate(summary.lastReconciledOn)
                : tx("purchases.reconcile.neverReconciled", "Not yet")
            }
            hint={tx("purchases.reconcile.lastReconciledHint", "The latest day the bank cleared a ticked line")}
            loading={!summary}
          />
        </div>
      )}

      <Card className="gap-0 py-4">
        <CardContent className="grid gap-4 px-4 md:grid-cols-2 md:items-start">
          <div className="space-y-1.5">
            <Label htmlFor="reconcile-statement">
              {tx("purchases.reconcile.statementBalance", "Bank statement balance")}
            </Label>
            <Input
              id="reconcile-statement"
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={statementText}
              error={
                statementInvalid
                  ? tx(
                      "purchases.reconcile.statementInvalid",
                      "Type an amount with at most two decimals, such as 12500.00.",
                    )
                  : undefined
              }
              onChange={(event) => setStatementText(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {tx(
                "purchases.reconcile.statementHint",
                "The closing balance printed on the bank statement for {date}. It is only compared here and is not saved.",
                { date: asOfText },
              )}
            </p>
          </div>
          {statement === null || statementInvalid || (!figures && !loading) ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <Info className="h-5 w-5 shrink-0" />
              {tx(
                "purchases.reconcile.statementEmpty",
                "Type the statement balance to compare it with the reconciled balance.",
              )}
            </div>
          ) : difference === null ? (
            <Skeleton className="h-24" />
          ) : difference === 0 ? (
            <div
              className="flex items-start gap-3 rounded-lg border border-success/20 bg-success/10 p-4 text-success"
              role="status"
            >
              <CircleCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">{tx("purchases.reconcile.agrees", "The books agree with the statement")}</p>
                <p className="text-sm">
                  {tx("purchases.reconcile.agreesHint", "The reconciled balance equals the statement balance.")}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-warning/20 bg-warning/10 p-4" role="status">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-warning">
                  {tx("purchases.reconcile.difference", "Difference to the statement")}
                </p>
                <Money value={fromHalalas(difference)} className="block text-xl font-semibold tabular-nums" />
                <p className="text-sm text-muted-foreground">
                  {tx(
                    "purchases.reconcile.differenceHint",
                    "The statement balance less the reconciled balance. Tick the lines that appear on the statement up to its date until it is zero.",
                  )}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="gap-2">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-5 w-5" />
              {tx("purchases.reconcile.linesTitle", "Lines of the account")}
            </CardTitle>
            <Tabs
              value={status}
              onValueChange={(value) => {
                setStatus(value as ReconciliationStatus);
                setPage(1);
              }}
            >
              <TabsList>
                {RECONCILIATION_STATUSES.map((value) => (
                  <TabsTrigger key={value} value={value} type="button">
                    {text(STATUS_TEXT[value])}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <GlobalSearch
            placeholder={tx("purchases.reconcile.searchPlaceholder", "Search by reference, description or journal number")}
            ariaLabel={tx("purchases.reconcile.searchLabel", "Search the lines")}
            initialValue={search}
            onSearch={(value) => {
              setSearch(value);
              setPage(1);
            }}
            isLoading={loading && Boolean(searchTerm)}
            className="w-full lg:max-w-md"
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            columns={columns}
            data={lines}
            loading={loading}
            getRowKey={(row) => row.id}
            emptyState={emptyState}
            error={
              failure
                ? {
                    message: describeError(failure),
                    icon: <TriangleAlert className="h-8 w-8 text-destructive" />,
                    onRetry: () => setReloads((value) => value + 1),
                    retryLabel: tx("purchases.reconcile.retry", "Try again"),
                  }
                : null
            }
            selection={
              access.canManage
                ? {
                    enabled: true,
                    selectedIds,
                    onSelectAll: (checked) => select(checked ? lines.map((line) => line.id) : []),
                    onSelectRow: (id, checked) =>
                      select(checked ? [...selectedIds.filter((value) => value !== id), id] : selectedIds.filter((value) => value !== id)),
                    getRowId: (row) => row.id,
                    selectAllLabel: tx("purchases.reconcile.selectPage", "Select all the lines on this page"),
                    selectRowLabel: (row) =>
                      tx("purchases.reconcile.selectLine", "Select the line of journal {number}", { number: row.entryNumber }),
                  }
                : undefined
            }
          />
          {total > 0 && (
            <LedgerPagination page={page} limit={limit} total={total} onPageChange={setPage} onLimitChange={setLimit} />
          )}
        </CardContent>
      </Card>

      {access.canManage && selected.length > 0 && (
        <div className="sticky bottom-4 z-20">
          <div
            role="region"
            aria-label={tx("purchases.reconcile.bulkLabel", "Selected lines")}
            className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-lg xl:flex-row xl:items-end xl:justify-between"
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {tx("purchases.reconcile.selectedCount", "Lines selected: {count}", { count: selected.length })}
                </p>
                {selected.length === lines.length && total > lines.length && (
                  <p className="text-xs text-muted-foreground">
                    {tx("purchases.reconcile.pageOnly", "Only the lines on this page are selected.")}
                  </p>
                )}
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">
                  {tx("purchases.reconcile.selectedNet", "Net of the selection (in less out)")}
                </p>
                <Money value={selectedNet} className="text-sm font-semibold tabular-nums" />
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {selected.length < lines.length && (
                  <Button variant="ghost" size="sm" onClick={() => select(lines.map((line) => line.id))}>
                    {tx("purchases.reconcile.selectAllOnPage", "Select the whole page (lines: {count})", {
                      count: lines.length,
                    })}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => select([])}>
                  <X className="h-4 w-4" />
                  {tx("purchases.reconcile.clearSelection", "Clear the selection")}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {toTick.length > 0 && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="reconcile-cleared-on" className="text-xs">
                      {tx("purchases.reconcile.clearedOn", "Cleared by the bank on")}
                    </Label>
                    <Input
                      id="reconcile-cleared-on"
                      type="date"
                      value={clearedOn}
                      max={today}
                      className="h-9 w-44"
                      error={clearedOnProblem ?? undefined}
                      onChange={(event) => setClearedOnEdited(event.target.value)}
                    />
                  </div>
                  <Button size="sm" disabled={busy || Boolean(clearedOnProblem)} onClick={() => void reconcile(true)}>
                    <CheckCheck className="h-4 w-4" />
                    {tx("purchases.reconcile.reconcileSelected", "Reconcile selected")}
                    {mixed && (
                      <span className="rounded bg-primary-foreground/20 px-1.5 text-xs tabular-nums">{toTick.length}</span>
                    )}
                  </Button>
                </>
              )}
              {toUntick.length > 0 && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void reconcile(false)}>
                  <Undo2 className="h-4 w-4" />
                  {tx("purchases.reconcile.unreconcileSelected", "Un-reconcile selected")}
                  {mixed && <span className="rounded bg-muted px-1.5 text-xs tabular-nums">{toUntick.length}</span>}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
