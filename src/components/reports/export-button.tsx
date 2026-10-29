"use client";

/**
 * PropertyPro - Report export button
 *
 * One control shared by every report, so a new export format reaches all of
 * them at once. Excel is the primary action because that is what the office
 * works in; PDF is what gets sent on to an owner; CSV sits behind the caret
 * for anything that needs to be machine-read.
 *
 * The file is fetched rather than navigated to. Navigating handed the browser
 * whatever the endpoint answered, so a refusal — no export permission, a bad
 * filter — replaced the page with a screen of raw JSON. Fetching lets a
 * failure arrive as a message, and a success still saves under the name the
 * server gives it.
 *
 * The two halves are joined with logical sides (start/end), not left and
 * right: in Arabic the row runs right to left, so the Excel button sits on
 * the right and the caret on the left. Squared-off left/right corners put
 * the rounded ones in the middle of the pair and dropped its outer border.
 */

import { useState } from "react";
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  FileType2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export type ExportFormat = "xlsx" | "pdf" | "csv";

/** The name the server gave the file — RFC 6266's `filename*` first. */
function fileNameFrom(disposition: string | null, format: ExportFormat): string {
  if (disposition) {
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (encoded) {
      try {
        return decodeURIComponent(encoded[1]);
      } catch {
        // Fall through to the plain form.
      }
    }
    const plain = /filename="([^"]+)"/i.exec(disposition);
    if (plain) return plain[1];
  }
  return `report.${format}`;
}

interface ReportExportButtonProps {
  /** Endpoint path without the format param, e.g. `/api/payments/reports`. */
  endpoint: string;
  /** Everything else the report is filtered by. */
  params: URLSearchParams;
  disabled?: boolean;
}

export function ReportExportButton({
  endpoint,
  params,
  disabled,
}: ReportExportButtonProps) {
  const { t, isRTL, language } = useLocalizationContext();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const download = async (format: ExportFormat) => {
    const query = new URLSearchParams(params);
    query.set("format", format);
    // Headings and known values are written in the reader's language, in
    // every format — not only the PDF.
    query.set("lang", language);
    // The PDF is laid out for whoever asked for it: an Arabic reader gets the
    // table mirrored, and the server has no other way to know which of an
    // office's two languages this particular click came from.
    if (format === "pdf" && isRTL) query.set("rtl", "1");

    setBusy(format);
    try {
      const response = await fetch(`${endpoint}?${query.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        toast.error(
          payload?.error ??
            t("reports.export.failed", {
              defaultValue: "The file could not be created",
            }),
        );
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(
        response.headers.get("Content-Disposition"),
        format,
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error(
        t("reports.export.failed", {
          defaultValue: "The file could not be created",
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex">
      <Button
        size="sm"
        variant="outline"
        onClick={() => download("xlsx")}
        disabled={disabled || busy !== null}
        className="rounded-e-none border-e-0"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {t("reports.export.excel", { defaultValue: "Export to Excel" })}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            className="rounded-s-none px-2"
            aria-label={t("reports.export.more", {
              defaultValue: "Other formats",
            })}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => download("xlsx")}>
            <FileSpreadsheet className="me-2 h-4 w-4" />
            {t("reports.export.xlsx", { defaultValue: "Excel (.xlsx)" })}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => download("pdf")}>
            <FileType2 className="me-2 h-4 w-4" />
            {t("reports.export.pdf", { defaultValue: "PDF (.pdf)" })}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => download("csv")}>
            <FileText className="me-2 h-4 w-4" />
            {t("reports.export.csv", { defaultValue: "CSV (.csv)" })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
