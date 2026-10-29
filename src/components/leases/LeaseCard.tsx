"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { TerminateContractDialog } from "@/components/leases/TerminateContractDialog";
import {
  FileText,
  MoreHorizontal,
  Edit,
  Eye,
  Trash2,
  Calendar,
  DollarSign,
  Home,
  User,
  FileSignature,
  XCircle,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckCircle,
  Clock,
  Download,
} from "lucide-react";
import { LeaseStatus } from "@/types";
import { LeaseResponse, leaseService } from "@/lib/services/lease.service";
import { businessDaysUntil } from "@/lib/dates/business-day";
import { leaseRentAmount } from "@/lib/lease-money";
import { useFrequencyLabel } from "@/components/leases/ContractRent";
import { toast } from "sonner";
import { LeaseInvoiceModal } from "@/components/invoices";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

/**
 * The leases API returns the full Prisma Unit (`unit: true`), which includes
 * `floor`; the shared LeaseResponse interface omits it, so extend it here.
 */
type LeaseWithUnitFloor = Omit<LeaseResponse, "unit"> & {
  unit?: NonNullable<LeaseResponse["unit"]> & { floor?: number | null };
};

interface LeaseCardProps {
  lease: LeaseWithUnitFloor;
  onUpdate?: () => void;
  onDelete?: (id: string) => void;
  showActions?: boolean;
}

