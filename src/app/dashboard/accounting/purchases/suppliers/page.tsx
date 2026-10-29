"use client";

/**
 * PropertyPro - Suppliers
 *
 * Who the office buys from, with what it owes each of them — read from the
 * books, so the list, the supplier's statement and the payables aging agree —
 * and how many of their bills are still open. Suppliers are added and changed
 * here; from a row a bill is started, the statement opened, a supplier no
 * longer used deactivated, or one nothing was ever written against removed.
 */

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { FilePlus2, Info, Lock, MoreHorizontal, Pencil, Plus, Power, ScrollText, Trash2, Truck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import GlobalSearch from "@/components/ui/global-search";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportExportButton } from "@/components/reports/export-button";
import type { SupplierView } from "@/lib/accounting/purchases/types";
import { LedgerHeader, LedgerNotSetUp, LedgerPagination, Money } from "../../setup/_shared/ledger-parts";
import { purchasesRequest, queryString, useLedgerError, useLedgerText, usePurchasesAccess } from "../_shared/purchases-ui";
import { SupplierFormDialog } from "./_parts/supplier-form";

type StatusFilter = "active" | "inactive" | "all";

export default function SuppliersPage() {
  return (
    <Suspense fallback={null}>
      <SuppliersFromAddress />
    </Suspense>
  );
}

/** A link may open the list already searched (`?search=`): the bill screen links a supplier's name here. */
function SuppliersFromAddress() {
  const search = useSearchParams().get("search") ?? "";
  return <Suppliers key={search} initialSearch={search} />;
}

function termsWords(tx: ReturnType<typeof useLedgerText>["tx"], days: number | null): string {
  return days === null || days <= 0
    ? tx("purchases.suppliers.termsOnBillDate", "On the bill's date")
    : tx("purchases.suppliers.termsDays", "{days} days", { days });
}

function NoSupplierAccess() {
  const { tx } = useLedgerText();
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">{tx("purchases.suppliers.noAccess.title", "You do not have access to suppliers")}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {tx(
            "purchases.suppliers.noAccess.body",
            "Ask an administrator to give your permission group the right to view Purchases & payments.",
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function SuppliersUnavailable() {
  const { tx } = useLedgerText();
  const describeError = useLedgerError();
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Info className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">{tx("purchases.suppliers.unavailable.title", "Suppliers are not available yet")}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {describeError({ code: "PURCHASES_UNAVAILABLE", message: null })}
        </p>
      </CardContent>
    </Card>
  );
}

/** What the office owes the supplier, from the books; below zero the supplier owes the office (an advance). */
function BalanceCell({ balance }: { balance: number | null }) {
  const { tx } = useLedgerText();
  if (balance === null) return <span className="text-sm text-muted-foreground">—</span>;
  if (balance < 0) {
    return (
      <div className="flex flex-col items-end">
        <Money value={-balance} className="text-sm font-semibold text-info" />
        <span className="text-xs text-muted-foreground">
          {tx("purchases.suppliers.advance", "Advance: the supplier owes the office")}
        </span>
      </div>
    );
  }
  return <Money value={balance} className="text-sm font-semibold" />;
}

