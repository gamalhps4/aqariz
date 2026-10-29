"use client";

/**
 * PropertyPro - What the payment voucher, payables aging and purchases
 * register screens share
 *
 * The states a purchases page can be in before it shows anything (no right
 * to it, accounting not set up, the purchases update not applied yet), the
 * figures above a list, the office's bank and cash accounts, a supplier's
 * open bills, cancelling a voucher, the printable voucher's address, and
 * reading an amount the way a person types it. Every text is `purchases.*`
 * with the English beside it, as the other purchases screens do it.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Info, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toHalalas } from "@/lib/accounting/money";
import type { BillView, PayingAccountOption, VoucherView } from "@/lib/accounting/purchases/types";
import { LedgerNotSetUp } from "../../../setup/_shared/ledger-parts";
import {
  purchasesRequest,
  queryString,
  useLedgerError,
  useLedgerText,
  usePurchaseLookups,
} from "../../_shared/purchases-ui";

// ---------------------------------------------------------------------------
// The states before a page
// ---------------------------------------------------------------------------

/** No right to purchases at all, or none to pay a supplier. */
export function NoPurchasesAccess({ right = "view" }: { right?: "view" | "pay" }) {
  const { tx } = useLedgerText();
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">
          {right === "pay"
            ? tx("purchases.access.payDeniedTitle", "You cannot pay suppliers")
            : tx("purchases.access.viewDeniedTitle", "You do not have access to purchases")}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          {right === "pay"
            ? tx(
                "purchases.access.payDeniedBody",
                "Writing a payment voucher takes money out of the office's accounts. Ask an administrator for the Pay suppliers permission in your permission group.",
              )
            : tx(
                "purchases.access.viewDeniedBody",
                "Ask an administrator for the View purchases permission in your permission group.",
              )}
        </p>
      </CardContent>
    </Card>
  );
}

/** A calm card with one sentence: the purchases update not applied, or another refusal. */
export function PurchasesNotice({ message, tone = "info" }: { message: string; tone?: "info" | "error" }) {
  const color = tone === "error" ? "text-destructive" : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Info className={`h-8 w-8 ${color}`} aria-hidden="true" />
        <p className={`max-w-md text-sm ${color}`}>{message}</p>
      </CardContent>
    </Card>
  );
}

/**
 * What a refused request leaves a page showing: accounting to set up first,
 * the purchases update still to apply (calm, it is nobody's mistake), or the
 * refusal itself.
 */
export function RefusalState({
  code,
  message,
  canManageBooks,
}: {
  code: string | null;
  message: string;
  canManageBooks: boolean;
}) {
  if (code === "LEDGER_NOT_SET_UP") return <LedgerNotSetUp canManage={canManageBooks} />;
  return <PurchasesNotice message={message} tone={code === "PURCHASES_UNAVAILABLE" ? "info" : "error"} />;
}

// ---------------------------------------------------------------------------
// Figures above a list
// ---------------------------------------------------------------------------

export interface SummaryTile {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "good" | "bad" | "warn";
}

const TILE_COLUMNS = {
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 xl:grid-cols-5",
} as const;

const TILE_TONES = {
  good: "text-emerald-600 dark:text-emerald-400",
  bad: "text-destructive",
  warn: "text-amber-600 dark:text-amber-400",
} as const;