export function LeaseCard({
  lease,
  onUpdate,
  onDelete,
  showActions = true,
}: LeaseCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showTerminateDialog, setShowTerminateDialog] = useState(false);
  const { t, formatCurrency, formatDate: formatAppDate } = useLocalizationContext();
  const frequencyLabel = useFrequencyLabel();

  const getStatusColor = (status: LeaseStatus) => {
    switch (status) {
      case LeaseStatus.DRAFT:
        return "outline";
      case LeaseStatus.PENDING:
        return "default";
      case LeaseStatus.ACTIVE:
        return "secondary";
      case LeaseStatus.EXPIRED:
        return "destructive";
      case LeaseStatus.TERMINATED:
        return "destructive";
      default:
        return "outline";
    }
  };

  const getStatusIcon = (status: LeaseStatus) => {
    switch (status) {
      case LeaseStatus.DRAFT:
        return Edit;
      case LeaseStatus.PENDING:
        return Clock;
      case LeaseStatus.ACTIVE:
        return CheckCircle;
      case LeaseStatus.EXPIRED:
        return AlertTriangle;
      case LeaseStatus.TERMINATED:
        return XCircle;
      default:
        return FileText;
    }
  };

  // In the reader's locale, like every other date — this was always US.
  const formatDate = (dateString: string) => formatAppDate(dateString);

  // Whole days on the office's calendar, not the browser's clock.
  const getDaysRemaining = () => businessDaysUntil(lease.endDate);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await leaseService.deleteLease(lease._id);
      toast.success(t("leases.card.toasts.deleted", { defaultValue: "Contract deleted" }));
      onDelete?.(lease._id);
    } catch (error) {
      console.error("Error deleting lease:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("leases.card.toasts.deleteFailed", { defaultValue: "Could not delete the contract" })
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchive = async () => {
    try {
      await leaseService.archiveLease(lease._id);
      toast.success(
        t("leases.card.toasts.archived", { defaultValue: "Contract archived. It is hidden from the list but kept for your records." }),
      );
      onUpdate?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("leases.card.toasts.archiveFailed", { defaultValue: "Could not archive the contract" })
      );
    }
  };

  const handleUnarchive = async () => {
    try {
      await leaseService.unarchiveLease(lease._id);
      toast.success(t("leases.card.toasts.restored", { defaultValue: "Contract restored to the list" }));
      onUpdate?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("leases.card.toasts.restoreFailed", { defaultValue: "Could not restore the contract" })
      );
    }
  };

  const StatusIcon = getStatusIcon(lease.status);
  const daysRemaining = getDaysRemaining();

  return (
    <>
      <Card className="hover:shadow-xl transition-all duration-300 border-border/40 overflow-hidden group p-0 bg-card">
        {/* Header with gradient background */}
        <div className="relative bg-gradient-to-br from-primary/8 via-primary/4 to-transparent p-4 border-b border-border/50">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="p-2 rounded-xl bg-background shadow-sm border border-border/60 shrink-0">
                <Home className="h-4 w-4 text-primary" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm text-foreground truncate">
                    {lease?.propertyId?.name}
                  </h3>
                  {lease.unit && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-medium">
                      {t("leases.card.unit", { defaultValue: "Unit {number}", values: { number: lease.unit.unitNumber } })}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {[
                    lease?.propertyId?.address?.street,
                    lease?.propertyId?.address?.city,
                    lease?.propertyId?.address?.state,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge
                variant={getStatusColor(lease.status) as any}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium"
              >
                <StatusIcon className="h-3 w-3" />
                <span className="capitalize">
                  {t(`leases.status.${lease.status}`, {
                    defaultValue: lease.status,
                  })}
                </span>
              </Badge>
              {showActions && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel>
                      {t("leases.card.actions", { defaultValue: "Actions" })}
                    </DropdownMenuLabel>
                    <DropdownMenuItem asChild>
                      <Link href={`/dashboard/leases/${lease._id}`}>
                        <Eye className="me-2 h-4 w-4" />
                        {t("leases.card.viewDetails", { defaultValue: "View details" })}
                      </Link>
                    </DropdownMenuItem>
                    {lease.status === LeaseStatus.DRAFT && (
                      <DropdownMenuItem asChild>
                        <Link href={`/dashboard/leases/${lease._id}/edit`}>
                          <Edit className="me-2 h-4 w-4" />
                          {t("leases.card.edit", { defaultValue: "Edit contract" })}
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {!lease.signedDate &&
                      lease.status === LeaseStatus.DRAFT && (
                        <DropdownMenuItem>
                          <FileSignature className="me-2 h-4 w-4" />
                          {t("leases.card.sendForSignature", { defaultValue: "Send for signature" })}
                        </DropdownMenuItem>
                      )}
                    {lease.status === LeaseStatus.ACTIVE && (
                      <DropdownMenuItem
                        // The menu closes as the form opens. Kept open behind
                        // a form someone types into, it was still there —
                        // holding the page inert — after the form closed.
                        onSelect={() => setShowTerminateDialog(true)}
                        className="text-orange-600 focus:text-orange-600"
                      >
                        <XCircle className="me-2 h-4 w-4" />
                        {t("leases.card.terminate", { defaultValue: "Terminate contract" })}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href={`/dashboard/leases/${lease._id}/invoice`}>
                        <FileText className="me-2 h-4 w-4" />
                        {t("leases.card.viewInvoice", { defaultValue: "View invoice" })}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <LeaseInvoiceModal
                        lease={lease}
                        trigger={
                          <div className="flex items-center w-full cursor-pointer">
                            <Download className="me-2 h-4 w-4" />
                            {t("leases.card.downloadInvoice", { defaultValue: "Download invoice" })}
                          </div>
                        }
                      />
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {/* Archived leases can be restored */}
                    {lease.archivedAt &&
                      (lease.status === LeaseStatus.TERMINATED ||
                        lease.status === LeaseStatus.EXPIRED) && (
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            handleUnarchive();
                          }}
                        >
                          <ArchiveRestore className="me-2 h-4 w-4" />
                          {t("leases.card.restore", { defaultValue: "Restore" })}
                        </DropdownMenuItem>
                      )}

                    {/* Ended leases (not archived) can be archived */}
                    {!lease.archivedAt &&
                      (lease.status === LeaseStatus.TERMINATED ||
                        lease.status === LeaseStatus.EXPIRED) && (
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            handleArchive();
                          }}
                        >
                          <Archive className="me-2 h-4 w-4" />
                          {t("leases.card.archive", { defaultValue: "Archive" })}
                        </DropdownMenuItem>
                      )}

                    {/* Only draft leases can be deleted */}
                    {lease.status === LeaseStatus.DRAFT && (
                      <DeleteConfirmationDialog
                        itemName={`${
                          lease.propertyId?.name || "—"
                        } - ${
                          lease.tenantId?.firstName && lease.tenantId?.lastName
                            ? `${lease.tenantId.firstName} ${lease.tenantId.lastName}`
                            : t("leases.card.unknownTenant", { defaultValue: "Unknown tenant" })
                        }`}
                        itemType="lease"
                        onConfirm={handleDelete}
                        loading={isDeleting}
                      >
                        <DropdownMenuItem
                          onSelect={(e) => e.preventDefault()}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="me-2 h-4 w-4" />
                          {t("leases.card.delete", { defaultValue: "Delete contract" })}
                        </DropdownMenuItem>
                      </DeleteConfirmationDialog>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Tenant Info Badge */}
          <div className="flex items-center gap-3 px-3 py-2.5 bg-background/80 backdrop-blur-sm rounded-xl border shadow-sm w-fit">
            <Avatar className="h-9 w-9 border-2 border-primary/20">
              <AvatarImage
                src={lease.tenantId?.avatar}
                alt={`${lease.tenantId?.firstName || ""} ${lease.tenantId?.lastName || ""}`}
              />
              <AvatarFallback className="bg-primary/10 text-primary font-medium text-sm">
                {lease.tenantId?.firstName?.[0] || "T"}
                {lease.tenantId?.lastName?.[0] || ""}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                {lease.tenantId?.firstName && lease.tenantId?.lastName
                  ? `${lease.tenantId.firstName} ${lease.tenantId.lastName}`
                  : t("leases.card.unknownTenant", { defaultValue: "Unknown tenant" })}
              </span>
              <span className="text-xs text-muted-foreground">
                {lease.tenantId?.email ||
                  t("leases.card.noEmail", { defaultValue: "No email" })}
              </span>
            </div>
          </div>
        </div>

        <CardContent className="p-4 space-y-3">
          {/* Lease Period with visual timeline */}
          <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-lg">
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                {t("leases.card.period", { defaultValue: "Contract period" })}
              </span>
            </div>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                daysRemaining < 30 && daysRemaining > 0
                  ? "text-orange-700 bg-orange-100 dark:text-orange-300 dark:bg-orange-900/30"
                  : daysRemaining <= 0
                  ? "text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/30"
                  : "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/30"
              }`}
            >
              {daysRemaining > 0
                ? t("leases.card.daysRemaining", { defaultValue: "{days} days remaining", values: { days: daysRemaining } })
                : daysRemaining === 0
                ? t("leases.card.expiresToday", { defaultValue: "Expires today" })
                : t("leases.card.expired", { defaultValue: "Expired" })}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground px-1">
            {formatDate(lease.startDate)} - {formatDate(lease.endDate)}
          </div>

          {/* Financial Summary */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 bg-muted/30 rounded-lg border border-border/40">
              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                <DollarSign className="h-3 w-3" />
                <span className="text-[10px] font-medium uppercase tracking-wide">
                  {t("leases.card.rent", { defaultValue: "Rent" })}
                </span>
              </div>
              <p className="text-sm font-bold text-foreground">
                {formatCurrency(leaseRentAmount(lease))}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {frequencyLabel(lease)}
              </p>
            </div>
            <div className="p-2.5 bg-muted/30 rounded-lg border border-border/40">
              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                <DollarSign className="h-3 w-3" />
                <span className="text-[10px] font-medium uppercase tracking-wide">
                  {t("leases.card.deposit", { defaultValue: "Deposit" })}
                </span>
              </div>
              <p className="text-sm font-bold text-foreground">
                {formatCurrency(lease.terms.securityDeposit ?? 0)}
              </p>
            </div>
          </div>

          {/* Property Details */}
          <div className="flex flex-wrap gap-1.5">
            {lease.unit ? (
              <>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium">
                  {t("leases.card.bedrooms", { defaultValue: "{count} bed", values: { count: lease.unit.bedrooms } })}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium">
                  {t("leases.card.bathrooms", { defaultValue: "{count} bath", values: { count: lease.unit.bathrooms } })}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium">
                  {lease.unit.squareFootage.toLocaleString()}{" "}
                  {t("properties.labels.squareFeetUnit", { defaultValue: "m²" })}
                </Badge>
                {lease.unit.floor && (
                  <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium">
                    {t("leases.card.floor", { defaultValue: "Floor {floor}", values: { floor: lease.unit.floor } })}
                  </Badge>
                )}
              </>
            ) : (
              <>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium">
                  {t("leases.card.bedrooms", { defaultValue: "{count} bed", values: { count: lease?.propertyId?.bedrooms ?? 0 } })}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium">
                  {t("leases.card.bathrooms", { defaultValue: "{count} bath", values: { count: lease?.propertyId?.bathrooms ?? 0 } })}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium">
                  {lease?.propertyId?.squareFootage?.toLocaleString()}{" "}
                  {t("properties.labels.squareFeetUnit", { defaultValue: "m²" })}
                </Badge>
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <Button variant="outline" size="sm" className="w-full h-8 text-xs" asChild>
              <Link href={`/dashboard/leases/${lease._id}`}>
                <Eye className="me-1.5 h-3.5 w-3.5" />
                {t("leases.card.viewDetails", { defaultValue: "View details" })}
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="w-full h-8 text-xs" asChild>
              <Link href={`/dashboard/leases/${lease._id}/invoice`}>
                <FileText className="me-1.5 h-3.5 w-3.5" />
                {t("leases.card.invoice", { defaultValue: "Invoice" })}
              </Link>
            </Button>
          </div>
          <LeaseInvoiceModal
            lease={lease}
            trigger={
              <Button variant="ghost" size="sm" className="w-full h-7 text-xs text-muted-foreground hover:text-foreground">
                <Download className="me-1.5 h-3.5 w-3.5" />
                PDF
              </Button>
            }
          />
        </CardContent>
      </Card>
      {/* The terminate form itself, not a one-click confirmation: it asks
          for the date and the reason and shows what is still owed. The card
          used to flip the status alone, which left the contract in the
          Cancelled register with neither. */}
      <TerminateContractDialog
        open={showTerminateDialog}
        onOpenChange={setShowTerminateDialog}
        leaseId={lease._id}
        propertyName={lease.propertyId?.name || "—"}
        onTerminated={() => onUpdate?.()}
      />
    </>
  );
}