function Suppliers({ initialSearch }: { initialSearch: string }) {
  const access = usePurchasesAccess();
  const { tx } = useLedgerText();
  const describeError = useLedgerError();
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState<SupplierView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ code: string | null; message: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<{ supplier: SupplierView | null } | null>(null);
  const [removing, setRemoving] = useState<{ supplier: SupplierView; refusal: string | null; inUse: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!access.canView) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      const response = await purchasesRequest<{ suppliers: SupplierView[] }>(
        `/suppliers${queryString({ search, status, page, limit })}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (response.ok) {
        setRows(response.data?.suppliers ?? []);
        setTotal(response.pagination?.total ?? 0);
        setFailure(null);
      } else {
        setRows([]);
        setTotal(0);
        setFailure({ code: response.code, message: response.message });
      }
      setLoading(false);
    })();
    return () => controller.abort();
  }, [access.canView, search, status, page, limit, version]);

  if (access.loading) return null;
  if (!access.canView) return <NoSupplierAccess />;
  if (failure?.code === "PURCHASES_UNAVAILABLE") return <SuppliersUnavailable />;
  if (failure?.code === "LEDGER_NOT_SET_UP") return <LedgerNotSetUp canManage={access.canManageBooks} />;

  const reload = () => setVersion((value) => value + 1);

  async function setActive(supplier: SupplierView, isActive: boolean): Promise<boolean> {
    setBusy(true);
    const response = await purchasesRequest<SupplierView>(`/suppliers/${encodeURIComponent(supplier.id)}`, {
      method: "PATCH",
      body: { isActive },
    });
    setBusy(false);
    if (!response.ok) {
      toast.error(describeError(response));
      return false;
    }
    toast.success(
      isActive
        ? tx("purchases.suppliers.reactivated", "{name} is active again", { name: supplier.name })
        : tx("purchases.suppliers.deactivated", "{name} is deactivated", { name: supplier.name }),
    );
    reload();
    return true;
  }

  async function remove() {
    if (!removing) return;
    const target = removing.supplier;
    setBusy(true);
    const response = await purchasesRequest(`/suppliers/${encodeURIComponent(target.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) {
      // Kept open: a supplier in use is refused, and deactivating is offered instead.
      setRemoving({
        supplier: target,
        refusal: describeError(response),
        inUse: response.code === "PURCHASE_SUPPLIER_IN_USE",
      });
      return;
    }
    toast.success(tx("purchases.suppliers.deleted", "{name} is deleted", { name: target.name }));
    setRemoving(null);
    reload();
  }

  async function deactivateInstead() {
    if (!removing) return;
    if (await setActive(removing.supplier, false)) setRemoving(null);
  }

  const hasFilters = Boolean(search) || status !== "active";
  const exportParams = new URLSearchParams({ status, ...(search ? { search } : {}) });
  const booksNotSetUp = rows.some((row) => row.balance === null);

  const columns: DataTableColumn<SupplierView>[] = [
    {
      id: "name",
      header: tx("purchases.suppliers.col.name", "Supplier"),
      cell: (row) => (
        <div className="flex min-w-0 flex-col items-start">
          <span className="text-sm font-medium">{row.name}</span>
          {row.vatNumber && (
            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
              {row.vatNumber}
            </span>
          )}
        </div>
      ),
      width: "min-w-[200px]",
    },
    {
      id: "contact",
      header: tx("purchases.suppliers.col.contact", "Contact"),
      cell: (row) =>
        row.contactName || row.phone || row.email ? (
          <div className="flex flex-col items-start text-sm">
            {row.contactName && <span>{row.contactName}</span>}
            {row.phone && (
              <span className="text-xs text-muted-foreground" dir="ltr">
                {row.phone}
              </span>
            )}
            {row.email && (
              <span className="text-xs text-muted-foreground" dir="ltr">
                {row.email}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      visibility: "md",
      width: "min-w-[180px]",
    },
    {
      id: "city",
      header: tx("purchases.suppliers.col.city", "City"),
      cell: (row) => <span className="text-sm">{row.city || "—"}</span>,
      visibility: "lg",
    },
    {
      id: "terms",
      header: tx("purchases.suppliers.col.terms", "Payment terms"),
      cell: (row) => <span className="text-sm">{termsWords(tx, row.paymentTermsDays)}</span>,
      visibility: "lg",
    },
    {
      id: "openBills",
      header: tx("purchases.suppliers.col.openBills", "Open bills"),
      cell: (row) =>
        row.openBills > 0 ? (
          <Link
            href={`/dashboard/accounting/purchases/bills?${new URLSearchParams({ supplierId: row.id, status: "open" }).toString()}`}
            className="text-sm font-medium text-primary hover:underline"
            dir="ltr"
          >
            {row.openBills}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground" dir="ltr">
            0
          </span>
        ),
      align: "center",
      visibility: "md",
    },
    {
      id: "balance",
      header: tx("purchases.suppliers.col.balance", "What we owe"),
      cell: (row) => <BalanceCell balance={row.balance} />,
      align: "right",
      width: "min-w-[130px]",
    },
    {
      id: "status",
      header: tx("purchases.suppliers.col.status", "Status"),
      cell: (row) => (
        <Badge variant={row.isActive ? "success" : "outline"} className="text-xs">
          {row.isActive ? tx("purchases.suppliers.active", "Active") : tx("purchases.suppliers.inactive", "Inactive")}
        </Badge>
      ),
      visibility: "sm",
    },
    {
      id: "actions",
      header: "",
      cell: (row) => {
        const newBill = access.canCreate && row.isActive;
        if (!access.canEdit && !newBill && !access.canViewBooks && !access.canDelete) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label={tx("ledger.common.actions", "Actions")}
                disabled={busy}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {access.canEdit && (
                <DropdownMenuItem onClick={() => setEditing({ supplier: row })}>
                  <Pencil className="h-4 w-4" />
                  {tx("ledger.common.edit", "Edit")}
                </DropdownMenuItem>
              )}
              {newBill && (
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/accounting/purchases/bills/new?${new URLSearchParams({ supplierId: row.id }).toString()}`}>
                    <FilePlus2 className="h-4 w-4" />
                    {tx("purchases.suppliers.newBill", "New bill")}
                  </Link>
                </DropdownMenuItem>
              )}
              {access.canViewBooks && (
                <DropdownMenuItem asChild>
                  <Link
                    href={`/dashboard/accounting/ledger-reports/party-statement?${new URLSearchParams({ partyType: "supplier", partyId: row.id }).toString()}`}
                  >
                    <ScrollText className="h-4 w-4" />
                    {tx("purchases.suppliers.statement", "Statement")}
                  </Link>
                </DropdownMenuItem>
              )}
              {access.canEdit && (
                <DropdownMenuItem onClick={() => void setActive(row, !row.isActive)}>
                  <Power className="h-4 w-4" />
                  {row.isActive
                    ? tx("purchases.suppliers.deactivate", "Deactivate")
                    : tx("purchases.suppliers.reactivate", "Reactivate")}
                </DropdownMenuItem>
              )}
              {access.canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setRemoving({ supplier: row, refusal: null, inUse: false })}
                  >
                    <Trash2 className="h-4 w-4" />
                    {tx("ledger.common.delete", "Delete")}
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
        title={tx("nav.accounting.suppliers", "Suppliers")}
        subtitle={tx(
          "purchases.suppliers.subtitle",
          "Who the office buys from, what it owes each of them in the books, and their bills still open.",
        )}
        actions={
          access.canExport || access.canCreate ? (
            <>
              {access.canExport && (
                <ReportExportButton
                  endpoint="/api/accounting/purchases/suppliers"
                  params={exportParams}
                  disabled={rows.length === 0}
                />
              )}
              {access.canCreate && (
                <Button size="sm" onClick={() => setEditing({ supplier: null })}>
                  <Plus className="h-4 w-4" />
                  {tx("purchases.suppliers.add", "Add supplier")}
                </Button>
              )}
            </>
          ) : null
        }
      />

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col gap-3 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 lg:flex-row lg:items-center dark:border-gray-700/60 dark:bg-gray-800/50">
            <GlobalSearch
              placeholder={tx("purchases.suppliers.searchPlaceholder", "Search by name, VAT number, phone, email or contact")}
              ariaLabel={tx("purchases.suppliers.searchLabel", "Search suppliers")}
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
                setStatus(value as StatusFilter);
                setPage(1);
              }}
            >
              <SelectTrigger
                className="h-10 w-full bg-white lg:w-52 dark:bg-gray-800"
                aria-label={tx("purchases.suppliers.col.status", "Status")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{tx("purchases.suppliers.filterActive", "Active suppliers")}</SelectItem>
                <SelectItem value="inactive">{tx("purchases.suppliers.filterInactive", "Inactive suppliers")}</SelectItem>
                <SelectItem value="all">{tx("purchases.filters.allSuppliers", "All suppliers")}</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 px-3"
                onClick={() => {
                  setSearch("");
                  setStatus("active");
                  setPage(1);
                }}
              >
                <X className="h-4 w-4" />
                {tx("common.clear", "Clear")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {booksNotSetUp && !loading && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {tx(
                "purchases.suppliers.balancesNotSetUp",
                "What the office owes each supplier is read from the books, so it shows once accounting is set up.",
              )}
            </p>
          )}
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            getRowKey={(row) => row.id}
            error={
              failure
                ? {
                    message: describeError(failure),
                    onRetry: reload,
                    retryLabel: tx("common.retry", "Try again"),
                  }
                : null
            }
            emptyState={{
              icon: <Truck className="h-12 w-12 text-muted-foreground" />,
              title: hasFilters
                ? tx("purchases.suppliers.emptyFiltered", "No supplier matches these filters")
                : tx("purchases.suppliers.empty", "No suppliers yet"),
              description: hasFilters
                ? tx("purchases.suppliers.emptyFilteredHint", "Change or clear the filters.")
                : tx("purchases.suppliers.emptyHint", "Add the people and companies the office buys from."),
              action:
                !hasFilters && access.canCreate ? (
                  <Button size="sm" onClick={() => setEditing({ supplier: null })}>
                    <Plus className="h-4 w-4" />
                    {tx("purchases.suppliers.add", "Add supplier")}
                  </Button>
                ) : undefined,
            }}
          />
          <LedgerPagination page={page} limit={limit} total={total} onPageChange={setPage} onLimitChange={setLimit} />
        </CardContent>
      </Card>

      <SupplierFormDialog
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {tx("purchases.suppliers.deleteTitle", "Delete {name}?", { name: removing?.supplier.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {tx(
                "purchases.suppliers.deleteBody",
                "Only a supplier nothing has been written against can be deleted. A supplier with bills, payments or expenses is deactivated instead.",
              )}
            </DialogDescription>
          </DialogHeader>
          {removing?.refusal && (
            <div role="alert" className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
              {removing.refusal}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
              {tx("ledger.common.cancel", "Cancel")}
            </Button>
            {removing?.inUse ? (
              access.canEdit && removing.supplier.isActive ? (
                <Button onClick={() => void deactivateInstead()} disabled={busy}>
                  <Power className="h-4 w-4" />
                  {busy ? tx("ledger.common.working", "Working…") : tx("purchases.suppliers.deactivateInstead", "Deactivate instead")}
                </Button>
              ) : null
            ) : (
              <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
                {busy ? tx("ledger.common.working", "Working…") : tx("ledger.common.delete", "Delete")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
