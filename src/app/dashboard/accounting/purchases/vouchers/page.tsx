"use client";

/**
 * PropertyPro - Payment vouchers (سند صرف)
 *
 * Every voucher the office wrote to pay a supplier, newest first: the account
 * it was paid from, what it paid on bills and what it left on account with
 * the supplier. A cancelled voucher keeps its number and stays in the list,
 * so the sequence has no gaps. Writing and cancelling one is the Pay
 * suppliers right; the list and its export are View and Export purchases.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, Eye, MoreHorizontal, Plus, Printer, Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { SortDirection } from "@/lib/table-sort";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import GlobalSearch from "@/components/ui/global-search";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportExportButton } from "@/components/reports/export-button";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { BankAccountKind } from "@/lib/accounting/types";
import { bankDisplayName, type VoucherMethod, type VoucherView } from "@/lib/accounting/purchases/types";
import { LedgerHeader, LedgerPagination, Money } from "../../setup/_shared/ledger-parts";
import { BANK_KIND_TEXT, type LedgerResponse } from "../../setup/_shared/ledger-ui";
import {
  SupplierPicker,
  VOUCHER_METHOD_TEXT,
  VoucherStatusBadge,
  purchasesRequest,
  queryString,
  useLedgerError,
  useLedgerText,
  usePurchasesAccess,
  useSupplierOptions,
} from "../_shared/purchases-ui";
import {
  CancelVoucherDialog,
  NoPurchasesAccess,
  RefusalState,
  SummaryTiles,
  useBankAccounts,
  voucherPdfHref,
} from "./_parts/voucher-kit";

type StatusFilter = "all" | "posted" | "cancelled";

const ALL = "__all__";

interface VoucherListSummary {
  count: number;
  /** Posted vouchers only. */
  totalAmount: number;
}

type Access = ReturnType<typeof usePurchasesAccess>;

export default function PaymentVouchersPage() {
  const access = usePurchasesAccess();
  if (access.loading) return null;
  if (!access.canView) return <NoPurchasesAccess />;
  return <VoucherList access={access} />;
}

