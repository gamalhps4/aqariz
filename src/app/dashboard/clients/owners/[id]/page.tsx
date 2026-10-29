"use client";

/**
 * PropertyPro - Owner detail & Statement of Account
 *
 * Reads two ways depending on who the owner is. For a management office it is
 * a payout statement: every payment in, the expenses and the commission out,
 * and who owes whom at the close. For a landlord managing their own buildings
 * it is simply their own profit & loss — same figures, no commission.
 *
 * The statement is laid out as the client's sample, the same document the
 * download produces (StatementDocument).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  ArrowLeft,
  Banknote,
  Building2,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Receipt,
  Save,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ReportExportButton } from "@/components/reports/export-button";
import {
  ReportFilterBar,
  type ReportFilterField,
} from "@/components/reports/report-filter-bar";
import {
  filterParams,
  useReportFilters,
  type FilterValues,
} from "@/components/reports/use-report-filters";
import { CommunicationLog } from "@/components/clients/CommunicationLog";
import {
  StatementContractsTable,
  StatementDocument,
} from "@/components/statements/StatementSections";
import { usePropertyCategories } from "@/hooks/use-property-categories";
import { useAuthorization } from "@/hooks/useAuthorization";
import { hasAnyPermission } from "@/lib/permissions-manager";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { personErrorText } from "@/lib/person-error-text";
import type { FilterOptions } from "@/lib/report-filters/options";
import { yearToDate } from "@/lib/report-filters/period";
import type {
  OwnerDetail,
  OwnerProperty,
  OwnerStatement,
} from "@/types/owner";

/**
 * What the owner's statement can be narrowed by: its period, which opens on
 * the year so far, and one of the owner's buildings. Reset returns to exactly
 * this.
 */
const STATEMENT_FILTERS = {
  defaults: (): FilterValues => ({ ...yearToDate(), propertyId: "" }),
};

const STATEMENT_FIELDS: ReportFilterField[] = [
  { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
  { kind: "entity", entity: "building" },
];

const STATEMENT_KEYS = ["startDate", "endDate", "propertyId"] as const;

export default function OwnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // The statement's filters live in the address, and useSearchParams needs a
  // boundary of its own under the dashboard layout.
  return (
    <Suspense fallback={null}>
      <OwnerDetailView params={params} />
    </Suspense>
  );
}

