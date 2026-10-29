"use client";

/**
 * PropertyPro - Narrowing the payments list to one contract, building or unit
 *
 * The quick filters on the payments page (search, status, type, method) apply
 * as you change them, which suits a single toggle. These do not: an operator
 * picking a compound, then a building, then a date range wants one answer at
 * the end, not three round trips on the way. So this panel is explicit —
 * Apply and Reset — and lives behind a disclosure so the two behaviours are
 * never sitting side by side pretending to be the same thing.
 *
 * `Contract` is the one the review asked for by name: with a contract chosen,
 * the page shows that contract's money and nothing else.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, Loader2, RotateCcw, X } from "lucide-react";

import {
  isolateLtr,
  RemoteOptionSelect,
  searchFilterOptions,
  type RemoteOption,
} from "@/components/payments/RemoteOptionSelect";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export interface PaymentRecordFilterValue {
  leaseId: string;
  propertyId: string;
  unitId: string;
  compoundId: string;
  ownerId: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  /** Which column the date range means. */
  dateField: "dueDate" | "paidDate" | "createdAt";
}

export const EMPTY_RECORD_FILTERS: PaymentRecordFilterValue = {
  leaseId: "",
  propertyId: "",
  unitId: "",
  compoundId: "",
  ownerId: "",
  tenantId: "",
  startDate: "",
  endDate: "",
  // An office thinks about when rent was *owed*, not when the row was
  // written, so the panel opens on the due date.
  dateField: "dueDate",
};

interface Option {
  id: string;
  label: string;
  hint?: string;
  /** Contracts only: what the hint is built from, in the reader's language. */
  propertyName?: string;
  status?: string;
  startDate?: string;
}

interface OptionSets {
  leases: Option[];
  properties: Option[];
  units: Option[];
  compounds: Option[];
  owners: Option[];
  tenants: Option[];
}

/** Searched on the server as the operator types, not listed up front. */
type SearchedSet = "leases" | "units" | "tenants";

interface SearchedOption extends Option {
  /** Contracts: the tenant's mobile. Tenants carry it in `hint`. */
  tenantPhone?: string;
}

const ANY = "__any__";

export function countActiveRecordFilters(value: PaymentRecordFilterValue) {
  return (
    Number(Boolean(value.leaseId)) +
    Number(Boolean(value.propertyId)) +
    Number(Boolean(value.unitId)) +
    Number(Boolean(value.compoundId)) +
    Number(Boolean(value.ownerId)) +
    Number(Boolean(value.tenantId)) +
    Number(Boolean(value.startDate || value.endDate))
  );
}

