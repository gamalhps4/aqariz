"use client";

/**
 * PropertyPro - What the two registers share
 *
 * One request per page of a register (the filters last applied, the search,
 * the order and the page), the page that resets to the first whenever any
 * of those change, the order switch, and the words a row needs: a stored
 * status, a stored code such as a charge's kind, and the card for a reader
 * without the right to the sales register.
 */

import { useCallback, useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BillStatus } from "@/lib/accounting/purchases/types";
import type { RegisterOrder } from "@/lib/accounting/registers";
import { apiRequest, useLedgerError, useLedgerText, type LedgerResponse } from "../../setup/_shared/ledger-ui";
import { BILL_STATUS_TEXT } from "../../purchases/_shared/purchases-ui";

/** The rows a register page holds unless the reader asks for another size. */
export const REGISTER_PAGE_SIZE = 50;

/**
 * A page of a register. `base` is everything but the page: when it changes
 * the page goes back to the first, without an effect to do it.
 */
export function useRegisterPage<T>(endpoint: string, base: string, enabled = true) {
  const describeError = useLedgerError();
  const [paging, setPaging] = useState({ base, page: 1 });
  const [limit, setLimit] = useState(REGISTER_PAGE_SIZE);
  const page = paging.base === base ? paging.page : 1;
  const setPage = useCallback((next: number) => setPaging({ base, page: next }), [base]);

  const url = enabled ? `${endpoint}?${base}${base ? "&" : ""}page=${page}&limit=${limit}` : null;
  const [result, setResult] = useState<{ url: string; response: LedgerResponse<T> } | null>(null);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void (async () => {
      const response = await apiRequest<T>(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult({ url, response });
    })();
    return () => controller.abort();
  }, [url]);

  const current = url && result?.url === url ? result.response : null;
  return {
    page,
    setPage,
    limit,
    setLimit,
    loading: url !== null && current === null,
    data: current?.ok ? current.data : null,
    total: current?.pagination?.total ?? 0,
    code: current && !current.ok ? current.code : null,
    error: current && !current.ok ? describeError(current) : null,
  };
}

/** Newest first, or oldest first. */
export function OrderSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: RegisterOrder;
  onChange: (order: RegisterOrder) => void;
}) {
  const { tx } = useLedgerText();
  return (
    <div className="w-full space-y-1.5 sm:w-48">
      <Label htmlFor={id}>{tx("purchases.registers.order.label", "Order")}</Label>
      <Select value={value} onValueChange={(next) => onChange(next === "asc" ? "asc" : "desc")}>
        <SelectTrigger id={id} className="h-10 bg-white dark:bg-gray-800">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc">{tx("purchases.registers.order.desc", "Newest first")}</SelectItem>
          <SelectItem value="asc">{tx("purchases.registers.order.asc", "Oldest first")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A stored status in words, the same words the status badge uses
 * (DocumentStatusBadge in purchases-ui): a bill's, a voucher's, an invoice's
 * or a receipt's.
 */
export function useStatusText() {
  const { tx, text } = useLedgerText();
  return useCallback(
    (status: string) => {
      if (status === "posted" || status === "cancelled") {
        return tx(`purchases.voucherStatus.${status}`, status === "posted" ? "Posted" : "Cancelled");
      }
      const bill = BILL_STATUS_TEXT[status as BillStatus];
      if (bill) return text(bill);
      return tx(`purchases.documentStatus.${status}`, status.replace(/_/g, " "));
    },
    [tx, text],
  );
}

const CODE = /^[a-z][a-z0-9_]*$/;

/**
 * A stored code — a charge's kind such as `security_deposit` — in the
 * reader's language, through the export catalogue's words for it; anything
 * else (an invoice number) as it is.
 */
export function useCodeText() {
  const { tx } = useLedgerText();
  return useCallback(
    (value: string | null | undefined) => {
      if (!value) return "";
      return CODE.test(value) ? tx(`exports.value.${value}`, value.replace(/_/g, " ")) : value;
    },
    [tx],
  );
}

/** For a reader without the accounting reports' right. */
export function NoSalesAccess() {
  const { tx } = useLedgerText();
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">
          {tx("purchases.access.salesDeniedTitle", "You do not have access to the sales register")}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          {tx(
            "purchases.access.salesDeniedBody",
            "Ask an administrator for the View accounting permission in your permission group.",
          )}
        </p>
      </CardContent>
    </Card>
  );
}