function OwnerDetailView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { t, formatDate, formatCurrency } = useLocalizationContext();
  const { labelFor: categoryLabelFor } = usePropertyCategories("property");
  const { permissions } = useAuthorization();
  // The rights PATCH and DELETE /api/owners/[id] ask for.
  const canEditOwner = hasAnyPermission(permissions, [
    "owner_edit",
    "owner_management",
  ]);
  const canArchiveOwner = hasAnyPermission(permissions, [
    "owner_delete",
    "owner_management",
  ]);
  const [archiving, setArchiving] = useState(false);

  const [owner, setOwner] = useState<OwnerDetail | null>(null);
  const [statement, setStatement] = useState<OwnerStatement | null>(null);
  // What the statement was last run with is `applied`; the controls edit
  // `draft` until Apply.
  const { draft, applied, setField, apply, reset, pending, canReset } =
    useReportFilters(STATEMENT_FILTERS);
  const statementParams = useMemo(
    () => filterParams(applied, STATEMENT_KEYS),
    [applied],
  );
  const statementQuery = statementParams.toString();
  // The buildings to choose among are the owner's own — the same list the
  // Properties tab shows, which the API has already scoped to the reader.
  const buildingOptions = useMemo<FilterOptions | undefined>(
    () =>
      owner
        ? {
            buildings: owner.properties.map((property) => ({
              id: property.id,
              label: property.name,
              hint:
                [property.compoundName, property.city]
                  .filter(Boolean)
                  .join(" · ") || null,
              compoundId: null,
              ownerId: owner.userId,
            })),
          }
        : undefined,
    [owner],
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOwner = useCallback(async () => {
    try {
      const response = await fetch(`/api/owners/${id}`);
      if (response.status === 404) {
        setNotFound(true);
        return;
      }
      const payload = await response.json();
      if (payload?.success) setOwner(payload.data as OwnerDetail);
    } catch (loadError) {
      console.error("Failed to load owner:", loadError);
    }
  }, [id]);

  const loadStatement = useCallback(
    async (isStale: () => boolean = () => false) => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/owners/${id}/statement?${statementQuery}`,
        );
        const payload = await response.json();
        // A statement for filters that have since been replaced is not the one
        // on screen: it must not land after the newer one.
        if (isStale()) return;
        if (payload?.success) {
          setStatement(payload.data as OwnerStatement);
          setError(null);
        } else {
          setError(payload?.error ?? t("errors.ui.loadFailed", { defaultValue: "Could not load this. Try again." }));
        }
      } catch (loadError) {
        console.error("Failed to load statement:", loadError);
        if (!isStale()) setError("Could not generate the statement");
      } finally {
        if (!isStale()) setLoading(false);
      }
    },
    [id, statementQuery, t],
  );

  useEffect(() => {
    loadOwner();
  }, [loadOwner]);

  useEffect(() => {
    let stale = false;
    loadStatement(() => stale);
    return () => {
      stale = true;
    };
  }, [loadStatement]);

  // To the archive, where it can be restored. The server refuses while the
  // owner still owns a building and says so; the dialog says it up front
  // when the buildings are in view.
  const archiveOwner = async () => {
    setArchiving(true);
    try {
      const response = await fetch(`/api/owners/${id}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        toast.error(
          personErrorText(
            t,
            result,
            t("clients.owners.delete.failed", {
              defaultValue: "The owner could not be moved to the archive.",
            }),
          ),
        );
        return;
      }
      toast.success(
        t("clients.owners.delete.done", {
          defaultValue: "{name} was moved to the archive.",
          values: { name: owner?.companyName ?? owner?.name ?? "" },
        }),
      );
      router.push("/dashboard/clients/owners");
    } finally {
      setArchiving(false);
    }
  };

  if (notFound) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Receipt className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("clients.owners.notFound", {
              defaultValue: "This owner no longer exists",
            })}
          </p>
          <Button size="sm" asChild>
            <Link href="/dashboard/clients/owners">
              {t("clients.owners.backToList", {
                defaultValue: "Back to owners",
              })}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const propertyColumns: DataTableColumn<OwnerProperty>[] = [
    {
      id: "name",
      header: t("clients.owners.properties.name", {
        defaultValue: "Property",
      }),
      cell: (row) => (
        <Link
          href={`/dashboard/properties/${row.id}`}
          className="group inline-flex flex-col text-foreground"
        >
          <span className="text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {row.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {[categoryLabelFor(row.type), row.city, row.compoundName]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </Link>
      ),
      width: "min-w-[230px]",
    },
    {
      id: "units",
      header: t("clients.owners.properties.units", { defaultValue: "Units" }),
      cell: (row) => <span className="text-sm">{row.totalUnits}</span>,
      align: "center",
      width: "min-w-[90px]",
    },
    {
      id: "status",
      header: t("clients.owners.properties.status", {
        defaultValue: "Status",
      }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal capitalize">
          {t(`properties.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
      width: "min-w-[110px]",
    },
    {
      id: "open",
      header: "",
      cell: (row) => (
        <Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0">
          <Link href={`/dashboard/properties/${row.id}`}>
            <ExternalLink className="h-4 w-4" />
          </Link>
        </Button>
      ),
      width: "w-10",
      align: "center",
    },
  ];

  // Whose statement and for which period — the same details the download
  // prints.
  const statementDetails = statement
    ? [
        {
          label: t("clients.statement.details.owner", { defaultValue: "Owner" }),
          value: statement.owner.name,
        },
        ...(statement.owner.companyName
          ? [
              {
                label: t("clients.statement.details.company", {
                  defaultValue: "Company",
                }),
                value: statement.owner.companyName,
              },
            ]
          : []),
        {
          label: t("clients.statement.details.properties", {
            defaultValue: "Properties",
          }),
          value: statement.propertyCount,
        },
        {
          label: t("clients.statement.details.period", { defaultValue: "Period" }),
          value: t("agreements.statement.term", {
            defaultValue: "{start} to {end}",
            values: {
              start: formatDate(statement.period.startDate),
              end: formatDate(statement.period.endDate),
            },
          }),
        },
        // What the commission was charged on, when that is not simply
        // everything collected — so the rate can be checked against it.
        ...(statement.commissionSource === "agreements" &&
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
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/clients/owners">
              <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              {owner?.companyName ?? owner?.name ?? "…"}
              {owner?.isSelf && (
                <Badge variant="outline" className="text-xs font-normal">
                  {t("clients.owners.you", { defaultValue: "You" })}
                </Badge>
              )}
            </h1>
            <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {owner?.companyName && <span>{owner.name}</span>}
              {owner?.email && (
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  {owner.email}
                </span>
              )}
              {owner?.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />
                  {owner.phone}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {canArchiveOwner && owner && !owner.isSelf && (
            owner.propertyCount > 0 ? (
              // Refused while they own a building — said at the click rather
              // than behind a button that silently does nothing.
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-destructive hover:text-destructive"
                onClick={() =>
                  toast.error(
                    t("clients.owners.delete.hasProperties", {
                      defaultValue:
                        "This owner still owns buildings. Reassign or archive them first.",
                    }),
                  )
                }
              >
                <Archive className="h-4 w-4" />
                {t("clients.owners.delete.trigger", {
                  defaultValue: "Move to archive",
                })}
              </Button>
            ) : (
              <ConfirmationDialog
                title={t("clients.owners.delete.title", {
                  defaultValue: "Move {name} to the archive?",
                  values: { name: owner.companyName ?? owner.name },
                })}
                description={t("clients.owners.delete.description", {
                  defaultValue:
                    "The owner leaves the owners list and moves to the Archive, where they can be restored. Their statements and agreements are kept.",
                })}
                confirmText={t("clients.owners.delete.confirm", {
                  defaultValue: "Move to archive",
                })}
                variant="destructive"
                onConfirm={archiveOwner}
                loading={archiving}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-destructive hover:text-destructive"
                  disabled={archiving}
                >
                  <Archive className="h-4 w-4" />
                  {t("clients.owners.delete.trigger", {
                    defaultValue: "Move to archive",
                  })}
                </Button>
              </ConfirmationDialog>
            )
          )}
          <ReportExportButton
            endpoint={`/api/owners/${id}/statement`}
            params={statementParams}
            disabled={loading}
          />
        </div>
      </div>

      <ReportFilterBar
        values={draft}
        onChange={setField}
        onApply={apply}
        onReset={reset}
        pending={pending}
        canReset={canReset}
        fields={STATEMENT_FIELDS}
        options={buildingOptions}
        optionsLoading={!owner}
      />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Tabs defaultValue="statement" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="statement" className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            {t("clients.owners.tabs.statement", {
              defaultValue: "Statement",
            })}
          </TabsTrigger>
          {/* The rent roll. The Statement tab is a cash ledger — where the
              money went; this is what is let and for how much, which is the
              table the statement an owner is used to leads with. */}
          <TabsTrigger value="contracts" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t("clients.owners.tabs.contracts", {
              defaultValue: "Contracts",
            })}
          </TabsTrigger>
          <TabsTrigger value="properties" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {t("clients.owners.tabs.properties", {
              defaultValue: "Properties",
            })}
          </TabsTrigger>
          <TabsTrigger value="communications" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            {t("clients.owners.tabs.communications", {
              defaultValue: "Communication",
            })}
          </TabsTrigger>
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            {t("clients.owners.tabs.details", { defaultValue: "Owner details" })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="statement" className="space-y-4">
          <StatementDocument
            statement={statement}
            letterhead={statement?.letterhead}
            title={t("clients.statement.document.ownerTitle", {
              defaultValue: "Owner statement of account",
            })}
            details={statementDetails}
            loading={loading}
            receiptLinks
          />
        </TabsContent>

        <TabsContent value="contracts" className="space-y-4">
          <StatementContractsTable
            statement={statement}
            loading={loading}
            exportEndpoint={`/api/owners/${id}/statement`}
            exportParams={(() => {
              const params = new URLSearchParams(statementParams);
              params.set("table", "contracts");
              return params;
            })()}
          />
        </TabsContent>

        <TabsContent value="properties">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>
                  {t("clients.owners.tabs.properties", {
                    defaultValue: "Properties",
                  })}
                </span>
                <Badge variant="outline">
                  {owner?.properties.length ?? 0}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={propertyColumns}
                data={owner?.properties ?? []}
                loading={!owner}
                getRowKey={(row) => row.id}
                emptyState={{
                  icon: (
                    <Building2 className="h-10 w-10 text-muted-foreground" />
                  ),
                  title: t("clients.owners.properties.empty", {
                    defaultValue: "No properties yet",
                  }),
                  description: t("clients.owners.properties.emptyHint", {
                    defaultValue:
                      "Assign this owner on a property and it appears here",
                  }),
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications">
          <CommunicationLog clientId={id} />
        </TabsContent>

        <TabsContent value="profile" className="space-y-4">
          <OwnerIdentityForm
            userId={id}
            detail={owner}
            canEdit={canEditOwner}
            onSaved={loadOwner}
          />
          <OwnerProfileForm
            userId={id}
            detail={owner}
            onSaved={loadOwner}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Who the owner is: name, phone and email — the email optional, as when the
 * owner was added.
 *
 * The one place these can be corrected. Administration → Users asks for an
 * email and a Latin name, so an owner recorded without an address could not
 * be edited anywhere. A member of staff who owns buildings is the exception:
 * their name and email are their sign-in, changed under Employees.
 */
function OwnerIdentityForm({
  userId,
  detail,
  canEdit,
  onSaved,
}: {
  userId: string;
  detail: OwnerDetail | null;
  canEdit: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useLocalizationContext();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [form, setForm] = useState({ fullName: "", phone: "", email: "" });

  useEffect(() => {
    setForm({
      // "—" is the list's stand-in for a record with no name, not a name.
      fullName: detail?.name && detail.name !== "—" ? detail.name : "",
      phone: detail?.phone ?? "",
      email: detail?.email ?? "",
    });
  }, [detail?.name, detail?.phone, detail?.email]);

  if (!detail) return null;

  if (!detail.isOwnerAccount) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground">
          <UserRound className="mt-0.5 h-4 w-4 shrink-0" />
          {t("clients.owners.identity.isStaff", {
            defaultValue:
              "This owner is a member of staff. Change their name and email under Employees.",
          })}
        </CardContent>
      </Card>
    );
  }

  const save = async () => {
    if (!form.fullName.trim()) {
      setMessage({
        text: t("people.errors.nameRequired", {
          defaultValue: "A name is required.",
        }),
        error: true,
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/owners/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          // Blank means "no email", stored as none rather than refused.
          email: form.email.trim(),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setMessage({
          text: personErrorText(
            t,
            result,
            t("errors.ui.saveFailed", {
              defaultValue: "Could not save. Try again.",
            }),
          ),
          error: true,
        });
        return;
      }
      await onSaved();
      setMessage({
        text: t("clients.owners.profile.saved", { defaultValue: "Saved" }),
        error: false,
      });
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("clients.owners.identity.title", { defaultValue: "Owner" })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ownerIdentityName">
            {t("clients.owners.add.fullName", { defaultValue: "Full name" })}
          </Label>
          <Input
            id="ownerIdentityName"
            value={form.fullName}
            onChange={(event) => set("fullName", event.target.value)}
            maxLength={160}
            disabled={!canEdit}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ownerIdentityPhone">
              {t("clients.owners.add.phone", { defaultValue: "Phone" })}
            </Label>
            <Input
              id="ownerIdentityPhone"
              value={form.phone}
              onChange={(event) => set("phone", event.target.value)}
              dir="ltr"
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ownerIdentityEmail">
              {t("clients.owners.add.email", { defaultValue: "Email" })}
              <span className="ms-1 text-xs font-normal text-muted-foreground">
                {t("clients.owners.add.emailOptional", {
                  defaultValue: "(optional)",
                })}
              </span>
            </Label>
            <Input
              id="ownerIdentityEmail"
              type="email"
              value={form.email}
              onChange={(event) => set("email", event.target.value)}
              dir="ltr"
              disabled={!canEdit}
            />
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center justify-end gap-3">
            {message && (
              <span
                className={`text-sm ${
                  message.error ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {message.text}
              </span>
            )}
            <Button onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t("common.saveChanges", { defaultValue: "Save changes" })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Payout and tax details. Entirely optional — a landlord managing their own
 * buildings never fills this in, so the form says as much rather than looking
 * like an unfinished record.
 */
function OwnerProfileForm({
  userId,
  detail,
  onSaved,
}: {
  userId: string;
  detail: OwnerDetail | null;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useLocalizationContext();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    companyName: "",
    nationalId: "",
    taxNumber: "",
    payoutMethod: "",
    bankName: "",
    bankAccountName: "",
    bankIban: "",
    notes: "",
  });

  useEffect(() => {
    const profile = detail?.profile;
    setForm({
      companyName: profile?.companyName ?? "",
      nationalId: profile?.nationalId ?? "",
      taxNumber: profile?.taxNumber ?? "",
      payoutMethod: profile?.payoutMethod ?? "",
      bankName: profile?.bankName ?? "",
      bankAccountName: profile?.bankAccountName ?? "",
      bankIban: profile?.bankIban ?? "",
      notes: profile?.notes ?? "",
    });
  }, [detail?.profile]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/owners/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        setMessage(result?.error ?? t("errors.ui.saveFailed", { defaultValue: "Could not save. Try again." }));
        return;
      }
      await onSaved();
      setMessage(
        t("clients.owners.profile.saved", { defaultValue: "Saved" }),
      );
    } finally {
      setSaving(false);
    }
  };

  const field = (
    key: keyof typeof form,
    labelKey: string,
    fallback: string,
    extra: { dir?: string } = {},
  ) => (
    <div className="space-y-2">
      <Label htmlFor={key}>{t(labelKey, { defaultValue: fallback })}</Label>
      <Input
        id={key}
        value={form[key]}
        onChange={(event) =>
          setForm((current) => ({ ...current, [key]: event.target.value }))
        }
        {...extra}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("clients.owners.profile.title", {
            defaultValue: "Payout & tax details",
          })}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {detail?.isSelf
            ? t("clients.owners.profile.selfHint", {
                defaultValue:
                  "You manage your own properties, so none of this is required — fill it in only if you want it on statements.",
              })
            : t("clients.owners.profile.hint", {
                defaultValue:
                  "Optional. Used on this owner's statements and when paying out their share.",
              })}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("companyName", "clients.owners.profile.companyName", "Company name")}
          {field("nationalId", "clients.owners.profile.nationalId", "National ID / CR")}
          {field("taxNumber", "clients.owners.profile.taxNumber", "Tax number")}
          {field("payoutMethod", "clients.owners.profile.payoutMethod", "Payout method")}
          {field("bankName", "clients.owners.profile.bankName", "Bank name")}
          {field("bankAccountName", "clients.owners.profile.bankAccountName", "Account name")}
        </div>
        {field("bankIban", "clients.owners.profile.bankIban", "IBAN")}
        <div className="space-y-2">
          <Label htmlFor="notes">
            {t("clients.owners.profile.notes", { defaultValue: "Notes" })}
          </Label>
          <Textarea
            id="notes"
            rows={3}
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          {message && (
            <span className="text-sm text-muted-foreground">{message}</span>
          )}
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("common.saveChanges", { defaultValue: "Save changes" })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
