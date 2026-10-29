/**
 * PropertyPro - Tenant Ledger Component
 * Component for displaying comprehensive tenant financial ledger
 */

"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Filter,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { describeCharge } from "@/lib/i18n/charge-description";
import { ReportExportButton } from "@/components/reports/export-button";
import { useAuthorization } from "@/hooks/useAuthorization";
import { hasAnyPermission } from "@/lib/permissions-manager";
import { codeLabel, TRANSACTION_CATEGORY_TABLES } from "@/lib/i18n/code-label";

/**
 * The ledger groups its lines under camel-case keys (see
 * tenant-ledger-entries.ts); the catalogue names the same groups by the
 * stored charge codes.
 */
const LEDGER_CATEGORY_CODES: Record<string, string> = {
  securityDeposit: "security_deposit",
  lateFees: "late_fee",
  utilities: "utility",
};

interface LedgerEntry {
  id: string;
  date: string;
  type: "debit" | "credit";
  category: string;
  description: string;
  reference: string;
  debitAmount: number;
  creditAmount: number;
  runningBalance: number;
  status: string;
  periodStart?: string | null;
  periodEnd?: string | null;
}

interface LedgerSummary {
  tenantName: string;
  propertyName: string;
  periodStart: string;
  periodEnd: string;
  totalDebits: number;
  totalCredits: number;
  currentBalance: number;
  breakdown: Record<string, { debits: number; credits: number }>;
  statusCounts: {
    paidInvoices: number;
    unpaidInvoices: number;
    overdueInvoices: number;
    totalPayments: number;
  };
}

interface TenantLedgerProps {
  tenantId: string;
  leaseId?: string;
  className?: string;
}

