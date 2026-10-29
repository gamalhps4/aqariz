"use client";

/**
 * PropertyPro - Typing journal lines
 *
 * One row per line: account, debit or credit, an optional note and party
 * (a tenant's or an owner's sub-ledger). The totals and the difference update
 * as the accountant types, with the same check the server runs
 * (lib/accounting/journal-validation.ts).
 */

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { checkJournalLines } from "@/lib/accounting/journal-validation";
import { AccountPicker, Money } from "../../setup/_shared/ledger-parts";
import { PARTY_TYPE_TEXT, ledgerRequest, useLedgerText } from "../../setup/_shared/ledger-ui";
import type { LedgerAccount } from "../../setup/_shared/use-ledger-data";

export interface LineDraft {
  key: string;
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
  partyType: "" | "tenant" | "owner";
  partyId: string;
  partyLabel: string;
}

let lineCounter = 0;

export function emptyLine(): LineDraft {
  lineCounter += 1;
  return {
    key: `line-${Date.now()}-${lineCounter}`,
    accountId: "",
    debit: "",
    credit: "",
    memo: "",
    partyType: "",
    partyId: "",
    partyLabel: "",
  };
}

/** The lines as the API takes them; spare empty rows left out. */
export function linesForRequest(lines: readonly LineDraft[]) {
  return lines
    .filter((line) => line.accountId || line.debit || line.credit)
    .map((line) => ({
      accountId: line.accountId,
      debit: line.debit || null,
      credit: line.credit || null,
      memo: line.memo || null,
      partyType: line.partyType && line.partyId ? line.partyType : null,
      partyId: line.partyType && line.partyId ? line.partyId : null,
    }));
}

function PartyPicker({
  type,
  value,
  label,
  onChange,
}: {
  type: "tenant" | "owner";
  value: string;
  label: string;
  onChange: (id: string, label: string) => void;
}) {
  const { tx } = useLedgerText();
  const [options, setOptions] = useState<Array<{ value: string; label: string; subtitle?: string }>>(
    value ? [{ value, label }] : [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const response = await ledgerRequest<{ parties: Array<{ id: string; name: string; email: string | null }> }>(
        `/parties?type=${type}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || !response.ok) return;
      setOptions(
        (response.data?.parties ?? []).map((party) => ({
          value: party.id,
          label: party.name,
          subtitle: party.email ?? undefined,
        })),
      );
    })();
    return () => controller.abort();
  }, [type]);

  return (
    <SearchableSelect
      value={value}
      onValueChange={(id) => onChange(id, options.find((option) => option.value === id)?.label ?? "")}
      options={options}
      placeholder={type === "owner" ? tx("ledger.lines.chooseOwner", "Choose the owner") : tx("ledger.lines.chooseTenant", "Choose the tenant")}
      triggerClassName="h-9"
    />
  );
}

export function LinesEditor({
  accounts,
  lines,
  onChange,
  allowUnbalanced = false,
}: {
  accounts: readonly LedgerAccount[];
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  /** Opening balances: the difference goes to opening-balance equity. */
  allowUnbalanced?: boolean;
}) {
  const { tx, text } = useLedgerText();
  const check = checkJournalLines(lines, { allowUnbalanced });

  const update = (key: string, patch: Partial<LineDraft>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <div className="space-y-3">
      <div className="hidden grid-cols-12 gap-2 px-1 text-xs font-medium text-muted-foreground lg:grid">
        <div className="col-span-4">{tx("ledger.coa.name", "Account")}</div>
        <div className="col-span-2">{tx("ledger.side.debit", "Debit")}</div>
        <div className="col-span-2">{tx("ledger.side.credit", "Credit")}</div>
        <div className="col-span-3">{tx("ledger.lines.memoParty", "Note and party")}</div>
        <div className="col-span-1" />
      </div>
      {lines.map((line, index) => {
        const issue = check.issues.find((candidate) => candidate.index === index);
        return (
          <div
            key={line.key}
            className={`grid grid-cols-1 gap-2 rounded-lg border p-2 lg:grid-cols-12 lg:items-start ${issue ? "border-destructive/50" : ""}`}
          >
            <div className="lg:col-span-4">
              <AccountPicker
                accounts={accounts}
                value={line.accountId}
                onChange={(accountId) => update(line.key, { accountId })}
                className="h-9"
              />
            </div>
            <div className="lg:col-span-2">
              <Input
                value={line.debit}
                inputMode="decimal"
                dir="ltr"
                placeholder={tx("ledger.side.debit", "Debit")}
                onChange={(event) => update(line.key, { debit: event.target.value, credit: event.target.value ? "" : line.credit })}
                className="h-9"
              />
            </div>
            <div className="lg:col-span-2">
              <Input
                value={line.credit}
                inputMode="decimal"
                dir="ltr"
                placeholder={tx("ledger.side.credit", "Credit")}
                onChange={(event) => update(line.key, { credit: event.target.value, debit: event.target.value ? "" : line.debit })}
                className="h-9"
              />
            </div>
            <div className="space-y-2 lg:col-span-3">
              <Input
                value={line.memo}
                placeholder={tx("ledger.lines.memo", "Note (optional)")}
                onChange={(event) => update(line.key, { memo: event.target.value })}
                className="h-9"
              />
              <div className="flex gap-2">
                <Select
                  value={line.partyType || "none"}
                  onValueChange={(value) =>
                    update(line.key, {
                      partyType: value === "none" ? "" : (value as "tenant" | "owner"),
                      partyId: "",
                      partyLabel: "",
                    })
                  }
                >
                  <SelectTrigger className="h-9 w-32 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tx("ledger.lines.noParty", "No party")}</SelectItem>
                    <SelectItem value="tenant">{text(PARTY_TYPE_TEXT.tenant)}</SelectItem>
                    <SelectItem value="owner">{text(PARTY_TYPE_TEXT.owner)}</SelectItem>
                  </SelectContent>
                </Select>
                {line.partyType && (
                  <div className="min-w-0 flex-1">
                    <PartyPicker
                      type={line.partyType}
                      value={line.partyId}
                      label={line.partyLabel}
                      onChange={(partyId, partyLabel) => update(line.key, { partyId, partyLabel })}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end lg:col-span-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                aria-label={tx("ledger.lines.remove", "Remove line")}
                onClick={() => onChange(lines.length > 1 ? lines.filter((candidate) => candidate.key !== line.key) : [emptyLine()])}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" size="sm" onClick={() => onChange([...lines, emptyLine()])}>
          <Plus className="h-4 w-4" />
          {tx("ledger.lines.add", "Add line")}
        </Button>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span>
            {tx("ledger.lines.totalDebit", "Debits")}: <Money value={check.totalDebit / 100} className="font-semibold" />
          </span>
          <span>
            {tx("ledger.lines.totalCredit", "Credits")}: <Money value={check.totalCredit / 100} className="font-semibold" />
          </span>
          {check.difference !== 0 && (
            <span className={allowUnbalanced ? "text-muted-foreground" : "text-destructive"}>
              {allowUnbalanced
                ? tx("ledger.lines.toEquity", "Difference to opening-balance equity")
                : tx("ledger.lines.difference", "Difference")}
              : <Money value={Math.abs(check.difference) / 100} className="font-semibold" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
