"use client";

/**
 * PropertyPro - The journal
 *
 * Every entry in the books, newest first: the automatic ones posted from
 * installments, payments, expenses and deposits, and the ones written here —
 * manual journals, opening balances, transfers, settlements, payouts.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, FilePlus2, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import GlobalSearch from "@/components/ui/global-search";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SOURCE_TYPES, type SourceType } from "@/lib/accounting/types";
import { LedgerHeader, LedgerNotSetUp, LedgerPagination, Money, NoLedgerAccess } from "../setup/_shared/ledger-parts";
import {
  SOURCE_TYPE_TEXT,
  ledgerRequest,
  useLedgerAccess,
  useLedgerError,
  useLedgerText,
} from "../setup/_shared/ledger-ui";
import { describeCharge } from "@/lib/i18n/charge-description";

interface JournalRow {
  id: string;
  number: number;
  date: string;
  sourceType: SourceType;
  sourceRef: string | null;
  memo: string | null;
  status: string;
  totalAmount: number;
  reversesNumber: number | null;
  reversedByNumber: number | null;
  lineCount: number;
}

const ALL = "all";

export default function JournalsPage() {
  const router = useRouter();
  const access = useLedgerAccess();
  const { tx, text, language, formatDate } = useLedgerText();
  const describeError = useLedgerError();

  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ code: string | null; message: string | null } | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [sourceType, setSourceType] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (!access.canView) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set("search", search);
    if (sourceType !== ALL) params.set("sourceType", sourceType);
    if (status !== ALL) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    void (async () => {
      setLoading(true);
      const response = await ledgerRequest<{ entries: JournalRow[] }>(`/journals?${params}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.ok) {
        setRows(response.data?.entries ?? []);
        setTotal(response.pagination?.total ?? 0);
        setFailure(null);
      } else {
        setRows([]);
        setFailure({ code: response.code, message: response.message });
      }
      setLoading(false);
    })();
    return () => controller.abort();
  }, [access.canView, page, limit, search, sourceType, status, from, to]);

  if (access.loading) return null;
  if (!access.canView) return <NoLedgerAccess />;
  if (failure?.code === "LEDGER_NOT_SET_UP") return <LedgerNotSetUp canManage={access.canManage} />;

  const columns: DataTableColumn<JournalRow>[] = [
    {
      id: "number",
      header: tx("ledger.journals.number", "No."),
      cell: (row) => (
        <Link href={`/dashboard/accounting/journals/${row.id}`} className="font-mono text-xs hover:underline" dir="ltr">
          #{row.number}
        </Link>
      ),
      width: "min-w-[70px]",
    },
    {
      id: "date",
      header: tx("ledger.journals.date", "Date"),
      cell: (row) => <span className="text-sm">{formatDate(row.date)}</span>,
      width: "min-w-[110px]",
    },
    {
      id: "source",
      header: tx("ledger.journals.source", "Source"),
      cell: (row) => (
        <div className="flex flex-col">
          <span className="text-sm">{text(SOURCE_TYPE_TEXT[row.sourceType] ?? SOURCE_TYPE_TEXT.manual)}</span>
          {row.sourceRef && (
            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
              {row.sourceRef}
            </span>
          )}
        </div>
      ),
      width: "min-w-[150px]",
    },
    {
      id: "memo",
      header: tx("ledger.journals.memo", "Description"),
      cell: (row) => (
        <div className="max-w-72 truncate text-sm text-muted-foreground" title={row.memo ? describeCharge({ description: row.memo }, language) : undefined}>
          {row.reversesNumber
            ? tx("ledger.journals.reverses", "Reverses #{number}", { number: row.reversesNumber })
            : (row.memo && describeCharge({ description: row.memo }, language)) || "—"}
        </div>
      ),
      visibility: "md",
    },
    {
      id: "amount",
      header: tx("ledger.journals.amount", "Amount"),
      cell: (row) => <Money value={row.totalAmount} className="text-sm font-medium" />,
      align: "right",
      width: "min-w-[120px]",
    },
    {
      id: "status",
      header: tx("ledger.journals.status", "Status"),
      cell: (row) =>
        row.status === "reversed" ? (
          <Badge variant="outline" className="text-xs">
            {row.reversedByNumber
              ? tx("ledger.journals.reversedBy", "Reversed by #{number}", { number: row.reversedByNumber })
              : tx("ledger.journals.reversed", "Reversed")}
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">
            {tx("ledger.journals.posted", "Posted")}
          </Badge>
        ),
      width: "min-w-[120px]",
    },
  ];

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("ledger.nav.journals", "Journal entries")}
        subtitle={tx(
          "ledger.journals.subtitle",
          "Every entry in the office's books. Entries from installments, payments, expenses and deposits are posted automatically and follow their documents.",
        )}
        actions={
          access.canManage ? (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/accounting/journals/opening">
                  <Scale className="h-4 w-4" />
                  {tx("ledger.setup.openingBalances", "Opening balances")}
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/dashboard/accounting/journals/new">
                  <FilePlus2 className="h-4 w-4" />
                  {tx("ledger.journals.new", "New journal")}
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
            <GlobalSearch
              placeholder={tx("ledger.journals.searchPlaceholder", "Search by number, reference or description…")}
              initialValue={search}
              debounceDelay={300}
              onSearch={(value) => {
                setSearch(value);
                setPage(1);
              }}
              isLoading={loading}
              className="min-w-0 flex-1"
              ariaLabel={tx("ledger.journals.searchPlaceholder", "Search by number, reference or description…")}
            />
            <Select
              value={sourceType}
              onValueChange={(value) => {
                setSourceType(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-10 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{tx("ledger.journals.allSources", "All sources")}</SelectItem>
                {SOURCE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {text(SOURCE_TYPE_TEXT[type])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-10 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{tx("ledger.journals.allStatuses", "All statuses")}</SelectItem>
                <SelectItem value="posted">{tx("ledger.journals.posted", "Posted")}</SelectItem>
                <SelectItem value="reversed">{tx("ledger.journals.reversed", "Reversed")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={from}
                aria-label={tx("ledger.journals.from", "From")}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
                className="h-10 w-40"
              />
              <span className="text-sm text-muted-foreground">—</span>
              <Input
                type="date"
                value={to}
                aria-label={tx("ledger.journals.to", "To")}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
                className="h-10 w-40"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            getRowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/dashboard/accounting/journals/${row.id}`)}
            error={
              failure && failure.code !== "ABORTED"
                ? { message: describeError(failure) }
                : null
            }
            emptyState={{
              title: tx("ledger.journals.empty", "No journal entries yet"),
              description: tx(
                "ledger.journals.emptyHint",
                "Post the office's documents from Accounting setup, or write a manual journal.",
              ),
              icon: <BookOpenText className="h-8 w-8 text-muted-foreground" />,
            }}
          />
          <LedgerPagination page={page} limit={limit} total={total} onPageChange={setPage} onLimitChange={setLimit} />
        </CardContent>
      </Card>
    </div>
  );
}
