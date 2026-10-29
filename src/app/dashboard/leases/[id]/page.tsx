"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LeaseStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  MoreHorizontal,
  Edit,
  Download,
  Calendar,
  DollarSign,
  Home,
  User,
  FileText,
  CheckCircle,
  MapPin,
  Phone,
  Mail,
  Settings,
  Building,
  Receipt,
} from "lucide-react";
import { useState, useEffect, use, useCallback } from "react";
import { LeaseActions } from "@/components/leases/LeaseActions";
import { InstallmentSchedule } from "@/components/leases/InstallmentSchedule";
import {
  LeaseStatusChanger,
  LeaseCapabilities,
} from "@/components/leases/LeaseStatusChanger";
import { LeaseInvoiceModal } from "@/components/invoices";
import { LeaseDocuments } from "@/components/leases/LeaseDocuments";
import { LeaseStatusBadge } from "@/components/leases/LeaseStatusBadge";
import { leaseService, LeaseResponse } from "@/lib/services/lease.service";
import { usePropertyCategories } from "@/hooks/use-property-categories";
import { showSimpleError } from "@/lib/toast-notifications";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { describeCharge } from "@/lib/i18n/charge-description";
import { ContractPayments } from "@/components/leases/ContractPayments";
import { ContractRenewalLinks } from "@/components/leases/ContractRenewalLinks";
import { LeaseDepositCard } from "@/components/leases/LeaseDepositCard";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useFrequencyLabel } from "@/components/leases/ContractRent";
import { leaseContractAmount, leaseRentAmount } from "@/lib/lease-money";

interface LeaseDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function LeaseDetailsPage({ params }: LeaseDetailsPageProps) {
  const router = useRouter();
  const { isTenant } = useAuthorization();
  const { t, formatCurrency, formatDate, formatNumber, language } =
    useLocalizationContext();
  const frequencyLabel = useFrequencyLabel();
  const { labelFor: categoryLabelFor } = usePropertyCategories("property");

