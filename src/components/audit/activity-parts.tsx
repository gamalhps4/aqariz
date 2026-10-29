"use client";

/**
 * PropertyPro - Pieces both activity screens share
 *
 * The organization's activity page and the platform console's show the same
 * entries the same way: the time in Riyadh time with seconds, the employee by
 * name, email and role, the sentence in the reader's language, the record by
 * its name or number, and — in the detail panel — every value before and
 * after the change. One set of parts, so the two screens cannot drift.
 */

import { useCallback, useMemo } from "react";
import { ArrowRight, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { roleDisplayName } from "@/lib/role-display";
import {
  auditActionLabel,
  auditFieldLabel,
  auditModuleLabel,
  auditRecordName,
  auditTypeLabel,
  changedFields,
  formatAuditValue,
  renderActivityMessage,
} from "@/lib/audit/render";
import { formatAuditDateTime } from "@/lib/audit/time";
import type { ActivityActor, ActivityRow } from "@/lib/audit/types";

export type { ActivityRow, ActivityActor };

/** Labels and sentences in the reader's language, bound to the context. */
export function useActivityText() {
  const { t, language, formatDate } = useLocalizationContext();

  const message = useCallback(
    (row: Pick<ActivityRow, "action" | "messageKey" | "messageParams" | "description" | "resourceType">) =>
      renderActivityMessage(row, t),
    [t],
  );
  const role = useCallback(
    (actor: ActivityActor) =>
      actor.role
        ? roleDisplayName(actor.role, {
            group: actor.roleLabel
              ? { label: actor.roleLabel, labelAr: actor.roleLabelAr }
              : null,
            language,
            t,
          })
        : "",
    [language, t],
  );
  const value = useCallback(
    (field: string, raw: unknown, recordType: string | null) =>
      formatAuditValue(field, raw, {
        t,
        recordType,
        formatDate: (iso) => formatDate(iso, { format: "medium" }),
      }),
    [formatDate, t],
  );

  return useMemo(
    () => ({
      t,
      language,
      message,
      role,
      value,
      module: (category: string) => auditModuleLabel(category, t),
      action: (action: string) => auditActionLabel(action, t),
      type: (recordType: string | null) => auditTypeLabel(recordType, t),
      field: (field: string) => auditFieldLabel(field, t),
    }),
    [language, message, role, t, value],
  );
}

/** "03/10/2026 15:42:07" — Riyadh time, with seconds. */
export function ActivityTime({ value }: { value: string }) {
  return (
    <span dir="ltr" className="whitespace-nowrap text-sm tabular-nums">
      {formatAuditDateTime(value)}
    </span>
  );
}

/** Who acted: name, then email and role; and the support operator, if any. */
export function ActivityEmployee({ row }: { row: ActivityRow }) {
  const text = useActivityText();
  const systemActor = row.actor.id === "system" || (!row.actor.id && !row.actor.email);
  const name =
    row.actor.name ||
    (systemActor
      ? text.t("admin.audit.system", { defaultValue: "System" })
      : row.actor.email ?? "—");
  const role = text.role(row.actor);
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{name}</p>
      {row.actor.email && row.actor.email !== name && (
        <p className="truncate text-xs text-muted-foreground">
          <span dir="ltr">{row.actor.email}</span>
        </p>
      )}
      {role && <p className="truncate text-xs text-muted-foreground">{role}</p>}
      {row.impersonator && (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <Eye className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {text.t("admin.audit.viewedBy", {
              defaultValue: "Support: {email}",
              values: { email: row.impersonator.email || row.impersonator.id },
            })}
          </span>
        </p>
      )}
    </div>
  );
}

/** The record: its type, and the name or number a reader knows it by. */
export function ActivityRecord({ row }: { row: ActivityRow }) {
  const text = useActivityText();
  const type = text.type(row.resourceType);
  const name =
    auditRecordName(row, text.t) ||
    (row.resourceId && row.resourceId.length <= 12 ? row.resourceId : null);
  if (!type && !name) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-0">
      {type && (
        <Badge variant="outline" className="mb-0.5 font-normal">
          {type}
        </Badge>
      )}
      {name && <p className="truncate text-sm">{name}</p>}
      {row.contractNumber && row.contractNumber !== name && (
        <p className="truncate text-xs text-muted-foreground">
          {text.t("admin.audit.contractNo", {
            defaultValue: "Contract {number}",
            values: { number: row.contractNumber },
          })}
        </p>
      )}
    </div>
  );
}

/** The from–to day range, with the "to" in the reader's language. */
export function ActivityDateRange({
  startDate,
  endDate,
  onChange,
}: {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
}) {
  const { t } = useLocalizationContext();
  const inputClass =
    "h-10 w-[150px] border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800";
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        aria-label={t("admin.audit.filters.from", { defaultValue: "From date" })}
        className={inputClass}
        value={startDate}
        max={endDate || undefined}
        onChange={(event) => onChange({ startDate: event.target.value, endDate })}
      />
      <span className="text-sm text-muted-foreground">
        {t("admin.audit.filters.to", { defaultValue: "to" })}
      </span>
      <Input
        type="date"
        aria-label={t("admin.audit.filters.toDate", { defaultValue: "To date" })}
        className={inputClass}
        value={endDate}
        min={startDate || undefined}
        onChange={(event) => onChange({ startDate, endDate: event.target.value })}
      />
    </div>
  );
}

/** Keys the writer keeps for itself; the panel shows them elsewhere or not at all. */
const INTERNAL_DETAILS = new Set([
  "impersonator",
  "actorRoleIsGroup",
  "actorRoleLabel",
  "actorRoleLabelAr",
]);

