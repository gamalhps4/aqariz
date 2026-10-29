"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Search,
  X,
  Calendar as CalendarIcon,
} from "lucide-react";
import { format } from "date-fns";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface TenantFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  onFiltersChange?: (filters: TenantFilterOptions) => void;
}

interface TenantFilterOptions {
  search: string;
  status: string;
  creditScoreMin?: number;
  creditScoreMax?: number;
  incomeMin?: number;
  incomeMax?: number;
  applicationDateFrom?: Date;
  applicationDateTo?: Date;
  hasEmployment?: boolean;
}

export default function TenantFilters({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onFiltersChange,
}: TenantFiltersProps) {
  const { t } = useLocalizationContext();
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filters, setFilters] = useState<TenantFilterOptions>({
    search: searchTerm,
    status: statusFilter,
  });

  const [activeFiltersCount, setActiveFiltersCount] = useState(0);

  const handleFilterChange = (key: keyof TenantFilterOptions, value: any) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);

    const count = Object.entries(newFilters).filter(([k, v]) => {
      if (k === "search" || k === "status") return false;
      return v !== undefined && v !== null && v !== "";
    }).length;
    setActiveFiltersCount(count);

    onFiltersChange?.(newFilters);
  };

  const clearAllFilters = () => {
    // Reset parent-controlled filters
    onSearchChange("");
    onStatusFilterChange("all");

    // Reset local advanced filters state
    const clearedFilters: TenantFilterOptions = {
      search: "",
      status: "all",
      creditScoreMin: undefined,
      creditScoreMax: undefined,
      incomeMin: undefined,
      incomeMax: undefined,
      applicationDateFrom: undefined,
      applicationDateTo: undefined,
      hasEmployment: undefined,
    };

    setFilters(clearedFilters);
    setActiveFiltersCount(0);
    onFiltersChange?.(clearedFilters);
  };

  const statusOptions = [
    { value: "all", label: t("tenants.filters.status.all") },
    { value: "pending", label: t("tenants.filters.status.pending") },
    { value: "approved", label: t("tenants.filters.status.approved") },
    { value: "active", label: t("tenants.filters.status.active") },
    { value: "inactive", label: t("tenants.filters.status.inactive") },
    { value: "moved_out", label: t("tenants.filters.status.movedOut") },
    { value: "terminated", label: t("tenants.filters.status.terminated") },
    {
      value: "application_submitted",
      label: t("tenants.filters.status.applicationSubmitted"),
    },
    { value: "under_review", label: t("tenants.filters.status.underReview") },
  ];

  return (
    <div className="space-y-4">
      <Card className="gap-0">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                {t("tenants.filters.title")}
              </CardTitle>
              <CardDescription>
                {t("tenants.filters.description")}
              </CardDescription>
            </div>
            {/* <div className="flex items-center gap-2">
              {activeFiltersCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {activeFiltersCount} filter
                  {activeFiltersCount !== 1 ? "s" : ""} active
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              >
                <SlidersHorizontal className="h-4 w-4 me-2" />
                Advanced
              </Button>
            </div> */}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("tenants.filters.searchPlaceholder")}
                  value={searchTerm}
                  onChange={(e) => {
                    onSearchChange(e.target.value);
                    handleFilterChange("search", e.target.value);
                  }}
                  className="ps-10"
                />
              </div>
            </div>
            <div className="w-48">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  onStatusFilterChange(value);
                  handleFilterChange("status", value);
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("tenants.filters.statusPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(activeFiltersCount > 0 ||
              searchTerm ||
              statusFilter !== "all") && (
              <Button
                variant="outline"
                size="icon"
                onClick={clearAllFilters}
                title={t("tenants.filters.clearAll")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {showAdvancedFilters && (
            <div className="border-t pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Credit Score Range
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Min"
                      min="300"
                      max="850"
                      value={filters.creditScoreMin || ""}
                      onChange={(e) =>
                        handleFilterChange(
                          "creditScoreMin",
                          e.target.value ? Number(e.target.value) : undefined
                        )
                      }
                    />
                    <Input
                      type="number"
                      placeholder="Max"
                      min="300"
                      max="850"
                      value={filters.creditScoreMax || ""}
                      onChange={(e) =>
                        handleFilterChange(
                          "creditScoreMax",
                          e.target.value ? Number(e.target.value) : undefined
                        )
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Annual Income Range
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Min"
                      value={filters.incomeMin || ""}
                      onChange={(e) =>
                        handleFilterChange(
                          "incomeMin",
                          e.target.value ? Number(e.target.value) : undefined
                        )
                      }
                    />
                    <Input
                      type="number"
                      placeholder="Max"
                      value={filters.incomeMax || ""}
                      onChange={(e) =>
                        handleFilterChange(
                          "incomeMax",
                          e.target.value ? Number(e.target.value) : undefined
                        )
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Application Date From
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-start font-normal"
                      >
                        <CalendarIcon className="me-2 h-4 w-4" />
                        {filters.applicationDateFrom ? (
                          format(filters.applicationDateFrom, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={filters.applicationDateFrom}
                        onSelect={(date) =>
                          handleFilterChange("applicationDateFrom", date)
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Application Date To
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-start font-normal"
                      >
                        <CalendarIcon className="me-2 h-4 w-4" />
                        {filters.applicationDateTo ? (
                          format(filters.applicationDateTo, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={filters.applicationDateTo}
                        onSelect={(date) =>
                          handleFilterChange("applicationDateTo", date)
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Employment Status
                  </Label>
                  <Select
                    value={
                      filters.hasEmployment === undefined
                        ? "ANY_STATUS"
                        : filters.hasEmployment.toString()
                    }
                    onValueChange={(value) =>
                      handleFilterChange(
                        "hasEmployment",
                        value === "ANY_STATUS" ? undefined : value === "true"
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Any status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANY_STATUS">Any Status</SelectItem>
                      <SelectItem value="true">Employed</SelectItem>
                      <SelectItem value="false">Unemployed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
