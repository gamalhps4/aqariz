"use client";

/**
 * PropertyPro - One journal entry
 *
 * Its lines, debits and credits, the party and building each concerns, and
 * where it came from. A manual journal or opening balance can be reversed
 * here; an entry posted from a document follows the document.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";
import type { SourceType } from "@/lib/accounting/types";
import { LedgerHeader, Money, NoLedgerAccess } from "../../setup/_shared/ledger-parts";
import {
  PARTY_TYPE_TEXT,
  SOURCE_TYPE_TEXT,
  accountName,
  ledgerRequest,
  todayInput,
  useLedgerAccess,
  useLedgerError,
  useLedgerText,
} from "../../setup/_shared/ledger-ui";
import { describeCharge } from "@/lib/i18n/charge-description";

interface JournalDetail {
  id: string;
  number: number;
  date: string;
  sourceType: SourceType;
  sourceId: string | null;
  sourceRef: string | null;
  memo: string | null;
  status: string;
  totalAmount: number;
  reversesId: string | null;
  reversesNumber: number | null;
  reversedById: string | null;
  reversedByNumber: number | null;
  createdAt: string;
  createdBy: string | null;
  lines: Array<{
    id: string;
    account: { id: string; code: string; nameAr: string; nameEn: string };
    debit: number;
    credit: number;
    partyType: string | null;
    partyName: string | null;
    propertyName: string | null;
    vatCode: string | null;
    memo: string | null;
  }>;
}

type JournalLine = JournalDetail["lines"][number];

const NO_LINES: JournalLine[] = [];

/** Where a document an entry follows can be opened. */
function sourceHref(entry: JournalDetail): string | null {
  if (!entry.sourceId) return null;
  switch (entry.sourceType) {
    case "invoice":
      return `/dashboard/accounting/invoices/${entry.sourceId}`;
    case "expense":
      return `/dashboard/accounting/expenses/${entry.sourceId}`;
    default:
      return null;
  }
}

