"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import LeaseTable from "@/components/tenant/LeaseTable";
import { leaseRentAmount } from "@/lib/lease-money";
import { leaseAnnualRent } from "@/lib/lease-installments";
import { formatCurrency } from "@/lib/utils/formatting";
import { GlobalSearch } from "@/components/ui/global-search";
import { showSimpleError, showSimpleInfo } from "@/lib/toast-notifications";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import {
  RefreshCw,
  Home,
  Calendar,
  DollarSign,
  FileText,
  X,
  Grid3X3,
  List,
} from "lucide-react";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { LeaseStatus } from "@/types";

interface Lease {
  _id: string;
  propertyId: {
    _id: string;
    name: string;
    address:
      | string
      | {
          street?: string;
          city?: string;
          state?: string;
          zipCode?: string;
          country?: string;
        };
    type: string;
  };
  unit?: {
    unitNumber: string;
    bedrooms: number;
    bathrooms: number;
    rentAmount: number;
  };
  startDate: string;
  endDate: string;
  status: string;
  /** The contract's rent per installment, its total if written as one, and its cycle. */
  rentAmount?: number;
  contractAmount?: number | null;
  paymentFrequency?: string;
  terms: {
    rentAmount: number;
    securityDeposit?: number;
    leaseDuration?: number;
  };
  daysUntilExpiration: number;
  daysUntilStart: number;
  isActive: boolean;
  isUpcoming: boolean;
  isExpired: boolean;
  documents?: string[];
  signedDate?: string;
  renewalOptions?: {
    available: boolean;
    terms?: string;
    deadline?: string;
  };
}

