"use client";

/**
 * PropertyPro - Management agreements
 *
 * The contracts between property owners and the office, and the basis on
 * which the office earns. Distinct from leases, which are with tenants.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ReportExportButton } from "@/components/reports/export-button";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  FileSignature,
  Handshake,
  MoreHorizontal,
  Percent,
  Plus,
  Trash2,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import GlobalSearch from "@/components/ui/global-search";
import { GlobalPagination } from "@/components/ui/global-pagination";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { Agreement, AgreementStatus } from "@/types/agreement";

const STATUS_STYLES: Record<AgreementStatus, string> = {
  active: "bg-success/10 text-success border-success/20",
  draft: "bg-muted text-muted-foreground border-muted",
  expired: "bg-warning/10 text-warning border-warning/20",
  terminated: "bg-error/10 text-error border-error/20",
};

const SCOPE_ICONS = {
  property: Building2,
  compound: Building2,
  portfolio: UserRound,
} as const;

/**
 * "Management agreements" and "Investment agreements" in the menu are this
 * page with a different `?kind=`. Keyed on it, so the second link starts the
 * page afresh instead of keeping the first one's filter.
 */
export default function AgreementsPage() {
  const kind = useSearchParams().get("kind");
  return <AgreementsList key={kind ?? ""} initialKind={kind} />;
}

