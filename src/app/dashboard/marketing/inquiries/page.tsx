"use client";

/**
 * PropertyPro - Marketing: listing inquiries
 *
 * What strangers wrote on the public pages — "is it still free?" — in a plain
 * inbox: new, contacted, closed; who has it; the office's notes. "Create
 * tenant" opens the new-tenant form with the person's name, phone and email
 * already filled in, so a viewing that turns into a contract does not mean
 * typing them again.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  CheckCircle2,
  Inbox,
  Mail,
  MessageCircle,
  MoreHorizontal,
  NotebookPen,
  Phone,
  PhoneCall,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import GlobalSearch from "@/components/ui/global-search";
import { GlobalPagination } from "@/components/ui/global-pagination";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { ReportExportButton } from "@/components/reports/export-button";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  describeFailure,
  listingTitleFor,
} from "@/components/listings/listing-ui";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { INQUIRY_STATUSES, type InquiryStatus } from "@/lib/listings/constants";
import { toWesternDigits } from "@/lib/listings/digits";
import type {
  InquiryDto,
  InquiryListSummary,
  StaffMemberDto,
} from "@/lib/listings/types";

const NONE = "__none__";

/** `https://wa.me/966501234567` from a stored +966… number. */
function whatsappLink(phone: string): string {
  return `https://wa.me/${toWesternDigits(phone).replace(/\D/g, "")}`;
}

