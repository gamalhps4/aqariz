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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  SortAsc,
  SortDesc,
  Filter,
  X,
  Calendar,
  DollarSign,
  User,
  Mail,
  Phone,
} from "lucide-react";

interface SortOption {
  field: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface TenantSearchSortProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  sortField: string;
  sortDirection: "asc" | "desc";
  onSortChange: (field: string, direction: "asc" | "desc") => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  totalCount: number;
  filteredCount: number;
}

export default function TenantSearchSort({
  searchTerm,
  onSearchChange,
  sortField,
  sortDirection,
  onSortChange,
  statusFilter,
  onStatusFilterChange,
  totalCount,
  filteredCount,
}: TenantSearchSortProps) {
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);

  const sortOptions: SortOption[] = [
    { field: "name", label: "Name", icon: User },
    { field: "email", label: "Email", icon: Mail },
    { field: "phone", label: "Phone", icon: Phone },
    { field: "applicationDate", label: "Application Date", icon: Calendar },
    { field: "moveInDate", label: "Move-in Date", icon: Calendar },
    { field: "creditScore", label: "Credit Score", icon: DollarSign },
    { field: "income", label: "Income", icon: DollarSign },
    { field: "createdAt", label: "Created Date", icon: Calendar },
  ];

  const statusOptions = [
    { value: "all", label: "All Statuses" },
    { value: "application_submitted", label: "Application Submitted" },
    { value: "under_review", label: "Under Review" },
    { value: "approved", label: "Approved" },
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
    { value: "moved_out", label: "Moved Out" },
    { value: "terminated", label: "Terminated" },
  ];

  const handleSortClick = (field: string) => {
    if (sortField === field) {
      onSortChange(field, sortDirection === "asc" ? "desc" : "asc");
    } else {
      onSortChange(field, "asc");
    }
  };

  const clearSearch = () => {
    onSearchChange("");
  };

  const clearAllFilters = () => {
    onSearchChange("");
    onStatusFilterChange("all");
    onSortChange("name", "asc");
  };

  const hasActiveFilters = searchTerm || statusFilter !== "all";
  const isFiltered = filteredCount !== totalCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tenants by name, email, or phone..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="ps-10 pe-10"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSearch}
              className="absolute end-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full sm:w-auto">
              {sortDirection === "asc" ? (
                <SortAsc className="h-4 w-4 me-2" />
              ) : (
                <SortDesc className="h-4 w-4 me-2" />
              )}
              Sort by{" "}
              {sortOptions.find((opt) => opt.field === sortField)?.label ||
                "Name"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Sort Options</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {sortOptions.map((option) => {
              const Icon = option.icon;
              const isActive = sortField === option.field;
              return (
                <DropdownMenuItem
                  key={option.field}
                  onClick={() => handleSortClick(option.field)}
                  className={isActive ? "bg-muted" : ""}
                >
                  <Icon className="h-4 w-4 me-2" />
                  {option.label}
                  {isActive && (
                    <div className="ms-auto">
                      {sortDirection === "asc" ? (
                        <SortAsc className="h-4 w-4" />
                      ) : (
                        <SortDesc className="h-4 w-4" />
                      )}
                    </div>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
          className="w-full sm:w-auto"
        >
          <Filter className="h-4 w-4 me-2" />
          Advanced
        </Button>
      </div>

      {(hasActiveFilters || isFiltered) && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isFiltered && (
              <Badge variant="secondary" className="text-xs">
                Showing {filteredCount} of {totalCount} tenants
              </Badge>
            )}
            {searchTerm && (
              <Badge variant="outline" className="text-xs">
                Search: "{searchTerm}"
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSearch}
                  className="ms-1 h-4 w-4 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )}
            {statusFilter !== "all" && (
              <Badge variant="outline" className="text-xs">
                Status:{" "}
                {statusOptions.find((opt) => opt.value === statusFilter)?.label}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onStatusFilterChange("all")}
                  className="ms-1 h-4 w-4 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )}
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear all filters
            </Button>
          )}
        </div>
      )}

      {showAdvancedSearch && (
        <div className="p-4 border rounded-lg bg-muted/20">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Credit Score Range
              </label>
              <div className="flex gap-2">
                <Input placeholder="Min" type="number" />
                <Input placeholder="Max" type="number" />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Income Range
              </label>
              <div className="flex gap-2">
                <Input placeholder="Min" type="number" />
                <Input placeholder="Max" type="number" />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Application Date
              </label>
              <div className="flex gap-2">
                <Input placeholder="From" type="date" />
                <Input placeholder="To" type="date" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowAdvancedSearch(false)}
            >
              Cancel
            </Button>
            <Button>Apply Filters</Button>
          </div>
        </div>
      )}
    </div>
  );
}
