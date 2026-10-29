"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useUiText } from "@/components/ui/use-ui-text";
import {
  nextSort,
  nodeText,
  sortRows,
  textSortValue,
  type SortDirection,
  type SortValue,
} from "@/lib/table-sort";

// Column definition type
export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  /** Responsive visibility: 'always' | 'sm' | 'md' | 'lg' | 'xl' */
  visibility?: "always" | "sm" | "md" | "lg" | "xl";
  /** Width class e.g., 'w-12', 'w-[200px]', 'min-w-[120px]' */
  width?: string;
  /** Text alignment */
  align?: "left" | "center" | "right";
  /**
   * What the column sorts by when its header is clicked. Without it, the
   * text the cell shows (lib/table-sort) — right for names and plain
   * numbers; dates and amounts written out in Arabic need this.
   */
  sortValue?: (row: T) => SortValue;
  /** False for a column with nothing to order (actions, a menu). Columns
   * whose id is "actions" or "select" are left unsortable by default. */
  sortable?: boolean;
  /** The API's name for this column, when the server sorts (`sort` prop). */
  sortKey?: string;
}

/**
 * A table sorted by the server: the page holds the column and direction,
 * sends them with its request, and is told when a header is clicked. Only
 * columns with a `sortKey` sort then — a column the API cannot order by
 * would otherwise re-order one page and pretend it was the whole list.
 */
export interface DataTableSort {
  key: string | null;
  direction: SortDirection;
  onSortChange: (key: string | null, direction: SortDirection) => void;
}

// Selection configuration
export interface DataTableSelection<T> {
  enabled: boolean;
  selectedIds: string[];
  onSelectAll: (checked: boolean) => void;
  onSelectRow: (id: string, checked: boolean) => void;
  getRowId: (row: T) => string;
  isRowDisabled?: (row: T) => boolean;
  selectAllLabel?: string;
  selectRowLabel?: (row: T) => string;
}

// Pagination configuration
export interface DataTablePagination {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  showingText?: string; // e.g., "Showing 1-10 of 100"
  previousLabel?: string;
  nextLabel?: string;
}

// Empty state configuration
export interface DataTableEmptyState {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

// Error state configuration
export interface DataTableErrorState {
  message: string;
  icon?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}

// Loading skeleton configuration
export interface DataTableLoadingConfig {
  rows?: number;
  /** Custom skeleton for each column, or use default */
  columnSkeletons?: Record<string, React.ReactNode>;
}

// Main DataTable props
export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean;
  error?: DataTableErrorState | null;
  emptyState?: DataTableEmptyState;
  selection?: DataTableSelection<T>;
  pagination?: DataTablePagination;
  loadingConfig?: DataTableLoadingConfig;
  /** Container class for the table wrapper */
  containerClassName?: string;
  /** Class for the table element */
  tableClassName?: string;
  /** Enable zebra striping */
  striped?: boolean;
  /** Row key extractor */
  getRowKey: (row: T, index: number) => string;
  /** Custom row class */
  getRowClassName?: (row: T, index: number) => string;
  /** On row click handler */
  onRowClick?: (row: T) => void;
  /**
   * A full-width row directly under a data row, for that row's own breakdown
   * (the payments on an installment, say). Return null for no detail row.
   */
  renderRowDetail?: (row: T, index: number) => React.ReactNode;
  /** Server-side sorting; without it the rows on hand are sorted here. */
  sort?: DataTableSort;
}

/** Columns that hold controls rather than data. */
const UNSORTABLE_COLUMN_IDS = new Set(["actions", "select", "menu"]);

/**
 * What the sorted column's cells show on screen, by row key.
 *
 * A column without a `sortValue` sorts by the text its cells show, and many
 * cells are components (`<Money amount={…} />`, a status badge) whose words
 * exist only once rendered. So after each commit the table reads them from
 * its own DOM into this store, and the store's change re-renders the rows in
 * that order — before paint, from a layout effect, so no unsorted frame
 * shows. An external store rather than state: the read happens in an effect,
 * and only a real change notifies, so it settles after one pass.
 */
