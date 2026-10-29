/**
 * PropertyPro - Lease Selector Component
 * Enhanced lease selection component for tenants with multiple leases
 */

"use client";

import React from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Check,
  ChevronsUpDown,
  Building2,
  Calendar,
  DollarSign,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { usePropertyTypeLabel } from "@/hooks/use-property-categories";

interface Lease {
  _id: string;
  propertyId: {
    name: string;
    address: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
    type: string;
  };
  startDate: string;
  endDate: string;
  status: string;
  terms: {
    rentAmount: number;
  };
  daysUntilExpiration: number;
  daysUntilStart: number;
  isActive: boolean;
  isUpcoming: boolean;
  isExpired: boolean;
}

import { formatCurrency } from "@/lib/utils/formatting";

interface LeaseSelectorProps {
  leases: Lease[];
  selectedLeaseId: string;
  onLeaseChange: (leaseId: string) => void;
  variant?: "simple" | "detailed" | "compact";
  className?: string;
}

export default function LeaseSelector({
  leases,
  selectedLeaseId,
  onLeaseChange,
  variant = "simple",
  className,
}: LeaseSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const { t, formatDate: formatLocalizedDate } = useLocalizationContext();

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

  const formatAddress = (address: any) => {
    if (!address) return t("leases.labels.addressNotAvailable");
    if (typeof address === "string") return address;
    if (typeof address === "object") {
      const { street, city, state, zipCode } = address;
      return `${street || ""}, ${city || ""}, ${state || ""} ${zipCode || ""}`
        .replace(/,\s*,/g, ",")
        .replace(/^\s*,\s*|\s*,\s*$/g, "");
    }
    return t("leases.labels.addressNotAvailable");
  };

  const getStatusBadge = (lease: Lease) => {
    if (lease.isActive) {
      return (
        <Badge variant="default" className="bg-green-500">
          {t("leases.status.active")}
        </Badge>
      );
    } else if (lease.isUpcoming) {
      return (
        <Badge variant="outline" className="border-blue-500 text-blue-500">
          {t("leases.myLeases.status.upcoming")}
        </Badge>
      );
    } else if (lease.isExpired) {
      return (
        <Badge variant="secondary" className="bg-gray-500">
          {t("leases.status.expired")}
        </Badge>
      );
    }
    return (
      <Badge variant="outline">
        {t(`leases.status.${lease.status}`, { defaultValue: lease.status })}
      </Badge>
    );
  };

  const getSelectedLease = () => {
    return leases.find((lease) => lease._id === selectedLeaseId);
  };

  if (leases.length <= 1) {
    return null; // Don't show selector if there's only one lease
  }

  if (variant === "simple") {
    return (
      <Select value={selectedLeaseId} onValueChange={onLeaseChange}>
        <SelectTrigger className={cn("w-64", className)}>
          <SelectValue
            placeholder={t("leases.myLeases.filters.selectLease", {
              defaultValue: "Select a lease",
            })}
          />
        </SelectTrigger>
        <SelectContent>
          {leases.map((lease) => (
            <SelectItem key={lease._id} value={lease._id}>
              <div className="flex items-center justify-between w-full">
                <span>
                  {lease.propertyId?.name ||
                    t("leases.invoices.table.property")}
                </span>
                {getStatusBadge(lease)}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (variant === "compact") {
    const selectedLease = getSelectedLease();

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-64 justify-between", className)}
          >
            {selectedLease ? (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span className="truncate">
                  {selectedLease.propertyId?.name}
                </span>
                {getStatusBadge(selectedLease)}
              </div>
            ) : (
              t("leases.myLeases.filters.selectLease", {
                defaultValue: "Select lease...",
              })
            )}
            <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0">
          <Command>
            <CommandInput
              placeholder={t("leases.myLeases.filters.searchPlaceholder")}
            />
            <CommandEmpty>{t("leases.myLeases.empty.noLeases")}</CommandEmpty>
            <CommandGroup>
              {leases.map((lease) => (
                <CommandItem
                  key={lease._id}
                  value={lease._id}
                  onSelect={() => {
                    onLeaseChange(lease._id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "me-2 h-4 w-4",
                      selectedLeaseId === lease._id
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                  <div className="flex items-center justify-between w-full">
                    <div>
                      <p className="font-medium">{lease.propertyId?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {`${formatCurrency(lease.terms?.rentAmount || 0)} ${t(
                          "leases.labels.perMonth"
                        )}`}
                      </p>
                    </div>
                    {getStatusBadge(lease)}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  if (variant === "detailed") {
    return (
      <div className={cn("space-y-4", className)}>
        <h3 className="text-lg font-semibold">
          {t("leases.myLeases.header.title")}
        </h3>
        <div className="grid gap-4">
          {leases.map((lease) => (
            <Card
              key={lease._id}
              className={cn(
                "cursor-pointer transition-all hover:shadow-md",
                selectedLeaseId === lease._id
                  ? "ring-2 ring-primary border-primary"
                  : "hover:border-primary/50"
              )}
              onClick={() => onLeaseChange(lease._id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {lease.propertyId?.name}
                  </CardTitle>
                  {getStatusBadge(lease)}
                </div>
                <CardDescription className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {formatAddress(lease.propertyId?.address)}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {t("leases.myLeases.table.leasePeriod")}
                      </p>
                      <p className="text-muted-foreground">
                        {formatDate(lease.startDate)} -{" "}
                        {formatDate(lease.endDate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {t("leases.myLeases.table.monthlyRent")}
                      </p>
                      <p className="text-muted-foreground">
                        {formatCurrency(lease.terms?.rentAmount || 0)}
                      </p>
                    </div>
                  </div>
                </div>

                {lease.isActive && (
                  <div className="mt-3 p-2 bg-green-50 rounded-lg">
                    <p className="text-sm text-green-700">
                      {lease.daysUntilExpiration > 0
                        ? t("leases.myLeases.daysRemaining", {
                            values: { days: lease.daysUntilExpiration },
                          })
                        : lease.daysUntilExpiration === 0
                        ? t("leases.myLeases.expiresToday")
                        : t("leases.myLeases.expiredDaysAgo", {
                            values: {
                              days: Math.abs(lease.daysUntilExpiration),
                            },
                          })}
                    </p>
                  </div>
                )}

                {lease.isUpcoming && (
                  <div className="mt-3 p-2 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-700">
                      {t("leases.myLeases.startsInDays", {
                        values: { days: lease.daysUntilStart },
                      })}
                    </p>
                  </div>
                )}

                {lease.isExpired && (
                  <div className="mt-3 p-2 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-700">
                      {t("leases.myLeases.expiredDaysAgo", {
                        values: { days: Math.abs(lease.daysUntilExpiration) },
                      })}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

// Export a summary component for lease overview
export function LeaseOverview({ lease }: { lease: Lease }) {
  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const { t, formatDate: formatLocalizedDate } = useLocalizationContext();
  const propertyTypeLabel = usePropertyTypeLabel();
  const formatDate = (date: string) => {
    return formatLocalizedDate(new Date(date), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatAddress = (address: any) => {
    if (!address) return t("leases.labels.addressNotAvailable");
    if (typeof address === "string") return address;
    if (typeof address === "object") {
      const { street, city, state, zipCode } = address;
      return `${street || ""}, ${city || ""}, ${state || ""} ${zipCode || ""}`
        .replace(/,\s*,/g, ",")
        .replace(/^\s*,\s*|\s*,\s*$/g, "");
    }
    return t("leases.labels.addressNotAvailable");
  };

  const getStatusBadge = (lease: Lease) => {
    if (lease.isActive) {
      return (
        <Badge variant="default" className="bg-green-500">
          {t("leases.status.active")}
        </Badge>
      );
    } else if (lease.isUpcoming) {
      return (
        <Badge variant="outline" className="border-blue-500 text-blue-500">
          {t("leases.myLeases.status.upcoming")}
        </Badge>
      );
    } else if (lease.isExpired) {
      return (
        <Badge variant="secondary" className="bg-gray-500">
          {t("leases.status.expired")}
        </Badge>
      );
    }
    return (
      <Badge variant="outline">
        {t(`leases.status.${lease.status}`, { defaultValue: lease.status })}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {lease.propertyId?.name}
          </CardTitle>
          {getStatusBadge(lease)}
        </div>
        <CardDescription className="flex items-center gap-1">
          <MapPin className="h-4 w-4" />
          {formatAddress(lease.propertyId?.address)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              {t("leases.myLeases.dialog.propertyType")}
            </label>
            <p className="capitalize">{propertyTypeLabel(lease.propertyId?.type)}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              {t("leases.myLeases.table.leasePeriod")}
            </label>
            <p className="font-semibold">
              {formatDate(lease.startDate)} - {formatDate(lease.endDate)}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              {t("leases.myLeases.table.monthlyRent")}
            </label>
            <p className="text-lg font-semibold">
              {formatCurrency(lease.terms?.rentAmount || 0)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