export default function InquiriesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { t, language, formatDate, formatTime } = useLocalizationContext();
  const { hasAnyPermission } = useRolePermissions();
  const mayCreateTenant = hasAnyPermission(["tenant_create", "tenant_management"]);

  const listingId = params.get("listingId") ?? "";

  const [rows, setRows] = useState<InquiryDto[]>([]);
  const [summary, setSummary] = useState<InquiryListSummary | null>(null);
  const [staff, setStaff] = useState<StaffMemberDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [noting, setNoting] = useState<InquiryDto | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const queryParams = useCallback(() => {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (status !== "all") query.set("status", status);
    if (assignee !== "all") query.set("assignee", assignee);
    if (listingId) query.set("listingId", listingId);
    return query;
  }, [search, status, assignee, listingId]);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setLoadError(null);
      try {
        const query = queryParams();
        query.set("page", String(page));
        query.set("limit", String(limit));
        const response = await fetch(`/api/marketing/inquiries?${query}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          setLoadError(
            describeFailure(
              t,
              payload,
              t("marketing.inquiries.loadFailed", {
                defaultValue: "The inquiries could not be loaded",
              }),
            ),
          );
          return;
        }
        setRows(payload.data ?? []);
        setSummary(payload.summary ?? null);
        setTotalItems(payload.pagination?.total ?? 0);
      } catch {
        setLoadError(
          t("marketing.inquiries.loadFailed", {
            defaultValue: "The inquiries could not be loaded",
          }),
        );
      } finally {
        setLoading(false);
      }
    },
    [queryParams, page, limit, t],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/marketing/inquiries/assignees")
      .then((response) => response.json().catch(() => null))
      .then((payload) => {
        if (!cancelled && payload?.success) {
          setStaff(payload.data as StaffMemberDto[]);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = async (
    inquiry: InquiryDto,
    body: { status?: InquiryStatus; assigneeId?: string | null; notes?: string | null },
  ): Promise<boolean> => {
    try {
      const response = await fetch(`/api/marketing/inquiries/${inquiry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        toast.error(
          describeFailure(
            t,
            payload,
            t("marketing.inquiries.updateFailed", {
              defaultValue: "The inquiry could not be updated",
            }),
          ),
        );
        return false;
      }
      const updated = payload.data as InquiryDto;
      setRows((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      );
      // The counts above the table follow the change.
      void load(true);
      return true;
    } catch {
      toast.error(
        t("marketing.inquiries.updateFailed", {
          defaultValue: "The inquiry could not be updated",
        }),
      );
      return false;
    }
  };

  const tenantLink = (inquiry: InquiryDto) => {
    const listing = listingTitleFor(inquiry.listing, language);
    const note = t("marketing.inquiries.tenantNote", {
      defaultValue: "Inquiry about {listing} on {date}: {message}",
      values: {
        listing,
        date: formatDate(inquiry.createdAt),
        message: inquiry.message ?? "",
      },
    }).trim();
    const query = new URLSearchParams({
      fullName: inquiry.name,
      phone: inquiry.phone,
      notes: note,
    });
    if (inquiry.email) query.set("email", inquiry.email);
    return `/dashboard/tenants/new?${query}`;
  };

  const filtersActive =
    Boolean(search) || status !== "all" || assignee !== "all" || Boolean(listingId);
  const abilities = summary?.abilities;

  const columns: DataTableColumn<InquiryDto>[] = [
    {
      id: "received",
      header: t("marketing.inquiries.table.received", { defaultValue: "Received" }),
      cell: (row) => (
        <div className="flex flex-col text-sm">
          <span>{formatDate(row.createdAt)}</span>
          <span className="text-xs text-muted-foreground">
            {formatTime(row.createdAt)}
          </span>
        </div>
      ),
      width: "min-w-[110px]",
    },
    {
      id: "contact",
      header: t("marketing.inquiries.table.contact", { defaultValue: "Contact" }),
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{row.name}</span>
          <span className="flex items-center gap-2 text-xs" dir="ltr">
            <a
              href={`tel:${row.phone}`}
              className="inline-flex items-center gap-1 hover:underline"
            >
              <Phone className="h-3 w-3" />
              {row.phone}
            </a>
            <a
              href={whatsappLink(row.phone)}
              target="_blank"
              rel="noreferrer"
              className="text-success hover:underline"
              aria-label="WhatsApp"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </a>
          </span>
          {row.email && (
            <a
              href={`mailto:${row.email}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              dir="ltr"
            >
              <Mail className="h-3 w-3" />
              {row.email}
            </a>
          )}
        </div>
      ),
      width: "min-w-[190px]",
    },
    {
      id: "listing",
      header: t("marketing.inquiries.table.listing", { defaultValue: "Listing" }),
      cell: (row) => (
        <div className="flex flex-col">
          <Link
            href={`/dashboard/marketing/listings/${row.listing.id}/edit`}
            className="text-sm hover:text-blue-600 dark:hover:text-blue-400"
          >
            {listingTitleFor(row.listing, language)}
          </Link>
          <span className="text-xs text-muted-foreground">
            {[row.listing.propertyName, row.listing.unitNumber]
              .filter(Boolean)
              .join(" · ") || row.listing.place}
          </span>
        </div>
      ),
      visibility: "md",
      width: "min-w-[170px]",
    },
    {
      id: "message",
      header: t("marketing.inquiries.table.message", { defaultValue: "Message" }),
      cell: (row) => (
        <button
          type="button"
          onClick={() => {
            setNoting(row);
            setNoteDraft(row.notes ?? "");
          }}
          className="max-w-[260px] text-start"
        >
          <span
            className="line-clamp-2 text-sm text-muted-foreground"
            title={row.message ?? undefined}
          >
            {row.message ||
              t("marketing.inquiries.noMessage", { defaultValue: "(no message)" })}
          </span>
          {row.notes && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
              <NotebookPen className="h-3 w-3" />
              {t("marketing.inquiries.hasNotes", { defaultValue: "Has notes" })}
            </span>
          )}
        </button>
      ),
      visibility: "lg",
      width: "min-w-[220px]",
    },
    {
      id: "status",
      header: t("marketing.inquiries.table.status", { defaultValue: "Status" }),
      cell: (row) => (
        <Select
          value={row.status}
          onValueChange={(value) => patch(row, { status: value as InquiryStatus })}
        >
          <SelectTrigger className="h-8 w-36" aria-label={t("marketing.inquiries.table.status", { defaultValue: "Status" })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INQUIRY_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`marketing.inquiryStatus.${value}`, { defaultValue: value })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      width: "min-w-[150px]",
    },
    {
      id: "assignee",
      header: t("marketing.inquiries.table.assignee", { defaultValue: "Assigned to" }),
      cell: (row) => (
        <Select
          value={row.assigneeId ?? NONE}
          onValueChange={(value) =>
            patch(row, { assigneeId: value === NONE ? null : value })
          }
        >
          <SelectTrigger className="h-8 w-40" aria-label={t("marketing.inquiries.table.assignee", { defaultValue: "Assigned to" })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              {t("marketing.inquiries.unassigned", { defaultValue: "Unassigned" })}
            </SelectItem>
            {/* The current assignee may no longer be in the list (a leaver). */}
            {row.assignee && !staff.some((member) => member.id === row.assignee?.id) && (
              <SelectItem value={row.assignee.id}>{row.assignee.name}</SelectItem>
            )}
            {staff.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      visibility: "md",
      width: "min-w-[170px]",
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label={t("marketing.inquiries.actions.menu", {
                defaultValue: "Inquiry actions",
              })}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setNoting(row);
                setNoteDraft(row.notes ?? "");
              }}
            >
              <NotebookPen className="h-4 w-4" />
              {t("marketing.inquiries.actions.notes", { defaultValue: "Details and notes" })}
            </DropdownMenuItem>
            {row.status === "new" && (
              <DropdownMenuItem onClick={() => patch(row, { status: "contacted" })}>
                <PhoneCall className="h-4 w-4" />
                {t("marketing.inquiries.actions.markContacted", {
                  defaultValue: "Mark as contacted",
                })}
              </DropdownMenuItem>
            )}
            {row.status !== "closed" && (
              <DropdownMenuItem onClick={() => patch(row, { status: "closed" })}>
                <CheckCircle2 className="h-4 w-4" />
                {t("marketing.inquiries.actions.close", { defaultValue: "Close" })}
              </DropdownMenuItem>
            )}
            {row.status === "closed" && (
              <DropdownMenuItem onClick={() => patch(row, { status: "new" })}>
                <Inbox className="h-4 w-4" />
                {t("marketing.inquiries.actions.reopen", { defaultValue: "Reopen" })}
              </DropdownMenuItem>
            )}
            {row.assigneeId && (
              <DropdownMenuItem onClick={() => patch(row, { assigneeId: null })}>
                <UserX className="h-4 w-4" />
                {t("marketing.inquiries.actions.unassign", { defaultValue: "Unassign" })}
              </DropdownMenuItem>
            )}
            {mayCreateTenant && (
              <DropdownMenuItem onClick={() => router.push(tenantLink(row))}>
                <UserPlus className="h-4 w-4" />
                {t("marketing.inquiries.actions.createTenant", {
                  defaultValue: "Create tenant",
                })}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      width: "w-10",
      align: "center",
    },
  ];

  const saveNote = async () => {
    if (!noting) return;
    setSavingNote(true);
    const ok = await patch(noting, { notes: noteDraft });
    setSavingNote(false);
    if (ok) setNoting(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("marketing.inquiries.title", { defaultValue: "Listing inquiries" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("marketing.inquiries.subtitle", {
              defaultValue:
                "Messages from the public pages of your listings, for you to follow up",
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {abilities?.export && (
            <ReportExportButton
              endpoint="/api/marketing/inquiries"
              params={queryParams()}
              disabled={loading}
            />
          )}
          <Button size="sm" variant="outline" asChild>
            <Link href="/dashboard/marketing/listings">
              {t("marketing.inquiries.toListings", { defaultValue: "Listings" })}
            </Link>
          </Button>
        </div>
      </div>

      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("marketing.inquiries.stats.new", { defaultValue: "New" })}
          value={String(summary?.new ?? 0)}
          icon={Inbox}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("marketing.inquiries.stats.contacted", { defaultValue: "Contacted" })}
          value={String(summary?.contacted ?? 0)}
          icon={PhoneCall}
          iconColor="warning"
        />
        <AnalyticsCard
          title={t("marketing.inquiries.stats.closed", { defaultValue: "Closed" })}
          value={String(summary?.closed ?? 0)}
          icon={CheckCircle2}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("marketing.inquiries.stats.unassigned", {
            defaultValue: "Not taken yet",
          })}
          value={String(summary?.unassigned ?? 0)}
          icon={UserX}
          iconColor="primary"
        />
      </AnalyticsCardGrid>

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <GlobalSearch
                placeholder={t("marketing.inquiries.searchPlaceholder", {
                  defaultValue: "Search by name, phone, email or message…",
                })}
                initialValue={search}
                debounceDelay={300}
                onSearch={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                isLoading={loading}
                className="min-w-0 flex-1"
                inputClassName="h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                ariaLabel={t("marketing.inquiries.searchPlaceholder", {
                  defaultValue: "Search inquiries",
                })}
              />
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-10 w-44 bg-white dark:bg-gray-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("marketing.inquiries.filters.allStatuses", {
                      defaultValue: "All statuses",
                    })}
                  </SelectItem>
                  {INQUIRY_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`marketing.inquiryStatus.${value}`, { defaultValue: value })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={assignee}
                onValueChange={(value) => {
                  setAssignee(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-10 w-48 bg-white dark:bg-gray-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("marketing.inquiries.filters.anyone", {
                      defaultValue: "Anyone",
                    })}
                  </SelectItem>
                  <SelectItem value="me">
                    {t("marketing.inquiries.filters.mine", { defaultValue: "Assigned to me" })}
                  </SelectItem>
                  <SelectItem value="none">
                    {t("marketing.inquiries.unassigned", { defaultValue: "Unassigned" })}
                  </SelectItem>
                  {staff.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setStatus("all");
                    setAssignee("all");
                    setPage(1);
                    if (listingId) router.replace("/dashboard/marketing/inquiries");
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="me-1 h-4 w-4" />
                  {t("common.clear", { defaultValue: "Clear" })}
                </Button>
              )}
            </div>
            {listingId && (
              <div>
                <Badge variant="secondary" className="font-normal">
                  {t("marketing.inquiries.filters.oneListing", {
                    defaultValue: "Showing one listing's inquiries",
                  })}
                </Badge>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent>
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            error={
              loadError
                ? {
                    message: loadError,
                    onRetry: () => load(),
                    retryLabel: t("marketing.listings.retry", { defaultValue: "Try again" }),
                  }
                : null
            }
            getRowKey={(row) => row.id}
            emptyState={{
              icon: <Inbox className="h-12 w-12 text-muted-foreground" />,
              title: filtersActive
                ? t("marketing.inquiries.empty.filtered", {
                    defaultValue: "No inquiries match these filters",
                  })
                : t("marketing.inquiries.empty.title", { defaultValue: "No inquiries yet" }),
              description: filtersActive
                ? undefined
                : t("marketing.inquiries.empty.description", {
                    defaultValue:
                      "When someone writes from the public page of a listing, it appears here.",
                  }),
            }}
          />
          {!loading && totalItems > 0 && (
            <GlobalPagination
              currentPage={page}
              totalPages={Math.max(1, Math.ceil(totalItems / limit))}
              totalItems={totalItems}
              pageSize={limit}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setLimit(next);
                setPage(1);
              }}
              showingLabel={t("common.showing", { defaultValue: "Showing" })}
              previousLabel={t("common.previous", { defaultValue: "Previous" })}
              nextLabel={t("common.next", { defaultValue: "Next" })}
              pageLabel={t("common.page", { defaultValue: "Page" })}
              ofLabel={t("common.of", { defaultValue: "of" })}
              itemsPerPageLabel={t("common.perPage", { defaultValue: "per page" })}
              disabled={loading}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(noting)} onOpenChange={(open) => !open && setNoting(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{noting?.name}</DialogTitle>
            <DialogDescription>
              {noting ? listingTitleFor(noting.listing, language) : ""}
            </DialogDescription>
          </DialogHeader>
          {noting && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                <p className="mb-1 text-xs text-muted-foreground">
                  {formatDate(noting.createdAt)} · {formatTime(noting.createdAt)}
                </p>
                <p className="whitespace-pre-line">
                  {noting.message ||
                    t("marketing.inquiries.noMessage", { defaultValue: "(no message)" })}
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="inquiry-notes" className="text-sm font-medium">
                  {t("marketing.inquiries.notes", { defaultValue: "Notes" })}
                </label>
                <Textarea
                  id="inquiry-notes"
                  rows={5}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  maxLength={2000}
                  placeholder={t("marketing.inquiries.notesPlaceholder", {
                    defaultValue: "What was said, when to call back…",
                  })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoting(null)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button onClick={saveNote} disabled={savingNote}>
              {t("common.save", { defaultValue: "Save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
