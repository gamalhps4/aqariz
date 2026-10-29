"use client";

/**
 * PropertyPro - The filter bar every report shares
 *
 * Owner, compound, building, unit, tenant, contract, agreement, status and
 * period, as the review asks of every report — each page showing the ones
 * that mean something for what it reports — with Apply and Reset beside them.
 *
 * The controls only edit a draft (see useReportFilters): nothing runs until
 * Apply, and Reset returns every control, the period included, to where the
 * page opened. Pressing Enter in a date box applies, as a form does.
 *
 * The pickers are narrowed by the ones above them — a compound leaves only its
 * buildings, a building only its units — over lists the server scoped to what
 * the reader may open, so a picker never offers a record they could not.
 * Choosing one that no longer fits what is chosen above clears it rather than
 * leaving it quietly filtering the report to nothing.
 */

import { Fragment, useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  pruneSelection,
  visibleAgreements,
  visibleBuildings,
  visibleCompounds,
  visibleContracts,
  visibleOwners,
  visibleTenants,
  visibleUnits,
  type Selection,
} from "@/lib/report-filters/dependent";
import type { FilterOptions } from "@/lib/report-filters/options";
import type { FilterIdKey } from "@/lib/report-filters/params";
import {
  PERIOD_PRESETS,
  isPeriodPreset,
  isReversedPeriod,
  presetOfRange,
  presetRange,
} from "@/lib/report-filters/period";
import type { FilterValues } from "./use-report-filters";

const ALL = "__all__";

/** The record pickers, with the value each one sets and the words it uses. */
const ENTITIES = {
  owner: {
    key: "ownerId",
    labelKey: "reports.filters.owner",
    label: "Owner",
    allKey: "reports.filters.allOwners",
    all: "All owners",
  },
  compound: {
    key: "compoundId",
    labelKey: "reports.filters.compound",
    label: "Compound",
    allKey: "reports.filters.allCompounds",
    all: "All compounds",
  },
  building: {
    key: "propertyId",
    labelKey: "reports.filters.building",
    label: "Building",
    allKey: "reports.filters.allBuildings",
    all: "All buildings",
  },
  unit: {
    key: "unitId",
    labelKey: "reports.filters.unit",
    label: "Unit",
    allKey: "reports.filters.allUnits",
    all: "All units",
  },
  tenant: {
    key: "tenantId",
    labelKey: "reports.filters.tenant",
    label: "Tenant",
    allKey: "reports.filters.allTenants",
    all: "All tenants",
  },
  contract: {
    key: "leaseId",
    labelKey: "reports.filters.contract",
    label: "Contract",
    allKey: "reports.filters.allContracts",
    all: "All contracts",
  },
  agreement: {
    key: "agreementId",
    labelKey: "reports.filters.agreement",
    label: "Agreement",
    allKey: "reports.filters.allAgreements",
    all: "All agreements",
  },
} as const satisfies Record<
  string,
  {
    key: FilterIdKey;
    labelKey: string;
    label: string;
    allKey: string;
    all: string;
  }
>;

export type FilterEntity = keyof typeof ENTITIES;

const ENTITY_KEYS: readonly FilterIdKey[] = Object.values(ENTITIES).map(
  (entity) => entity.key,
);

export type ReportFilterField =
  | {
      kind: "period";
      /** Which filter values hold the two ends. */
      startKey: string;
      endKey: string;
      /** Offer the ready-made ranges ("this quarter") beside the dates. */
      presets?: boolean;
      /** Already translated; the defaults are "From" and "To". */
      startLabel?: string;
      endLabel?: string;
    }
  | { kind: "entity"; entity: FilterEntity }
  | {
      kind: "status";
      key: string;
      /** Already translated. */
      label?: string;
      allLabel?: string;
      options: ReadonlyArray<{ value: string; label: string }>;
    }
  | { kind: "toggle"; key: string; label: string };

export interface ReportFilterBarProps {
  /** What the controls show — the draft. */
  values: FilterValues;
  /** Change the draft. */
  onChange: (patch: Partial<FilterValues>) => void;
  onApply: () => void;
  onReset: () => void;
  /** The controls show something the report has not been run with. */
  pending: boolean;
  /** There is something for Reset to undo. */
  canReset: boolean;
  fields: readonly ReportFilterField[];
  /** What the pickers choose among; absent until it arrives. */
  options?: FilterOptions;
  optionsLoading?: boolean;
  optionsFailed?: boolean;
  /** Controls ahead of the filters — the report selector. */
  leading?: ReactNode;
}

