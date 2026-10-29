/**
 * PropertyPro - Lease Table Component
 * Comprehensive table for displaying and managing tenant leases
 */

"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { usePropertyTypeLabel } from "@/hooks/use-property-categories";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";
import {
  Building2,
  Calendar,
  Download,
  Eye,
  MoreHorizontal,
  MessageSquare,
  FileText,
  AlertTriangle,
  CheckCircle,
  Clock,
  MapPin,
  Home,
} from "lucide-react";

export interface Lease {
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
  startDate: string;
  endDate: string;
  status: string;
  /** The contract's rent per installment and how often it falls due. */
  rentAmount?: number;
  paymentFrequency?: string;
  terms: {
    rentAmount: number;
    securityDeposit?: number;
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
  };
}
import { formatCurrency } from "@/lib/utils/formatting";
import { leaseRentAmount } from "@/lib/lease-money";
import { useFrequencyLabel } from "@/components/leases/ContractRent";

interface LeaseTableProps {
  leases: Lease[];
  onLeaseAction?: (action: string, lease: Lease) => void;
  className?: string;
}

const ITEMS_PER_PAGE = 12;

export default function LeaseTable({
  leases,
  onLeaseAction,
  className,
}: LeaseTableProps) {
  const { t, formatDate: formatLocalizedDate } = useLocalizationContext();
  const propertyTypeLabel = usePropertyTypeLabel();
  const frequencyLabel = useFrequencyLabel();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);

  // The words on a lease's status badge, which its column sorts by.
  const statusLabel = (lease: Lease) =>
    lease.isActive
      ? t("leases.status.active")
      : lease.isUpcoming
        ? t("leases.myLeases.status.upcoming")
        : lease.isExpired
          ? t("leases.status.expired")
          : lease.status;

  // The whole list sorts, then pages; a new order starts on its first page.
  const sorted = useTableSort(leases, {
    property: (lease) => lease.propertyId.name,
    period: (lease) => new Date(lease.startDate),
    rent: (lease) => leaseRentAmount(lease),
    status: statusLabel,
    // The count the column shows, signed: days left (or until the start)
    // ahead, days since it ended behind.
    days: (lease) =>
      lease.isUpcoming
        ? lease.daysUntilStart
        : lease.isActive || lease.isExpired
          ? lease.daysUntilExpiration
          : null,
  });
  const sort = {
    ...sorted,
    toggle: (column: string) => {
      sorted.toggle(column);
      setCurrentPage(1);
    },
  };

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentLeases = sorted.rows.slice(startIndex, endIndex);

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const formatDate = (date: string) => {
    return formatLocalizedDate(new Date(date), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatAddress = (address: Lease["propertyId"]["address"]) => {
    if (!address) {
      return t("leases.labels.addressNotAvailable");
    }

    if (typeof address === "string") {
      return address;
    }

    const { street, city, state, zipCode, country } = address;
    const cityState = [city, state].filter(Boolean).join(", ");
    return (
      [street, cityState, zipCode, country]
        .filter((segment) => (segment?.toString().trim().length ?? 0) > 0)
        .join(", ") || t("leases.labels.addressNotAvailable")
    );
  };

  const getStatusBadge = (lease: Lease) => {
    if (lease.isActive) {
      return (
        <Badge variant="default" className="bg-green-500">
          <CheckCircle className="w-3 h-3 me-1" />
          {statusLabel(lease)}
        </Badge>
      );
    } else if (lease.isUpcoming) {
      return (
        <Badge variant="outline" className="border-blue-500 text-blue-500">
          <Clock className="w-3 h-3 me-1" />
          {statusLabel(lease)}
        </Badge>
      );
    } else if (lease.isExpired) {
      return (
        <Badge variant="secondary" className="bg-gray-500">
          <AlertTriangle className="w-3 h-3 me-1" />
          {statusLabel(lease)}
        </Badge>
      );
    }
    return <Badge variant="outline">{statusLabel(lease)}</Badge>;
  };

  const getDaysDisplay = (lease: Lease) => {
    if (lease.isActive) {
      if (lease.daysUntilExpiration > 0) {
        return (
          <span className="text-sm text-muted-foreground">
            {t("leases.myLeases.daysRemaining", {
              values: { days: lease.daysUntilExpiration },
            })}
          </span>
        );
      } else if (lease.daysUntilExpiration === 0) {
        return (
          <span className="text-sm text-red-600 font-medium">
            {t("leases.myLeases.expiresToday")}
          </span>
        );
      } else {
        return (
          <span className="text-sm text-red-600">
            {t("leases.myLeases.expiredDaysAgo", {
              values: { days: Math.abs(lease.daysUntilExpiration) },
            })}
          </span>
        );
      }
    } else if (lease.isUpcoming) {
      return (
        <span className="text-sm text-blue-600">
          {t("leases.myLeases.startsInDays", {
            values: { days: lease.daysUntilStart },
          })}
        </span>
      );
    } else if (lease.isExpired) {
      return (
        <span className="text-sm text-gray-600">
          {t("leases.myLeases.expiredDaysAgo", {
            values: { days: Math.abs(lease.daysUntilExpiration) },
          })}
        </span>
      );
    }
    return null;
  };

  const handleAction = (action: string, lease: Lease) => {
    onLeaseAction?.(action, lease);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {t("leases.myLeases.card.title", {
              values: { count: leases.length },
            })}
          </CardTitle>
          <CardDescription>
            {t("leases.myLeases.card.subtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {leases.length === 0 ? (
            <div className="text-center py-8">
              <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {t("leases.myLeases.empty.noLeases")}
              </h3>
              <p className="text-muted-foreground">
                {t("leases.myLeases.empty.noLeasesDescription")}
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead sort={sort} column="property">
                        {t("leases.myLeases.table.property")}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="period">
                        {t("leases.myLeases.table.leasePeriod")}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="rent">
                        {t("leases.card.rent", { defaultValue: "Rent" })}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="status">
                        {t("leases.table.status")}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="days">
                        {t("leases.myLeases.table.daysUntil")}
                      </SortableTableHead>
                      <TableHead className="text-end">
                        {t("leases.table.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentLeases.map((lease) => (
                      <TableRow key={lease._id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <div className="font-medium">
                              {lease.propertyId.name}
                            </div>
                            <div className="text-sm text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {formatAddress(lease.propertyId.address)}
                            </div>
                            <div className="text-xs text-muted-foreground capitalize">
                              {propertyTypeLabel(lease.propertyId.type)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <div className="text-sm font-medium">
                              {formatDate(lease.startDate)} -{" "}
                              {formatDate(lease.endDate)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t("leases.myLeases.months", {
                                values: {
                                  count: Math.ceil(
                                    (new Date(lease.endDate).getTime() -
                                      new Date(lease.startDate).getTime()) /
                                      (1000 * 60 * 60 * 24 * 30)
                                  ),
                                },
                              })}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <div className="font-medium">
                              {formatCurrency(leaseRentAmount(lease))}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {frequencyLabel(lease)}
                            </div>
                            {(lease.terms.securityDeposit ?? 0) > 0 && (
                              <div className="text-xs text-muted-foreground">
                                {t("leases.myLeases.deposit")}{" "}
                                {formatCurrency(lease.terms.securityDeposit)}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(lease)}</TableCell>
                        <TableCell>{getDaysDisplay(lease)}</TableCell>
                        <TableCell className="text-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">
                                  {t("leases.myLeases.actions.openMenu")}
                                </span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {/* The tenant's own contract, read-only: its
                                  installments, payments and documents. This
                                  used to open a summary with none of them. */}
                              <DropdownMenuItem asChild>
                                <Link href={`/dashboard/leases/${lease._id}`}>
                                  <Eye className="me-2 h-4 w-4" />
                                  {t("leases.myLeases.actions.viewDetails")}
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleAction("download-agreement", lease)
                                }
                              >
                                <Download className="me-2 h-4 w-4" />
                                {t("leases.myLeases.actions.downloadAgreement")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleAction("view-invoices", lease)
                                }
                              >
                                <FileText className="me-2 h-4 w-4" />
                                {t("leases.myLeases.actions.viewInvoices")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleAction("contact-manager", lease)
                                }
                              >
                                <MessageSquare className="me-2 h-4 w-4" />
                                {t("leases.myLeases.actions.contactManager")}
                              </DropdownMenuItem>
                              {lease.renewalOptions?.available && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleAction("request-renewal", lease)
                                  }
                                >
                                  <Calendar className="me-2 h-4 w-4" />
                                  {t("leases.myLeases.actions.requestRenewal")}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <GlobalPagination
                currentPage={currentPage}
                totalPages={Math.max(1, Math.ceil(leases.length / pageSize))}
                totalItems={leases.length}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                showingLabel={t("common.showing", { defaultValue: "Showing" })}
                previousLabel={t("common.previous", { defaultValue: "Previous" })}
                nextLabel={t("common.next", { defaultValue: "Next" })}
                pageLabel={t("common.page", { defaultValue: "Page" })}
                ofLabel={t("common.of", { defaultValue: "of" })}
                itemsPerPageLabel={t("common.perPage", { defaultValue: "per page" })}
              />
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
