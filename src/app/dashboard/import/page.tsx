"use client";

/**
 * Bulk import.
 *
 * The flow is deliberately two-step: pick a file, see exactly what would
 * happen, then commit. Nothing writes until the person has read the preview,
 * because the alternative — discovering the file was wrong after 400 rows
 * landed — is what makes people stop trusting an importer.
 *
 * A file may be CSV or Excel (.xlsx); the server reads either the same way.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type Resource = "properties" | "units" | "tenants" | "leases" | "payments";

interface RowIssue {
  row: number;
  message: string;
  /** Said as `import.issue.<code>` when the server sent one. */
  code?: string;
  values?: Record<string, string | number>;
}

interface ImportResult {
  resource: Resource;
  dryRun: boolean;
  totalRows: number;
  valid: number;
  imported: number;
  skipped: number;
  errors: RowIssue[];
  warnings: RowIssue[];
}

const RESOURCES: Array<{
  key: Resource;
  label: string;
  hint: string;
  columns: string;
}> = [
  {
    key: "properties",
    label: "Properties",
    hint: "Import these first — units are linked to them by name.",
    columns: "name, type, street, city, state, zipCode, country, status",
  },
  {
    key: "units",
    label: "Units",
    hint: "Each row is matched to an existing property by its name.",
    columns:
      "propertyName, unitNumber, bedrooms, bathrooms, rentAmount, securityDeposit",
  },
  {
    key: "tenants",
    label: "Tenants",
    hint: "Creates tenant records only — nobody is emailed until you invite them. The email may be left empty, and the name is one column.",
    columns: "fullName, phone, email, moveInDate",
  },
  {
    key: "leases",
    label: "Lease contracts",
    hint: "Each row is created as the contract form creates it: its installments are billed and the unit is marked occupied. Add the tenants and units first — a tenant is found by national ID / iqama, email or phone, a unit by its building's name and its number. Give the contract total or the rent per installment; dates as YYYY-MM-DD or DD/MM/YYYY.",
    columns:
      "contractNumber, tenantIdNumber | tenantEmail | tenantPhone, buildingName, unitNumber, startDate, endDate, paymentFrequency, contractAmount | rentAmount, securityDeposit, status",
  },
  {
    key: "payments",
    label: "Payments",
    hint: "Records money already received against a contract's installments, as the Record payment dialog does — receipts, balances and the books are updated. Name the contract by its number (or the tenant with the building and unit) and the installment by its invoice number or due date. Method: cash, pos, bank_transfer, owner_cash, owner_account or ejari. Tenants are not sent receipt messages.",
    columns:
      "contractNumber | (tenantIdNumber, buildingName, unitNumber), invoiceNumber | dueDate, amount, paidDate, paymentMethod, reference",
  },
];

/** What the file picker offers: CSV, and Excel's own format. */
const ACCEPTED_FILES = [
  ".csv",
  "text/csv",
  ".xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

function IssueList({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: RowIssue[];
  tone: "error" | "warning";
}) {
  const { t } = useLocalizationContext();
  if (issues.length === 0) return null;
  const shown = issues.slice(0, 25);
  return (
    <div className="mt-4">
      <p
        className={`text-sm font-medium ${
          tone === "error" ? "text-destructive" : "text-amber-600"
        }`}
      >
        {title} ({issues.length})
      </p>
      <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
        {shown.map((issue) => (
          <li key={`${issue.row}-${issue.message}`}>
            <span className="font-medium text-foreground">
              {t("import.row", { defaultValue: "Row {row}", values: { row: issue.row } })}
            </span>{" "}
            —{" "}
            {issue.code
              ? t(`import.issue.${issue.code}`, {
                  defaultValue: issue.message,
                  values: issue.values,
                })
              : issue.message}
          </li>
        ))}
      </ul>
      {issues.length > shown.length && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("import.more", { defaultValue: "…and {count} more. Fix these and check again.", values: { count: issues.length - shown.length } })}
        </p>
      )}
    </div>
  );
}

