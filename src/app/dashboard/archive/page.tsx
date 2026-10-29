"use client";

/**
 * PropertyPro - Archive
 *
 * Everything deleted anywhere in the product lands here instead of being
 * destroyed. Restoring is available to anyone who can manage the records;
 * permanent deletion is offered only to the account owner and the platform
 * super admin, and the server enforces that independently.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive as ArchiveIcon,
  Building,
  Building2,
  DoorOpen,
  FileSignature,
  FileText,
  Handshake,
  Info,
  Loader2,
  Receipt,
  RotateCcw,
  Trash2,
  UserRound,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import GlobalSearch from "@/components/ui/global-search";
import { ReportExportButton } from "@/components/reports/export-button";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

// Mirrors ARCHIVE_CATEGORIES in lib/services/archive.service.ts. Kept as a
// local union rather than imported so this client page does not pull the
// service — and the Prisma client with it — into the browser bundle.
type ArchiveCategory =
  | "owners"
  | "clients"
  | "compounds"
  | "buildings"
  | "units"
  | "management_agreements"
  | "investment_agreements"
  | "lease_contracts"
  | "invoices"
  | "payments"
  | "maintenance";

interface ArchivedRecord {
  id: string;
  category: ArchiveCategory;
  label: string;
  sublabel: string;
  deletedAt: string;
  createdAt: string;
  detail: string | null;
}

const CATEGORIES: Array<{
  category: ArchiveCategory;
  labelKey: string;
  fallback: string;
  icon: typeof Users;
}> = [
  { category: "owners", labelKey: "archive.category.owners", fallback: "Owners", icon: UserRound },
  { category: "clients", labelKey: "archive.category.clients", fallback: "Tenants", icon: Users },
  { category: "compounds", labelKey: "archive.category.compounds", fallback: "Compounds", icon: Building },
  { category: "buildings", labelKey: "archive.category.buildings", fallback: "Buildings", icon: Building2 },
  { category: "units", labelKey: "archive.category.units", fallback: "Units", icon: DoorOpen },
  {
    category: "management_agreements",
    labelKey: "archive.category.managementAgreements",
    fallback: "Management Agreements",
    icon: Handshake,
  },
  {
    category: "investment_agreements",
    labelKey: "archive.category.investmentAgreements",
    fallback: "Investment Agreements",
    icon: FileSignature,
  },
  {
    category: "lease_contracts",
    labelKey: "archive.category.leaseContracts",
    fallback: "Lease Contracts",
    icon: FileText,
  },
  {
    category: "invoices",
    labelKey: "archive.category.invoices",
    fallback: "Invoices",
    icon: Receipt,
  },
  {
    category: "payments",
    labelKey: "archive.category.payments",
    fallback: "Payments",
    icon: Wallet,
  },
  {
    category: "maintenance",
    labelKey: "archive.category.maintenance",
    fallback: "Maintenance Requests",
    icon: Wrench,
  },
];

export default function ArchivePage() {
  const { t, formatDate, language } = useLocalizationContext();

  const [active, setActive] = useState<ArchiveCategory>("buildings");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [canPurge, setCanPurge] = useState(false);
  // Whether the server will let this reader restore — someone holding only
  // the right to view the archive is not offered a button that would refuse.
  const [canRestore, setCanRestore] = useState(false);
  // Restoring is confirmed like deleting: it puts a record back into every
  // list, and a payment back onto its installment.
  const [pendingRestore, setPendingRestore] = useState<ArchivedRecord | null>(
    null,
  );
  const [records, setRecords] = useState<ArchivedRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPurge, setPendingPurge] = useState<ArchivedRecord | null>(null);

  const loadCounts = useCallback(async () => {
    try {
      const response = await fetch("/api/archive");
      const payload = await response.json();
      if (payload?.success) {
        const map: Record<string, number> = {};
        for (const entry of payload.data.counts ?? []) {
          map[entry.category] = entry.count;
        }
        setCounts(map);
        setCanPurge(Boolean(payload.data.canPurge));
        setCanRestore(Boolean(payload.data.canRestore));
      }
    } catch (loadError) {
      console.error("Failed to load archive counts:", loadError);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      // `lang`: the record details are worded on the server, in this language.
      const params = new URLSearchParams({ category: active, lang: language });
      if (search) params.set("search", search);
      const response = await fetch(`/api/archive?${params}`);
      const payload = await response.json();
      if (payload?.success) {
        setRecords(payload.data.records ?? []);
        setCanPurge(Boolean(payload.data.canPurge));
        setCanRestore(Boolean(payload.data.canRestore));
        setError(null);
      } else {
        setError(
        payload?.error ??
          t("archive.errors.load", { defaultValue: "Could not read the archive" }),
      );
      }
    } catch (loadError) {
      console.error("Failed to load archive:", loadError);
      setError("Could not read the archive");
    } finally {
      setLoading(false);
    }
  }, [active, search, language]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const restore = async () => {
    const record = pendingRestore;
    if (!record) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/archive/${record.category}/${record.id}`,
        { method: "POST" },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(
        result?.error ??
          t("archive.errors.restore", { defaultValue: "Could not restore" }),
      );
        return;
      }
      setPendingRestore(null);
      await Promise.all([loadRecords(), loadCounts()]);
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!pendingPurge) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/archive/${pendingPurge.category}/${pendingPurge.id}`,
        { method: "DELETE" },
      );
      const result = await response.json();
      if (!response.ok || !result?.success) {
        setError(
        result?.error ??
          t("archive.errors.delete", { defaultValue: "Could not delete" }),
      );
        return;
      }
      setPendingPurge(null);
      await Promise.all([loadRecords(), loadCounts()]);
    } finally {
      setBusy(false);
    }
  };

  const columns: DataTableColumn<ArchivedRecord>[] = [
    {
      id: "label",
      header: t("archive.table.record", { defaultValue: "Record" }),
      cell: (row) => (
        <div className="text-sm">
          <span className="block font-medium">{row.label}</span>
          <span className="block text-xs text-muted-foreground">
            {row.sublabel}
          </span>
        </div>
      ),
      width: "min-w-[200px]",
    },
    {
      id: "detail",
      header: t("archive.table.detail", { defaultValue: "Detail" }),
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.detail ?? "—"}
        </span>
      ),
      visibility: "lg",
      width: "min-w-[200px]",
    },
    {
      id: "deletedAt",
      header: t("archive.table.archivedOn", { defaultValue: "Archived on" }),
      cell: (row) => (
        <span className="text-sm">{formatDate(row.deletedAt)}</span>
      ),
      width: "min-w-[140px]",
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          {canRestore && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => {
                setError(null);
                setPendingRestore(row);
              }}
              disabled={busy}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("archive.actions.restore", { defaultValue: "Restore" })}
            </Button>
          )}
          {/* Offered only to the roles the server will actually accept, so
              nobody meets a button that always fails. */}
          {canPurge && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-destructive"
              onClick={() => setPendingPurge(row)}
              disabled={busy}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
      width: "min-w-[150px]",
      align: "right",
    },
  ];

  const activeMeta = CATEGORIES.find((entry) => entry.category === active)!;
  const totalArchived = Object.values(counts).reduce(
    (sum, count) => sum + count,
    0,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ArchiveIcon className="h-6 w-6" />
          {t("nav.archive", { defaultValue: "Archive" })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("archive.subtitle", {
            defaultValue:
              "Deleted records are kept here instead of being destroyed. Restore them at any time.",
          })}
        </p>
      </div>

      {!canPurge && totalArchived > 0 && (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t("archive.noPurgeRights", {
            defaultValue:
              "Only the account owner or a platform super admin can permanently delete an archived record. You can restore anything here.",
          })}
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((entry) => (
          <Button
            key={entry.category}
            size="sm"
            variant={active === entry.category ? "default" : "outline"}
            onClick={() => {
              setActive(entry.category);
              setSearch("");
            }}
          >
            <entry.icon className="h-4 w-4" />
            {t(entry.labelKey, { defaultValue: entry.fallback })}
            {(counts[entry.category] ?? 0) > 0 && (
              <Badge variant="secondary" className="ms-1">
                {counts[entry.category]}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <activeMeta.icon className="h-4 w-4" />
              {t(activeMeta.labelKey, { defaultValue: activeMeta.fallback })}
            </CardTitle>
            {/* The category as filtered on screen, to Excel, PDF or CSV. */}
            <ReportExportButton
              endpoint="/api/archive"
              params={
                new URLSearchParams({
                  category: active,
                  ...(search ? { search } : {}),
                })
              }
              disabled={loading || records.length === 0}
            />
          </div>
          <div className="pt-2">
            <GlobalSearch
              placeholder={t("archive.searchPlaceholder", {
                defaultValue: "Search the archive...",
              })}
              initialValue={search}
              debounceDelay={300}
              onSearch={setSearch}
              isLoading={loading}
              inputClassName="h-10"
              ariaLabel={t("archive.searchPlaceholder", {
                defaultValue: "Search the archive...",
              })}
            />
          </div>
        </CardHeader>
        <CardContent>
          {busy && (
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("archive.working", { defaultValue: "Working…" })}
            </div>
          )}
          <DataTable
            columns={columns}
            data={records}
            loading={loading}
            getRowKey={(row) => row.id}
            emptyState={{
              icon: (
                <ArchiveIcon className="h-10 w-10 text-muted-foreground" />
              ),
              title: t("archive.empty.title", {
                defaultValue: "Nothing archived here",
              }),
              description: t("archive.empty.description", {
                defaultValue:
                  "Records you delete in this category will appear here",
              }),
            }}
          />
        </CardContent>
      </Card>

      <AlertDialog
        open={!!pendingRestore}
        onOpenChange={(open) => !open && setPendingRestore(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              {t("archive.restore.title", {
                defaultValue: "Restore {name}?",
                values: { name: pendingRestore?.label ?? "" },
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRestore?.category === "payments"
                ? t("archive.restore.paymentDescription", {
                    defaultValue:
                      "The payment is recorded again: its amount goes back onto the installment it paid, which then reads as paid by it. If that installment has been settled since, the restore is refused.",
                  })
                : t("archive.restore.description", {
                    defaultValue:
                      "It leaves the Archive and appears again in its lists, as it was when it was deleted.",
                  })}
            </AlertDialogDescription>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Kept open until the server answers, so a refusal is read
                // beside the record it concerns.
                event.preventDefault();
                void restore();
              }}
              disabled={busy}
            >
              {t("archive.restore.confirm", { defaultValue: "Restore" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingPurge}
        onOpenChange={(open) => !open && setPendingPurge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("archive.purge.title", {
                defaultValue: "Delete permanently?",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("archive.purge.description", {
                defaultValue:
                  '"{name}" will be destroyed and cannot be recovered. If anything still references it — invoices, payments or contracts — the deletion will be refused rather than take that history with it.',
                values: { name: pendingPurge?.label ?? "" },
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={purge}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("archive.purge.confirm", {
                defaultValue: "Delete permanently",
              })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