export function PaymentRecordFilters({
  value,
  onApply,
}: {
  value: PaymentRecordFilterValue;
  /**
   * `describe` is a short human sentence for what was applied — "Contract:
   * سارة الحربي #A101". The page prints it above the totals so the money on
   * screen is visibly about something, rather than a set of numbers whose
   * scope the reader has to remember.
   */
  onApply: (next: PaymentRecordFilterValue, describe: string) => void;
}) {
  const { t, formatDate } = useLocalizationContext();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<OptionSets | null>(null);
  const [draft, setDraft] = useState<PaymentRecordFilterValue>(value);
  // What the searched pickers chose, by id — their lists change with every
  // search, so the names are kept here for the sentence on Apply.
  const [picked, setPicked] = useState<Record<string, string>>({});

  // Derived, not stored: the panel is loading exactly while it is open and
  // has no options yet. A `loading` state would have to be set synchronously
  // as the effect starts, which is the cascading-render trap.
  const loading = open && options === null;

  // The panel edits a draft and only hands it over on Apply, so an abandoned
  // half-built filter never reaches the list. The draft is seeded when the
  // panel opens rather than from an effect watching `value`.
  const toggle = () =>
    setOpen((previous) => {
      if (!previous) setDraft(value);
      return !previous;
    });

  useEffect(() => {
    if (!open || options) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/payments/filter-options");
      const result = await response.json().catch(() => null);
      if (cancelled) return;
      setOptions(
        response.ok && result?.success
          ? (result.data as OptionSets)
          : {
              leases: [],
              properties: [],
              units: [],
              compounds: [],
              owners: [],
              tenants: [],
            },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, options]);

  const activeCount = useMemo(
    () => countActiveRecordFilters(value),
    [value],
  );

  /** Name what the draft narrows to, using the labels the operator just saw. */
  const describe = (next: PaymentRecordFilterValue) => {
    if (!options) return "";
    const named = (
      key: keyof OptionSets,
      id: string,
      label: string,
    ): string | null => {
      if (!id) return null;
      const name =
        picked[`${key}:${id}`] ??
        options[key].find((option) => option.id === id)?.label;
      return name ? `${label}: ${name}` : null;
    };
    const parts = [
      named("leases", next.leaseId,
        t("payments.filters.contract", { defaultValue: "Contract" })),
      named("tenants", next.tenantId,
        t("payments.filters.tenant", { defaultValue: "Tenant" })),
      named("owners", next.ownerId,
        t("payments.filters.owner", { defaultValue: "Owner" })),
      named("compounds", next.compoundId,
        t("payments.filters.compound", { defaultValue: "Compound" })),
      named("properties", next.propertyId,
        t("payments.filters.property", { defaultValue: "Building" })),
      named("units", next.unitId,
        t("payments.filters.unit", { defaultValue: "Unit" })),
      next.startDate || next.endDate
        ? [next.startDate || "…", next.endDate || "…"].join(" → ")
        : null,
    ].filter(Boolean);
    return parts.join(" · ");
  };

  const set = <K extends keyof PaymentRecordFilterValue>(
    key: K,
    next: PaymentRecordFilterValue[K],
  ) => setDraft((previous) => ({ ...previous, [key]: next }));

  /** A contract's place and dates, in the reader's language. */
  const contractHint = useCallback(
    (option: Option) =>
      [
        option.propertyName,
        option.startDate ? formatDate(option.startDate) : null,
        option.status
          ? t(`leases.status.${option.status}`, { defaultValue: option.status })
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [t, formatDate],
  );

  const loadLeases = useCallback(
    async (search: string, chosen: string[]): Promise<RemoteOption[]> =>
      (await searchFilterOptions<SearchedOption>("leases", search, chosen)).map(
        (option) => ({
          value: option.id,
          label: option.label,
          subtitle: [isolateLtr(option.tenantPhone), contractHint(option)]
            .filter(Boolean)
            .join(" · "),
        }),
      ),
    [contractHint],
  );
  const loadUnits = useCallback(
    async (search: string, chosen: string[]): Promise<RemoteOption[]> =>
      (await searchFilterOptions<SearchedOption>("units", search, chosen)).map(
        (option) => ({ value: option.id, label: option.label, subtitle: option.hint }),
      ),
    [],
  );
  const loadTenants = useCallback(
    async (search: string, chosen: string[]): Promise<RemoteOption[]> =>
      (await searchFilterOptions<SearchedOption>("tenants", search, chosen)).map(
        (option) => ({
          value: option.id,
          label: option.label,
          subtitle: isolateLtr(option.hint),
        }),
      ),
    [],
  );
  const loaders: Record<SearchedSet, typeof loadLeases> = {
    leases: loadLeases,
    units: loadUnits,
    tenants: loadTenants,
  };

  /** A picker that searches every contract in scope, not the first 300. */
  const searchedPicker = (
    key: SearchedSet,
    field: keyof PaymentRecordFilterValue,
    label: string,
  ) => {
    const anyLabel = t("common.all", { defaultValue: "Any" });
    return (
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
        <RemoteOptionSelect
          value={(draft[field] as string) || ANY}
          onValueChange={(next, option) => {
            if (option && next !== ANY) {
              setPicked((previous) => ({
                ...previous,
                [`${key}:${next}`]: option.label,
              }));
            }
            set(field, (next === ANY ? "" : next) as never);
          }}
          load={loaders[key]}
          leading={[{ value: ANY, label: anyLabel }]}
          placeholder={anyLabel}
          searchPlaceholder={t("payments.filters.searchOptions", {
            defaultValue: "Name, mobile, unit or contract number",
          })}
          emptyMessage={t("payments.filters.noOptions", {
            defaultValue: "Nothing matches",
          })}
          loadingMessage={t("common.loading", { defaultValue: "Loading…" })}
          triggerClassName="h-10"
        />
      </div>
    );
  };

  const picker = (
    key: keyof OptionSets,
    field: keyof PaymentRecordFilterValue,
    label: string,
  ) => {
    const list = options?.[key] ?? [];
    return (
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
        <Select
          value={(draft[field] as string) || ANY}
          onValueChange={(next) =>
            set(field, (next === ANY ? "" : next) as never)
          }
          disabled={loading || list.length === 0}
        >
          <SelectTrigger className="h-10">
            <SelectValue placeholder={t("common.all", { defaultValue: "Any" })} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>
              {t("common.all", { defaultValue: "Any" })}
            </SelectItem>
            {list.map((option) => {
              // A contract's status and start date read in the reader's
              // language; the server's own hint prints them raw.
              const hint = option.status
                ? [
                    option.propertyName,
                    option.startDate ? formatDate(option.startDate) : null,
                    t(`leases.status.${option.status}`, {
                      defaultValue: option.status,
                    }),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : option.hint;
              return (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                  {hint ? (
                    <span className="ms-2 text-xs text-muted-foreground">
                      {hint}
                    </span>
                  ) : null}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-10"
          onClick={toggle}
        >
          <Filter className="me-2 h-4 w-4" />
          {t("payments.filters.more", { defaultValue: "More filters" })}
          {activeCount > 0 && (
            <Badge variant="secondary" className="ms-2">
              {activeCount}
            </Badge>
          )}
        </Button>

        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10"
            onClick={() => onApply(EMPTY_RECORD_FILTERS, "")}
          >
            <X className="me-2 h-4 w-4" />
            {t("payments.filters.resetRecord", {
              defaultValue: "Reset filters",
            })}
          </Button>
        )}
      </div>

      {open && (
        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading", { defaultValue: "Loading…" })}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {searchedPicker("leases", "leaseId",
              t("payments.filters.contract", { defaultValue: "Contract" }))}
            {searchedPicker("tenants", "tenantId",
              t("payments.filters.tenant", { defaultValue: "Tenant" }))}
            {picker("owners", "ownerId",
              t("payments.filters.owner", { defaultValue: "Owner" }))}
            {picker("compounds", "compoundId",
              t("payments.filters.compound", { defaultValue: "Compound" }))}
            {picker("properties", "propertyId",
              t("payments.filters.property", { defaultValue: "Building" }))}
            {searchedPicker("units", "unitId",
              t("payments.filters.unit", { defaultValue: "Unit" }))}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {t("payments.filters.dateField", { defaultValue: "Date means" })}
              </Label>
              <Select
                value={draft.dateField}
                onValueChange={(next) =>
                  set("dateField", next as PaymentRecordFilterValue["dateField"])
                }
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dueDate">
                    {t("payments.filters.dueDate", { defaultValue: "Due date" })}
                  </SelectItem>
                  <SelectItem value="paidDate">
                    {t("payments.filters.paidDate", { defaultValue: "Paid date" })}
                  </SelectItem>
                  <SelectItem value="createdAt">
                    {t("payments.filters.recordedDate", {
                      defaultValue: "Recorded date",
                    })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {t("payments.filters.from", { defaultValue: "From" })}
              </Label>
              <Input
                type="date"
                className="h-10"
                value={draft.startDate}
                onChange={(event) => set("startDate", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {t("payments.filters.to", { defaultValue: "To" })}
              </Label>
              <Input
                type="date"
                className="h-10"
                value={draft.endDate}
                onChange={(event) => set("endDate", event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(EMPTY_RECORD_FILTERS)}
            >
              <RotateCcw className="me-2 h-4 w-4" />
              {t("payments.filters.resetRecord", {
                defaultValue: "Reset filters",
              })}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onApply(draft, describe(draft));
                setOpen(false);
              }}
            >
              {t("payments.filters.apply", { defaultValue: "Apply filters" })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
