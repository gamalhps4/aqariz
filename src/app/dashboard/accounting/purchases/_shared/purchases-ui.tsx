"use client";

/**
 * PropertyPro - What the purchases, register and reconciliation screens share
 *
 * The reader's rights over purchases, one way to call the purchases API (a
 * refusal comes back as a code the screens translate — see
 * setup/_shared/ledger-ui.ts), the words for statuses, methods and VAT
 * categories, the status badges, and the supplier picker. Every text is
 * `purchases.*` in the accounting locale files with the English beside it as
 * the fallback, the way the ledger screens do it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useAuthorization } from "@/hooks/useAuthorization";
import { hasAnyPermission } from "@/lib/permissions-manager";
import {
  ACCOUNTING_READ_PERMISSIONS,
  LEDGER_MANAGE_PERMISSIONS,
  LEDGER_VIEW_PERMISSIONS,
  PURCHASE_APPROVE_PERMISSIONS,
  PURCHASE_CREATE_PERMISSIONS,
  PURCHASE_DELETE_PERMISSIONS,
  PURCHASE_EDIT_PERMISSIONS,
  PURCHASE_PAY_PERMISSIONS,
  PURCHASE_VIEW_PERMISSIONS,
} from "@/lib/finance-permissions";
import type {
  AgingBucket,
  BillStatus,
  CostAccountOption,
  PayingAccountOption,
  PurchaseLookups,
  VoucherMethod,
  VoucherStatus,
} from "@/lib/accounting/purchases/types";
import { apiRequest, useLedgerText, type LedgerResponse, type Text } from "../../setup/_shared/ledger-ui";

export { apiRequest, todayInput, useLedgerError, useLedgerText } from "../../setup/_shared/ledger-ui";
export type { LedgerResponse, Text } from "../../setup/_shared/ledger-ui";

// ---------------------------------------------------------------------------
// Rights
// ---------------------------------------------------------------------------

export function usePurchasesAccess() {
  const { accessProfile, isLoading } = useAuthorization();
  return useMemo(() => {
    const permissions = accessProfile.permissions;
    const can = (list: readonly string[]) => hasAnyPermission(permissions, [...list]);
    return {
      loading: isLoading,
      /** Suppliers, bills, vouchers, the aging report and the purchases register. */
      canView: can(PURCHASE_VIEW_PERMISSIONS),
      canCreate: can(PURCHASE_CREATE_PERMISSIONS),
      canEdit: can(PURCHASE_EDIT_PERMISSIONS),
      /** Cancelling a bill; removing a supplier. */
      canDelete: can(PURCHASE_DELETE_PERMISSIONS),
      canApprove: can(PURCHASE_APPROVE_PERMISSIONS),
      /** Writing and cancelling payment vouchers. */
      canPay: can(PURCHASE_PAY_PERMISSIONS),
      canExport: can(["purchase_export", "financial_management", "data_export"]),
      /** The Sales & Receipts register: the accounting reports' right. */
      canViewSales: can(ACCOUNTING_READ_PERMISSIONS),
      canExportSales: can(["accounting_export", "financial_management", "data_export"]),
      /** Bank reconciliation reads the books and ticks lines off in them. */
      canViewBooks: can(LEDGER_VIEW_PERMISSIONS),
      canManageBooks: can(LEDGER_MANAGE_PERMISSIONS),
    };
  }, [accessProfile.permissions, isLoading]);
}

// ---------------------------------------------------------------------------
// Calling the API
// ---------------------------------------------------------------------------

/** Call a purchases API route (`/api/accounting/purchases<path>`); never throws. */
export function purchasesRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<LedgerResponse<T>> {
  return apiRequest<T>(`/api/accounting/purchases${path}`, init);
}

