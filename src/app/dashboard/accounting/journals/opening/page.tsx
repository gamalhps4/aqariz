"use client";

/**
 * PropertyPro - Opening balances
 *
 * The books on the cut-over day: what each account held when the office
 * started keeping them here — the bank and the cash box, each owner's
 * balance, each tenant's arrears, the deposits held. Typed in, or imported
 * from a spreadsheet. Whatever does not balance goes to opening-balance
 * equity.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { checkJournalLines } from "@/lib/accounting/journal-validation";
import { LedgerHeader, LedgerNotSetUp, Money, NoLedgerAccess } from "../../setup/_shared/ledger-parts";
import { ledgerRequest, useLedgerAccess, useLedgerError, useLedgerText } from "../../setup/_shared/ledger-ui";
import { useLedgerAccounts, useLedgerSetup } from "../../setup/_shared/use-ledger-data";
import { LinesEditor, emptyLine, linesForRequest, type LineDraft } from "../_parts/lines-editor";

interface OpeningEntry {
  id: string;
  number: number;
  date: string;
  totalAmount: number;
  status: string;
  memo: string | null;
}

interface CsvProblem {
  line: number;
  code: string;
  detail?: string;
}

const CSV_TEMPLATE = "code,debit,credit,memo,party_type,party_id\n110102,50000,,Bank balance,,\n210201,,30000,Owner balance,owner,<owner id>\n";

export default function OpeningBalancesPage() {
  const access = useLedgerAccess();
  const { tx, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const { view, loading: setupLoading } = useLedgerSetup(access.canView);
  const { accounts } = useLedgerAccounts(access.canManage && Boolean(view?.isSetUp));
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine(), emptyLine()]);
  const [csv, setCsv] = useState("");
  const [problems, setProblems] = useState<CsvProblem[]>([]);
  const [entries, setEntries] = useState<OpeningEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!access.canView || !view?.isSetUp) return;
    const controller = new AbortController();
    void (async () => {
      const response = await ledgerRequest<{ entries: OpeningEntry[] }>("/opening-balances", { signal: controller.signal });
      if (!controller.signal.aborted && response.ok) setEntries(response.data?.entries ?? []);
    })();
    return () => controller.abort();
  }, [access.canView, view?.isSetUp, version]);

  if (access.loading || (setupLoading && !view)) return null;
  if (!access.canView) return <NoLedgerAccess />;
  if (view && !view.isSetUp) return <LedgerNotSetUp canManage={access.canManage} />;

  const cutOver = view?.settings?.cutOverDate;
  const check = checkJournalLines(lines, { allowUnbalanced: true });

  async function postLines() {
    setBusy(true);
    const response = await ledgerRequest<{ number: number }>("/opening-balances", {
      method: "POST",
      body: { lines: linesForRequest(lines) },
    });
    setBusy(false);
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(tx("ledger.opening.posted", "Opening balances posted as journal #{number}", { number: response.data?.number ?? "" }));
    setLines([emptyLine(), emptyLine()]);
    setVersion((value) => value + 1);
  }

  async function postCsv() {
    setBusy(true);
    setProblems([]);
    const response = await ledgerRequest<{ number: number; problems?: CsvProblem[] }>("/opening-balances", {
      method: "POST",
      body: { csv },
    });
    setBusy(false);
    if (!response.ok) {
      const found = (response.data as { problems?: CsvProblem[] } | null)?.problems ?? [];
      setProblems(found);
      toast.error(describeError(response));
      return;
    }
    toast.success(tx("ledger.opening.posted", "Opening balances posted as journal #{number}", { number: response.data?.number ?? "" }));
    setCsv("");
    setVersion((value) => value + 1);
  }

  async function readFile(file: File) {
    setCsv(await file.text());
  }

  const problemText = (problem: CsvProblem) => {
    switch (problem.code) {
      case "UNKNOWN_ACCOUNT":
        return tx("ledger.opening.problem.unknownAccount", "Line {line}: no account has the code {code}", {
          line: problem.line,
          code: problem.detail ?? "",
        });
      case "MISSING_CODE":
        return tx("ledger.opening.problem.missingCode", "Line {line}: the account code is missing", { line: problem.line });
      case "BAD_PARTY":
        return tx("ledger.opening.problem.badParty", "Line {line}: the party type must be tenant, owner, supplier or customer", {
          line: problem.line,
        });
      case "EMPTY":
        return tx("ledger.opening.problem.empty", "The file has no balances");
      default:
        return tx("ledger.opening.problem.other", "Line {line}: the row could not be read", { line: problem.line });
    }
  };

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("ledger.setup.openingBalances", "Opening balances")}
        subtitle={
          cutOver
            ? tx("ledger.opening.subtitle", "The office's balances on the cut-over day, {date}. Anything that does not balance goes to opening-balance equity.", {
                date: formatDate(cutOver),
              })
            : undefined
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/accounting/journals">{tx("ledger.journal.back", "All entries")}</Link>
          </Button>
        }
      />

      {access.canManage && (
        <Tabs defaultValue="form">
          <TabsList>
            <TabsTrigger value="form">{tx("ledger.opening.tabForm", "Enter balances")}</TabsTrigger>
            <TabsTrigger value="csv">{tx("ledger.opening.tabCsv", "Import a CSV")}</TabsTrigger>
          </TabsList>
          <TabsContent value="form">
            <Card>
              <CardContent className="space-y-4 pt-6">
                <LinesEditor accounts={accounts} lines={lines} onChange={setLines} allowUnbalanced />
                <div className="flex justify-end">
                  <Button onClick={postLines} disabled={busy || check.issues.length > 0}>
                    {busy ? tx("ledger.common.working", "Working…") : tx("ledger.opening.post", "Post opening balances")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="csv">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{tx("ledger.opening.csvTitle", "Import from a spreadsheet")}</CardTitle>
                <CardDescription>
                  {tx(
                    "ledger.opening.csvBody",
                    "One row per balance: the account code, its debit or its credit, and optionally a note and the party (party_type tenant or owner, party_id the person's id). Commas or semicolons; a header row in English or Arabic.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <FileUp className="h-4 w-4" />
                    {tx("ledger.opening.chooseFile", "Choose a CSV file")}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void readFile(file);
                      }}
                    />
                  </Label>
                  <Button variant="ghost" size="sm" onClick={() => setCsv(CSV_TEMPLATE)}>
                    {tx("ledger.opening.useTemplate", "Start from the template")}
                  </Button>
                </div>
                <Textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={8} dir="ltr" className="font-mono text-xs" />
                {problems.length > 0 && (
                  <ul className="space-y-1 text-sm text-destructive">
                    {problems.map((problem, index) => (
                      <li key={`${problem.line}-${index}`}>{problemText(problem)}</li>
                    ))}
                  </ul>
                )}
                <div className="flex justify-end">
                  <Button onClick={postCsv} disabled={busy || !csv.trim()}>
                    {busy ? tx("ledger.common.working", "Working…") : tx("ledger.opening.import", "Import and post")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tx("ledger.opening.postedTitle", "Posted opening balances")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground">{tx("ledger.opening.none", "None posted yet.")}</p>
          )}
          {entries.map((entry) => (
            <Link
              key={entry.id}
              href={`/dashboard/accounting/journals/${entry.id}`}
              className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-muted/50"
            >
              <span>
                <span className="font-mono" dir="ltr">
                  #{entry.number}
                </span>{" "}
                · {formatDate(entry.date)}
              </span>
              <span className="flex items-center gap-2">
                {entry.status === "reversed" && <Badge variant="outline">{tx("ledger.journals.reversed", "Reversed")}</Badge>}
                <Money value={entry.totalAmount} className="font-medium" />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