interface CellTextStore {
  column: string | null;
  texts: ReadonlyMap<string, string>;
}

function createCellTextStore() {
  let snapshot: CellTextStore = { column: null, texts: new Map() };
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => snapshot,
    set(column: string, texts: Map<string, string>) {
      const same =
        snapshot.column === column &&
        snapshot.texts.size === texts.size &&
        [...texts].every(([key, text]) => snapshot.texts.get(key) === text);
      if (same) return;
      snapshot = { column, texts };
      listeners.forEach((listener) => listener());
    },
  };
}

const EMPTY_CELL_TEXTS: CellTextStore = { column: null, texts: new Map() };

function DataTable<T>({
  columns,
  data,
  loading = false,
  error = null,
  emptyState,
  selection,
  pagination,
  loadingConfig = { rows: 8 },
  containerClassName,
  tableClassName,
  striped = true,
  getRowKey,
  getRowClassName,
  onRowClick,
  renderRowDetail,
  sort,
}: DataTableProps<T>) {
  // Words the table says itself when the page gives none, in the reader's
  // language.
  const { text, language } = useUiText();

  // Every header sorts (the client's ⇅ request): by the server when the page
  // passes `sort`, otherwise here, over the rows on hand.
  const [localSort, setLocalSort] = React.useState<{
    key: string | null;
    direction: SortDirection;
  }>({ key: null, direction: "asc" });

  const sortIdOf = (column: DataTableColumn<T>): string | null => {
    if (column.sortable === false) return null;
    if (column.sortable === undefined && UNSORTABLE_COLUMN_IDS.has(column.id)) {
      return null;
    }
    if (sort) return column.sortKey ?? null;
    return column.id;
  };

  const activeSort = sort ? { key: sort.key, direction: sort.direction } : localSort;

  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const [cellTextStore] = React.useState(createCellTextStore);
  const cellTexts = React.useSyncExternalStore(
    cellTextStore.subscribe,
    cellTextStore.get,
    () => EMPTY_CELL_TEXTS,
  );
  const sortColumn =
    !sort && localSort.key
      ? columns.find((candidate) => candidate.id === localSort.key) ?? null
      : null;
  const readsScreen = Boolean(sortColumn && !sortColumn.sortValue);

  React.useLayoutEffect(() => {
    if (!readsScreen || !sortColumn) return;
    const body = tbodyRef.current;
    if (!body) return;
    const texts = new Map<string, string>();
    body.querySelectorAll<HTMLTableRowElement>("tr[data-row-key]").forEach((row) => {
      const cell = row.querySelector<HTMLElement>(
        `td[data-col="${CSS.escape(sortColumn.id)}"]`,
      );
      // innerText, not textContent: it keeps the space between an amount and
      // the badge beside it, which the amount reader relies on.
      texts.set(row.dataset.rowKey ?? "", cell?.innerText ?? "");
    });
    cellTextStore.set(sortColumn.id, texts);
  });

  const onHeaderClick = (id: string) => {
    const next = nextSort(activeSort, id);
    if (sort) sort.onSortChange(next.key, next.direction);
    else setLocalSort(next);
  };

  const rows = React.useMemo(() => {
    if (!sortColumn) return data;
    const screen = cellTexts.column === sortColumn.id ? cellTexts.texts : null;
    return sortRows(
      data,
      (row, index) => {
        if (sortColumn.sortValue) return sortColumn.sortValue(row);
        // What the screen shows once it has been read; until then (the first
        // pass after a click, a row just fetched) the cell's own JSX text.
        const shown = screen?.get(getRowKey(row, index));
        return textSortValue(
          shown ?? nodeText(sortColumn.cell(row, index)),
        );
      },
      localSort.direction,
      language,
    );
  }, [sortColumn, cellTexts, data, getRowKey, localSort.direction, language]);

  // Helper to get visibility class
  const getVisibilityClass = (visibility?: string) => {
    switch (visibility) {
      case "sm":
        return "hidden sm:table-cell";
      case "md":
        return "hidden md:table-cell";
      case "lg":
        return "hidden lg:table-cell";
      case "xl":
        return "hidden xl:table-cell";
      default:
        return "";
    }
  };

  // Helper to get alignment class. "left"/"right" mean the reading start/end,
  // so numbers stay on the end side in Arabic tables too.
  const getAlignClass = (align?: string) => {
    switch (align) {
      case "center":
        return "text-center";
      case "right":
        return "text-end";
      default:
        return "text-start";
    }
  };

  // Check if all visible rows are selected
  const isAllSelected = React.useMemo(() => {
    if (!selection) return false;
    const selectableRows = data.filter(
      (row) => !selection.isRowDisabled?.(row)
    );
    if (selectableRows.length === 0) return false;
    return selectableRows.every((row) =>
      selection.selectedIds.includes(selection.getRowId(row))
    );
  }, [data, selection]);

  // Render loading skeleton
  const renderLoadingSkeleton = () => (
    <>
      {Array.from({ length: loadingConfig.rows || 8 }).map((_, rowIndex) => (
        <TableRow key={`skeleton-${rowIndex}`}>
          {selection?.enabled && (
            <TableCell className="py-4 px-4 w-12">
              <Skeleton className="h-4 w-4" />
            </TableCell>
          )}
          {columns.map((column) => (
            <TableCell
              key={`skeleton-${rowIndex}-${column.id}`}
              className={cn(
                "py-4 px-4",
                getVisibilityClass(column.visibility),
                column.className
              )}
            >
              {loadingConfig.columnSkeletons?.[column.id] || (
                <Skeleton className="h-4 w-full max-w-[120px]" />
              )}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );

  // Render error state
  const renderError = () => (
    <TableRow>
      <TableCell
        colSpan={columns.length + (selection?.enabled ? 1 : 0)}
        className="py-16"
      >
        <div className="flex flex-col items-center justify-center text-center">
          {error?.icon}
          <span className="text-red-600 mt-2">{error?.message}</span>
          {error?.onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={error.onRetry}
              className="mt-4"
            >
              {error.retryLabel || "Try Again"}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );

  // Render empty state
  const renderEmpty = () => (
    <TableRow>
      <TableCell
        colSpan={columns.length + (selection?.enabled ? 1 : 0)}
        className="py-16"
      >
        <div className="flex flex-col items-center justify-center text-center">
          {emptyState?.icon}
          <span className="text-gray-600 dark:text-gray-400 mt-2 font-medium">
            {emptyState?.title}
          </span>
          {emptyState?.description && (
            <span className="text-gray-500 dark:text-gray-500 text-sm mt-1">
              {emptyState.description}
            </span>
          )}
          {emptyState?.action && (
            <div className="mt-4">{emptyState.action}</div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );

  // A row's key is computed from its place in `data`, as the page defines it,
  // whatever order it is drawn in.
  const dataIndex = React.useMemo(
    () => new Map(data.map((row, index) => [row, index])),
    [data],
  );

  // Render data rows
  const renderDataRows = () =>
    rows.map((row, index) => {
      const rowKey = getRowKey(row, dataIndex.get(row) ?? index);
      const isSelected = selection
        ? selection.selectedIds.includes(selection.getRowId(row))
        : false;
      const isDisabled = selection?.isRowDisabled?.(row) ?? false;
      const stripe =
        striped &&
        (index % 2 === 0
          ? "bg-white dark:bg-gray-800"
          : "bg-gray-50/20 dark:bg-gray-800/50");
      const detail = renderRowDetail?.(row, index);

      return (
        <React.Fragment key={rowKey}>
          <TableRow
            className={cn(
              "border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors",
              stripe,
              isSelected && "bg-blue-50/50 dark:bg-blue-900/20",
              onRowClick && "cursor-pointer",
              // The detail row below closes the pair instead.
              detail && "border-b-0",
              getRowClassName?.(row, index)
            )}
            onClick={() => onRowClick?.(row)}
            data-state={isSelected ? "selected" : undefined}
            data-row-key={rowKey}
          >
            {selection?.enabled && (
              <TableCell className="py-4 px-4 w-12">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) =>
                    selection.onSelectRow(
                      selection.getRowId(row),
                      checked as boolean
                    )
                  }
                  disabled={isDisabled}
                  aria-label={selection.selectRowLabel?.(row) || "Select row"}
                  onClick={(e) => e.stopPropagation()}
                />
              </TableCell>
            )}
            {columns.map((column) => (
              <TableCell
                key={`${rowKey}-${column.id}`}
                data-col={column.id}
                className={cn(
                  "py-4 px-4",
                  getVisibilityClass(column.visibility),
                  getAlignClass(column.align),
                  column.className
                )}
              >
                {column.cell(row, index)}
              </TableCell>
            ))}
          </TableRow>
          {detail ? (
            <TableRow
              className={cn(
                "border-b border-gray-100 dark:border-gray-700 hover:bg-transparent",
                stripe
              )}
            >
              <TableCell
                colSpan={columns.length + (selection?.enabled ? 1 : 0)}
                className="px-4 pb-4 pt-0 whitespace-normal"
              >
                {detail}
              </TableCell>
            </TableRow>
          ) : null}
        </React.Fragment>
      );
    });

  return (
    <div className={cn("space-y-4", containerClassName)}>
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <Table className={tableClassName}>
          <TableHeader className="bg-gray-50/50 dark:bg-gray-800/50">
            <TableRow className="border-b border-gray-200 dark:border-gray-700">
              {selection?.enabled && (
                <TableHead className="font-medium text-gray-700 dark:text-gray-300 py-3 px-4 w-12">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={selection.onSelectAll}
                    aria-label={selection.selectAllLabel || "Select all"}
                  />
                </TableHead>
              )}
              {columns.map((column) => {
                const sortId = sortIdOf(column);
                const direction =
                  sortId && activeSort.key === sortId ? activeSort.direction : null;
                const SortIcon =
                  direction === "asc"
                    ? ArrowUp
                    : direction === "desc"
                      ? ArrowDown
                      : ArrowUpDown;
                return (
                  <TableHead
                    key={column.id}
                    aria-sort={
                      direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : sortId
                            ? "none"
                            : undefined
                    }
                    className={cn(
                      "font-medium text-gray-700 dark:text-gray-300 py-3 px-4",
                      getVisibilityClass(column.visibility),
                      getAlignClass(column.align),
                      column.width,
                      column.headerClassName
                    )}
                  >
                    {sortId ? (
                      <button
                        type="button"
                        onClick={() => onHeaderClick(sortId)}
                        title={text("ui.sortHint", "Sort by this column")}
                        className={cn(
                          "-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-white",
                          direction && "text-gray-900 dark:text-white"
                        )}
                      >
                        <span>{column.header}</span>
                        <SortIcon
                          aria-hidden="true"
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            !direction && "opacity-40"
                          )}
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody ref={tbodyRef}>
            {loading
              ? renderLoadingSkeleton()
              : error
              ? renderError()
              : rows.length === 0
              ? renderEmpty()
              : renderDataRows()}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination && !loading && !error && data.length > 0 && (
        <div className="flex items-center justify-between px-2">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {pagination.showingText}
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                pagination.onPageChange(pagination.currentPage - 1)
              }
              disabled={pagination.currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4 me-1 rtl:rotate-180" />
              {pagination.previousLabel || text("ui.previous", "Previous")}
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {pagination.currentPage} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                pagination.onPageChange(pagination.currentPage + 1)
              }
              disabled={pagination.currentPage >= pagination.totalPages}
            >
              {pagination.nextLabel || text("ui.next", "Next")}
              <ChevronRight className="h-4 w-4 ms-1 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export { DataTable };