/** `?a=1&b=2` from the values that are set; empty when none is. */
export function queryString(values: Record<string, string | number | null | undefined | false>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === false || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const BILL_STATUS_TEXT: Record<BillStatus, Text> = {
  pending: ["purchases.status.pending", "Waiting for approval"],
  approved: ["purchases.status.approved", "Approved"],
  partially_paid: ["purchases.status.partially_paid", "Partly paid"],
  paid: ["purchases.status.paid", "Paid"],
  cancelled: ["purchases.status.cancelled", "Cancelled"],
};

export const VOUCHER_STATUS_TEXT: Record<VoucherStatus, Text> = {
  posted: ["purchases.voucherStatus.posted", "Posted"],
  cancelled: ["purchases.voucherStatus.cancelled", "Cancelled"],
};

export const VOUCHER_METHOD_TEXT: Record<VoucherMethod, Text> = {
  bank_transfer: ["purchases.method.bank_transfer", "Bank transfer"],
  cheque: ["purchases.method.cheque", "Cheque"],
  cash: ["purchases.method.cash", "Cash"],
  card: ["purchases.method.card", "Card"],
  other: ["purchases.method.other", "Other"],
};

export const AGING_BUCKET_TEXT: Record<AgingBucket, Text> = {
  current: ["purchases.aging.current", "Not yet due"],
  d1_30: ["purchases.aging.d1_30", "1–30 days"],
  d31_60: ["purchases.aging.d31_60", "31–60 days"],
  d61_90: ["purchases.aging.d61_90", "61–90 days"],
  d90_plus: ["purchases.aging.d90_plus", "Over 90 days"],
};

export const VAT_CATEGORY_TEXT: Record<"S" | "Z" | "E" | "O", Text> = {
  S: ["purchases.vat.S", "Standard-rated"],
  Z: ["purchases.vat.Z", "Zero-rated"],
  E: ["purchases.vat.E", "Exempt"],
  O: ["purchases.vat.O", "Out of scope"],
};

/** The customer kinds a sales register row can have. */
export const CUSTOMER_TYPE_TEXT: Record<"tenant" | "owner" | "customer", Text> = {
  tenant: ["purchases.customerType.tenant", "Tenant"],
  owner: ["purchases.customerType.owner", "Owner"],
  customer: ["purchases.customerType.customer", "Customer"],
};

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const BADGE_TONES = {
  success: "border-success/20 bg-success/10 text-success",
  info: "border-info/20 bg-info/10 text-info",
  warning: "border-warning/20 bg-warning/10 text-warning",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
  muted: "border-muted bg-muted text-muted-foreground",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

const BILL_TONES: Record<BillStatus, BadgeTone> = {
  pending: "warning",
  approved: "info",
  partially_paid: "info",
  paid: "success",
  cancelled: "muted",
};

export function BillStatusBadge({ status, overdue = false }: { status: BillStatus; overdue?: boolean }) {
  const { text, tx } = useLedgerText();
  const tone: BadgeTone = overdue ? "danger" : (BILL_TONES[status] ?? "muted");
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant="outline" className={`text-xs ${BADGE_TONES[tone]}`}>
        {text(BILL_STATUS_TEXT[status] ?? BILL_STATUS_TEXT.pending)}
      </Badge>
      {overdue && (
        <Badge variant="outline" className={`text-xs ${BADGE_TONES.danger}`}>
          {tx("purchases.status.overdue", "Overdue")}
        </Badge>
      )}
    </span>
  );
}

export function VoucherStatusBadge({ status }: { status: VoucherStatus }) {
  const { text } = useLedgerText();
  return (
    <Badge variant="outline" className={`text-xs ${BADGE_TONES[status === "cancelled" ? "muted" : "success"]}`}>
      {text(VOUCHER_STATUS_TEXT[status] ?? VOUCHER_STATUS_TEXT.posted)}
    </Badge>
  );
}

/** A status code of either document as a badge: for the registers, where one column holds both. */
export function DocumentStatusBadge({ status }: { status: string }) {
  const { tx } = useLedgerText();
  const bill = BILL_STATUS_TEXT[status as BillStatus];
  const voucher = VOUCHER_STATUS_TEXT[status as VoucherStatus];
  const tone: BadgeTone =
    status === "paid" || status === "posted"
      ? "success"
      : status === "cancelled" || status === "refunded"
        ? "muted"
        : status === "overdue"
          ? "danger"
          : status === "pending" || status === "scheduled"
            ? "warning"
            : "info";
  const label =
    status === "posted" || status === "cancelled"
      ? tx(`purchases.voucherStatus.${status}`, voucher?.[1] ?? status)
      : bill
        ? tx(bill[0], bill[1])
        : tx(`purchases.documentStatus.${status}`, status.replace(/_/g, " "));
  return (
    <Badge variant="outline" className={`text-xs ${BADGE_TONES[tone]}`}>
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Suppliers, for a picker
// ---------------------------------------------------------------------------

export interface SupplierOption {
  id: string;
  name: string;
  vatNumber: string | null;
  paymentTermsDays: number | null;
  isActive: boolean;
}

/** The suppliers a picker offers (active ones, or all with `includeInactive`). */
export function useSupplierOptions(enabled = true, includeInactive = false) {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      const response = await purchasesRequest<{ suppliers: SupplierOption[] }>(
        `/suppliers${queryString({ options: 1, status: includeInactive ? "all" : "active" })}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setSuppliers(response.ok ? (response.data?.suppliers ?? []) : []);
      setLoading(false);
    })();
    return () => controller.abort();
  }, [enabled, includeInactive, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { suppliers, loading, reload };
}

// ---------------------------------------------------------------------------
// What the forms read from the books
// ---------------------------------------------------------------------------

/**
 * Whether accounting is set up and, on request, the accounts a purchase can
 * be charged to and the bank and cash accounts a voucher can be drawn on
 * (GET /api/accounting/purchases/lookups). They are open to every purchases
 * right, so a clerk without the right to view the books gets the same lists;
 * the accounts a saved bill already uses are listed in `alsoAccountIds`
 * whether or not they still qualify.
 */
export function usePurchaseLookups(
  include: { accounts?: boolean; banks?: boolean },
  options: { enabled?: boolean; alsoAccountIds?: readonly string[] } = {},
) {
  const enabled = options.enabled ?? true;
  const wanted = [include.accounts ? "accounts" : "", include.banks ? "banks" : ""].filter(Boolean).join(",");
  const also = (options.alsoAccountIds ?? []).filter(Boolean).join(",");
  const key = `${wanted}|${also}`;
  const [state, setState] = useState<{
    key: string;
    setUp: boolean | null;
    accounts: CostAccountOption[];
    banks: PayingAccountOption[];
    error: { code: string | null; message: string | null } | null;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      const response = await purchasesRequest<PurchaseLookups>(`/lookups${queryString({ include: wanted, also })}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setState({
        key,
        setUp: response.ok ? (response.data?.setUp ?? null) : null,
        accounts: response.ok ? (response.data?.accounts ?? []) : [],
        banks: response.ok ? (response.data?.banks ?? []) : [],
        error: response.ok ? null : { code: response.code, message: response.message },
      });
    })();
    return () => controller.abort();
  }, [enabled, key, wanted, also]);

  const current = enabled && state?.key === key ? state : null;
  return {
    loading: enabled && current === null,
    /** null until the answer comes, and when the request failed. */
    setUp: current?.setUp ?? null,
    /** Accounting is known not to be set up: the answer says so, or the server refused on that ground. */
    notSetUp: current?.setUp === false || current?.error?.code === "LEDGER_NOT_SET_UP",
    accounts: current?.accounts ?? [],
    banks: current?.banks ?? [],
    error: current?.error ?? null,
  };
}

