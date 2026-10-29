"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useUiText } from "@/components/ui/use-ui-text";

export interface GlobalPaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
  showingText?: string;
  showingLabel?: string;
  previousLabel?: string;
  nextLabel?: string;
  pageLabel?: string;
  ofLabel?: string;
  itemsPerPageLabel?: string;
  className?: string;
  disabled?: boolean;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [12, 20, 50, 100];

export function GlobalPagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  showPageSizeSelector = true,
  showingText,
  showingLabel = "Showing",
  previousLabel = "Previous",
  nextLabel = "Next",
  pageLabel = "Page",
  ofLabel = "of",
  itemsPerPageLabel: itemsPerPageLabelProp,
  className,
  disabled = false,
}: GlobalPaginationProps) {
  const { text } = useUiText();
  const itemsPerPageLabel = itemsPerPageLabelProp ?? text("ui.perPage", "per page");
  // Always calculate total pages client-side based on totalItems and pageSize
  // This ensures accuracy regardless of what the API returns
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Calculate showing range
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | "ellipsis")[] = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage > 3) {
        pages.push("ellipsis");
      }

      // Show pages around current page
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) {
          pages.push(i);
        }
      }

      if (currentPage < totalPages - 2) {
        pages.push("ellipsis");
      }

      // Always show last page
      if (!pages.includes(totalPages)) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  const handlePageSizeChange = (value: string) => {
    const newPageSize = parseInt(value, 10);
    onPageSizeChange?.(newPageSize);
    // Reset to page 1 when page size changes
    onPageChange(1);
  };

  if (totalItems === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-3",
        className,
      )}
    >
      {/* Left side - Showing info and page size selector */}
      <div className="flex flex-col sm:flex-row items-center gap-4 text-sm text-muted-foreground">
        <span>
          {showingText ||
            `${showingLabel} ${startItem}-${endItem} ${ofLabel} ${totalItems}`}
        </span>

        {showPageSizeSelector && onPageSizeChange && (
          <div className="flex items-center gap-2">
            <Select
              value={pageSize.toString()}
              onValueChange={handlePageSizeChange}
              disabled={disabled}
            >
              <SelectTrigger className="h-8! w-17 p-2">
                <SelectValue placeholder={pageSize.toString()} />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">{itemsPerPageLabel}</span>
          </div>
        )}
      </div>

      {/* Right side - Pagination controls (always visible) */}
      <div className="flex items-center gap-2">
        {/* Previous button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1 || disabled}
          className="h-8"
        >
          <ChevronLeft className="h-4 w-4 me-1 rtl:rotate-180" />
          {previousLabel}
        </Button>

        {/* Page numbers */}
        <div className="hidden sm:flex items-center gap-1">
          {getPageNumbers().map((page, index) =>
            page === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">
                ...
              </span>
            ) : (
              <Button
                key={page}
                variant={currentPage === page ? "default" : "outline"}
                size="sm"
                onClick={() => onPageChange(page)}
                disabled={disabled}
                className="h-8 w-8 p-0"
              >
                {page}
              </Button>
            ),
          )}
        </div>

        {/* Mobile page indicator */}
        <span className="sm:hidden text-sm text-muted-foreground">
          {pageLabel} {currentPage} {ofLabel} {totalPages}
        </span>

        {/* Next button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages || disabled}
          className="h-8"
        >
          {nextLabel}
          <ChevronRight className="h-4 w-4 ms-1 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}

// Hook for managing pagination state
export function usePagination(initialPageSize: number = 12) {
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(initialPageSize);
  const [totalItems, setTotalItems] = React.useState(0);

  const totalPages = Math.ceil(totalItems / pageSize) || 1;

  const handlePageChange = React.useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handlePageSizeChange = React.useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // Reset to first page
  }, []);

  const resetPagination = React.useCallback(() => {
    setCurrentPage(1);
  }, []);

  return {
    currentPage,
    pageSize,
    totalItems,
    totalPages,
    setCurrentPage,
    setPageSize,
    setTotalItems,
    handlePageChange,
    handlePageSizeChange,
    resetPagination,
  };
}

export default GlobalPagination;
