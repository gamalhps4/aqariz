"use client";

/**
 * PropertyPro - Marketing: property listings
 *
 * The office's advertisements for vacant units — a draft while it is being
 * written, published when it is on the public page, archived when it is
 * done — with the REGA advertising licence each one needs before it can go
 * public. A published listing that is not actually showing (its licence ran
 * out, or its unit has been let) says so in its row. One for a property not
 * in the system has no building or unit to be named by, so its row says so
 * and gives its address, or its district and city.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  AlertTriangle,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Inbox,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  LicenceBadge,
  ListingStatusBadges,
  describeFailure,
  listingTitleFor,
  usePriceText,
} from "@/components/listings/listing-ui";
import { OfficeSettingsDialog } from "@/components/listings/OfficeSettingsDialog";
import type { ListingAction } from "@/lib/listings/schemas";
import type { ListingDto, ListingListSummary } from "@/lib/listings/types";

const DEFAULT_STATUS = "active";

interface BlockedPublish {
  listing: ListingDto;
  problems: string[];
}

export default function ListingsPage() {
  const router = useRouter();
  const { t, language, formatDate } = useLocalizationContext();
  const priceText = usePriceText();

  const [listings, setListings] = useState<ListingDto[]>([]);
  const [summary, setSummary] = useState<ListingListSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(12);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [type, setType] = useState("all");
  const [attention, setAttention] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    listing: ListingDto;
    action: "archive" | "unpublish";
  } | null>(null);
  const [blocked, setBlocked] = useState<BlockedPublish | null>(null);
  const [officeOpen, setOfficeOpen] = useState(false);

  const abilities = summary?.abilities;

  const queryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status && status !== "all") params.set("status", status);
    if (type !== "all") params.set("type", type);
    if (attention) params.set("attention", "1");
    return params;
  }, [search, status, type, attention]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = queryParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      const response = await fetch(`/api/marketing/listings?${params}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        setLoadError(
          describeFailure(
            t,
            payload,
            t("marketing.listings.loadFailed", {
              defaultValue: "The listings could not be loaded",
            }),
          ),
        );
        return;
      }
      setListings(payload.data ?? []);
      setSummary(payload.summary ?? null);
      setTotalItems(payload.pagination?.total ?? 0);
    } catch {
      setLoadError(
        t("marketing.listings.loadFailed", {
          defaultValue: "The listings could not be loaded",
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [queryParams, page, limit, t]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (listing: ListingDto, action: ListingAction) => {
    setBusyId(listing.id);
    try {
      const response = await fetch(`/api/marketing/listings/${listing.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        if (payload?.code === "listing_not_publishable") {
          setBlocked({ listing, problems: payload.problems ?? [] });
        } else {
          toast.error(
            describeFailure(
              t,
              payload,
              t("marketing.listings.actionFailed", {
                defaultValue: "The change could not be made",
              }),
            ),
          );
        }
        return;
      }
      toast.success(
        t(`marketing.listings.done.${action}`, { defaultValue: "Done" }),
      );
      await load();
    } catch {
      toast.error(
        t("marketing.listings.actionFailed", {
          defaultValue: "The change could not be made",
        }),
      );
    } finally {
      setBusyId(null);
    }
  };

  const copyLink = async (listing: ListingDto) => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${listing.publicPath}`,
      );
      toast.success(
        t("marketing.listings.linkCopied", { defaultValue: "Link copied" }),
      );
    } catch {
      toast.error(
        t("marketing.listings.linkCopyFailed", {
          defaultValue: "The link could not be copied",
        }),
      );
    }
  };

  const filtersActive =
    Boolean(search) || status !== DEFAULT_STATUS || type !== "all" || attention;

  const columns: DataTableColumn<ListingDto>[] = [
    {
      id: "listing",
      header: t("marketing.listings.table.listing", { defaultValue: "Listing" }),
      cell: (row) => (
        <div className="flex flex-col">
          <Link
            href={`/dashboard/marketing/listings/${row.id}/edit`}
            className="text-sm font-medium text-foreground transition-colors hover:text-blue-600 dark:hover:text-blue-400"
          >
            {listingTitleFor(row, language)}
          </Link>
          <span className="text-xs text-muted-foreground">
            {row.property && row.unit
              ? `${row.property.name} · ${row.unit.unitNumber}`
              : [
                  t("marketing.listings.standalone", {
                    defaultValue: "Not in the system",
                  }),
                  row.addressLine ||
                    [row.district, row.city].filter(Boolean).join(" · "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </span>
          <span className="text-xs text-muted-foreground" dir="ltr">
            {row.slug}
          </span>
        </div>
      ),
      width: "min-w-[220px]",
    },
    {
      id: "price",
      header: t("marketing.listings.table.price", { defaultValue: "Offer" }),
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <Badge variant="outline" className="w-fit font-normal">
            {t(`marketing.type.${row.type}`, { defaultValue: row.type })}
          </Badge>
          <span className="text-sm font-medium">{priceText(row)}</span>
        </div>
      ),
      width: "min-w-[160px]",
    },
    {
      id: "location",
      header: t("marketing.listings.table.location", { defaultValue: "Location" }),
      cell: (row) => (
        <span className="text-sm">
          {[row.district, row.city].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
      visibility: "lg",
      width: "min-w-[130px]",
    },
    {
      id: "licence",
      header: t("marketing.listings.table.licence", {
        defaultValue: "Advertising licence",
      }),
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <span className="text-sm" dir="ltr">
            {row.adLicenceNumber ?? "—"}
          </span>
          {row.adLicenceExpiry && (
            <span className="text-xs text-muted-foreground">
              {formatDate(row.adLicenceExpiry)}
            </span>
          )}
          <LicenceBadge licence={row.licence} />
        </div>
      ),
      visibility: "md",
      width: "min-w-[170px]",
    },
    {
      id: "status",
      header: t("marketing.listings.table.status", { defaultValue: "Status" }),
      cell: (row) => <ListingStatusBadges listing={row} />,
      width: "min-w-[150px]",
    },
    {
      id: "inquiries",
      header: t("marketing.listings.table.inquiries", { defaultValue: "Inquiries" }),
      cell: (row) =>
        row.inquiries.total === 0 ? (
          <span className="text-sm text-muted-foreground">0</span>
        ) : (
          <Link
            href={`/dashboard/marketing/inquiries?listingId=${row.id}`}
            className="inline-flex items-center gap-1.5 text-sm hover:underline"
          >
            {row.inquiries.total}
            {row.inquiries.new > 0 && (
              <Badge variant="info" className="px-1.5 py-0">
                {t("marketing.listings.newCount", {
                  defaultValue: "{count} new",
                  values: { count: row.inquiries.new },
                })}
              </Badge>
            )}
          </Link>
        ),
      visibility: "md",
      width: "min-w-[110px]",
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
              disabled={busyId === row.id}
              aria-label={t("marketing.listings.actions.menu", {
                defaultValue: "Listing actions",
              })}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.status === "published" && (
              <DropdownMenuItem asChild>
                <a href={row.publicPath} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  {t("marketing.listings.actions.viewPublic", {
                    defaultValue: "View public page",
                  })}
                </a>
              </DropdownMenuItem>
            )}
            {row.status === "published" && (
              <DropdownMenuItem onClick={() => copyLink(row)}>
                <Copy className="h-4 w-4" />
                {t("marketing.listings.actions.copyLink", {
                  defaultValue: "Copy link",
                })}
              </DropdownMenuItem>
            )}
            {abilities?.edit && row.status !== "archived" && (
              <DropdownMenuItem
                onClick={() =>
                  router.push(`/dashboard/marketing/listings/${row.id}/edit`)
                }
              >
                <Pencil className="h-4 w-4" />
                {t("common.edit", { defaultValue: "Edit" })}
              </DropdownMenuItem>
            )}
            {!abilities?.edit && (
              <DropdownMenuItem
                onClick={() =>
                  router.push(`/dashboard/marketing/listings/${row.id}/edit`)
                }
              >
                <Eye className="h-4 w-4" />
                {t("common.view", { defaultValue: "View" })}
              </DropdownMenuItem>
            )}
            {abilities?.publish && row.status === "draft" && (
              <DropdownMenuItem onClick={() => runAction(row, "publish")}>
                <Send className="h-4 w-4" />
                {t("marketing.listings.actions.publish", { defaultValue: "Publish" })}
              </DropdownMenuItem>
            )}
            {abilities?.publish && row.status === "published" && (
              <DropdownMenuItem
                onClick={() => setConfirming({ listing: row, action: "unpublish" })}
              >
                <EyeOff className="h-4 w-4" />
                {t("marketing.listings.actions.unpublish", {
                  defaultValue: "Take off the public page",
                })}
              </DropdownMenuItem>
            )}
            {abilities?.edit && row.status === "archived" && (
              <DropdownMenuItem onClick={() => runAction(row, "restore")}>
                <ArchiveRestore className="h-4 w-4" />
                {t("marketing.listings.actions.restore", { defaultValue: "Restore" })}
              </DropdownMenuItem>
            )}
            {abilities?.archive && row.status !== "archived" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setConfirming({ listing: row, action: "archive" })}
                  className="text-destructive"
                >
                  <Archive className="h-4 w-4" />
                  {t("marketing.listings.actions.archive", { defaultValue: "Archive" })}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      width: "w-10",
      align: "center",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("marketing.listings.title", { defaultValue: "Property listings" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("marketing.listings.subtitle", {
              defaultValue:
                "Advertise vacant units on your public page, with the advertising licence each one needs",
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {abilities?.export && (
            <ReportExportButton
              endpoint="/api/marketing/listings"
              params={queryParams()}
              disabled={loading}
            />
          )}
          <Button size="sm" variant="outline" onClick={() => setOfficeOpen(true)}>
            <Settings2 className="h-4 w-4" />
            {t("marketing.listings.officeDetails", { defaultValue: "Office details" })}
          </Button>
          {summary?.officePath && (
            <Button size="sm" variant="outline" asChild>
              <a href={summary.officePath} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                {t("marketing.listings.viewOfficePage", {
                  defaultValue: "Public page",
                })}
              </a>
            </Button>
          )}
          {abilities?.create && (
            <Button
              size="sm"
              onClick={() => router.push("/dashboard/marketing/listings/new")}
            >
              <Plus className="h-4 w-4" />
              {t("marketing.listings.add", { defaultValue: "New listing" })}
            </Button>
          )}
        </div>
      </div>

      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("marketing.listings.stats.published", { defaultValue: "Published" })}
          value={String(summary?.published ?? 0)}
          icon={Megaphone}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("marketing.listings.stats.drafts", { defaultValue: "Drafts" })}
          value={String(summary?.draft ?? 0)}
          icon={Pencil}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("marketing.listings.stats.attention", {
            defaultValue: "Not showing",
          })}
          value={String(summary?.attention ?? 0)}
          description={t("marketing.listings.stats.attentionHint", {
            defaultValue: "Published, but the licence or the unit stops it",
          })}
          icon={AlertTriangle}
          iconColor="warning"
        />
        <AnalyticsCard
          title={t("marketing.listings.stats.newInquiries", {
            defaultValue: "New inquiries",
          })}
          value={String(summary?.newInquiries ?? 0)}
          icon={Inbox}
          iconColor="primary"
          href={abilities?.inquiries ? "/dashboard/marketing/inquiries" : undefined}
        />
      </AnalyticsCardGrid>

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <GlobalSearch
                placeholder={t("marketing.listings.searchPlaceholder", {
                  defaultValue: "Search by title, unit, building, district or licence…",
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
                ariaLabel={t("marketing.listings.searchPlaceholder", {
                  defaultValue: "Search listings",
                })}
              />
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-10 w-48 bg-white dark:bg-gray-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">
                    {t("marketing.listings.filters.active", {
                      defaultValue: "Drafts and published",
                    })}
                  </SelectItem>
                  <SelectItem value="published">
                    {t("marketing.status.published", { defaultValue: "Published" })}
                  </SelectItem>
                  <SelectItem value="draft">
                    {t("marketing.status.draft", { defaultValue: "Draft" })}
                  </SelectItem>
                  <SelectItem value="archived">
                    {t("marketing.status.archived", { defaultValue: "Archived" })}
                  </SelectItem>
                  <SelectItem value="all">
                    {t("marketing.listings.filters.allStatuses", {
                      defaultValue: "All statuses",
                    })}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={type}
                onValueChange={(value) => {
                  setType(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-10 w-40 bg-white dark:bg-gray-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("marketing.listings.filters.allTypes", {
                      defaultValue: "Rent and sale",
                    })}
                  </SelectItem>
                  <SelectItem value="rent">
                    {t("marketing.type.rent", { defaultValue: "For rent" })}
                  </SelectItem>
                  <SelectItem value="sale">
                    {t("marketing.type.sale", { defaultValue: "For sale" })}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant={attention ? "default" : "outline"}
                size="sm"
                className="h-10"
                onClick={() => {
                  setAttention((current) => !current);
                  setPage(1);
                }}
                aria-pressed={attention}
              >
                <AlertTriangle className="h-4 w-4" />
                {t("marketing.listings.filters.attention", {
                  defaultValue: "Not showing",
                })}
              </Button>
              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setStatus(DEFAULT_STATUS);
                    setType("all");
                    setAttention(false);
                    setPage(1);
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="me-1 h-4 w-4" />
                  {t("common.clear", { defaultValue: "Clear" })}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <DataTable
            columns={columns}
            data={listings}
            loading={loading}
            error={
              loadError
                ? {
                    message: loadError,
                    onRetry: load,
                    retryLabel: t("marketing.listings.retry", {
                      defaultValue: "Try again",
                    }),
                  }
                : null
            }
            getRowKey={(row) => row.id}
            emptyState={{
              icon: <Megaphone className="h-12 w-12 text-muted-foreground" />,
              title: filtersActive
                ? t("marketing.listings.empty.filtered", {
                    defaultValue: "No listings match these filters",
                  })
                : t("marketing.listings.empty.title", {
                    defaultValue: "No listings yet",
                  }),
              description: filtersActive
                ? undefined
                : t("marketing.listings.empty.description", {
                    defaultValue:
                      "Start one from a vacant unit. It goes on your public page once it carries a valid advertising licence.",
                  }),
              action:
                abilities?.create && !filtersActive ? (
                  <Button
                    size="sm"
                    onClick={() => router.push("/dashboard/marketing/listings/new")}
                  >
                    <Plus className="me-2 h-4 w-4" />
                    {t("marketing.listings.add", { defaultValue: "New listing" })}
                  </Button>
                ) : undefined,
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

      <AlertDialog
        open={Boolean(confirming)}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.action === "archive"
                ? t("marketing.listings.confirm.archiveTitle", {
                    defaultValue: "Archive this listing?",
                  })
                : t("marketing.listings.confirm.unpublishTitle", {
                    defaultValue: "Take this listing off the public page?",
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.action === "archive"
                ? t("marketing.listings.confirm.archiveText", {
                    defaultValue:
                      "It disappears from the public page and from the working list. Its inquiries are kept, and you can restore it later.",
                  })
                : t("marketing.listings.confirm.unpublishText", {
                    defaultValue:
                      "It goes back to a draft. Anyone with the link will no longer see it, and you can publish it again.",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) runAction(confirming.listing, confirming.action);
                setConfirming(null);
              }}
            >
              {confirming?.action === "archive"
                ? t("marketing.listings.actions.archive", { defaultValue: "Archive" })
                : t("marketing.listings.actions.unpublish", {
                    defaultValue: "Take off the public page",
                  })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(blocked)} onOpenChange={(open) => !open && setBlocked(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("marketing.listings.blocked.title", {
                defaultValue: "This listing cannot be published yet",
              })}
            </DialogTitle>
            <DialogDescription>
              {blocked ? listingTitleFor(blocked.listing, language) : ""}
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {blocked?.problems.map((problem) => (
              <li key={problem}>
                {t(`marketing.problem.${problem}`, { defaultValue: problem })}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlocked(null)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            {blocked && abilities?.edit && (
              <Button
                onClick={() =>
                  router.push(`/dashboard/marketing/listings/${blocked.listing.id}/edit`)
                }
              >
                <Pencil className="h-4 w-4" />
                {t("marketing.listings.blocked.edit", { defaultValue: "Edit the listing" })}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OfficeSettingsDialog
        open={officeOpen}
        onOpenChange={setOfficeOpen}
        canEdit={Boolean(abilities?.settings)}
      />
    </div>
  );
}