function detailText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Before → after, field by field, or per record for a bulk change. */
function ChangeTable({ row }: { row: ActivityRow }) {
  const text = useActivityText();
  const bulkRows = Array.isArray((row.before as { rows?: unknown } | null)?.rows)
    ? ((row.before as { rows: Array<Record<string, unknown>> }).rows)
    : null;

  if (bulkRows) {
    const keys = Object.keys(row.after ?? {});
    return (
      <div className="space-y-2">
        {bulkRows.slice(0, 20).map((entry, index) => (
          <div key={String(entry.id ?? index)} className="rounded-md border p-2 text-xs">
            <p className="mb-1 font-mono text-muted-foreground">
              <span dir="ltr">{String(entry.id ?? index)}</span>
            </p>
            {keys.map((key) => (
              <p key={key}>
                {text.field(key)}:{" "}
                <span className="line-through opacity-60">
                  {text.value(key, entry[key], row.resourceType)}
                </span>{" "}
                <ArrowRight className="inline h-3 w-3 rtl:rotate-180" />{" "}
                <span className="font-medium">
                  {text.value(key, row.after?.[key], row.resourceType)}
                </span>
              </p>
            ))}
          </div>
        ))}
      </div>
    );
  }

  const fields = changedFields(row.before, row.after);
  if (fields.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="p-2 text-start font-medium">
              {text.t("admin.audit.detail.field", { defaultValue: "Field" })}
            </th>
            <th className="p-2 text-start font-medium">
              {text.t("admin.audit.detail.before", { defaultValue: "Before" })}
            </th>
            <th className="p-2 text-start font-medium">
              {text.t("admin.audit.detail.after", { defaultValue: "After" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field} className="border-t align-top">
              <td className="p-2 font-medium text-muted-foreground">{text.field(field)}</td>
              <td className="p-2 break-words">
                {row.before ? text.value(field, row.before[field], row.resourceType) : "—"}
              </td>
              <td className="p-2 break-words font-medium">
                {row.after ? text.value(field, row.after[field], row.resourceType) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

/** Everything one entry holds, with the before and after. */
export function ActivityDetailSheet({
  row,
  onClose,
  showOrganization = false,
}: {
  row: ActivityRow | null;
  onClose: () => void;
  showOrganization?: boolean;
}) {
  const text = useActivityText();
  const details = Object.entries(row?.details ?? {}).filter(
    ([key, value]) => !INTERNAL_DETAILS.has(key) && value !== null && value !== undefined && value !== "",
  );
  const hasChanges =
    row !== null && (Boolean(row.before) || Boolean(row.after));

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="pe-6">{text.message(row)}</SheetTitle>
              <SheetDescription>
                <ActivityTime value={row.timestamp} />{" "}
                <span className="text-xs">
                  {text.t("admin.audit.riyadhTime", { defaultValue: "(Riyadh time)" })}
                </span>
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <div className="divide-y">
                {showOrganization && (
                  <DetailLine label={text.t("admin.audit.detail.organization", { defaultValue: "Organization" })}>
                    {row.organizationName ?? row.organizationId ?? "—"}
                  </DetailLine>
                )}
                <DetailLine label={text.t("admin.audit.detail.employee", { defaultValue: "Employee" })}>
                  <ActivityEmployee row={row} />
                </DetailLine>
                {row.source === "organization" && (
                  <DetailLine label={text.t("admin.audit.detail.module", { defaultValue: "Module" })}>
                    {text.module(row.category)}
                  </DetailLine>
                )}
                <DetailLine label={text.t("admin.audit.detail.action", { defaultValue: "Action" })}>
                  {row.source === "organization" ? text.action(row.action) : row.action}
                </DetailLine>
                <DetailLine label={text.t("admin.audit.detail.record", { defaultValue: "Record" })}>
                  <ActivityRecord row={row} />
                  {row.resourceId && (
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      <span dir="ltr">{row.resourceId}</span>
                    </p>
                  )}
                </DetailLine>
                <DetailLine label={text.t("admin.audit.detail.ip", { defaultValue: "IP address" })}>
                  <span dir="ltr">{row.ipAddress || "—"}</span>
                </DetailLine>
                {row.userAgent && (
                  <DetailLine label={text.t("admin.audit.detail.device", { defaultValue: "Device" })}>
                    <span dir="ltr" className="text-xs text-muted-foreground">
                      {row.userAgent}
                    </span>
                  </DetailLine>
                )}
                {row.source === "organization" && (
                  <DetailLine label={text.t("admin.audit.filters.severity", { defaultValue: "Importance" })}>
                    {text.t(`admin.audit.severity.${row.severity}`, { defaultValue: row.severity })}
                  </DetailLine>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {text.t("admin.audit.detail.changes", { defaultValue: "What changed" })}
                </h3>
                {hasChanges ? (
                  <ChangeTable row={row} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {text.t("admin.audit.detail.noChanges", {
                      defaultValue: "No values were recorded for this entry.",
                    })}
                  </p>
                )}
              </div>

              {details.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    {text.t("admin.audit.detail.more", { defaultValue: "More detail" })}
                  </h3>
                  <div className="divide-y rounded-md border px-3">
                    {details.map(([key, value]) => (
                      <DetailLine key={key} label={text.field(key)}>
                        <span dir="auto" className="text-xs">
                          {key === "secretsChanged" && Array.isArray(value)
                            ? value
                                .map((field) => text.field(String(field)))
                                .join(text.language === "ar" ? "، " : ", ")
                            : detailText(value)}
                        </span>
                      </DetailLine>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
