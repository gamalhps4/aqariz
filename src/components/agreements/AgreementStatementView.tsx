"use client";

/**
 * PropertyPro - One management agreement's statement
 *
 * The statement the review lists first under Properties & Operations, laid out
 * as the client's own sample (كشف حساب إتفاقيات الإدارة): the office's name,
 * registration and logo; the agreement's details, with its fee; the summary;
 * every payment received on the buildings it covers, one row each; the
 * expenses. The rent roll stays a tab away.
 *
 * Shown on the agreement's own statement page, and under the menu's
 * "Management agreement statement" once an agreement is picked there
 * (`embedded`: that page carries the heading).
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, FileText, Handshake, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  ReportFilterBar,
  type ReportFilterField,
} from "@/components/reports/report-filter-bar";
import {
  useReportFilters,
  type FilterValues,
} from "@/components/reports/use-report-filters";
import { yearToDate } from "@/lib/report-filters/period";
import { useSession } from "@/lib/auth-client";
import { UserRole } from "@/types";
import {
  StatementContractsTable,
  StatementDocument,
} from "@/components/statements/StatementSections";
import { feeDetailText } from "@/lib/statements/document";
import type { LineTranslate } from "@/lib/statements/line-text";
import type { AgreementStatement } from "@/types/agreement";
import { businessDay } from "@/lib/dates/business-day";

/**
 * The statement's one filter is its period, which opens on the year so far.
 * Reset returns to exactly this.
 */
const FILTERS = {
  defaults: (): FilterValues => ({ ...yearToDate() }),
};