export function ReportFilterBar({
  values,
  onChange,
  onApply,
  onReset,
  pending,
  canReset,
  fields,
  options,
  optionsLoading = false,
  optionsFailed = false,
  leading,
}: ReportFilterBarProps) {
  const { t } = useLocalizationContext();
  const uid = useId();

  const selection: Selection = {};
  for (const key of ENTITY_KEYS) {
    if (values[key]) selection[key] = values[key];
  }

  const period = fields.find(
    (field): field is Extract<ReportFilterField, { kind: "period" }> =>
      field.kind === "period",
  );
  const reversed = period
    ? isReversedPeriod(values[period.startKey] ?? "", values[period.endKey] ?? "")
    : false;

  /**
   * Choose a record — or "all" — and clear what the choice leaves behind: a
   * building that is not in the new compound, a contract that is not the new
   * tenant's.
   */
  const choose = (entity: FilterEntity, value: string) => {
    const key = ENTITIES[entity].key;
    const wanted: Selection = { ...selection, [key]: value || undefined };
    const next = options ? pruneSelection(options, wanted, key) : wanted;
    const patch: Record<string, string> = {};
    for (const entityKey of ENTITY_KEYS) {
      const after = next[entityKey] ?? "";
      if (after !== (values[entityKey] ?? "")) patch[entityKey] = after;
    }
    onChange(patch);
  };

  const contractStatus = (status: string) =>
    t(`leases.status.${status}`, { defaultValue: status });
  const agreementStatus = (status: string) =>
    t(`agreements.status.${status}`, { defaultValue: status });
  const unnumbered = t("agreements.table.unnumbered", {
    defaultValue: "(no number)",
  });

  /** What a picker offers, narrowed by what is chosen above it. */
  function offered(entity: FilterEntity): SearchableSelectOption[] {
    if (!options) return [];
    switch (entity) {
      case "owner":
        return visibleOwners(options, selection).map((owner) => ({
          value: owner.id,
          label: owner.label,
        }));
      case "compound":
        return visibleCompounds(options, selection).map((compound) => ({
          value: compound.id,
          label: compound.label,
        }));
      case "building":
        return visibleBuildings(options, selection).map((building) => ({
          value: building.id,
          label: building.label,
          subtitle: building.hint ?? undefined,
        }));
      case "unit":
        return visibleUnits(options, selection).map((unit) => ({
          value: unit.id,
          label: unit.label,
          subtitle: unit.hint ?? undefined,
        }));
      case "tenant":
        return visibleTenants(options, selection).map((tenant) => ({
          value: tenant.id,
          label: tenant.label,
        }));
      case "contract":
        return visibleContracts(options, selection).map((contract) => ({
          value: contract.id,
          // The number the office knows it by; the tenant when it has none.
          label: contract.label || contract.tenantName || unnumbered,
          subtitle: [
            contract.label ? contract.tenantName : null,
            [contract.propertyName, contract.unitNumber]
              .filter(Boolean)
              .join(" · "),
          ]
            .filter(Boolean)
            .join(" · "),
          badge: contractStatus(contract.status),
        }));
      case "agreement":
        return visibleAgreements(options, selection).map((agreement) => ({
          value: agreement.id,
          label: agreement.label || unnumbered,
          subtitle: [
            agreement.ownerName,
            agreement.scopeName ||
              t("agreements.scope.portfolio", {
                defaultValue: "Whole portfolio",
              }),
          ]
            .filter(Boolean)
            .join(" · "),
          badge: agreementStatus(agreement.status),
        }));
    }
  }

  const renderEntity = (entity: FilterEntity) => {
    const { key, labelKey, label, allKey, all } = ENTITIES[entity];
    const value = values[key] ?? "";
    const allLabel = t(allKey, { defaultValue: all });
    const choices = offered(entity);
    // A choice that is not on offer — an address naming a record this reader
    // cannot open, or lists still on their way — is shown as what it is
    // rather than as "all", which it is not.
    const listed = choices.some((choice) => choice.value === value);
    const stray: SearchableSelectOption[] =
      value && !listed
        ? [
            {
              value,
              label: optionsLoading
                ? t("reports.filters.loading", { defaultValue: "Loading…" })
                : t("reports.filters.unavailable", {
                    defaultValue: "Not available",
                  }),
            },
          ]
        : [];

    return (
      <div key={entity} className="w-full min-w-[200px] space-y-1.5 sm:w-auto">
        <Label htmlFor={`${uid}-${key}`}>{t(labelKey, { defaultValue: label })}</Label>
        <SearchableSelect
          id={`${uid}-${key}`}
          value={value}
          onValueChange={(next) => choose(entity, next === ALL ? "" : next)}
          options={[
            { value: ALL, label: allLabel },
            ...stray,
            ...choices,
          ]}
          placeholder={
            optionsLoading
              ? t("reports.filters.loading", { defaultValue: "Loading…" })
              : allLabel
          }
          triggerClassName="h-10 bg-white dark:bg-gray-800"
        />
      </div>
    );
  };

  const renderPeriod = (
    field: Extract<ReportFilterField, { kind: "period" }>,
  ) => {
    const start = values[field.startKey] ?? "";
    const end = values[field.endKey] ?? "";
    const preset = presetOfRange(start, end);
    return (
      <Fragment key={`period-${field.startKey}`}>
        {field.presets && (
          <div className="w-full min-w-[160px] space-y-1.5 sm:w-auto">
            <Label htmlFor={`${uid}-preset`}>
              {t("reports.filters.period", { defaultValue: "Period" })}
            </Label>
            <Select
              value={preset ?? "custom"}
              onValueChange={(next) => {
                if (isPeriodPreset(next)) {
                  const range = presetRange(next);
                  onChange({
                    [field.startKey]: range.startDate,
                    [field.endKey]: range.endDate,
                  });
                }
              }}
            >
              <SelectTrigger
                id={`${uid}-preset`}
                className="h-10 bg-white dark:bg-gray-800"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_PRESETS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`reports.dateRange.${presetLabelKey(value)}`, {
                      defaultValue: value,
                    })}
                  </SelectItem>
                ))}
                <SelectItem value="custom">
                  {t("reports.filters.periodCustom", {
                    defaultValue: "Custom range",
                  })}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor={`${uid}-${field.startKey}`}>
            {field.startLabel ??
              t("reports.filters.from", { defaultValue: "From" })}
          </Label>
          <Input
            id={`${uid}-${field.startKey}`}
            type="date"
            className="h-10 bg-white dark:bg-gray-800"
            value={start}
            max={end || undefined}
            onChange={(event) => onChange({ [field.startKey]: event.target.value })}
          />
        </div>
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor={`${uid}-${field.endKey}`}>
            {field.endLabel ?? t("reports.filters.to", { defaultValue: "To" })}
          </Label>
          <Input
            id={`${uid}-${field.endKey}`}
            type="date"
            className="h-10 bg-white dark:bg-gray-800"
            value={end}
            min={start || undefined}
            onChange={(event) => onChange({ [field.endKey]: event.target.value })}
          />
        </div>
      </Fragment>
    );
  };

  const renderStatus = (
    field: Extract<ReportFilterField, { kind: "status" }>,
  ) => {
    const allLabel =
      field.allLabel ??
      t("reports.filters.allStatuses", { defaultValue: "All statuses" });
    return (
      <div
        key={`status-${field.key}`}
        className="w-full min-w-[180px] space-y-1.5 sm:w-auto"
      >
        <Label htmlFor={`${uid}-${field.key}`}>
          {field.label ??
            t("reports.filters.status", { defaultValue: "Status" })}
        </Label>
        <Select
          value={values[field.key] || ALL}
          onValueChange={(next) =>
            onChange({ [field.key]: next === ALL ? "" : next })
          }
        >
          <SelectTrigger
            id={`${uid}-${field.key}`}
            className="h-10 bg-white dark:bg-gray-800"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{allLabel}</SelectItem>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const truncated = options?.truncated
    ? Object.keys(options.truncated).length > 0
    : false;

  return (
    <div data-testid="report-filter-bar">
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending && !reversed) onApply();
        }}
      >
        {leading}

        {fields.map((field) => {
          switch (field.kind) {
            case "period":
              return renderPeriod(field);
            case "entity":
              return renderEntity(field.entity);
            case "status":
              return renderStatus(field);
            case "toggle":
              return (
                <label
                  key={`toggle-${field.key}`}
                  className="flex h-10 cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={values[field.key] === "true"}
                    onCheckedChange={(checked) =>
                      onChange({ [field.key]: checked === true ? "true" : "" })
                    }
                  />
                  {field.label}
                </label>
              );
          }
        })}

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button
            type="submit"
            size="sm"
            className="h-10"
            disabled={!pending || reversed}
            data-testid="report-filter-apply"
          >
            {t("reports.applyFilters", { defaultValue: "Apply filters" })}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10"
            disabled={!canReset}
            onClick={onReset}
            data-testid="report-filter-reset"
          >
            {t("reports.resetFilters", { defaultValue: "Reset filters" })}
          </Button>
        </div>
      </form>

      {reversed && (
        <p className="px-4 pt-2 text-xs text-destructive" role="alert">
          {t("reports.filters.periodReversed", {
            defaultValue: "The start date cannot be after the end date.",
          })}
        </p>
      )}
      {pending && !reversed && (
        <p className="px-4 pt-2 text-xs text-muted-foreground">
          {t("reports.pendingHint", {
            defaultValue:
              "Filters changed — the figures below are from the last run.",
          })}
        </p>
      )}
      {optionsFailed && (
        <p className="px-4 pt-2 text-xs text-destructive">
          {t("reports.filters.optionsFailed", {
            defaultValue:
              "The lists to choose from could not be loaded. Reload the page to try again.",
          })}
        </p>
      )}
      {truncated && (
        <p className="px-4 pt-2 text-xs text-muted-foreground">
          {t("reports.filters.truncated", {
            defaultValue: "Some lists show only their first entries.",
          })}
        </p>
      )}
    </div>
  );
}

/** "this-month" → "thisMonth": the catalogue's key for a ready-made range. */
function presetLabelKey(preset: string): string {
  return preset.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}