export default function MyLeasesPage() {
  const { t } = useLocalizationContext();
  const [loading, setLoading] = useState(true);
  const { data: session, status } = useSession();
  const { isTenant } = useAuthorization();
  const [searchTerm, setSearchTerm] = useState("");
  const [leases, setLeases] = useState<Lease[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const viewMode = useViewPreferencesStore((state) => state.leasesView);
  const setViewMode = useViewPreferencesStore((state) => state.setLeasesView);

  // Handler for debounced search from GlobalSearch component
  const handleSearch = useCallback((value: string) => {
    setIsSearching(true);
    setSearchTerm(value);
    // Brief delay to show search state
    setTimeout(() => setIsSearching(false), 100);
  }, []);

  const fetchLeases = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/tenant/dashboard");
      const data = await response.json();

      if (data.success) {
        setLeases(data.data.allLeases || []);
      } else {
        showSimpleError("Load Error", t("leases.toasts.fetchYourLeasesError"));
      }
    } catch {
      showSimpleError("Load Error", t("leases.toasts.fetchYourLeasesError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (session?.user) {
      fetchLeases();
    }
  }, [session, fetchLeases]);

  const handleLeaseAction = (action: string, lease: Lease) => {
    console.log("Lease action:", action, lease);
    // "View details" is a link to the contract itself (see LeaseTable).
    switch (action) {
      case "download-agreement":
        showSimpleInfo("Info", t("leases.myLeases.toasts.downloadAgreement"));
        // Implement download functionality
        break;
      case "view-invoices":
        showSimpleInfo("Info", t("leases.myLeases.toasts.viewInvoices"));
        // Navigate to invoices page
        break;
      case "contact-manager":
        showSimpleInfo("Info", t("leases.myLeases.toasts.contactManager"));
        // Navigate to communication center
        break;
      case "request-renewal":
        showSimpleInfo("Info", t("leases.myLeases.toasts.requestRenewal"));
        // Implement renewal request functionality
        break;
      default:
      // Unknown lease action
    }
  };

  const filteredLeases = leases.filter((lease) => {
    // Skip leases with missing propertyId data
    if (!lease.propertyId || !lease.propertyId.address) {
      return false;
    }

    const address = lease.propertyId.address;
    const addressString =
      typeof address === "string"
        ? address
        : `${address.street || ""} ${address.city || ""} ${
            address.state || ""
          }`;

    const matchesSearch =
      lease.propertyId.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      addressString.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "all" || lease.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const get = (obj: any, path: string) =>
    path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

  const getSortVal = (lease: Lease) => {
    if (sortBy === "terms.rentAmount") {
      return leaseRentAmount(lease);
    }
    if (sortBy === "createdAt") {
      const v = (get(lease, "createdAt") as any) ?? lease.startDate;
      const t = new Date(v as any).getTime();
      return Number.isNaN(t) ? 0 : t;
    }
    if (sortBy === "startDate" || sortBy === "endDate") {
      const v = get(lease, sortBy) as any;
      const t = new Date(v as any).getTime();
      return Number.isNaN(t) ? 0 : t;
    }
    const v = get(lease, sortBy);
    return typeof v === "number" ? v : String(v || "").toLowerCase();
  };

  const sortedLeases = [...filteredLeases].sort((a, b) => {
    const av = getSortVal(a);
    const bv = getSortVal(b);
    if (typeof av === "number" && typeof bv === "number") {
      return sortOrder === "asc" ? av - bv : bv - av;
    }
    return sortOrder === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const getLeaseStats = () => {
    const now = new Date();
    const stats = {
      total: filteredLeases.length,
      active: filteredLeases.filter(
        (lease) => lease.status === LeaseStatus.ACTIVE
      ).length,
      expiring: filteredLeases.filter((lease) => {
        const endDate = new Date(lease.endDate);
        const daysUntilExpiration = Math.ceil(
          (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        return daysUntilExpiration <= 60 && daysUntilExpiration > 0;
      }).length,
      // A month's worth of each contract's rent, whatever its cycle.
      totalRent: filteredLeases.reduce(
        (sum, lease) => sum + leaseAnnualRent(lease) / 12,
        0
      ),
    };

    return stats;
  };

  const leaseStats = getLeaseStats();

  // Show loading state while session is being fetched
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect if not authenticated
  if (status === "unauthenticated") {
    redirect("/auth/signin");
  }

  // Only allow tenants to access this page
  if (!isTenant) {
    redirect("/dashboard");
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
            <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("leases.myLeases.header.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("leases.myLeases.header.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center border rounded-lg p-1">
            <Button
              variant={viewMode === "cards" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("cards")}
              className="h-8 sm:px-3"
              aria-label={t("leases.view.cards")}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "table" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("table")}
              className="h-8 sm:px-3"
              aria-label={t("leases.view.table")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLeases}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            {t("leases.actions.refresh")}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <AnalyticsCardGrid className="md:grid-cols-2 lg:grid-cols-4">
        <AnalyticsCard
          title={t("leases.myLeases.stats.totalLeases")}
          value={leaseStats.total}
          description={t("leases.myLeases.stats.currentlyActive", {
            values: { count: leaseStats.active },
          })}
          icon={Home}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("leases.myLeases.stats.activeLeases")}
          value={leaseStats.active}
          description={t("leases.myLeases.stats.currentlyOccupied")}
          icon={FileText}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("leases.myLeases.stats.expiringSoon")}
          value={leaseStats.expiring}
          description={t("leases.myLeases.stats.within60Days")}
          icon={Calendar}
          iconColor="warning"
        />
        <AnalyticsCard
          title={t("leases.myLeases.stats.totalMonthlyRent")}
          value={formatCurrency(leaseStats.totalRent)}
          description={t("leases.myLeases.stats.combinedRent")}
          icon={DollarSign}
          iconColor="success"
        />
      </AnalyticsCardGrid>

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("leases.header.title")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("leases.header.subtitle")}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex items-center border rounded-lg p-1 w-full sm:w-auto">
                <Button
                  variant={viewMode === "cards" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("cards")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <Grid3X3 className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "table" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("table")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <GlobalSearch
              placeholder={t("leases.filters.searchPlaceholder")}
              initialValue={searchTerm}
              debounceDelay={300}
              onSearch={handleSearch}
              isLoading={isSearching}
              className="flex-1 min-w-0"
              ariaLabel={t("leases.myLeases.filters.searchAriaLabel")}
            />

            <div className="flex flex-wrap items-center gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("leases.filters.status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("leases.filters.allStatus")}
                  </SelectItem>
                  <SelectItem value="draft">
                    {t("leases.status.draft")}
                  </SelectItem>
                  <SelectItem value="pending">
                    {t("leases.status.pending")}
                  </SelectItem>
                  <SelectItem value="active">
                    {t("leases.status.active")}
                  </SelectItem>
                  <SelectItem value="expired">
                    {t("leases.status.expired")}
                  </SelectItem>
                  <SelectItem value="terminated">
                    {t("leases.status.terminated")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={`${sortBy}-${sortOrder}`}
                onValueChange={(value) => {
                  const [sb, so] = value.split("-");
                  setSortBy(sb);
                  setSortOrder(so as "asc" | "desc");
                }}
              >
                <SelectTrigger className="w-[160px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("leases.filters.sort")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt-desc">
                    {t("leases.sort.newestFirst")}
                  </SelectItem>
                  <SelectItem value="startDate-desc">
                    {t("leases.sort.startDateLatest")}
                  </SelectItem>
                  <SelectItem value="endDate-asc">
                    {t("leases.sort.endDateSoonest")}
                  </SelectItem>
                  <SelectItem value="terms.rentAmount-desc">
                    {t("leases.sort.rentHighToLow")}
                  </SelectItem>
                  <SelectItem value="terms.rentAmount-asc">
                    {t("leases.sort.rentLowToHigh")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {(searchTerm ||
                statusFilter !== "all" ||
                sortBy !== "createdAt" ||
                sortOrder !== "desc") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter("all");
                    setSortBy("createdAt");
                    setSortOrder("desc");
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("leases.filters.clear")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <LeaseTable
              leases={sortedLeases}
              onLeaseAction={handleLeaseAction}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
