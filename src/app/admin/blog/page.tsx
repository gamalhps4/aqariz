"use client";

/**
 * PropertyPro - Platform blog console
 *
 * Every post on the marketing site's blog, drafts included, in the same
 * table, search, filter and pagination the rest of the console and the
 * tenant dashboard use (`DataTableCard`). Sorting is the server's: the list
 * is paged there, and a header that only reordered the page on screen would
 * misrepresent the rest.
 *
 * A post is listed by its English title, else its Arabic one, with a badge
 * per language saying whether that language is on the site yet.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ExternalLink, Newspaper, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { type DataTableColumn } from "@/components/ui/data-table";
import { DataTableCard } from "@/components/ui/data-table-card";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import type { SortDirection } from "@/lib/table-sort";
import type { BlogListRow, BlogListSortKey } from "@/lib/blog/admin-list";
import { displayTitle } from "@/lib/blog/languages";
import { blogPostPath } from "@/lib/blog/paths";
import { LanguageBadges } from "./_components/language-badges";

type Row = Omit<BlogListRow, "publishedAt" | "updatedAt"> & {
  publishedAt: string | null;
  updatedAt: string;
};

const PAGE_SIZES = [10, 25, 50];

export default function PlatformBlogPage() {
  const { t, formatDate } = useLocalizationContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ key: string | null; direction: SortDirection }>({
    key: null,
    direction: "desc",
  });
  const [deleting, setDeleting] = useState<string | null>(null);
  // Bumped to read the list again (refresh, after a delete).
  const [reload, setReload] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status !== "all") params.set("status", status);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (sort.key) {
      params.set("sort", sort.key);
      params.set("direction", sort.direction);
    }
    return params.toString();
  }, [search, status, page, pageSize, sort]);

  // Loading is derived, not set: the table is loading whenever what it shows
  // was read for a different request than the one now wanted. Nothing has to
  // remember to raise or lower a flag, and the effect below only reads.
  const requestKey = `${query}#${reload}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/admin/blog?${query}`);
        const payload = await response.json();
        if (!active) return;
        if (!response.ok || !payload.success) {
          setError(
            payload?.error ||
              t("platform.blog.loadError", { defaultValue: "Could not load the blog posts." }),
          );
        } else {
          setRows(payload.data.posts ?? []);
          setTotal(payload.data.total ?? 0);
          setError(null);
        }
      } catch {
        if (active) {
          setError(t("platform.blog.loadError", { defaultValue: "Could not load the blog posts." }));
        }
      } finally {
        if (active) setLoadedKey(requestKey);
      }
    })();
    return () => {
      active = false;
    };
  }, [query, requestKey, t]);

  const refresh = () => setReload((value) => value + 1);

  const remove = async (row: Row) => {
    setDeleting(row.id);
    try {
      const response = await fetch(`/api/admin/blog/${row.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload?.error || "Request failed");
      toast.success(t("platform.blog.deleted", { defaultValue: "Post deleted" }));
      refresh();
    } catch {
      toast.error(t("platform.blog.deleteError", { defaultValue: "Could not delete the post." }));
    } finally {
      setDeleting(null);
    }
  };

  const statusBadge = (value: Row["status"]) =>
    value === "published" ? (
      <Badge variant="success">{t("platform.blog.status.published", { defaultValue: "Published" })}</Badge>
    ) : (
      <Badge variant="secondary">{t("platform.blog.status.draft", { defaultValue: "Draft" })}</Badge>
    );

  const columns: DataTableColumn<Row>[] = [
    {
      id: "title",
      sortKey: "title" satisfies BlogListSortKey,
      header: t("platform.blog.col.title", { defaultValue: "Title" }),
      cell: (row) => {
        const { title, lang } = displayTitle(row);
        return (
          <div className="flex min-w-0 flex-col gap-1.5">
            <Link
              href={`/admin/blog/${row.id}`}
              className="line-clamp-2 text-sm font-medium hover:underline"
              dir={lang === "ar" ? "rtl" : "ltr"}
              lang={lang}
            >
              {title || t("platform.blog.untitled", { defaultValue: "Untitled" })}
            </Link>
            <div className="flex flex-wrap items-center gap-1.5">
              <LanguageBadges languages={row.languages} />
              <span className="truncate text-xs text-muted-foreground" dir="ltr">
                /blog/{row.slug}
              </span>
            </div>
          </div>
        );
      },
      width: "min-w-[280px]",
    },
    {
      id: "status",
      sortKey: "status" satisfies BlogListSortKey,
      header: t("platform.blog.col.status", { defaultValue: "Status" }),
      cell: (row) => statusBadge(row.status),
      width: "min-w-[110px]",
    },
    {
      id: "published",
      sortKey: "published" satisfies BlogListSortKey,
      header: t("platform.blog.col.published", { defaultValue: "Published" }),
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.publishedAt ? formatDate(row.publishedAt) : "—"}
        </span>
      ),
      width: "min-w-[120px]",
      visibility: "md",
    },
    {
      id: "updated",
      sortKey: "updated" satisfies BlogListSortKey,
      header: t("platform.blog.col.updated", { defaultValue: "Updated" }),
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.updatedAt)}</span>
      ),
      width: "min-w-[120px]",
      visibility: "sm",
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("platform.blog.col.actions", { defaultValue: "Actions" })}</span>,
      cell: (row) => {
        const name = displayTitle(row).title || row.slug;
        // The first language the post can be read in, for "view on site".
        const liveLang =
          row.status === "published"
            ? row.languages.en === "complete"
              ? "en"
              : row.languages.ar === "complete"
                ? "ar"
                : null
            : null;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button asChild variant="ghost" size="icon" className="h-8 w-8">
              <Link
                href={`/admin/blog/${row.id}`}
                aria-label={t("platform.blog.edit", { defaultValue: "Edit" })}
                title={t("platform.blog.edit", { defaultValue: "Edit" })}
              >
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
            {liveLang && (
              <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                <a
                  href={blogPostPath(row.slug, liveLang)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("platform.blog.viewOnSite", { defaultValue: "View on site" })}
                  title={t("platform.blog.viewOnSite", { defaultValue: "View on site" })}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
            <DeleteConfirmationDialog
              itemName={name}
              description={t("platform.blog.deleteDescription", {
                defaultValue: "The post is removed from the site in both languages. This cannot be undone.",
              })}
              onConfirm={() => remove(row)}
              loading={deleting === row.id}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                aria-label={t("platform.blog.delete", { defaultValue: "Delete" })}
                title={t("platform.blog.delete", { defaultValue: "Delete" })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </DeleteConfirmationDialog>
          </div>
        );
      },
      align: "right",
      width: "w-[132px]",
    },
  ];

  const filtersActive = status !== "all" || Boolean(search);

  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t("platform.nav.blog", { defaultValue: "Blog" })}</h1>
            <p className="text-sm text-muted-foreground">
              {t("platform.blog.subtitle", {
                defaultValue: "Articles on the marketing site, in English at /blog and Arabic at /ar/blog.",
              })}
            </p>
          </div>
          <Button asChild>
            <Link href="/admin/blog/new">
              <Plus className="me-2 h-4 w-4" />
              {t("platform.blog.newPost", { defaultValue: "New post" })}
            </Link>
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DataTableCard
          icon={Newspaper}
          title={t("platform.blog.card.title", { defaultValue: "All posts" })}
          description={t("platform.blog.card.description", {
            defaultValue: "Click a title to edit it. Drafts are visible only here.",
          })}
          columns={columns}
          data={rows}
          loading={loading}
          getRowKey={(row) => row.id}
          headerActions={
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              aria-label={t("platform.blog.refresh", { defaultValue: "Refresh" })}
            >
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          }
          search={{
            value: search,
            onSearch: (value) => {
              setSearch(value);
              setPage(1);
            },
            placeholder: t("platform.blog.searchPlaceholder", {
              defaultValue: "Search titles, slugs, tags and authors…",
            }),
          }}
          filters={[
            {
              id: "status",
              value: status,
              onChange: (value) => {
                setStatus(value);
                setPage(1);
              },
              ariaLabel: t("platform.blog.filter.status", { defaultValue: "Filter by status" }),
              options: [
                { value: "all", label: t("platform.blog.filter.allStatuses", { defaultValue: "All statuses" }) },
                { value: "published", label: t("platform.blog.status.published", { defaultValue: "Published" }) },
                { value: "draft", label: t("platform.blog.status.draft", { defaultValue: "Draft" }) },
              ],
            },
          ]}
          filtersActive={filtersActive}
          onResetFilters={() => {
            setStatus("all");
            setSearch("");
            setPage(1);
          }}
          sort={{
            key: sort.key,
            direction: sort.direction,
            onSortChange: (key, direction) => {
              setSort({ key, direction });
              setPage(1);
            },
          }}
          pagination={{
            currentPage: page,
            pageSize,
            totalItems: total,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
            pageSizeOptions: PAGE_SIZES,
          }}
          emptyState={{
            icon: <Newspaper className="h-10 w-10 text-muted-foreground" />,
            title: filtersActive
              ? t("platform.blog.empty.filtered", { defaultValue: "No posts match these filters" })
              : t("platform.blog.empty.none", { defaultValue: "No posts yet" }),
            description: filtersActive
              ? undefined
              : t("platform.blog.empty.hint", {
                  defaultValue: "Write the first article; it stays a draft until you publish it.",
                }),
            action: filtersActive ? undefined : (
              <Button asChild size="sm">
                <Link href="/admin/blog/new">
                  <Plus className="me-2 h-4 w-4" />
                  {t("platform.blog.newPost", { defaultValue: "New post" })}
                </Link>
              </Button>
            ),
          }}
        />
      </div>
    </ResponsiveLayout>
  );
}
