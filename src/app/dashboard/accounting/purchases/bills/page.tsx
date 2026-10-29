"use client";

/**
 * PropertyPro - Purchase bills
 *
 * Every bill the office's suppliers have sent: waiting for approval, owed,
 * paid in part or in full, or cancelled. The cards add up everything the
 * filters match — not only the page shown — and each bill is approved, sent
 * back, cancelled or paid from its row, as far as its state and the reader's
 * rights allow. A link can open the list narrowed (`?supplierId=…&status=open`,
 * as the suppliers list does for a supplier's open bills).
 */

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Eye,
  FileText,
  Hourglass,
  MoreHorizontal,
  Pencil,
  Percent,
  Plus,
  Undo2,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
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
import type { BillView } from "@/lib/accounting/purchases/types";
import { cn } from "@/lib/utils";
import { LedgerHeader, LedgerNotSetUp, LedgerPagination, Money } from "../../setup/_shared/ledger-parts";
import type { Text } from "../../setup/_shared/ledger-ui";
import {
  BILL_STATUS_TEXT,
  BillStatusBadge,
  SupplierPicker,
  purchasesRequest,
  queryString,
  useLedgerError,
  useLedgerText,
  usePurchasesAccess,
  useSupplierOptions,
} from "../_shared/purchases-ui";
import {
  BILLS_HREF,
  NoBillAccess,
  PurchasesUnavailable,
  allowedBillActions,
  billHref,
  payBillHref,
  useBillActions,
  useBooksNotSetUp,
} from "./_parts/bill-form";

const STATUS_FILTERS = ["all", "pending", "approved", "partially_paid", "paid", "cancelled", "open", "overdue"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const isStatusFilter = (value: string): value is StatusFilter => (STATUS_FILTERS as readonly string[]).includes(value);

const STATUS_FILTER_TEXT: Record<StatusFilter, Text> = {
  all: ["ledger.journals.allStatuses", "All statuses"],
  pending: BILL_STATUS_TEXT.pending,
  approved: BILL_STATUS_TEXT.approved,
  partially_paid: BILL_STATUS_TEXT.partially_paid,
  paid: BILL_STATUS_TEXT.paid,
  cancelled: BILL_STATUS_TEXT.cancelled,
  open: ["purchases.bills.filter.open", "Owed, not paid in full"],
  overdue: ["purchases.status.overdue", "Overdue"],
};

/** Totals over everything the filters match (the route's `summary`). */
interface BillSummary {
  count: number;
  totalAmount: number;
  vatAmount: number;
  amountPaid: number;
  outstanding: number;
  overdue: number;
}

const TILE_TONES = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  error: "bg-error/10 text-error",
} as const;

