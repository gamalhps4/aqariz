"use client";

/**
 * PropertyPro - New manual journal
 *
 * A balanced journal written by hand: an accrual, a correction, a
 * reclassification. It posts only when the debits equal the credits.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkJournalLines } from "@/lib/accounting/journal-validation";
import { LedgerHeader, LedgerNotSetUp, NoLedgerAccess } from "../../setup/_shared/ledger-parts";
import { ledgerRequest, todayInput, useLedgerAccess, useLedgerError, useLedgerText } from "../../setup/_shared/ledger-ui";
import { useLedgerAccounts } from "../../setup/_shared/use-ledger-data";
import { LinesEditor, emptyLine, linesForRequest, type LineDraft } from "../_parts/lines-editor";

export default function NewJournalPage() {
  const router = useRouter();
  const access = useLedgerAccess();
  const { tx } = useLedgerText();
  const describeError = useLedgerError();
  const { accounts, error } = useLedgerAccounts(access.canManage);
  const [date, setDate] = useState(todayInput());
  const [memo, setMemo] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine(), emptyLine()]);
  const [busy, setBusy] = useState(false);

  if (access.loading) return null;
  if (!access.canManage) return <NoLedgerAccess />;
  if (error?.code === "LEDGER_NOT_SET_UP") return <LedgerNotSetUp canManage />;

  const check = checkJournalLines(lines);
  const ready = check.issues.length === 0 && check.balanced;

  async function post() {
    setBusy(true);
    const response = await ledgerRequest<{ id: string; number: number }>("/journals", {
      method: "POST",
      body: { date, memo, reference, lines: linesForRequest(lines) },
    });
    setBusy(false);
    if (!response.ok || !response.data) {
      toast.error(describeError(response));
      return;
    }
    toast.success(tx("ledger.newJournal.posted", "Journal #{number} posted", { number: response.data.number }));
    router.push(`/dashboard/accounting/journals/${response.data.id}`);
  }

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("ledger.journals.new", "New journal")}
        subtitle={tx("ledger.newJournal.subtitle", "Write a balanced journal by hand. It posts only when the debits equal the credits.")}
      />
      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="journal-date">{tx("ledger.journals.date", "Date")}</Label>
            <Input id="journal-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="journal-ref">{tx("ledger.journal.reference", "Reference")}</Label>
            <Input id="journal-ref" value={reference} onChange={(event) => setReference(event.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-3">
            <Label htmlFor="journal-memo">{tx("ledger.journals.memo", "Description")}</Label>
            <Input id="journal-memo" value={memo} onChange={(event) => setMemo(event.target.value)} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <LinesEditor accounts={accounts} lines={lines} onChange={setLines} />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/dashboard/accounting/journals")}>
          {tx("ledger.common.cancel", "Cancel")}
        </Button>
        <Button onClick={post} disabled={!ready || busy}>
          {busy ? tx("ledger.common.working", "Working…") : tx("ledger.newJournal.post", "Post journal")}
        </Button>
      </div>
    </div>
  );
}