const FIELDS: ReportFilterField[] = [
  { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
];

/**
 * One agreement's statement, with its own period controls: what the
 * statement was last run with lives in the address, and the controls edit a
 * draft until Apply, so changing both dates fetches once, for the pair
 * actually asked for. Reset returns the period to the year so far.
 */
export function AgreementStatementView({
  id,
  embedded = false,
}: {
  id: string;
  /** Inside a page that already carries the heading and the way back. */
  embedded?: boolean;
}) {
  const { draft, applied, setField, apply, reset, pending, canReset } =
    useReportFilters(FILTERS);

  return (
    <AgreementStatementContent
      id={id}
      embedded={embedded}
      period={{ startDate: applied.startDate, endDate: applied.endDate }}
      controls={
        <ReportFilterBar
          values={draft}
          onChange={setField}
          onApply={apply}
          onReset={reset}
          pending={pending}
          canReset={canReset}
          fields={FIELDS}
        />
      }
    />
  );
}

/**
 * The statement for a period somebody else chose. The menu's "Management
 * agreement statement" page picks the agreement and the period together, under
 * one Apply, and hands both here; `controls` is whatever sits between the
 * heading and the statement, if anything.
 */
export function AgreementStatementContent({
  id,
  embedded = false,
  period: asked,
  controls,
}: {
  id: string;
  embedded?: boolean;
  /** The period to run it for. */
  period: { startDate: string; endDate: string };
  controls?: ReactNode;
}) {
  const { t, formatDate, formatCurrency, isRTL } = useLocalizationContext();
  const { data: session } = useSession();
  // The receipt page is the office's; an owner reads the number only.
  const isOwner = session?.user?.role === UserRole.OWNER;
  const tr: LineTranslate = (key, english, values) =>
    t(key, { defaultValue: english, values });

  const [result, setResult] = useState<AgreementStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () =>
      new URLSearchParams({
        startDate: asked.startDate,
        endDate: asked.endDate,
      }),
    [asked.startDate, asked.endDate],
  );

  const load = useCallback(
    async (isStale: () => boolean = () => false) => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/agreements/${id}/statement?${query}`,
        );
        if (isStale()) return;
        if (response.status === 404) {
          setNotFound(true);
          return;
        }
        const payload = await response.json();
        // A statement for a period that has since been replaced is not the one
        // on screen: it must not land after the newer one.
        if (isStale()) return;
        if (payload?.success) {
          setResult(payload.data as AgreementStatement);
          setError(null);
        } else {
          setError(
            payload?.error ??
              t("agreements.statement.loadError", {
                defaultValue: "Could not generate the statement",
              }),
          );
        }
      } catch (loadError) {
        console.error("Failed to load agreement statement:", loadError);
        if (!isStale()) {
          setError(
            t("agreements.statement.loadError", {
              defaultValue: "Could not generate the statement",
            }),
          );
        }
      } finally {
        if (!isStale()) setLoading(false);
      }
    },
    [id, query, t],
  );

  useEffect(() => {
    let stale = false;
    void load(() => stale);
    return () => {
      stale = true;
    };
  }, [load]);

  if (notFound) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Handshake className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("agreements.statement.notFound", {
              defaultValue: "This agreement no longer exists",
            })}
          </p>
          <Button size="sm" asChild>
            <Link href="/dashboard/agreements/reports">
              {t("agreements.statement.back", {
                defaultValue: "Back to agreements",
              })}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const agreement = result?.agreement;
  const statement = result?.statement ?? null;
  const covers = agreement
    ? (agreement.scopeName ??
      t("agreements.scope.portfolio", { defaultValue: "Whole portfolio" }))
    : "";

  const exportParams = (table?: string) => {
    const params = new URLSearchParams(query);
    if (table) params.set("table", table);
    return params;
  };

  // The period the statement covers, as the download prints it: the part of
  // the dates asked for that the agreement was in force — shorter than they
  // are when it started, ended or was renewed between them.
  const period = statement
    ? {
        // The period's ends are the first and last instants of its days on
        // Riyadh's calendar, so the day is read there, not off the UTC date.
        startDate: businessDay(statement.period.startDate),
        endDate: businessDay(statement.period.endDate),
      }
    : asked;

  // Whose agreement, over what, on what terms, for which period — the same
  // details the download prints, in the same words. The fee is stated here
  // in full; the summary's commission label repeats only the rate.
  const details = agreement
    ? [
        {
          label: t("clients.statement.details.agreement", {
            defaultValue: "Agreement",
          }),
          value: (
            <Link
              href={`/dashboard/agreements/${agreement.id}`}
              className="hover:underline"
            >
              {agreement.agreementNumber ??
                t("agreements.table.unnumbered", {
                  defaultValue: "(no number)",
                })}
            </Link>
          ),
        },
        ...(agreement.kind === "investment"
          ? [
              {
                label: t("clients.statement.details.type", {
                  defaultValue: "Agreement type",
                }),
                value: t("agreements.kind.investment", {
                  defaultValue: "Investment agreement",
                }),
              },
            ]
          : []),
        {
          label: t("clients.statement.details.owner", { defaultValue: "Owner" }),
          value: isOwner ? (
            agreement.ownerName
          ) : (
            <Link
              href={`/dashboard/clients/owners/${agreement.ownerId}`}
              className="hover:underline"
            >
              {agreement.ownerName}
            </Link>
          ),
        },
        {
          label: t("clients.statement.details.covers", { defaultValue: "Covers" }),
          value: covers,
        },
        {
          label:
            agreement.kind === "investment"
              ? t("agreements.investment.rent", {
                  defaultValue: "Rent paid to the owner",
                })
              : t("clients.statement.details.fee", {
                  defaultValue: "Management fee",
                }),
          value: feeDetailText(agreement.fee, agreement.commissionBasis, tr),
        },
        {
          label: t("clients.statement.details.period", { defaultValue: "Period" }),
          value: t("agreements.statement.term", {
            defaultValue: "{start} to {end}",
            values: {
              start: formatDate(period.startDate),
              end: formatDate(period.endDate),
            },
          }),
        },
        // What the commission was charged on, when that is not simply
        // everything collected — so the rate can be checked against it.
        ...(statement &&
        statement.commissionSource === "agreements" &&
        Math.abs(
          statement.totals.commissionBase - statement.totals.rentCollected,
        ) >= 0.005
          ? [
              {
                label: t("clients.statement.details.commissionBase", {
                  defaultValue: "Commission charged on",
                }),
                value: formatCurrency(statement.totals.commissionBase),
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          {!embedded && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/agreements/reports">
                <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
              </Link>
            </Button>
          )}
          <div>
            {!embedded && (
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("agreements.statement.title", {
                  defaultValue: "Management agreement statement",
                })}
              </h1>
            )}
            {agreement && (
              <p className="text-sm text-muted-foreground">
                {agreement.endDate
                  ? t("agreements.statement.term", {
                      defaultValue: "{start} to {end}",
                      values: {
                        start: formatDate(agreement.startDate),
                        end: formatDate(agreement.endDate),
                      },
                    })
                  : t("agreements.statement.termOpen", {
                      defaultValue: "From {start}",
                      values: { start: formatDate(agreement.startDate) },
                    })}
              </p>
            )}
          </div>
        </div>
      </div>

      {controls}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <p className="text-sm text-muted-foreground">
          {result.properties.length > 0
            ? t("agreements.statement.covers", {
                defaultValue: "Covers: {names}",
                values: {
                  names: result.properties
                    .map((property) => property.name)
                    .join(isRTL ? "، " : ", "),
                },
              })
            : t("agreements.statement.coversNothing", {
                defaultValue:
                  "This agreement covers no buildings you can see for this period.",
              })}
        </p>
      )}

      <Tabs defaultValue="statement" className="space-y-4">
        <TabsList>
          <TabsTrigger value="statement" className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            {t("clients.owners.tabs.statement", { defaultValue: "Statement" })}
          </TabsTrigger>
          <TabsTrigger value="contracts" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t("clients.owners.tabs.contracts", { defaultValue: "Contracts" })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="statement">
          <StatementDocument
            statement={statement}
            letterhead={result?.letterhead}
            title={t("clients.statement.document.agreementTitle", {
              defaultValue: "Management agreement statement",
            })}
            details={details}
            loading={loading}
            exportEndpoint={`/api/agreements/${id}/statement`}
            exportParams={exportParams()}
            receiptLinks={!isOwner}
          />
        </TabsContent>
        <TabsContent value="contracts">
          <StatementContractsTable
            statement={statement}
            loading={loading}
            exportEndpoint={`/api/agreements/${id}/statement`}
            exportParams={exportParams("contracts")}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
