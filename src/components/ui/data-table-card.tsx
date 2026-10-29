"use client";

/**
 * PropertyPro - Data table card
 *
 * The list surface every tenant-facing page already renders by hand: a titled
 * card whose header carries the search box and the filter row, a `DataTable`
 * body, and `GlobalPagination` underneath. The platform console rebuilt a
 * different half of it on each page — some with pagination, some without, none
 * with the debounced search or the page-size picker — so the same table read
 * differently depending on where you opened it.
 *
 * Composed rather than invented: search, table and pagination are the existing
 * components, this only fixes their arrangement so every list matches.
 */

import * as React from "react";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { GlobalSearch } from "@/components/ui/global-search";
import { GlobalPagination } from "@/components/ui/global-pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataTableProps } from "@/components/ui/data-table";

export interface DataTableCardFilterOption {
  value: string;
  label: React.ReactNode;
}

export interface DataTableCardFilter {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: DataTableCardFilterOption[];
  placeholder?: string;
  ariaLabel?: string;
  /** Width utility for the trigger; defaults to `w-[150px]`. */
  width?: string;
}

export interface DataTableCardSearch {
  /** Current term — also the value the input resets to when cleared upstream. */
  value: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  isLoading?: boolean;
  debounceDelay?: number;
}

export interface DataTableCardPagination {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  /** Omit to hide the page-size picker. */
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  disabled?: boolean;
}

export interface DataTableCardProps<T>
  extends Omit<DataTableProps<T>, "pagination"> {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right side of the header row — refresh, export, create… */
  headerActions?: React.ReactNode;
  search?: DataTableCardSearch;
  filters?: DataTableCardFilter[];
  /** Extra controls appended to the filter row (date ranges, toggles…). */
  filterExtras?: React.ReactNode;
  /** Shows the reset button when true and `onResetFilters` is given. */
  filtersActive?: boolean;
  onResetFilters?: () => void;
  resetLabel?: string;
  pagination?: DataTableCardPagination;
  cardClassName?: string;
}

function DataTableCard<T>({
  icon: Icon,
  title,
  description,
  headerActions,
  search,
  filters,
  filterExtras,
  filtersActive = false,
  onResetFilters,
  resetLabel = "Clear",
  pagination,
  cardClassName,
  ...tableProps
}: DataTableCardProps<T>) {
  const hasFilterBar = Boolean(
    search || (filters && filters.length > 0) || filterExtras,
  );

  return (
    <Card className={cn("gap-2", cardClassName)}>
      <CardHeader>
        <div className="mb-2 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            {Icon && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-2 dark:border-blue-800 dark:bg-blue-900/30">
                <Icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
            )}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {title}
              </h2>
              {description && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {description}
                </p>
              )}
            </div>
          </div>

          {headerActions && (
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              {headerActions}
            </div>
          )}
        </div>

        {hasFilterBar && (
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 lg:flex-row lg:items-center dark:border-gray-700/60 dark:bg-gray-800/50">
            {search && (
              <GlobalSearch
                placeholder={search.placeholder}
                initialValue={search.value}
                debounceDelay={search.debounceDelay ?? 300}
                onSearch={search.onSearch}
                isLoading={search.isLoading}
                ariaLabel={search.ariaLabel}
                className="min-w-0 flex-1"
              />
            )}

            {(filters?.length || filterExtras || onResetFilters) && (
              <div className="flex flex-wrap items-center gap-3">
                {filters?.map((filter) => (
                  <Select
                    key={filter.id}
                    value={filter.value}
                    onValueChange={filter.onChange}
                  >
                    <SelectTrigger
                      aria-label={filter.ariaLabel}
                      className={cn(
                        "h-10 border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800",
                        filter.width ?? "w-[150px]",
                      )}
                    >
                      <SelectValue placeholder={filter.placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {filter.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ))}

                {filterExtras}

                {filtersActive && onResetFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onResetFilters}
                    className="h-10 px-3 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    <X className="me-1 h-4 w-4" />
                    {resetLabel}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent>
        <DataTable<T> {...tableProps} />

        {pagination && (
          <GlobalPagination
            currentPage={pagination.currentPage}
            totalPages={Math.max(
              1,
              Math.ceil(pagination.totalItems / pagination.pageSize),
            )}
            totalItems={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={pagination.onPageChange}
            onPageSizeChange={pagination.onPageSizeChange}
            pageSizeOptions={pagination.pageSizeOptions}
            disabled={pagination.disabled ?? tableProps.loading}
          />
        )}
      </CardContent>
    </Card>
  );
}

export { DataTableCard };
export default DataTableCard;