export default function TenantLedger({
  tenantId,
  leaseId,
  className,
}: TenantLedgerProps) {
  const { t, formatCurrency, formatDate, language } = useLocalizationContext();
  const { permissions } = useAuthorization();
  // What the export asks for (canExport on the server): the payments export
  // right, the finance module's umbrella, or the old catch-all.
  const mayExport = hasAnyPermission(permissions, [
    "payment_export",
    "financial_management",
    "data_export",
  ]);
  const [ledgerData, setLedgerData] = useState<{
    summary: LedgerSummary;
    entries: LedgerEntry[];
    pagination: any;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  // The reader's own calendar days. `toISOString` wrote them in UTC, so east
  // of Greenwich the default period opened on 31 December and ended
  // yesterday.
  const localDay = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const [filters, setFilters] = useState({
    startDate: localDay(new Date(new Date().getFullYear(), 0, 1)),
    endDate: localDay(new Date()),
    page: 1,
    limit: 50,
  });

  useEffect(() => {
    fetchLedgerData();
  }, [tenantId, leaseId, filters.startDate, filters.endDate, filters.page]);

  const fetchLedgerData = async () => {
    try {
      setLoading(true);

      const params = new URLSearchParams({
        startDate: filters.startDate,
        endDate: filters.endDate,
        page: filters.page.toString(),
        limit: filters.limit.toString(),
      });

      if (leaseId) params.append("leaseId", leaseId);

      const response = await fetch(`/api/tenants/${tenantId}/ledger?${params}`);
      const data = await response.json();

      if (data.success && data.data) {
        setLedgerData(data.data);
      } else {
        toast.error(t("tenants.ledger.toasts.ledgerFailed", { defaultValue: "Could not load the ledger" }));
      }
    } catch (error) {
      console.error("Error fetching ledger:", error);
      toast.error(t("tenants.ledger.toasts.ledgerFailed", { defaultValue: "Could not load the ledger" }));
    } finally {
      setLoading(false);
    }
  };

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const getEntryTypeIcon = (type: string) => {
    return type === "debit" ? (
      <TrendingUp className="h-4 w-4 text-red-500" />
    ) : (
      <TrendingDown className="h-4 w-4 text-green-500" />
    );
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      paid: {
        variant: "default" as const,
        label: t("tenants.ledger.status.paid", { defaultValue: "Paid" }),
      },
      issued: {
        variant: "secondary" as const,
        label: t("tenants.ledger.status.issued", { defaultValue: "Due" }),
      },
      overdue: {
        variant: "destructive" as const,
        label: t("tenants.ledger.status.overdue", { defaultValue: "Overdue" }),
      },
      partial: {
        variant: "outline" as const,
        label: t("tenants.ledger.status.partial", { defaultValue: "Partially paid" }),
      },
      completed: {
        variant: "default" as const,
        label: t("tenants.ledger.status.completed", { defaultValue: "Received" }),
      },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || {
      variant: "outline" as const,
      label: status,
    };

    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (loading && !ledgerData) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin me-2" />
          {t("tenants.ledger.loadingLedger", { defaultValue: "Loading the ledger…" })}
        </CardContent>
      </Card>
    );
  }

  if (!ledgerData) {
    return (
      <Card className={className}>
        <CardContent className="py-8">
          <Alert>
            <AlertDescription>
              {t("tenants.ledger.empty", { defaultValue: "Nothing has been charged or paid on this tenant's account yet." })}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tenants.ledger.currentBalance", { defaultValue: "Balance" })}
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                ledgerData.summary.currentBalance > 0
                  ? "text-red-600"
                  : "text-green-600"
              }`}
            >
              {formatCurrency(Math.abs(ledgerData.summary.currentBalance))}
            </div>
            <p className="text-xs text-muted-foreground">
              {ledgerData.summary.currentBalance > 0
                ? t("tenants.ledger.owedLabel", { defaultValue: "Owed by the tenant" })
                : t("tenants.ledger.creditLabel", { defaultValue: "In credit" })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tenants.ledger.totalCharges", { defaultValue: "Charges" })}
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(ledgerData.summary.totalDebits)}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("tenants.ledger.periodTotal", { defaultValue: "In this period" })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tenants.ledger.totalPayments", { defaultValue: "Payments" })}
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(ledgerData.summary.totalCredits)}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("tenants.ledger.paymentCount", { defaultValue: "Payments: {count}", values: { count: ledgerData.summary.statusCounts.totalPayments } })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tenants.ledger.overdue", { defaultValue: "Overdue" })}
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {ledgerData.summary.statusCounts.overdueInvoices}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("tenants.ledger.overdueInstallments", { defaultValue: "Installments past due" })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("tenants.ledger.title", { defaultValue: "Tenant ledger" })}
          </CardTitle>
          <CardDescription>
            {[ledgerData.summary.tenantName, ledgerData.summary.propertyName]
              .filter(Boolean)
              .join(" · ")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex items-center gap-2">
              <Label htmlFor="startDate">
                {t("payments.reports.from", { defaultValue: "From" })}
              </Label>
              <Input
                id="startDate"
                type="date"
                value={filters.startDate}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, startDate: e.target.value }))
                }
                className="w-auto"
              />
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="endDate">
                {t("payments.reports.to", { defaultValue: "To" })}
              </Label>
              <Input
                id="endDate"
                type="date"
                value={filters.endDate}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, endDate: e.target.value }))
                }
                className="w-auto"
              />
            </div>

            {/* The shared export: Excel and PDF as well as CSV, in the reader's
                language — the same period and contract as on screen. */}
            {mayExport && (
              <div className="ms-auto">
                <ReportExportButton
                  endpoint={`/api/tenants/${tenantId}/ledger`}
                  params={
                    new URLSearchParams({
                      startDate: filters.startDate,
                      endDate: filters.endDate,
                      ...(leaseId ? { leaseId } : {}),
                    })
                  }
                  disabled={loading}
                />
              </div>
            )}
          </div>

          {/* Ledger Table */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tenants.ledger.columns.date", { defaultValue: "Date" })}</TableHead>
                  <TableHead>{t("tenants.ledger.columns.type", { defaultValue: "Type" })}</TableHead>
                  <TableHead>{t("tenants.ledger.columns.description", { defaultValue: "Description" })}</TableHead>
                  <TableHead>{t("tenants.ledger.columns.reference", { defaultValue: "Reference" })}</TableHead>
                  <TableHead className="text-end">
                    {t("tenants.ledger.totalCharges", { defaultValue: "Charges" })}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("tenants.ledger.totalPayments", { defaultValue: "Payments" })}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("tenants.ledger.currentBalance", { defaultValue: "Balance" })}
                  </TableHead>
                  <TableHead>{t("tenants.ledger.columns.status", { defaultValue: "Status" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledgerData.entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      {formatDate(entry.date)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getEntryTypeIcon(entry.type)}
                        <span>
                          {t(
                            `tenants.ledger.categories.${LEDGER_CATEGORY_CODES[entry.category] ?? entry.category}`,
                            {
                              defaultValue: codeLabel(
                                language,
                                LEDGER_CATEGORY_CODES[entry.category] ?? entry.category,
                                TRANSACTION_CATEGORY_TABLES,
                              ),
                            },
                          )}
                        </span>
                      </div>
                    </TableCell>
                    {/* Generated wordings ("Monthly Rent", "Payment - cash")
                        in the reader's language; typed ones as typed. */}
                    <TableCell>
                      {describeCharge(
                        {
                          description: entry.description,
                          periodStart: entry.periodStart,
                          periodEnd: entry.periodEnd,
                        },
                        language,
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="text-sm">{entry.reference}</code>
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.debitAmount > 0
                        ? formatCurrency(entry.debitAmount)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-end">
                      {entry.creditAmount > 0
                        ? formatCurrency(entry.creditAmount)
                        : "-"}
                    </TableCell>
                    <TableCell
                      className={`text-end font-medium ${
                        entry.runningBalance > 0
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {formatCurrency(Math.abs(entry.runningBalance))}
                    </TableCell>
                    <TableCell>{getStatusBadge(entry.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {ledgerData.pagination?.pages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                {t("tenants.ledger.showing", { defaultValue: "Entries {from}–{to} of {total}", values: { from: (ledgerData.pagination.page - 1) * ledgerData.pagination.limit + 1, to: Math.min(ledgerData.pagination.page * ledgerData.pagination.limit, ledgerData.pagination.total), total: ledgerData.pagination.total } })}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, page: prev.page - 1 }))
                  }
                  disabled={ledgerData.pagination.page <= 1}
                >
                  {t("tenants.ledger.previous", { defaultValue: "Previous" })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, page: prev.page + 1 }))
                  }
                  disabled={
                    ledgerData.pagination.page >= ledgerData.pagination.pages
                  }
                >
                  {t("tenants.ledger.next", { defaultValue: "Next" })}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