export default function JournalDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const access = useLedgerAccess();
  const { tx, text, language, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const [entry, setEntry] = useState<JournalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseDate, setReverseDate] = useState(todayInput());
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const id = params?.id;

  useEffect(() => {
    if (!access.canView || !id) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      const response = await ledgerRequest<JournalDetail>(`/journals/${id}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.ok) {
        setEntry(response.data);
        setNotFound(false);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    })();
    return () => controller.abort();
  }, [access.canView, id, version]);

  // The lines sort by any column — an entry has no running balance — and the
  // totals stay in the footer. A side the line does not touch is blank, and
  // sorts last both ways.
  const lineSort = useTableSort(entry?.lines ?? NO_LINES, {
    account: (line) => accountName(line.account, language),
    party: (line) => (line.partyType ? line.partyName : null),
    property: (line) => line.propertyName,
    debit: (line) => (line.debit > 0 ? line.debit : null),
    credit: (line) => (line.credit > 0 ? line.credit : null),
  });

  if (access.loading) return null;
  if (!access.canView) return <NoLedgerAccess />;

  async function reverse() {
    if (!entry) return;
    setBusy(true);
    const response = await ledgerRequest<{ id: string; number: number }>(`/journals/${entry.id}/reverse`, {
      method: "POST",
      body: { date: reverseDate },
    });
    setBusy(false);
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(tx("ledger.journal.reversedToast", "Reversed by journal #{number}", { number: response.data?.number ?? "" }));
    setReverseOpen(false);
    setVersion((value) => value + 1);
  }

  const back = (
    <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/accounting/journals")}>
      <ArrowRight className="h-4 w-4 ltr:rotate-180" />
      {tx("ledger.journal.back", "All entries")}
    </Button>
  );

  if (loading && !entry) {
    return (
      <div className="space-y-4">
        <LedgerHeader title={tx("ledger.journal.title", "Journal entry")} actions={back} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tx("ledger.common.loading", "Loading…")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (notFound || !entry) {
    return (
      <div className="space-y-4">
        <LedgerHeader title={tx("ledger.journal.title", "Journal entry")} actions={back} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tx("ledger.journal.notFound", "This journal entry does not exist.")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const reversible =
    access.canManage &&
    entry.status === "posted" &&
    !entry.reversesId &&
    (entry.sourceType === "manual" || entry.sourceType === "opening_balance");
  const href = sourceHref(entry);
  const totalDebit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = entry.lines.reduce((sum, line) => sum + line.credit, 0);

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("ledger.journal.titleNumber", "Journal entry #{number}", { number: entry.number })}
        subtitle={text(SOURCE_TYPE_TEXT[entry.sourceType] ?? SOURCE_TYPE_TEXT.manual)}
        actions={
          <>
            {back}
            {reversible && (
              <Button variant="outline" size="sm" onClick={() => setReverseOpen(true)}>
                <Undo2 className="h-4 w-4" />
                {tx("ledger.journal.reverse", "Reverse")}
              </Button>
            )}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {formatDate(entry.date)}
            {entry.status === "reversed" ? (
              <Badge variant="outline">{tx("ledger.journals.reversed", "Reversed")}</Badge>
            ) : (
              <Badge variant="secondary">{tx("ledger.journals.posted", "Posted")}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-muted-foreground">{tx("ledger.journal.reference", "Reference")}</div>
            <div className="font-mono" dir="ltr">
              {href ? (
                <Link href={href} className="hover:underline">
                  {entry.sourceRef || tx("ledger.journal.openDocument", "Open the document")}
                </Link>
              ) : (
                entry.sourceRef || "—"
              )}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">{tx("ledger.journals.amount", "Amount")}</div>
            <Money value={entry.totalAmount} className="font-medium" />
          </div>
          <div>
            <div className="text-muted-foreground">{tx("ledger.journal.createdBy", "Recorded by")}</div>
            <div>{entry.createdBy ?? tx("ledger.journal.automatic", "Posted automatically")}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{tx("ledger.journal.links", "Reversal")}</div>
            <div className="flex flex-col">
              {entry.reversesId && (
                <Link href={`/dashboard/accounting/journals/${entry.reversesId}`} className="hover:underline">
                  {tx("ledger.journals.reverses", "Reverses #{number}", { number: entry.reversesNumber ?? "" })}
                </Link>
              )}
              {entry.reversedById && (
                <Link href={`/dashboard/accounting/journals/${entry.reversedById}`} className="hover:underline">
                  {tx("ledger.journals.reversedBy", "Reversed by #{number}", { number: entry.reversedByNumber ?? "" })}
                </Link>
              )}
              {!entry.reversesId && !entry.reversedById && "—"}
            </div>
          </div>
          {entry.memo && (
            <div className="sm:col-span-2 lg:col-span-4">
              <div className="text-muted-foreground">{tx("ledger.journals.memo", "Description")}</div>
              <div>{describeCharge({ description: entry.memo }, language)}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead sort={lineSort} column="account">
                  {tx("ledger.coa.name", "Account")}
                </SortableTableHead>
                <SortableTableHead sort={lineSort} column="party" className="hidden md:table-cell">
                  {tx("ledger.journal.party", "Party")}
                </SortableTableHead>
                <SortableTableHead sort={lineSort} column="property" className="hidden lg:table-cell">
                  {tx("ledger.journal.property", "Building")}
                </SortableTableHead>
                <SortableTableHead sort={lineSort} column="debit" className="text-end">
                  {tx("ledger.side.debit", "Debit")}
                </SortableTableHead>
                <SortableTableHead sort={lineSort} column="credit" className="text-end">
                  {tx("ledger.side.credit", "Credit")}
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineSort.rows.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm">
                        <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                          {line.account.code}
                        </span>{" "}
                        {accountName(line.account, language)}
                      </span>
                      {line.memo && (
                        <span className="text-xs text-muted-foreground">
                          {describeCharge({ description: line.memo }, language)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">
                    {line.partyType ? (
                      <span>
                        {line.partyName ?? "—"}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({text(PARTY_TYPE_TEXT[line.partyType as keyof typeof PARTY_TYPE_TEXT] ?? PARTY_TYPE_TEXT.customer)})
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">{line.propertyName ?? "—"}</TableCell>
                  <TableCell className="text-end">{line.debit > 0 ? <Money value={line.debit} /> : ""}</TableCell>
                  <TableCell className="text-end">{line.credit > 0 ? <Money value={line.credit} /> : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">{tx("ledger.journal.total", "Total")}</TableCell>
                <TableCell className="hidden md:table-cell" />
                <TableCell className="hidden lg:table-cell" />
                <TableCell className="text-end font-semibold">
                  <Money value={totalDebit} />
                </TableCell>
                <TableCell className="text-end font-semibold">
                  <Money value={totalCredit} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tx("ledger.journal.reverseTitle", "Reverse this entry?")}</DialogTitle>
            <DialogDescription>
              {tx(
                "ledger.journal.reverseBody",
                "A new entry with every line turned around is posted on the date below. This entry stays in the books, marked reversed.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reverse-date">{tx("ledger.journal.reverseDate", "Reversal date")}</Label>
            <Input
              id="reverse-date"
              type="date"
              value={reverseDate}
              min={entry.date}
              onChange={(event) => setReverseDate(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseOpen(false)}>
              {tx("ledger.common.cancel", "Cancel")}
            </Button>
            <Button onClick={reverse} disabled={busy}>
              {busy ? tx("ledger.common.working", "Working…") : tx("ledger.journal.reverse", "Reverse")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