  const resolvedParams = use(params);
  const [lease, setLease] = useState<LeaseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // const [isDeleting, setIsDeleting] = useState(false);
  // `?tab=payments` opens straight onto a tab — the old standalone payments
  // page for a contract now sends people here.
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const requested = searchParams.get("tab");
    return requested &&
      ["overview", "installments", "payments", "documents", "settings"].includes(
        requested,
      )
      ? requested
      : "overview";
  });

  const fetchLease = useCallback(async () => {
    try {
      setLoading(true);
      const leaseData = await leaseService.getLeaseById(resolvedParams.id);
      setLease(leaseData);
    } catch (error) {
      showSimpleError(
        t("leases.details.toasts.loadErrorTitle"),
        t("leases.details.toasts.fetchError"),
      );
      router.push("/dashboard/leases");
    } finally {
      setLoading(false);
    }
  }, [resolvedParams.id, router, t]);

  useEffect(() => {
    fetchLease();
  }, [fetchLease]);

  // DISABLED: Delete functionality temporarily disabled
  // const handleDelete = async () => {
  //   try {
  //     setIsDeleting(true);
  //     await leaseService.deleteLease(resolvedParams.id);
  //     toast.success("Lease deleted successfully");
  //     router.push("/dashboard/leases");
  //   } catch (error) {
  //     toast.error("Failed to delete lease");
  //   } finally {
  //     setIsDeleting(false);
  //     setShowDeleteDialog(false);
  //   }
  // };

  const getDaysRemaining = () => {
    if (!lease) return 0;
    const endDate = new Date(lease.endDate);
    const now = new Date();
    const diffTime = endDate.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  if (loading) {
    return (
      <div className="space-y-8 animate-fade-in-up">
        <div className="flex items-center gap-6">
          <Skeleton className="h-12 w-24 rounded-xl" />
          <div className="space-y-3">
            <Skeleton className="h-10 w-80 rounded-lg" />
            <Skeleton className="h-5 w-64 rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
          <div className="space-y-8">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!lease) {
    return (
      <div className="flex items-center justify-center min-h-[500px] animate-fade-in-up">
        <div className="text-center p-8 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 shadow-lg">
          <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto mb-6">
            <FileText className="h-16 w-16 text-muted-foreground" />
          </div>
          <h3 className="text-2xl font-bold mb-3">
            {t("leases.details.notFound.title")}
          </h3>
          <p className="text-muted-foreground mb-8 text-lg leading-relaxed max-w-md">
            {t("leases.details.notFound.description")}
          </p>
          <Button
            onClick={() => router.push("/dashboard/leases")}
            size="lg"
            className="animate-pulse-glow"
          >
            {t("leases.details.notFound.backButton")}
          </Button>
        </div>
      </div>
    );
  }

  const daysRemaining = getDaysRemaining();
  const contractTotal = leaseContractAmount(lease);
  // What this person may do here, as the server worked it out from their own
  // permissions (per-person grants and denials included). A tenant sees their
  // contract read-only.
  const canViewInvoices = !isTenant && Boolean(lease.viewer?.viewInvoices);
  const canEditContract = !isTenant && Boolean(lease.viewer?.editContract);
  // Settings holds the status controls, which a tenant's read-only contract
  // does not show; asked for anyway, it opens on the overview.
  const tab =
    isTenant && activeTab === "settings" ? "overview" : activeTab;

  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 p-4 lg:p-6 rounded-2xl bg-gradient-to-r from-card/60 via-card/40 to-transparent backdrop-blur-sm border border-border/15 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 lg:gap-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {lease.propertyId?.name ||
                t("leases.labels.propertyNotAvailable")}
            </h1>
            <p className="text-muted-foreground text-base lg:text-lg font-medium">
              {t("leases.details.header.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:gap-3">
          <LeaseStatusBadge status={lease.status} />
          {!isTenant && <LeaseActions lease={lease} onUpdate={fetchLease} />}

          {/* Payment Management Button */}
          {!isTenant && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveTab("payments")}
              className="flex items-center gap-2 cursor-pointer"
            >
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t("leases.details.actions.managePayments")}
              </span>
              <span className="sm:hidden">
                {t("leases.details.actions.paymentsShort")}
              </span>
            </Button>
          )}

          {/* This contract's invoices — its own, not the whole building's:
              the register filtered by building listed every contract in it. */}
          {canViewInvoices && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                router.push(
                  `/dashboard/leases/invoices?leaseId=${encodeURIComponent(
                    lease._id
                  )}`
                )
              }
              className="flex items-center gap-2 cursor-pointer"
            >
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t("leases.details.actions.viewInvoices")}
              </span>
              <span className="sm:hidden">
                {t("leases.details.actions.invoicesShort")}
              </span>
            </Button>
          )}
          {!isTenant && (
            <LeaseInvoiceModal
              lease={lease}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {t("leases.details.actions.quickInvoice")}
                  </span>
                  <span className="sm:hidden">
                    {t("leases.details.actions.quickShort")}
                  </span>
                </Button>
              }
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="cursor-pointer">
              <Button variant="outline" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {t("leases.details.dropdown.actionsLabel")}
              </DropdownMenuLabel>
              {/* Any contract can be edited by whoever may edit contracts:
                  once its installments are billed, the form locks its terms
                  and only the contract number and details still change. */}
              {canEditContract && (
                <>
                  <DropdownMenuItem asChild>
                    <Link href={`/dashboard/leases/${lease._id}/edit`}>
                      <Edit className="me-2 h-4 w-4" />
                      {t("leases.details.actions.editLease")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/leases/${lease._id}/invoice`}>
                  <FileText className="me-2 h-4 w-4" />
                  {t("leases.details.actions.fullInvoicePage")}
                </Link>
              </DropdownMenuItem>
              {!isTenant && (
                <>
                  {/* DISABLED: Delete functionality temporarily disabled */}
                  {/* <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    <Trash2 className="me-2 h-4 w-4" />
                    Delete Lease
                  </DropdownMenuItem> */}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.back()}
            className="flex items-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            {t("leases.details.actions.back")}
          </Button>
        </div>
      </div>

      {/* The renewal of this contract, or the contract it renewed. */}
      <ContractRenewalLinks lease={lease} />

      {/* Main Content with Tabs */}
      <Tabs
        value={tab}
        onValueChange={setActiveTab}
        className="space-y-6"
      >
        <TabsList
          className={`grid w-full ${isTenant ? "grid-cols-4" : "grid-cols-5"}`}
        >
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Home className="h-4 w-4" />
            {t("leases.details.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="installments" className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            {t("leases.details.tabs.installments", {
              defaultValue: "Installments",
            })}
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            {t("leases.details.tabs.payments")}
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t("leases.details.tabs.documents")}
          </TabsTrigger>
          {!isTenant && (
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              {t("leases.details.tabs.settings")}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
            {/* Main Content */}
            <div className="xl:col-span-2 space-y-6 lg:space-y-8">
              {/* Property Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-xl">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Home className="h-5 w-5 text-primary" />
                    </div>
                    {t("leases.details.property.title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 lg:space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6">
                    <div className="space-y-2">
                      <label className="text-xs lg:text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        {t("leases.details.property.nameLabel")}
                      </label>
                      <p className="text-lg lg:text-xl font-bold text-foreground break-words">
                        {lease.propertyId?.name ||
                          t("leases.labels.propertyNotAvailable")}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs lg:text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        {t("leases.details.property.typeLabel")}
                      </label>
                      <p className="font-medium capitalize">
                        {lease.propertyId?.type
                          ? categoryLabelFor(lease.propertyId.type)
                          : t("leases.details.property.typeNotAvailable")}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs lg:text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      {t("leases.details.property.addressLabel")}
                    </label>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 lg:p-4 rounded-xl bg-muted/30 border border-border/15">
                      <div className="p-2 rounded-lg bg-info/10 w-fit">
                        <MapPin className="h-4 w-4 text-info" />
                      </div>
                      <p className="text-sm lg:text-lg font-medium break-words">
                        {lease.propertyId?.address ? (
                          <>
                            {lease.propertyId.address.street},{" "}
                            {lease.propertyId.address.city},{" "}
                            {lease.propertyId.address.state}{" "}
                            {lease.propertyId.address.zipCode}
                          </>
                        ) : (
                          t("leases.labels.addressNotAvailable")
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Unit Information - prioritize unit details over property details */}
                  {lease.unit && (
                    <div className="space-y-3">
                      <label className="text-xs lg:text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        {t("leases.details.property.unitDetailsTitle")}
                      </label>
                      <div className="p-3 lg:p-4 rounded-xl bg-primary/5 border border-primary/15">
                        <div className="flex items-center gap-2 mb-3">
                          <Building className="h-4 w-4 text-primary" />
                          <span className="font-semibold text-primary">
                            {t("leases.labels.unit")} {lease.unit.unitNumber}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
                    <div className="text-center p-3 lg:p-4 rounded-xl bg-gradient-to-br from-success/15 to-success/8 border border-success/15">
                      <label className="text-xs font-bold text-success uppercase tracking-wider block mb-2">
                        {t("leases.details.property.bedrooms")}
                      </label>
                      <p className="text-xl lg:text-2xl font-bold text-success">
                        {lease.unit?.bedrooms ||
                          lease.propertyId?.bedrooms ||
                          t("leases.details.common.notAvailable")}
                      </p>
                    </div>
                    <div className="text-center p-3 lg:p-4 rounded-xl bg-gradient-to-br from-warning/15 to-warning/8 border border-warning/15">
                      <label className="text-xs font-bold text-warning uppercase tracking-wider block mb-2">
                        {t("leases.details.property.bathrooms")}
                      </label>
                      <p className="text-xl lg:text-2xl font-bold text-warning">
                        {lease.unit?.bathrooms ||
                          lease.propertyId?.bathrooms ||
                          t("leases.details.common.notAvailable")}
                      </p>
                    </div>
                    <div className="text-center p-3 lg:p-4 rounded-xl bg-gradient-to-br from-info/15 to-info/8 border border-info/15">
                      <label className="text-xs font-bold text-info uppercase tracking-wider block mb-2">
                        {t("leases.details.property.squareFeet")}
                      </label>
                      <p className="text-xl lg:text-2xl font-bold text-info">
                        {(() => {
                          const squareFootage =
                            lease.unit?.squareFootage ||
                            lease.propertyId?.squareFootage;
                          return squareFootage
                            ? formatNumber(squareFootage)
                            : t("leases.details.common.notAvailable");
                        })()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Tenant Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-xl">
                    <div className="p-2 rounded-lg bg-success/10">
                      <User className="h-5 w-5 text-success" />
                    </div>
                    {t("leases.details.tenant.title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("leases.details.tenant.fullName")}
                      </label>
                      <p className="text-lg font-semibold">
                        {lease.tenantId?.firstName && lease.tenantId?.lastName
                          ? `${lease.tenantId.firstName} ${lease.tenantId.lastName}`
                          : t("leases.labels.unknownTenant")}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("leases.details.tenant.email")}
                      </label>
                      <div className="flex items-center gap-2 mt-1">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <p>
                          {lease.tenantId?.email || t("leases.labels.noEmail")}
                        </p>
                      </div>
                    </div>
                  </div>

                  {lease.tenantId?.phone && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("leases.details.tenant.phone")}
                      </label>
                      <div className="flex items-center gap-2 mt-1">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <p>{lease.tenantId.phone}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Lease Terms */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    {t("leases.details.terms.title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Utilities — terms are free JSON; an imported or renewed
                      contract may carry only the rent, so a list can be absent. */}
                  {(lease.terms?.utilities ?? []).length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground mb-2 block">
                        {t("leases.details.terms.utilitiesIncluded")}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {(lease.terms?.utilities ?? []).map((utility) => (
                          <Badge
                            key={utility}
                            variant="secondary"
                            className="capitalize"
                          >
                            {describeCharge({ description: utility }, language)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Restrictions */}
                  {(lease.terms?.restrictions ?? []).length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground mb-2 block">
                        {t("leases.details.terms.restrictions")}
                      </label>
                      <div className="space-y-2">
                        {(lease.terms?.restrictions ?? []).map((restriction, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-2 text-sm"
                          >
                            <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full"></div>
                            <span>{restriction}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Renewal Options */}
                  {lease.renewalOptions?.available && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground mb-2 block">
                        {t("leases.details.terms.renewalOptions")}
                      </label>
                      <div className="p-3 rounded-md border bg-success/10 dark:bg-success/15 border-success/20">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="h-4 w-4 text-success" />
                          <span className="text-sm font-medium text-success">
                            {t("leases.details.terms.renewalAvailable")}
                          </span>
                        </div>
                        {lease.renewalOptions.terms && (
                          <p className="text-sm text-success">
                            {lease.renewalOptions.terms}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {lease.notes && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground mb-2 block">
                        {t("leases.details.terms.additionalNotes")}
                      </label>
                      <div className="p-3 bg-muted/50 rounded-md">
                        <p className="text-sm">{lease.notes}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6 lg:space-y-8">
              {/* Lease Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-lg">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Calendar className="h-5 w-5 text-primary" />
                    </div>
                    {t("leases.details.summary.title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("leases.details.summary.leasePeriod")}
                    </label>
                    <p className="font-semibold">
                      {formatDate(lease.startDate)} -{" "}
                      {formatDate(lease.endDate)}
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("leases.details.summary.duration")}
                    </label>
                    <p>
                      {leaseService.formatLeaseDuration(
                        lease.startDate,
                        lease.endDate,
                        language
                      )}
                    </p>
                  </div>

                  {lease.status === LeaseStatus.ACTIVE && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("leases.details.summary.daysRemaining")}
                      </label>
                      <p
                        className={`font-semibold ${
                          daysRemaining < 30
                            ? "text-red-600"
                            : daysRemaining < 60
                            ? "text-orange-600"
                            : "text-green-600"
                        }`}
                      >
                        {daysRemaining > 0
                          ? t("leases.labels.days", {
                              values: { days: daysRemaining },
                            })
                          : t("leases.labels.expired")}
                      </p>
                    </div>
                  )}

                  {lease.signedDate && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("leases.details.summary.signedDate")}
                      </label>
                      <div className="flex items-center gap-2 mt-1">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <p>{formatDate(lease.signedDate)}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Financial Terms */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-lg">
                    <div className="p-2 rounded-lg bg-success/10">
                      <DollarSign className="h-5 w-5 text-success" />
                    </div>
                    {t("leases.details.financial.title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 lg:space-y-6">
                  <div className="grid grid-cols-1 gap-3 lg:gap-4">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-3 lg:p-4 rounded-xl bg-gradient-to-r from-success/15 to-success/8 border border-success/15">
                      <span className="text-success font-semibold text-sm lg:text-base">
                        {t("leases.contract.rentPerInstallment", {
                          defaultValue: "Rent per installment",
                        })}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {frequencyLabel(lease)}
                        </span>
                      </span>
                      <span className="font-bold text-lg lg:text-xl text-success">
                        {formatCurrency(leaseRentAmount(lease))}
                      </span>
                    </div>
                    {/* The figure the contract was written with, when it was
                        written as one total for the term. */}
                    {contractTotal !== null && (
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-3 lg:p-4 rounded-xl bg-gradient-to-r from-success/15 to-success/8 border border-success/15">
                        <span className="text-success font-semibold text-sm lg:text-base">
                          {t("leases.contract.rentTotal", {
                            defaultValue: "Total contract value",
                          })}
                        </span>
                        <span className="font-bold text-base lg:text-lg text-success">
                          {formatCurrency(contractTotal)}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-3 lg:p-4 rounded-xl bg-gradient-to-r from-warning/15 to-warning/8 border border-warning/15">
                      <span className="text-warning font-semibold text-sm lg:text-base">
                        {t("leases.details.financial.securityDeposit")}
                      </span>
                      <span className="font-bold text-base lg:text-lg text-warning">
                        {formatCurrency(lease.terms.securityDeposit ?? 0)}
                      </span>
                    </div>
                    {(lease.terms.petDeposit ?? 0) > 0 && (
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-3 lg:p-4 rounded-xl bg-gradient-to-r from-info/15 to-info/8 border border-info/15">
                        <span className="text-info font-semibold text-sm lg:text-base">
                          {t("leases.details.financial.petDeposit")}
                        </span>
                        <span className="font-bold text-base lg:text-lg text-info">
                          {formatCurrency(lease.terms.petDeposit ?? 0)}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Security Deposit */}
              {!isTenant && (
                <LeaseDepositCard
                  leaseId={lease._id}
                  fallbackAmount={lease.terms.securityDeposit ?? 0}
                />
              )}

              {/* Status Management — the office's controls. A tenant's
                  contract is read-only: the status is shown in the header. */}
              {!isTenant && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Settings className="h-5 w-5" />
                      {t("leases.details.status.title")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <LeaseStatusChanger lease={lease} onUpdate={fetchLease} />
                  </CardContent>
                </Card>
              )}

              {/* Lease Capabilities */}
              {!isTenant && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      {t("leases.details.status.availableActionsTitle")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LeaseCapabilities lease={lease} />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* The contract's own schedule: every installment, its due date, and
            what is paid or overdue. */}
        <TabsContent value="installments" className="space-y-6">
          <InstallmentSchedule
            leaseId={lease._id}
            readOnly={isTenant}
            leaseStatus={lease.status}
          />
        </TabsContent>

        {/* The contract's payments, read against its installments: which
            installment each payment settled, and a way to record the next
            one against the right installment. */}
        <TabsContent value="payments" className="space-y-6">
          <ContractPayments leaseId={lease._id} readOnly={isTenant} />
        </TabsContent>

        <TabsContent value="documents" className="space-y-6">
          {/* Document Management */}
          <LeaseDocuments lease={lease} onUpdate={fetchLease} />
        </TabsContent>

        {!isTenant && (
          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("leases.details.settings.title")}</CardTitle>
                <CardDescription>
                  {t("leases.details.settings.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Status Management */}
                <div>
                  <h4 className="font-medium mb-3">
                    {t("leases.details.status.title")}
                  </h4>
                  <LeaseStatusChanger lease={lease} onUpdate={fetchLease} />
                </div>

                {/* Lease Capabilities */}
                <div>
                  <h4 className="font-medium mb-3">
                    {t("leases.details.status.availableActionsTitle")}
                  </h4>
                  <LeaseCapabilities lease={lease} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* DISABLED: Delete functionality temporarily disabled */}
      {/* <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lease</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this lease? This action cannot be
              undone. The lease for {lease.propertyId?.name || "this property"}{" "}
              will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? "Deleting..." : "Delete Lease"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog> */}
    </div>
  );
}