export default function ImportPage() {
  const { t } = useLocalizationContext();
  const [resource, setResource] = useState<Resource>("properties");
  const resourceLabel = (key: Resource, english: string) =>
    t(`import.resource.${key}.label`, { defaultValue: english });
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Contracts and payments need the rights their own screens need; the
  // server says which this person has. Until it answers — or if it cannot —
  // every type is offered, and the import itself refuses what is not theirs.
  const [allowed, setAllowed] = useState<Resource[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/import")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const keys = (payload?.data?.resources as Array<{ key: Resource }> | undefined)
          ?.map((entry) => entry.key);
        if (!cancelled && keys && keys.length > 0) setAllowed(keys);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const offered = RESOURCES.filter(
    (entry) => !allowed || allowed.includes(entry.key),
  );
  const active = RESOURCES.find((entry) => entry.key === resource)!;

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("resource", resource);
      formData.set("dryRun", String(dryRun));

      const response = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || t("import.failed", { defaultValue: "The import failed" }));

      const data = payload.data as ImportResult;
      setResult(data);
      toast.success(
        data.dryRun
          ? t("import.checkedToast", { defaultValue: "Checked: {valid} of {total} rows are ready", values: { valid: data.valid, total: data.totalRows } })
          : t("import.importedToast", { defaultValue: "Imported {count} of {total} rows", values: { count: data.imported, total: data.totalRows } }),
      );
      // A completed import invalidates the preview it came from.
      if (!dryRun) setFile(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("import.failed", { defaultValue: "The import failed" }));
    } finally {
      setBusy(false);
    }
  }

  const readyToCommit =
    result?.dryRun === true && result.valid > 0 && Boolean(file);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {t("import.title", { defaultValue: "Import data" })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("import.subtitle", { defaultValue: "Bring buildings, units, tenants, lease contracts and payments in from a spreadsheet. Every file is checked before anything is saved." })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("import.step1", { defaultValue: "1. Choose what to import" })}
          </CardTitle>
          <CardDescription>
            {t(`import.resource.${active.key}.hint`, { defaultValue: active.hint })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="import-resource">
              {t("import.recordType", { defaultValue: "Record type" })}
            </Label>
            <Select
              value={resource}
              onValueChange={(value) => {
                setResource(value as Resource);
                setResult(null);
              }}
            >
              <SelectTrigger id="import-resource">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {offered.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {resourceLabel(entry.key, entry.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>{t("import.starter", { defaultValue: "Starter file" })}</Label>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href={`/api/import?resource=${resource}&template=1`} download>
                  <Download className="me-2 size-4" />
                  {t("import.download", { defaultValue: "Download the {name} template (CSV)", values: { name: resourceLabel(active.key, active.label) } })}
                </a>
              </Button>
              <Button asChild variant="outline">
                <a
                  href={`/api/import?resource=${resource}&template=1&format=xlsx`}
                  download
                >
                  <FileSpreadsheet className="me-2 size-4" />
                  {t("import.downloadXlsx", { defaultValue: "Download the {name} template (Excel)", values: { name: resourceLabel(active.key, active.label) } })}
                </a>
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground sm:col-span-2">
            <span className="font-medium text-foreground">
              {t("import.columns", { defaultValue: "Columns:" })}
            </span>{" "}
            <span dir="ltr">{active.columns}</span>.{" "}
            {t("import.columnsHint", { defaultValue: "Capital letters and spacing in the headings do not matter, and extra columns are ignored." })}{" "}
            {t("import.formats", { defaultValue: "CSV and Excel (.xlsx) files are both accepted; from Excel, only the first sheet is read." })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("import.step2", { defaultValue: "2. Check your file" })}
          </CardTitle>
          <CardDescription>
            {t("import.step2Hint", { defaultValue: "The whole file is read and every problem listed — nothing is saved yet." })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="import-file">{t("import.file", { defaultValue: "CSV or Excel file" })}</Label>
            <Input
              id="import-file"
              type="file"
              accept={ACCEPTED_FILES}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setResult(null);
              }}
            />
          </div>
          <div>
            <Button onClick={() => send(true)} disabled={!file || busy}>
              <FileSpreadsheet className="me-2 size-4" />
              {busy
                ? t("import.checking", { defaultValue: "Checking…" })
                : t("import.check", { defaultValue: "Check file" })}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card
          className={
            result.errors.length > 0 ? "border-amber-300" : "border-emerald-300"
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {result.errors.length > 0 ? (
                <AlertTriangle className="size-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-600" />
              )}
              {result.dryRun
                ? t("import.results", { defaultValue: "Check results" })
                : t("import.done", { defaultValue: "Import complete" })}
            </CardTitle>
            <CardDescription>
              {result.dryRun
                ? t("import.readySummary", { defaultValue: "{valid} of {total} rows are ready. Rows with errors are skipped, not blocked.", values: { valid: result.valid, total: result.totalRows } })
                : t("import.importedSummary", { defaultValue: "{count} of {total} rows imported.", values: { count: result.imported, total: result.totalRows } })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {t("import.rowsRead", { defaultValue: "{count} rows read", values: { count: result.totalRows } })}
              </Badge>
              <Badge variant={result.valid > 0 ? "default" : "secondary"}>
                {result.dryRun
                  ? t("import.readyCount", { defaultValue: "{count} ready", values: { count: result.valid } })
                  : t("import.importedCount", { defaultValue: "{count} imported", values: { count: result.imported } })}
              </Badge>
              {result.skipped > 0 && (
                <Badge variant="secondary">
                  {t("import.skippedCount", { defaultValue: "{count} skipped", values: { count: result.skipped } })}
                </Badge>
              )}
            </div>

            <IssueList
              title={t("import.errors", { defaultValue: "Errors" })}
              issues={result.errors}
              tone="error"
            />
            <IssueList
              title={t("import.warnings", { defaultValue: "Warnings" })}
              issues={result.warnings}
              tone="warning"
            />

            {readyToCommit && (
              <div className="mt-6 border-t pt-4">
                <Button onClick={() => send(false)} disabled={busy}>
                  <Upload className="me-2 size-4" />
                  {busy
                    ? t("import.importing", { defaultValue: "Importing…" })
                    : t("import.commit", { defaultValue: "Import {count} rows", values: { count: result.valid } })}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("import.skipNote", { defaultValue: "Rows listed above as errors will be skipped." })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