function VoucherList({ access }: { access: Access }) {
  const { tx, text, language, formatDate } = useLedgerText();
  const { formatNumber } = useLocalizationContext();
  const describeError = useLedgerError();
  const { suppliers } = useSupplierOptions(true, true);
  const bankList = useBankAccounts(true);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [supplierId, setSupplierId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  // A header's order, as the API names it (voucherDate, number, amount) and
  // applies to every page; no key: latest voucher date first.
  const [sort, setSort] = useState<{ key: string | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });
  const [version, setVersion] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<VoucherView | null>(null);

  const reversed = Boolean(from && to && from > to);
  const filters = {
    search: search.trim(),
    status: status === "all" ? "" : status,
    supplierId,
    bankAccountId,
    from,
    to,
  };
  const query = queryString({
    ...filters,
    page,
    limit,
    sortBy: sort.key,
    sortOrder: sort.key ? sort.direction : null,
  });

  const [result, setResult] = useState<{
    query: string;
    response: LedgerResponse<{ vouchers: VoucherView[] }>;
  } | null>(null);

  useEffect(() => {
    if (reversed) return;
    const controller = new AbortController();
    void (async () => {
      const response = await purchasesRequest<{ vouchers: VoucherView[] }>(`/vouchers${query}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResult({ query, response });
    })();
    return () => controller.abort();
  }, [query, reversed, version]);

  // A reload after a cancel keeps the rows on screen until the new ones come.
  const current = result?.query === query ? result.response : null;
  const loading = !reversed && current === null;
  const vouchers = current?.ok ? (current.data?.vouchers ?? []) : [];
  const summary = current?.ok ? ((current.raw as { summary?: VoucherListSummary } | undefined)?.summary ?? null) : null;
  const total = current?.pagination?.total ?? 0;
  const refusal =
    current && !current.ok && (current.code === "PURCHASES_UNAVAILABLE" || current.code === "LEDGER_NOT_SET_UP")
      ? current
      : null;
  const failure = current && !current.ok && !refusal ? describeError(current) : null;

  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const narrowed = Boolean(filters.search || filters.status || supplierId || bankAccountId || from || to);
  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    setSupplierId("");
    setBankAccountId("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  const exportParams = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  const methodText = (method: string) => {
    const entry = VOUCHER_METHOD_TEXT[method as VoucherMethod];
    return entry ? text(entry) : method;
  };
  const kindText = (kind: string) => {
    const entry = BANK_KIND_TEXT[kind as BankAccountKind];
    return entry ? text(entry) : kind;
  };

  const newVoucherButton = access.canPay ? (
    <Button asChild size="sm">
      <Link href="/dashboard/accounting/purchases/vouchers/new">
        <Plus className="h-4 w-4" />
        {tx("purchases.vouchers.new", "New payment voucher")}
      </Link>
    </Button>
  ) : null;

  const columns: DataTableColumn<VoucherView>[] = [
    {
      id: "number",
      sortKey: "number",
      header: tx("purchases.vouchers.col.number", "Number"),
      cell: (row) => (
        <Link
          href={`/dashboard/accounting/purchases/vouchers/${row.id}`}
          className="font-mono text-xs font-medium text-primary hover:underline"
          dir="ltr"
        >
          {row.displayNumber}
        </Link>
      ),
      width: "min-w-[120px]",
    },
    {
      id: "date",
      sortKey: "voucherDate",
      header: tx("purchases.vouchers.col.date", "Date"),
      cell: (row) => <span className="whitespace-nowrap text-sm">{formatDate(row.voucherDate)}</span>,
      width: "min-w-[110px]",
    },
    {
      id: "supplier",
      header: tx("purchases.vouchers.col.supplier", "Supplier"),
      cell: (row) => <span className="text-sm font-medium">{row.supplier?.name ?? "—"}</span>,
      width: "min-w-[160px]",
    },
    {
      id: "account",
      header: tx("purchases.vouchers.col.account", "Paid from"),
      cell: (row) =>
        row.bankAccount ? (
          <div className="flex flex-col">
            <span className="text-sm">{bankDisplayName(row.bankAccount, language)}</span>
            <span className="text-xs text-muted-foreground">{kindText(row.bankAccount.kind)}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      visibility: "md",
      width: "min-w-[150px]",
    },
    {
      id: "method",
      header: tx("purchases.vouchers.col.method", "Method"),
      cell: (row) => <span className="text-sm">{methodText(row.method)}</span>,
      visibility: "lg",
    },
    {
      id: "reference",
      header: tx("purchases.vouchers.col.reference", "Reference"),
      cell: (row) =>
        row.reference ? (
          <span className="font-mono text-xs" dir="ltr">
            {row.reference}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      visibility: "lg",
    },
    {
      id: "amount",
      sortKey: "amount",
      header: tx("purchases.vouchers.col.amount", "Amount"),
      cell: (row) => (
        <Money
          value={row.amount}
          className={`whitespace-nowrap text-sm font-semibold ${row.status === "cancelled" ? "text-muted-foreground" : ""}`}
        />
      ),
      align: "right",
      width: "min-w-[120px]",
    },
    {
      id: "onAccount",
      header: tx("purchases.vouchers.col.onAccount", "On account"),
      cell: (row) =>
        row.onAccount > 0 ? (
          <Money value={row.onAccount} className="whitespace-nowrap text-sm text-amber-600 dark:text-amber-400" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      align: "right",
      visibility: "md",
      width: "min-w-[110px]",
    },
    {
      id: "status",
      header: tx("purchases.vouchers.col.status", "Status"),
      cell: (row) => <VoucherStatusBadge status={row.status} />,
    },
    {
      id: "actions",
      header: <span className="sr-only">{tx("ledger.common.actions", "Actions")}</span>,
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label={tx("purchases.vouchers.actions.menu", "Actions for {number}", { number: row.displayNumber })}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/accounting/purchases/vouchers/${row.id}`}>
                <Eye className="h-4 w-4" />
                {tx("purchases.vouchers.actions.view", "View")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={voucherPdfHref(row.id, language)} target="_blank" rel="noopener noreferrer">
                <Printer className="h-4 w-4" />
                {tx("purchases.vouchers.actions.print", "Print or save as PDF")}
              </a>
            </DropdownMenuItem>
            {access.canPay && row.status === "posted" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setCancelTarget(row)}>
                  <Ban className="h-4 w-4" />
                  {tx("purchases.vouchers.actions.cancel", "Cancel voucher")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      width: "w-10",
      align: "center",
    },
  ];

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("purchases.vouchers.title", "Payment vouchers")}
        subtitle={tx(
          "purchases.vouchers.subtitle",
          "Money paid to suppliers from the office's bank and cash accounts. A voucher is posted to the books as soon as it is written.",
        )}
        actions={
          refusal ? null : (
            <>
              {access.canExport && (
                <ReportExportButton
                  endpoint="/api/accounting/purchases/vouchers"
                  params={exportParams}
                  disabled={loading || reversed || vouchers.length === 0}
                />
              )}
              {newVoucherButton}
            </>
          )
        }
      />

      {refusal ? (
        <RefusalState code={refusal.code} message={describeError(refusal)} canManageBooks={access.canManageBooks} />
      ) : (
        <>
          <SummaryTiles
            loading={loading}
            items={[
              {
                label: tx("purchases.vouchers.stats.count", "Vouchers"),
                value: (
                  <span dir="ltr">{formatNumber(summary?.count ?? 0)}</span>
                ),
                hint: tx("purchases.vouchers.stats.countHint", "Matching the filters, cancelled ones included"),
              },
              {
                label: tx("purchases.vouchers.stats.total", "Total paid"),
                value: <Money value={summary?.totalAmount ?? 0} />,
                hint: tx("purchases.vouchers.stats.totalHint", "Posted vouchers only"),
              },
            ]}
          />

          <Card className="gap-2">
            <CardHeader>
              <div className="flex flex-col gap-3 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
                <GlobalSearch
                  placeholder={tx(
                    "purchases.vouchers.filters.search",
                    "Search by voucher number, supplier, reference or notes",
                  )}
                  ariaLabel={tx("purchases.vouchers.filters.searchLabel", "Search payment vouchers")}
                  initialValue={search}
                  debounceDelay={300}
                  onSearch={onSearch}
                  isLoading={loading && Boolean(search)}
                  className="min-w-0 flex-1"
                  inputClassName="h-10 bg-white dark:bg-gray-800"
                />
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full min-w-[160px] space-y-1.5 sm:w-auto">
                    <Label htmlFor="vouchers-status">{tx("purchases.vouchers.filters.status", "Status")}</Label>
                    <Select
                      value={status}
                      onValueChange={(value) => {
                        setStatus(value as StatusFilter);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger id="vouchers-status" className="h-10 bg-white dark:bg-gray-800">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{tx("purchases.vouchers.filters.allStatuses", "All statuses")}</SelectItem>
                        <SelectItem value="posted">{tx("purchases.voucherStatus.posted", "Posted")}</SelectItem>
                        <SelectItem value="cancelled">{tx("purchases.voucherStatus.cancelled", "Cancelled")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-full min-w-[220px] space-y-1.5 sm:w-auto">
                    <Label htmlFor="vouchers-supplier">{tx("purchases.vouchers.filters.supplier", "Supplier")}</Label>
                    <SupplierPicker
                      id="vouchers-supplier"
                      suppliers={suppliers}
                      value={supplierId}
                      includeAll
                      onChange={(value) => {
                        setSupplierId(value);
                        setPage(1);
                      }}
                      className="h-10 bg-white dark:bg-gray-800"
                    />
                  </div>
                  {bankList.code === null && (
                    <div className="w-full min-w-[200px] space-y-1.5 sm:w-auto">
                      <Label htmlFor="vouchers-account">{tx("purchases.vouchers.filters.account", "Paid from")}</Label>
                      <Select
                        value={bankAccountId || ALL}
                        onValueChange={(value) => {
                          setBankAccountId(value === ALL ? "" : value);
                          setPage(1);
                        }}
                      >
                        <SelectTrigger id="vouchers-account" className="h-10 bg-white dark:bg-gray-800">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>{tx("purchases.vouchers.filters.allAccounts", "All accounts")}</SelectItem>
                          {bankList.banks.map((bank) => (
                            <SelectItem key={bank.id} value={bank.id}>
                              {bankDisplayName(bank, language)}
                              <span className="ms-1 text-xs text-muted-foreground">({kindText(bank.kind)})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="w-full space-y-1.5 sm:w-auto">
                    <Label htmlFor="vouchers-from">{tx("purchases.vouchers.filters.from", "From")}</Label>
                    <Input
                      id="vouchers-from"
                      type="date"
                      className="h-10 bg-white dark:bg-gray-800"
                      value={from}
                      max={to || undefined}
                      onChange={(event) => {
                        setFrom(event.target.value);
                        setPage(1);
                      }}
                    />
                  </div>
                  <div className="w-full space-y-1.5 sm:w-auto">
                    <Label htmlFor="vouchers-to">{tx("purchases.vouchers.filters.to", "To")}</Label>
                    <Input
                      id="vouchers-to"
                      type="date"
                      className="h-10 bg-white dark:bg-gray-800"
                      value={to}
                      min={from || undefined}
                      onChange={(event) => {
                        setTo(event.target.value);
                        setPage(1);
                      }}
                    />
                  </div>
                  {narrowed && (
                    <Button variant="ghost" size="sm" className="h-10" onClick={clearFilters}>
                      <X className="h-4 w-4" />
                      {tx("purchases.vouchers.filters.clear", "Clear filters")}
                    </Button>
                  )}
                </div>
                {reversed && (
                  <p role="alert" className="text-xs text-destructive">
                    {describeError({ code: "LEDGER_PERIOD_REVERSED", message: null })}
                  </p>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <DataTable
                columns={columns}
                data={vouchers}
                loading={loading}
                error={failure ? { message: failure, onRetry: () => setVersion((value) => value + 1), retryLabel: tx("purchases.vouchers.retry", "Try again") } : null}
                getRowKey={(row) => row.id}
                // Sorted by the API across every page: only the number, the
                // date and the amount can be; the other headers stay plain.
                sort={{
                  key: sort.key,
                  direction: sort.direction,
                  onSortChange: (key, direction) => {
                    setSort({ key, direction });
                    setPage(1);
                  },
                }}
                emptyState={{
                  icon: <Receipt className="h-12 w-12 text-muted-foreground" />,
                  title: narrowed
                    ? tx("purchases.vouchers.empty.filteredTitle", "No voucher matches these filters")
                    : tx("purchases.vouchers.empty.title", "No payment vouchers yet"),
                  description: narrowed
                    ? tx("purchases.vouchers.empty.filtered", "Change or clear the filters to see more.")
                    : tx("purchases.vouchers.empty.body", "Write a voucher whenever the office pays a supplier."),
                  action: narrowed ? undefined : (newVoucherButton ?? undefined),
                }}
              />
              {!loading && total > 0 && (
                <LedgerPagination page={page} limit={limit} total={total} onPageChange={setPage} onLimitChange={setLimit} />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <CancelVoucherDialog
        voucher={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onCancelled={() => {
          setCancelTarget(null);
          setVersion((value) => value + 1);
        }}
      />
    </div>
  );
}