function AgreementsList({ initialKind }: { initialKind: string | null }) {
  const router = useRouter();
  const { t, formatDate, formatCurrency } = useLocalizationContext();

  /** "5%" or "3,000.00 ﷼ / monthly", in the reader's language. */
  const feeText = (row: Agreement) =>
    row.feeType === "fixed"
      ? `${formatCurrency(row.feeAmount)} / ${t(
          `leases.contract.frequency.${row.feeFrequency}`,
          { defaultValue: row.feeFrequency.replace(/_/g, " ") },
        )}`
      : `${row.feePercentage}%`;

  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(12);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  // The plain list is "Management agreements" in the menu; investment
  // agreements have their own entry (`?kind=investment`).
  const [kind, setKind] = useState(
    initialKind === "investment" || initialKind === "all"
      ? initialKind
      : "management",
  );
  const [pendingDelete, setPendingDelete] = useState<Agreement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        status,
      });
      if (search) params.set("search", search);
      if (kind !== "all") params.set("kind", kind);

      const response = await fetch(`/api/agreements?${params}`);
      const payload = await response.json();
      if (payload?.success) {
        setAgreements(payload.data ?? []);
        setTotalPages(payload.pagination?.totalPages ?? 1);
        setTotalItems(payload.pagination?.total ?? 0);
      }
    } catch (error) {
      console.error("Failed to load agreements:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, status, kind]);

  useEffect(() => {
    load();
  }, [load]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      const response = await fetch(`/api/agreements/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setPendingDelete(null);
        load();
      }
    } catch (error) {
      console.error("Failed to archive agreement:", error);
    }
  };

  const percentageCount = agreements.filter(
    (agreement) => agreement.feeType === "percentage",
  ).length;

  const columns: DataTableColumn<Agreement>[] = [
    {
      id: "agreement",
      header: t("agreements.table.agreement", { defaultValue: "Agreement" }),
      cell: (row) => (
        <Link
          href={`/dashboard/agreements/${row.id}`}
          className="group inline-flex flex-col text-foreground"
        >
          <span className="text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {row.agreementNumber ??
              t("agreements.table.unnumbered", {
                defaultValue: "(no number)",
              })}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.kind === "investment" ? t("agreements.kind.investment", { defaultValue: "Investment agreement" }) : t("agreements.kind.management", { defaultValue: "Management agreement" })}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDate(row.startDate)}
            {row.endDate ? ` – ${formatDate(row.endDate)}` : ""}
          </span>
        </Link>
      ),
      width: "min-w-[170px]",
    },
    {
      id: "owner",
      header: t("agreements.table.owner", { defaultValue: "Owner" }),
      cell: (row) => (
        <Link
          href={`/dashboard/clients/owners/${row.ownerId}`}
          className="text-sm transition-colors hover:text-blue-600 dark:hover:text-blue-400"
        >
          {row.owner
            ? `${row.owner.firstName} ${row.owner.lastName}`.trim()
            : "—"}
        </Link>
      ),
      width: "min-w-[150px]",
    },
    {
      id: "covers",
      header: t("agreements.table.covers", { defaultValue: "Covers" }),
      cell: (row) => {
        const Icon = SCOPE_ICONS[row.scopeType];
        const label =
          row.scopeType === "property"
            ? (row.property?.name ?? "—")
            : row.scopeType === "compound"
              ? (row.compound?.name ?? "—")
              : t("agreements.scope.portfolio", {
                  defaultValue: "Whole portfolio",
                });
        return (
          <span className="flex items-center gap-1.5 text-sm">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            {label}
          </span>
        );
      },
      visibility: "md",
      width: "min-w-[170px]",
    },
    {
      id: "fee",
      header: t("agreements.table.fee", { defaultValue: "Fee" }),
      cell: (row) => (
        <div className="text-sm">
          <span className="block font-medium">{feeText(row)}</span>
          <span className="block text-xs capitalize text-muted-foreground">
            {row.kind === "investment"
              ? t("agreements.investment.rent", { defaultValue: "Rent paid to the owner" })
              : t(`agreements.basis.${row.commissionBasis}`, {
                  defaultValue: row.commissionBasis,
                })}
          </span>
        </div>
      ),
      width: "min-w-[140px]",
    },
    {
      id: "status",
      header: t("agreements.table.status", { defaultValue: "Status" }),
      cell: (row) => (
        <Badge
          variant="outline"
          className={`text-xs font-normal capitalize ${STATUS_STYLES[row.status]}`}
        >
          {t(`agreements.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
      width: "min-w-[110px]",
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => router.push(`/dashboard/agreements/${row.id}`)}
            >
              {t("common.view", { defaultValue: "View" })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push(`/dashboard/agreements/${row.id}/edit`)}
            >
              {t("common.edit", { defaultValue: "Edit" })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setPendingDelete(row)}
              className="text-destructive"
            >
              <Trash2 className="me-2 h-4 w-4" />
              {t("agreements.actions.archive", { defaultValue: "Archive" })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      width: "w-10",
      align: "center",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("nav.agreements", { defaultValue: "Agreements" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("agreements.subtitle", {
              defaultValue:
                "Contracts between property owners and the office, and the commission the office earns",
            })}
          </p>
        </div>
        <div className="flex gap-2">
          {/* The file carries the list as filtered, not the page of it on
              screen — see the export branch in /api/agreements. */}
          <ReportExportButton
            endpoint="/api/agreements"
            params={(() => {
              const params = new URLSearchParams();
              if (search) params.set("search", search);
              if (status && status !== "all") params.set("status", status);
              if (kind !== "all") params.set("kind", kind);
              return params;
            })()}
            disabled={loading}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push("/dashboard/agreements/reports")}
          >
            <FileSignature className="h-4 w-4" />
            {t("agreements.actions.report", { defaultValue: "Report" })}
          </Button>
          <Button
            size="sm"
            onClick={() =>
              router.push(
                kind === "investment"
                  ? "/dashboard/agreements/new?kind=investment"
                  : "/dashboard/agreements/new",
              )
            }
          >
            <Plus className="h-4 w-4" />
            {t("agreements.actions.add", { defaultValue: "Create agreement" })}
          </Button>
        </div>
      </div>

      <AnalyticsCardGrid className="lg:grid-cols-3">
        <AnalyticsCard
          title={t("agreements.stats.total", { defaultValue: "Agreements" })}
          value={String(totalItems)}
          icon={Handshake}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("agreements.stats.percentage", {
            defaultValue: "Percentage-based",
          })}
          value={String(percentageCount)}
          icon={Percent}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("agreements.stats.fixed", { defaultValue: "Fixed fee" })}
          value={String(agreements.length - percentageCount)}
          icon={Wallet}
          iconColor="success"
        />
      </AnalyticsCardGrid>

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <GlobalSearch
                placeholder={t("agreements.searchPlaceholder", {
                  defaultValue: "Search agreements...",
                })}
                initialValue={search}
                debounceDelay={300}
                onSearch={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                isLoading={loading}
                className="min-w-0 flex-1"
                inputClassName="h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                ariaLabel={t("agreements.searchPlaceholder", {
                  defaultValue: "Search agreements...",
                })}
              />
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-10 w-44 bg-white dark:bg-gray-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("agreements.filters.all", {
                      defaultValue: "All statuses",
                    })}
                  </SelectItem>
                  {(["active", "draft", "expired", "terminated"] as const).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {t(`agreements.status.${value}`, {
                          defaultValue: value,
                        })}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <Select
                value={kind}
                onValueChange={(value) => {
                  setKind(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-10 w-52 bg-white dark:bg-gray-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("agreements.filters.allKinds", { defaultValue: "All agreement types" })}
                  </SelectItem>
                  <SelectItem value="management">{t("agreements.kind.management", { defaultValue: "Management agreement" })}</SelectItem>
                  <SelectItem value="investment">{t("agreements.kind.investment", { defaultValue: "Investment agreement" })}</SelectItem>
                </SelectContent>
              </Select>
              {(search || status !== "active" || kind !== "management") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setStatus("active");
                    setKind("management");
                    setPage(1);
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="me-1 h-4 w-4" />
                  {t("common.clear", { defaultValue: "Clear" })}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <DataTable
            columns={columns}
            data={agreements}
            loading={loading}
            getRowKey={(row) => row.id}
            emptyState={{
              icon: <Handshake className="h-12 w-12 text-muted-foreground" />,
              title: t("agreements.empty.title", {
                defaultValue: "No agreements yet",
              }),
              description: t("agreements.empty.description", {
                defaultValue:
                  "Create one to record what the office earns on an owner's buildings. Owners who manage their own property need none.",
              }),
              action: (
                <Button
                  size="sm"
                  onClick={() => router.push("/dashboard/agreements/new")}
                >
                  <Plus className="me-2 h-4 w-4" />
                  {t("agreements.actions.add", {
                    defaultValue: "Create agreement",
                  })}
                </Button>
              ),
            }}
          />
          {!loading && totalItems > 0 && (
            <GlobalPagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={limit}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setLimit(next);
                setPage(1);
              }}
              showingLabel={t("common.showing", { defaultValue: "Showing" })}
              previousLabel={t("common.previous", { defaultValue: "Previous" })}
              nextLabel={t("common.next", { defaultValue: "Next" })}
              pageLabel={t("common.page", { defaultValue: "Page" })}
              ofLabel={t("common.of", { defaultValue: "of" })}
              itemsPerPageLabel={t("common.perPage", {
                defaultValue: "per page",
              })}
              disabled={loading}
            />
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("agreements.archive.title", {
                defaultValue: "Archive this agreement?",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("agreements.archive.description", {
                defaultValue:
                  "It stops earning commission from now on. Everything already earned stays on the record, so past statements still reconcile.",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("agreements.actions.archive", { defaultValue: "Archive" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
