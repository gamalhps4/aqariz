"use client";

import Link from "next/link";
import { ReportExportButton } from "@/components/reports/export-button";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, Ban, CheckCircle2, Eye, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type DataTableColumn } from "@/components/ui/data-table";
import { DataTableCard } from "@/components/ui/data-table-card";
import { parseSortValue } from "@/lib/server-sort";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { roleDisplayName } from "@/lib/role-display";

interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: string;
  /** The group's names beside its stored key; null for a built-in role. */
  roleLabel?: string | null;
  roleLabelAr?: string | null;
  isActive: boolean;
  emailVerified: boolean;
  lastLogin: string | null;
  createdAt: string;
  organization: { id: string; name: string; slug: string } | null;
}

const DEFAULT_FILTERS = {
  query: "",
  role: "all",
  status: "all",
  sort: "createdAt-desc",
  page: 1,
  pageSize: 20,
};

export default function PlatformUsersPage() {
  const { t, formatDate, language } = useLocalizationContext();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const query = useMemo(
    () =>
      new URLSearchParams({
        page: String(filters.page),
        pageSize: String(filters.pageSize),
        query: filters.query,
        role: filters.role,
        status: filters.status,
        sort: filters.sort,
      }).toString(),
    [filters],
  );

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/users?${query}`)
      .then((response) =>
        response.json().then((payload) => ({ response, payload })),
      )
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load users");
        }
        setUsers(payload.data.users);
        setTotal(payload.data.pagination.total);
        setError("");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("platform.users.loadError", { defaultValue: "Unable to load users" }),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query]);

  /** Any filter change invalidates the page number. */
  const setFilter = useCallback((patch: Partial<typeof DEFAULT_FILTERS>) => {
    setLoading(true);
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  }, []);

  const setPage = useCallback((page: number) => {
    setLoading(true);
    setFilters((current) => ({ ...current, page }));
  }, []);

  const filtersActive =
    filters.query.trim().length > 0 ||
    filters.role !== "all" ||
    filters.status !== "all" ||
    filters.sort !== DEFAULT_FILTERS.sort;

  async function setAccess(user: PlatformUser, isActive: boolean) {
    setBusyId(user.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to update access");
      }
      setUsers((current) =>
        current.map((item) =>
          item.id === user.id ? { ...item, isActive } : item,
        ),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t("platform.users.updateError", { defaultValue: "Unable to update access" }),
      );
    } finally {
      setBusyId(null);
    }
  }

  /** Open the customer's dashboard as them. The grant is read-only and
   * expires on its own; the banner in the dashboard is the way back. */
  async function impersonate(user: PlatformUser) {
    setBusyId(user.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${user.id}/impersonate`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to start support view");
      }
      // Hard navigation: every server component must re-render as the target.
      window.location.assign("/dashboard");
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t("platform.users.impersonateError", { defaultValue: "Unable to start support view" }),
      );
      setBusyId(null);
    }
  }

  const columns: DataTableColumn<PlatformUser>[] = useMemo(
    () => [
      {
        id: "user",
        header: t("platform.users.col.user", { defaultValue: "User" }),
        sortKey: "name",
        cell: (user) => (
          <div>
            <p className="font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        ),
      },
      {
        id: "organization",
        header: t("platform.users.col.organization", { defaultValue: "Organization" }),
        cell: (user) =>
          user.organization ? (
            <Link
              href={`/admin/organizations/${user.organization.id}`}
              className="hover:underline"
            >
              <p>{user.organization.name}</p>
              <p className="text-xs text-muted-foreground">
                /{user.organization.slug}
              </p>
            </Link>
          ) : (
            "—"
          ),
      },
      {
        id: "role",
        header: t("platform.users.col.role", { defaultValue: "Role" }),
        visibility: "md",
        // A group by its name — the key it is stored under ("group_2")
        // says nothing — and a built-in role by the catalogue's wording.
        cell: (user) => (
          <Badge variant="outline">
            {roleDisplayName(user.role, {
              group: user.roleLabel
                ? { label: user.roleLabel, labelAr: user.roleLabelAr }
                : null,
              language,
              t,
            })}
          </Badge>
        ),
      },
      {
        id: "status",
        header: t("platform.users.col.status", { defaultValue: "Status" }),
        cell: (user) => (
          <Badge variant={user.isActive ? "default" : "destructive"}>
            {user.isActive ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      {
        id: "lastLogin",
        header: t("platform.users.col.lastLogin", { defaultValue: "Last login" }),
        visibility: "lg",
        cell: (user) => (
          <span className="text-sm text-muted-foreground">
            {user.lastLogin
              ? formatDate(user.lastLogin, { format: "medium" })
              : t("platform.common.never", { defaultValue: "Never" })}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("platform.users.col.actions", { defaultValue: "Actions" }),
        align: "right",
        cell: (user) => (
          <div className="flex items-center justify-end gap-1.5">
            {/* What this person did: their organization's log for a
                customer, the console's own for an operator. */}
            <Button asChild size="sm" variant="ghost">
              <Link
                href={
                  user.organization
                    ? `/admin/activity?organizationId=${user.organization.id}&userId=${user.id}`
                    : `/admin/activity?tab=console&actorId=${user.id}`
                }
                title={t("platform.users.action.activity", { defaultValue: "Activity" })}
              >
                <Activity className="me-2 h-3.5 w-3.5" />
                {t("platform.users.action.activity", { defaultValue: "Activity" })}
              </Link>
            </Button>
            {/* Only customers have a workspace to view, and only while active. */}
            {user.organization &&
              user.isActive &&
              user.role !== "super_admin" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === user.id}
                  onClick={() => void impersonate(user)}
                  title={`View the app as ${user.email} (read-only)`}
                >
                  <Eye className="me-2 h-3.5 w-3.5" />
                  {t("platform.users.action.viewAs", { defaultValue: "View as" })}
                </Button>
              )}
            <Button
              size="sm"
              variant="outline"
              disabled={busyId === user.id}
              className={
                user.isActive ? "text-destructive hover:text-destructive" : ""
              }
              onClick={() => void setAccess(user, !user.isActive)}
            >
              {user.isActive ? (
                <>
                  <Ban className="me-2 h-3.5 w-3.5" />
                  {t("platform.users.action.deactivate", { defaultValue: "Deactivate" })}
                </>
              ) : (
                <>
                  <CheckCircle2 className="me-2 h-3.5 w-3.5" />
                  {t("platform.users.action.activate", { defaultValue: "Activate" })}
                </>
              )}
            </Button>
          </div>
        ),
      },
    ],
    [busyId, formatDate, language, t],
  );

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("platform.users.title", { defaultValue: "Platform users" })}</h1>
          <p className="text-muted-foreground">
            {t("platform.users.subtitle", { defaultValue: "Review and control user access across organizations." })}
          </p>
        </div>
        {/* Exports the filtered set, not the page on screen. */}
        <ReportExportButton
          endpoint="/api/admin/users"
          params={new URLSearchParams(query)}
          disabled={loading}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTableCard<PlatformUser>
        icon={Users}
        title={t("platform.users.card.title", { defaultValue: "Users" })}
        description={t("platform.users.card.description", { defaultValue: "Every member of every organization on the platform." })}
        headerActions={
          <Badge variant="secondary" className="w-fit tabular-nums">
            {loading ? "Loading…" : `${total} total`}
          </Badge>
        }
        search={{
          value: filters.query,
          onSearch: (value) => setFilter({ query: value }),
          placeholder: t("platform.users.searchPlaceholder", { defaultValue: "Search name or email…" }),
          ariaLabel: t("platform.users.searchLabel", { defaultValue: "Search users" }),
        }}
        filters={[
          {
            id: "role",
            value: filters.role,
            onChange: (value) => setFilter({ role: value }),
            ariaLabel: t("platform.users.filter.role", { defaultValue: "Filter by role" }),
            options: [
              { value: "all", label: t("platform.users.filter.allRoles", { defaultValue: "All roles" }) },
              { value: "admin", label: t("platform.users.filter.admins", { defaultValue: "Admins" }) },
              { value: "manager", label: t("platform.users.filter.managers", { defaultValue: "Managers" }) },
              { value: "tenant", label: t("platform.users.filter.tenants", { defaultValue: "Tenants" }) },
            ],
          },
          {
            id: "status",
            value: filters.status,
            onChange: (value) => setFilter({ status: value }),
            ariaLabel: t("platform.users.filter.status", { defaultValue: "Filter by status" }),
            options: [
              { value: "all", label: t("platform.users.filter.allStatuses", { defaultValue: "All statuses" }) },
              { value: "active", label: t("platform.common.active", { defaultValue: "Active" }) },
              { value: "inactive", label: t("platform.common.inactive", { defaultValue: "Inactive" }) },
            ],
          },
          {
            id: "sort",
            value: filters.sort,
            onChange: (value) => setFilter({ sort: value }),
            ariaLabel: t("platform.users.filter.sort", { defaultValue: "Sort users" }),
            width: "w-[160px]",
            options: [
              { value: "createdAt-desc", label: t("platform.common.newestFirst", { defaultValue: "Newest first" }) },
              { value: "createdAt-asc", label: t("platform.common.oldestFirst", { defaultValue: "Oldest first" }) },
              { value: "lastLogin-desc", label: t("platform.users.sort.recentlyActive", { defaultValue: "Recently active" }) },
              { value: "name-asc", label: t("platform.users.sort.nameAsc", { defaultValue: "Name A–Z" }) },
              { value: "name-desc", label: t("platform.users.sort.nameDesc", { defaultValue: "Name Z–A" }) },
            ],
          },
        ]}
        filtersActive={filtersActive}
        onResetFilters={() => {
          setLoading(true);
          setFilters(DEFAULT_FILTERS);
        }}
        columns={columns}
        data={users}
        loading={loading}
        loadingConfig={{ rows: 6 }}
        getRowKey={(user) => user.id}
        // The header and the sort menu are one order ("name-asc"…), which
        // the API applies across every page. It orders sign-ins most recent
        // first only, so that header stays plain and the menu keeps it; a
        // third click on the name goes back to the menu's default.
        sort={{
          ...parseSortValue(filters.sort),
          onSortChange: (key, direction) =>
            setFilter({ sort: key ? `${key}-${direction}` : DEFAULT_FILTERS.sort }),
        }}
        emptyState={{
          icon: <Users className="h-8 w-8 text-muted-foreground" />,
          title: t("platform.users.empty.title", { defaultValue: "No users found" }),
          description: t("platform.users.empty.description", { defaultValue: "Try changing the current filters." }),
        }}
        pagination={{
          currentPage: filters.page,
          pageSize: filters.pageSize,
          totalItems: total,
          onPageChange: setPage,
          onPageSizeChange: (pageSize) => setFilter({ pageSize }),
        }}
      />
    </ResponsiveLayout>
  );
}