/** A row of figures; money goes in as <Money/>, which keeps it left to right. */
export function SummaryTiles({ items, loading = false }: { items: SummaryTile[]; loading?: boolean }) {
  const columns = TILE_COLUMNS[Math.min(5, Math.max(2, items.length)) as keyof typeof TILE_COLUMNS];
  return (
    <div className={`grid gap-4 ${columns}`}>
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <p className={`mt-1 text-xl font-semibold tabular-nums ${item.tone ? TILE_TONES[item.tone] : ""}`}>
              {item.value}
            </p>
          )}
          {item.hint && <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The office's bank and cash accounts
// ---------------------------------------------------------------------------

/** One account as the purchases lookups list it (see `usePurchaseLookups`). */
export type BankOption = PayingAccountOption;

/**
 * The office's bank and cash accounts, from the purchases lookups — open to
 * every purchases right, so a cashier without the right to view the books
 * still chooses the account a payment leaves. A balance is shown only to
 * someone who may see the books or pays suppliers (`balance` is null
 * otherwise). `code` is set when the list could not be read, `notSetUp` when
 * accounting has not been set up.
 */
export function useBankAccounts(enabled: boolean) {
  const lookups = usePurchaseLookups({ banks: true }, { enabled });
  return {
    banks: lookups.banks,
    code: lookups.error ? (lookups.error.code ?? "FAILED") : null,
    notSetUp: lookups.notSetUp,
    loading: lookups.loading,
  };
}

// ---------------------------------------------------------------------------
// A supplier's open bills
// ---------------------------------------------------------------------------

/** How many open bills one request lists, oldest due first (the route's own cap). */
export const OPEN_BILLS_LIMIT = 100;

/**
 * The supplier's bills a voucher can pay — approved, with something left to
 * pay — oldest due first. Nothing is read while no supplier is chosen.
 */
export function useOpenBills(supplierId: string, enabled = true) {
  const key = enabled && supplierId ? supplierId : "";
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    key: string;
    version: number;
    bills: BillView[];
    total: number;
    code: string | null;
    message: string | null;
  } | null>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void (async () => {
      const response = await purchasesRequest<{ bills: BillView[] }>(
        `/bills${queryString({ supplierId: key, status: "open", sortBy: "dueDate", order: "asc", limit: OPEN_BILLS_LIMIT })}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const bills = response.ok ? (response.data?.bills ?? []) : [];
      setState({
        key,
        version,
        bills,
        total: response.pagination?.total ?? bills.length,
        code: response.ok ? null : response.code,
        message: response.ok ? null : response.message,
      });
    })();
    return () => controller.abort();
  }, [key, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const current = state && state.key === key ? state : null;
  return {
    bills: current?.bills ?? [],
    total: current?.total ?? 0,
    /** First read for this supplier, or a reload, still on its way. */
    loading: Boolean(key) && (!current || current.version !== version),
    code: current?.code ?? null,
    message: current?.message ?? null,
    reload,
  };
}

// ---------------------------------------------------------------------------
// Cancelling a voucher
// ---------------------------------------------------------------------------

/**
 * "Cancel voucher N?" with an optional reason. A voucher whose bank line is
 * ticked off against the statement is refused (PURCHASE_VOUCHER_RECONCILED):
 * the dialog stays open and says why, in the reader's language.
 */
export function CancelVoucherDialog({
  voucher,
  onClose,
  onCancelled,
}: {
  voucher: { id: string; displayNumber: string } | null;
  onClose: () => void;
  onCancelled: (voucher: VoucherView) => void;
}) {
  const { tx } = useLedgerText();
  const describeError = useLedgerError();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setReason("");
    setProblem(null);
    onClose();
  };

  async function confirm() {
    if (!voucher) return;
    setBusy(true);
    setProblem(null);
    const response = await purchasesRequest<VoucherView>(`/vouchers/${encodeURIComponent(voucher.id)}/cancel`, {
      method: "POST",
      body: { reason: reason.trim() || null },
    });
    setBusy(false);
    if (!response.ok || !response.data) {
      setProblem(describeError(response));
      return;
    }
    toast.success(tx("purchases.vouchers.cancelledToast", "Voucher {number} cancelled", { number: voucher.displayNumber }));
    setReason("");
    onCancelled(response.data);
  }

  return (
    <Dialog open={voucher !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {tx("purchases.vouchers.cancelDialog.title", "Cancel voucher {number}?", {
              number: voucher?.displayNumber ?? "",
            })}
          </DialogTitle>
          <DialogDescription>
            {tx(
              "purchases.vouchers.cancelDialog.body",
              "The voucher keeps its number and is marked cancelled. The bills it paid are open again and the books reverse the payment. To correct a voucher, cancel it and write a new one.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancel-voucher-reason">
            {tx("purchases.vouchers.cancelDialog.reason", "Reason (optional)")}
          </Label>
          <Textarea
            id="cancel-voucher-reason"
            value={reason}
            maxLength={500}
            rows={3}
            placeholder={tx("purchases.vouchers.cancelDialog.reasonPlaceholder", "For example: paid from the wrong account")}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {problem && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            {tx("purchases.vouchers.cancelDialog.keep", "Keep the voucher")}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || !voucher}>
            {busy ? tx("ledger.common.working", "Working…") : tx("purchases.vouchers.cancelDialog.confirm", "Cancel voucher")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The printable voucher, and amounts as typed
// ---------------------------------------------------------------------------

/** The printable voucher (سند صرف), laid out in the reader's language. */
export function voucherPdfHref(id: string, language: string): string {
  return `/api/accounting/purchases/vouchers/${encodeURIComponent(id)}/pdf${queryString({ lang: language })}`;
}

const EASTERN_DIGITS = /[٠-٩۰-۹]/g;
const GROUPED = /^-?\d{1,3}(,\d{3})+(\.\d*)?$/;
const PLAIN = /^-?(\d+\.?\d*|\.\d+)$/;

/**
 * An amount as a person types it: Arabic-Indic digits and the Arabic decimal
 * mark are read as their Latin forms, and commas only as thousands groups
 * ("1,250.50"). Null when nothing is typed; NaN when it is not a number — a
 * comma used as the decimal mark included, rather than a guess that is off
 * by a hundred.
 */
export function parseMoneyInput(raw: string): number | null {
  let text = raw
    .trim()
    .replace(EASTERN_DIGITS, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/\s+/g, "");
  if (!text) return null;
  if (GROUPED.test(text)) text = text.replace(/,/g, "");
  if (!PLAIN.test(text)) return Number.NaN;
  return Number(text);
}

/** An amount with its two decimals, as an input shows it. */
export function moneyInputText(value: number): string {
  return (toHalalas(value) / 100).toFixed(2);
}

/** Whether an amount is above zero and has at most two decimals. */
export function isPositiveMoney(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}
