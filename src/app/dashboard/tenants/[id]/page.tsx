"use client";

import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { useErrorHandler } from "@/hooks/useErrorHandler";
import {
  ErrorAlert,
  NetworkErrorAlert,
  NotFoundErrorAlert,
} from "@/components/ui/error-alert";
import { DetailPageSkeleton } from "@/components/ui/skeleton-layouts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  TenantStatusManager,
  TenantStatusDialog,
  TenantDeleteDialog,
  TenantStatusBadge,
  TenantInvoiceHistory,
  type TenantStatus,
} from "@/components/tenants";
import { CommunicationLog } from "@/components/clients/CommunicationLog";
import {
  ArrowLeft,
  Edit,
  Trash2,
  User,
  Briefcase,
  Phone,
  Mail,
  Calendar,
  CreditCard,
  FileText,
  Download,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { personErrorText } from "@/lib/person-error-text";

interface Tenant {
  _id: string;
  /** The tenant's user account: what the communication history is keyed by. */
  userId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatar?: string;
  documents?: string[];
  dateOfBirth?: string;
  ssn?: string;
  employmentInfo?: {
    employer: string;
    position: string;
    income: number;
    startDate: string;
  };
  emergencyContacts: Array<{
    name: string;
    relationship: string;
    phone: string;
    email?: string;
  }>;
  creditScore?: number;
  backgroundCheckStatus?: "pending" | "approved" | "rejected";
  // Enhanced status management
  tenantStatus?:
    | "application_submitted"
    | "under_review"
    | "approved"
    | "active"
    | "inactive"
    | "moved_out"
    | "terminated";
  displayStatus?: string;
  statusColor?: string;
  moveInDate?: string;
  moveOutDate?: string;
  applicationDate: string;
  screeningScore?: number;
  applicationNotes?: string;
  lastStatusUpdate?: string;
  hasActiveLease?: boolean;
  activeLeaseCount?: number;
  statusHistory?: Array<{
    status: string;
    changedBy: {
      firstName: string;
      lastName: string;
    };
    changedAt: string;
    reason?: string;
    notes?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

type HttpError = Error & { status?: number };

export default function TenantDetailPage() {
  const { t, formatDate, formatCurrency } = useLocalizationContext();
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const tenantId = params.id as string;

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Status management state
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteBlockedMessage = t("tenants.delete.blockedActiveLease", {
    defaultValue:
      "This tenant has an active lease. Terminate the lease before deleting the tenant.",
  });
  const tenantHasActiveLease =
    tenant?.hasActiveLease || (tenant?.activeLeaseCount ?? 0) > 0;

  // Enhanced error handling
  const { errorState, handleError, clearError, canRetry } = useErrorHandler();

  const fetchTenant = useCallback(async () => {
    try {
      setIsLoading(true);
      clearError(); // Clear any previous errors

      const response = await fetch(`/api/tenants/${tenantId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(
          errorData.message || `HTTP ${response.status}: Failed to fetch tenant`
        );
        (error as HttpError).status = response.status;
        throw error;
      }

      const data = await response.json();
      const tenantData = data?.data;

      if (!tenantData) {
        throw new Error("Tenant data missing");
      }

      setTenant(tenantData);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  }, [clearError, handleError, tenantId]);

  // Status management handlers
  const handleStatusUpdate = (newStatus: TenantStatus) => {
    if (tenant) {
      setTenant({ ...tenant, tenantStatus: newStatus });
    }
    fetchTenant(); // Refresh to get updated data
  };

  const handleDeleteTenant = () => {
    if (tenantHasActiveLease) {
      toast.error(deleteBlockedMessage);
      return;
    }

    setDeleteDialogOpen(true);
  };

  const handleTenantDeleted = () => {
    toast.success(t("tenants.toasts.deleteSuccess"));
    router.push("/dashboard/tenants");
  };

  useEffect(() => {
    fetchTenant();
  }, [fetchTenant]);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      const response = await fetch(`/api/tenants/${tenantId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(
          personErrorText(
            t,
            errorData,
            t("tenants.deleteDialog.toasts.deleteFailed"),
          ),
        );
        (error as HttpError).status = response.status;
        throw error;
      }

      toast.success(t("tenants.toasts.deleteSuccess"), {
        description: t("tenants.toasts.deleteSuccessDescription"),
      });
      router.push("/dashboard/tenants");
    } catch (error) {
      handleError(error);
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const getDocumentName = (url: string) => {
    try {
      const parsed = new URL(url, window.location.origin);
      const pathname = parsed.pathname;
      const last = pathname.split("/").filter(Boolean).pop() || url;
      return decodeURIComponent(last);
    } catch {
      const last = url.split("/").filter(Boolean).pop() || url;
      return decodeURIComponent(last);
    }
  };

  if (isLoading) {
    return <DetailPageSkeleton showImage={false} showTabs={true} />;
  }

  if (errorState.hasError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push("/dashboard/tenants")}
            className="flex items-center space-x-2"
          >
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            <span>{t("tenants.actions.backToList")}</span>
          </Button>
        </div>

        <div className="flex items-center justify-center min-h-[400px]">
          <div className="max-w-md w-full">
            {errorState.errorType === "network" ? (
              <NetworkErrorAlert
                onRetry={canRetry ? fetchTenant : undefined}
                onDismiss={clearError}
              />
            ) : errorState.errorType === "notFound" ? (
              <NotFoundErrorAlert
                resource={t("tenants.resource.singular")}
                onRetry={canRetry ? fetchTenant : undefined}
                onDismiss={clearError}
              />
            ) : (
              <ErrorAlert
                title={t("tenants.error.loadingTenant")}
                message={
                  errorState.error?.message || t("tenants.error.unexpected")
                }
                variant={
                  errorState.errorType === "permission" ? "warning" : "error"
                }
                onRetry={canRetry ? fetchTenant : undefined}
                onDismiss={clearError}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">
            {t("tenants.error.notFound")}
          </h2>
          <p className="text-muted-foreground mb-4">
            {t("tenants.error.notFoundDescription")}
          </p>
          <Link href="/dashboard/tenants">
            <Button>{t("tenants.actions.backToList")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        {/* Left side - Back button */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => router.push("/dashboard/tenants")}
          className="flex items-center"
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
          <span>{t("tenants.actions.backToList")}</span>
        </Button>

        {/* Center - Tenant name and badges */}
        <div className="flex-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {tenant.firstName} {tenant.lastName}
          </h1>
          <div className="flex items-center justify-center space-x-2 mt-2">
            <TenantStatusBadge
              status={tenant.tenantStatus}
              showIcon={true}
              size="default"
            />
            <Badge variant="outline">
              {t("tenants.details.tenantSince", {
                values: { date: formatDate(tenant.applicationDate) },
              })}
            </Badge>
          </div>
        </div>

        {/* Right side - Action Buttons */}
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStatusDialogOpen(true)}
            className="flex items-center"
          >
            <RefreshCw className="h-4 w-4" />
            <span>{t("tenants.actions.changeStatus")}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push(`/dashboard/tenants/${tenantId}/edit`)}
            className="flex items-center"
          >
            <Edit className="h-4 w-4" />
            <span>{t("tenants.actions.editTenant")}</span>
          </Button>

          {/* The tenant's account: every charge and payment, with the
              running balance. The page existed and nothing linked to it. */}
          <Button size="sm" variant="outline" asChild>
            <Link
              href={`/dashboard/tenants/${tenantId}/ledger`}
              className="flex items-center"
            >
              <CreditCard className="h-4 w-4" />
              <span>{t("tenants.actions.ledger", { defaultValue: "Ledger" })}</span>
            </Link>
          </Button>

          {tenantHasActiveLease ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex" tabIndex={0}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled
                      className="flex items-center text-red-600 border-red-200"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>{t("tenants.actions.delete")}</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px]">
                  <p>{deleteBlockedMessage}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleDeleteTenant()}
              className="flex items-center text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
            >
              <Trash2 className="h-4 w-4" />
              <span>{t("tenants.actions.delete")}</span>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {t("tenants.details.personalInfo.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Avatar Section */}
            <div className="flex items-center space-x-4 pb-4 border-b">
              <Avatar className="h-20 w-20">
                <AvatarImage
                  src={tenant.avatar || ""}
                  alt={`${tenant.firstName} ${tenant.lastName}`}
                />
                <AvatarFallback className="text-lg font-semibold bg-primary/10">
                  {tenant.firstName?.[0]}
                  {tenant.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-lg font-semibold">
                  {tenant.firstName} {tenant.lastName}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("tenants.details.tenantId")}: {tenant._id.slice(-8)}
                </p>
              </div>
            </div>

            {/* Personal Details */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("tenants.details.personalInfo.firstName")}
                </label>
                <p className="text-sm">{tenant.firstName}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("tenants.details.personalInfo.lastName")}
                </label>
                <p className="text-sm">{tenant.lastName}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("tenants.details.personalInfo.email")}
                </label>
                <p className="text-sm flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {tenant.email}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("tenants.details.personalInfo.phone")}
                </label>
                <p className="text-sm flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {tenant.phone}
                </p>
              </div>
              {tenant.dateOfBirth && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("tenants.details.personalInfo.dateOfBirth")}
                  </label>
                  <p className="text-sm flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(tenant.dateOfBirth)}
                  </p>
                </div>
              )}
              {tenant.creditScore && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("tenants.details.creditScore")}
                  </label>
                  <p className="text-sm flex items-center gap-1">
                    <CreditCard className="h-3 w-3" />
                    {tenant.creditScore}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Employment Information */}
        {tenant.employmentInfo && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                {t("tenants.details.employmentInfo.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("tenants.details.employmentInfo.employer")}
                  </label>
                  <p className="text-sm">{tenant.employmentInfo.employer}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("tenants.details.employmentInfo.position")}
                  </label>
                  <p className="text-sm">{tenant.employmentInfo.position}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("tenants.details.employmentInfo.annualIncome")}
                  </label>
                  <p className="text-sm">
                    {formatCurrency(tenant.employmentInfo.income)}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("tenants.details.employmentInfo.startDate")}
                  </label>
                  <p className="text-sm">
                    {formatDate(tenant.employmentInfo.startDate)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Emergency Contact */}
        {tenant.emergencyContacts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" />
                {t("tenants.details.emergencyContact.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {tenant.emergencyContacts.map((contact, index) => (
                <div key={index} className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("tenants.details.emergencyContact.name")}
                    </label>
                    <p className="text-sm">{contact.name}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("tenants.details.emergencyContact.relationship")}
                    </label>
                    <p className="text-sm capitalize">{contact.relationship}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("tenants.details.emergencyContact.phone")}
                    </label>
                    <p className="text-sm">{contact.phone}</p>
                  </div>
                  {contact.email && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("tenants.details.emergencyContact.email")}
                      </label>
                      <p className="text-sm">{contact.email}</p>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Tenant Status Management */}
        <TenantStatusManager
          tenant={tenant}
          onStatusChange={() => {
            // Refresh tenant data after status change
            fetchTenant();
          }}
          userRole={session?.user?.role || "manager"}
        />
      </div>

      {/* Move Dates */}
      {(tenant.moveInDate || tenant.moveOutDate) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {t("tenants.details.moveDates.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {tenant.moveInDate && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("tenants.details.moveDates.moveInDate")}
                  </label>
                  <p className="text-sm">{formatDate(tenant.moveInDate)}</p>
                </div>
              )}
              {tenant.moveOutDate && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("tenants.details.moveDates.moveOutDate")}
                  </label>
                  <p className="text-sm">{formatDate(tenant.moveOutDate)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {Array.isArray(tenant.documents) && tenant.documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("tenants.applicationForm.steps.documents")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tenant.documents.map((url) => (
              <div
                key={url}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {getDocumentName(url)}
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={url} download target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4 me-2" />
                    Download
                  </a>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Invoice History */}
      <TenantInvoiceHistory tenantId={tenant._id} />

      {/* Communication history — the same timeline the owner profile shows,
          so a person who is both tenant and owner has one history. */}
      <CommunicationLog clientId={tenant.userId ?? tenant._id} />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tenants.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tenants.deleteDialog.description", {
                values: {
                  name: `${tenant?.firstName ?? ""} ${
                    tenant?.lastName ?? ""
                  }`.trim(),
                },
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {isDeleting
                ? t("tenants.deleteDialog.deleting")
                : t("tenants.deleteDialog.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Status Management Dialog */}
      {tenant && (
        <TenantStatusDialog
          isOpen={statusDialogOpen}
          onClose={() => setStatusDialogOpen(false)}
          tenant={{
            _id: tenant._id,
            firstName: tenant.firstName,
            lastName: tenant.lastName,
            tenantStatus: tenant.tenantStatus,
            lastStatusUpdate: tenant.lastStatusUpdate,
          }}
          onStatusChange={handleStatusUpdate}
          userRole={session?.user?.role || ""}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {tenant && (
        <TenantDeleteDialog
          isOpen={deleteDialogOpen}
          onClose={() => setDeleteDialogOpen(false)}
          tenant={{
            _id: tenant._id,
            firstName: tenant.firstName,
            lastName: tenant.lastName,
            tenantStatus: tenant.tenantStatus,
            hasActiveLease: tenant.hasActiveLease,
            activeLeaseCount: tenant.activeLeaseCount,
          }}
          onDelete={handleTenantDeleted}
          userRole={session?.user?.role || ""}
        />
      )}
    </div>
  );
}