function SummaryTile({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: LucideIcon;
  tone: keyof typeof TILE_TONES;
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex items-start justify-between gap-3 px-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground/85">{label}</p>
          <div className="mt-2 text-xl font-bold tracking-tight tabular-nums">
            <Money value={value} />
          </div>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("shrink-0 rounded-lg p-2", TILE_TONES[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function PurchaseBillsPage() {
  return (
    <Suspense fallback={null}>
      <BillsFromAddress />
    </Suspense>
  );
}

function BillsFromAddress() {
  const params = useSearchParams();
  const supplierId = params.get("supplierId") ?? "";
  const status = params.get("status") ?? "";
  return (
    <PurchaseBills
      key={`${supplierId}|${status}`}
      initialSupplierId={supplierId}
      initialStatus={isStatusFilter(status) ? status : "all"}
    />
  );
}

function PurchaseBills({ initialSupplierId, initialStatus }: { initialSupplierId: string; initialStatus: StatusFilter }) {
  const access = usePurchasesAccess();
  const { tx, text, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const notSetUp = useBooksNotSetUp(access.canView);
  // Inactive suppliers too: their old bills are still looked up.
  const { suppliers } = useSupplierOptions(access.canView, true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  // A header's order, as the API names it (billDate, dueDate, number,
  // totalAmount) and applies to every page; no key: latest bill date first.
  const [sort, setSort] = useState<{ key: string | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });
  const [bills, setBills] = useState<BillView[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<BillSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ code: string | null; message: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const actions = useBillActions(() => setVersion((value) => value + 1));

  useEffect(() => {
    if (!access.canView) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      const response = await purchasesRequest<{ bills: BillView[] }>(
        `/bills${queryString({
          search,
          status: status === "all" ? null : status,
          supplierId,
          from,
          to,
          page,
          limit,
          sortBy: sort.key,
          sortOrder: sort.key ? sort.direction : null,
        })}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (response.ok) {
        setBills(response.data?.bills ?? []);
        setTotal(response.pagination?.total ?? 0);
        setSummary((response.raw as { summary?: BillSummary } | undefined)?.summary ?? null);
        setFailure(null);
      } else {
        setBills([]);
        setTotal(0);
        setSummary(null);
        setFailure({ code: response.code, message: response.message });
      }
      setLoading(false);
    })();
    return () => controller.abort();
  }, [access.canView, search, status, supplierId, from, to, page, limit, sort, version]);

  if (access.loading) return null;
  if (!access.canView) return <NoBillAccess />;
  if (failure?.code === "PURCHASES_UNAVAILABLE") return <PurchasesUnavailable />;
  if (notSetUp || failure?.code === "LEDGER_NOT_SET_UP") return <LedgerNotSetUp canManage={access.canManageBooks} />;

  const hasFilters = Boolean(search || supplierId || from || to) || status !== "all";
  const filterValues: Record<string, string> = {
    from,
    to,
    status: status === "all" ? "" : status,
    supplierId,
    search,
  };
  const exportParams = new URLSearchParams(Object.entries(filterValues).filter(([, value]) => value));
  const newBillHref = supplierId
    ? `${BILLS_HREF}/new?${new URLSearchParams({ supplierId }).toString()}`
    : `${BILLS_HREF}/new`;

  function clearFilters() {
    setSearch("");
    setStatus("all");
    setSupplierId("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  const columns: DataTableColumn<BillView>[] = [
    {
      id: "number",
      header: tx("purchases.bills.col.number", "Bill"),
      sortKey: "number",
      cell: (bill) => (
        <Link href={billHref(bill.id)} className="font-mono text-xs font-medium text-primary hover:underline" dir="ltr">
          {bill.displayNumber}
        </Link>
      ),
      width: "min-w-[120px]",
    },
    {
      id: "date",
      header: tx("purchases.bills.col.date", "Date"),
      sortKey: "billDate",
      cell: (bill) => <span className="text-sm">{formatDate(bill.billDate)}</span>,
      visibility: "md",
    },
    {
      id: "due",
      header: tx("purchases.bills.col.due", "Due date"),
      sortKey: "dueDate",
      cell: (bill) => (
        <span className={cn("text-sm", bill.overdue && "font-medium text-destructive")}>{formatDate(bill.dueDate)}</span>
      ),
    },
    {
      id: "supplier",
      header: tx("purchases.bills.col.supplier", "Supplier"),
      cell: (bill) => (
        <span className="block max-w-[220px] truncate text-sm" title={bill.supplier?.name}>
          {bill.supplier?.name ?? "—"}
        </span>
      ),
      width: "min-w-[160px]",
    },
    {
      id: "supplierInvoice",
      header: tx("purchases.bills.col.supplierInvoice", "Supplier's invoice"),
      cell: (bill) =>
        bill.supplierInvoiceNumber ? (
          <span className="font-mono text-xs" dir="ltr">
            {bill.supplierInvoiceNumber}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      visibility: "lg",
    },
    {
      id: "total",
      sortKey: "totalAmount",
      header: tx("purchases.bills.col.total", "Total"),
      cell: (bill) => <Money value={bill.totalAmount} className="text-sm font-medium" />,
      align: "right",
    },
    {
      id: "paid",
      header: tx("purchases.bills.col.paid", "Paid"),
      cell: (bill) => <Money value={bill.amountPaid} className="text-sm" />,
      align: "right",
      visibility: "lg",
    },
    {
      id: "balance",
      header: tx("purchases.bills.col.balance", "Balance"),
      cell: (bill) => <Money value={bill.balance} className={cn("text-sm", bill.balance > 0 && "font-semibold")} />,
      align: "right",
      visibility: "sm",
    },
    {
      id: "status",
      header: tx("purchases.bills.col.status", "Status"),
      cell: (bill) => <BillStatusBadge status={bill.status} overdue={bill.overdue} />,
    },
    {
      id: "actions",
      header: "",
      cell: (bill) => {
        const allowed = allowedBillActions(bill, access);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label={tx("ledger.common.actions", "Actions")}
                disabled={actions.busyId === bill.id}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={billHref(bill.id)}>
                  <Eye className="h-4 w-4" />
                  {tx("common.view", "View")}
                </Link>
              </DropdownMenuItem>
              {allowed.edit && (
                <DropdownMenuItem asChild>
                  <Link href={`${billHref(bill.id)}/edit`}>
                    <Pencil className="h-4 w-4" />
                    {tx("ledger.common.edit", "Edit")}
                  </Link>
                </DropdownMenuItem>
              )}
              {allowed.approve && (
                <DropdownMenuItem onClick={() => actions.approve(bill)}>
                  <CheckCircle2 className="h-4 w-4" />
                  {tx("purchases.bills.approve", "Approve")}
                </DropdownMenuItem>
              )}
              {allowed.reopen && (
                <DropdownMenuItem onClick={() => actions.requestReopen(bill)}>
                  <Undo2 className="h-4 w-4" />
                  {tx("purchases.bills.sendBack", "Send back")}
                </DropdownMenuItem>
              )}
              {allowed.pay && (
                <DropdownMenuItem asChild>
                  <Link href={payBillHref(bill)}>
                    <Wallet className="h-4 w-4" />
                    {tx("purchases.bills.pay", "Pay")}
                  </Link>
                </DropdownMenuItem>
              )}
              {allowed.cancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => actions.requestCancel(bill)}>
                    <Ban className="h-4 w-4" />
                    {tx("purchases.bills.cancel", "Cancel bill")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
      width: "w-10",
      align: "center",
    },
  ];

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("nav.accounting.purchaseBills", "Purchase bills")}
        subtitle={tx(
          "purchases.bills.subtitle",
          "The bills the office's suppliers send: entered, approved, then paid with payment vouchers.",
        )}
        actions={
          access.canExport || access.canCreate ? (
            <>
              {access.canExport && (
                <ReportExportButton
                  endpoint="/api/accounting/purchases/bills"
                  params={exportParams}
                  disabled={bills.length === 0}
                />
              )}
              {access.canCreate && (
                <Button asChild size="sm">
                  <Link href={newBillHref}>
                    <Plus className="h-4 w-4" />
                    {tx("purchases.bills.new", "New bill")}
                  </Link>
                </Button>
              )}
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <SummaryTile
          label={tx("purchases.bills.summary.total", "Total billed")}
          value={summary?.totalAmount ?? 0}
          hint={tx("purchases.bills.summary.count", "Bills: {count}", { count: summary?.count ?? 0 })}
          icon={FileText}
          tone="primary"
        />
        <SummaryTile
          label={tx("purchases.bills.summary.vat", "VAT")}
          value={summary?.vatAmount ?? 0}
          icon={Percent}
          tone="info"
        />
        <SummaryTile
          label={tx("purchases.bills.summary.paid", "Paid")}
          value={summary?.amountPaid ?? 0}
          icon={CheckCircle2}
          tone="success"
        />
        <SummaryTile
          label={tx("purchases.bills.summary.outstanding", "Still to pay")}
          value={summary?.outstanding ?? 0}
          hint={tx("purchases.bills.summary.outstandingHint", "On approved bills")}
          icon={Hourglass}
          tone="warning"
        />
        <SummaryTile
          label={tx("purchases.bills.summary.overdue", "Overdue")}
          value={summary?.overdue ?? 0}
          hint={tx("purchases.bills.summary.overdueHint", "Past the due date and not paid in full")}
          icon={AlertTriangle}
          tone="error"
        />
      </div>

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col gap-3 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <GlobalSearch
                placeholder={tx("purchases.bills.searchPlaceholder", "Search by bill number, supplier, supplier's invoice or notes")}
                ariaLabel={tx("purchases.bills.searchLabel", "Search bills")}
                initialValue={search}
                debounceDelay={300}
                onSearch={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                isLoading={loading}
                className="min-w-0 flex-1"
                inputClassName="h-10 bg-white dark:bg-gray-800"
              />
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(isStatusFilter(value) ? value : "all");
                  setPage(1);
                }}
              >
                <SelectTrigger
                  className="h-10 w-full bg-white lg:w-56 dark:bg-gray-800"
                  aria-label={tx("purchases.bills.col.status", "Status")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {text(STATUS_FILTER_TEXT[value])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="w-full lg:w-64">
                <Label htmlFor="bills-supplier" className="sr-only">
                  {tx("purchases.bills.col.supplier", "Supplier")}
                </Label>
                <SupplierPicker
                  id="bills-supplier"
                  suppliers={suppliers}
                  value={supplierId}
                  onChange={(value) => {
                    setSupplierId(value);
                    setPage(1);
                  }}
                  includeAll
                  className="h-10 bg-white dark:bg-gray-800"
                />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="bills-from" className="text-xs text-muted-foreground">
                  {tx("purchases.bills.filter.from", "Bill date from")}
                </Label>
                <Input
                  id="bills-from"
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    setPage(1);
                  }}
                  className="h-10 bg-white sm:w-44 dark:bg-gray-800"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bills-to" className="text-xs text-muted-foreground">
                  {tx("purchases.bills.filter.to", "Bill date to")}
                </Label>
                <Input
                  id="bills-to"
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(event) => {
                    setTo(event.target.value);
                    setPage(1);
                  }}
                  className="h-10 bg-white sm:w-44 dark:bg-gray-800"
                />
              </div>
              {hasFilters && (
                <Button variant="ghost" size="sm" className="h-10 px-3" onClick={clearFilters}>
                  <X className="h-4 w-4" />
                  {tx("common.clear", "Clear")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            columns={columns}
            data={bills}
            loading={loading}
            getRowKey={(bill) => bill.id}
            // Sorted by the API across every page: only the columns it can
            // order by sort; the others' headers stay plain.
            sort={{
              key: sort.key,
              direction: sort.direction,
              onSortChange: (key, direction) => {
                setSort({ key, direction });
                setPage(1);
              },
            }}
            error={
              failure
                ? {
                    message: describeError(failure),
                    onRetry: () => setVersion((value) => value + 1),
                    retryLabel: tx("common.retry", "Try again"),
                  }
                : null
            }
            emptyState={{
              icon: <FileText className="h-12 w-12 text-muted-foreground" />,
              title: hasFilters
                ? tx("purchases.bills.emptyFiltered", "No bill matches these filters")
                : tx("purchases.bills.empty", "No purchase bills yet"),
              description: hasFilters
                ? tx("purchases.bills.emptyFilteredHint", "Change or clear the filters.")
                : tx("purchases.bills.emptyHint", "Enter a supplier's bill to keep track of what the office owes."),
              action:
                !hasFilters && access.canCreate ? (
                  <Button asChild size="sm">
                    <Link href={newBillHref}>
                      <Plus className="h-4 w-4" />
                      {tx("purchases.bills.new", "New bill")}
                    </Link>
                  </Button>
                ) : undefined,
            }}
          />
          <LedgerPagination page={page} limit={limit} total={total} onPageChange={setPage} onLimitChange={setLimit} />
        </CardContent>
      </Card>

      {actions.dialogs}
    </div>
  );
}