export function SupplierPicker({
  suppliers,
  value,
  onChange,
  includeAll = false,
  allLabel,
  placeholder,
  className,
  disabled,
  id,
}: {
  suppliers: readonly SupplierOption[];
  value: string;
  onChange: (supplierId: string) => void;
  /** Offer "all suppliers" as the empty choice (the filters do). */
  includeAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  const { tx } = useLedgerText();
  const ALL = "__all__";
  const options = [
    ...(includeAll ? [{ value: ALL, label: allLabel ?? tx("purchases.filters.allSuppliers", "All suppliers") }] : []),
    ...suppliers.map((supplier) => ({
      value: supplier.id,
      label: supplier.name,
      subtitle: supplier.vatNumber ?? undefined,
      badge: supplier.isActive ? undefined : tx("purchases.suppliers.inactive", "Inactive"),
    })),
  ];
  return (
    <SearchableSelect
      id={id}
      value={includeAll && !value ? ALL : value}
      onValueChange={(next) => onChange(next === ALL ? "" : next)}
      options={options}
      placeholder={placeholder ?? tx("purchases.suppliers.choose", "Choose a supplier")}
      searchPlaceholder={tx("purchases.suppliers.search", "Search by name or VAT number")}
      emptyMessage={tx("purchases.suppliers.none", "No matching supplier")}
      triggerClassName={className}
      disabled={disabled}
    />
  );
}
