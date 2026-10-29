"use client";

/**
 * PropertyPro - Management agreement statement, from the menu
 *
 * The menu's "Management agreement statement" is one agreement's statement,
 * not the report over all of them — that is "Reports" beside it. It used to
 * open the report. Here the agreement is picked, and its statement opens
 * beneath in the client's layout, as the compound, building and unit
 * statements ask for their subject first.
 *
 * The agreement and the period are chosen together and run together, under one
 * Apply; owner, compound and building narrow the agreements on offer. All of it
 * rides in the address, so the statement can be bookmarked and reopened, and
 * Reset returns every control to where the page opened — no agreement chosen,
 * the period the year so far.
 */

import { Suspense } from "react";
import { Handshake } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { AgreementStatementContent } from "@/components/agreements/AgreementStatementView";
import {
  ReportFilterBar,
  type ReportFilterField,
} from "@/components/reports/report-filter-bar";
import {
  useReportFilters,
  type FilterValues,
} from "@/components/reports/use-report-filters";
import { useReportFilterOptions } from "@/components/reports/use-report-filter-options";
import { yearToDate } from "@/lib/report-filters/period";

/** Nothing chosen, and the year so far. Reset returns to exactly this. */
const FILTERS = {
  defaults: (): FilterValues => ({
    ...yearToDate(),
    ownerId: "",
    compoundId: "",
    propertyId: "",
    agreementId: "",
  }),
};

const FIELDS: ReportFilterField[] = [
  { kind: "entity", entity: "owner" },
  { kind: "entity", entity: "compound" },
  { kind: "entity", entity: "building" },
  { kind: "entity", entity: "agreement" },
  { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
];

const OPTION_LISTS = ["owners", "compounds", "buildings", "agreements"] as const;

export default function AgreementStatementMenuPage() {
  // useSearchParams needs a boundary of its own under the dashboard layout.
  return (
    <Suspense fallback={null}>
      <AgreementStatementPicker />
    </Suspense>
  );
}

function AgreementStatementPicker() {
  const { t } = useLocalizationContext();
  const { draft, applied, setField, apply, reset, pending, canReset } =
    useReportFilters(FILTERS);
  const { options, loading, failed } = useReportFilterOptions(OPTION_LISTS);

  const chosen = applied.agreementId;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("agreements.statement.title", {
            defaultValue: "Management agreement statement",
          })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("agreements.statement.pickHint", {
            defaultValue: "Choose an agreement to see its statement.",
          })}
        </p>
      </div>

      <ReportFilterBar
        values={draft}
        onChange={setField}
        onApply={apply}
        onReset={reset}
        pending={pending}
        canReset={canReset}
        fields={FIELDS}
        options={options}
        optionsLoading={loading}
        optionsFailed={failed}
      />

      {chosen ? (
        <AgreementStatementContent
          key={chosen}
          id={chosen}
          embedded
          period={{ startDate: applied.startDate, endDate: applied.endDate }}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Handshake className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("agreements.statement.pickHint", {
                defaultValue: "Choose an agreement to see its statement.",
              })}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
