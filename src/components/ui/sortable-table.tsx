"use client";

/**
 * PropertyPro - Sort arrows for a table built from the raw Table parts
 *
 * DataTable sorts every column on its own. A page that draws its table from
 * `<Table>`/`<TableHead>` directly — the reports, the tenant portal's lists —
 * gets the same header (⇅, then ↑ or ↓) from these two pieces, and names the
 * value each column sorts by, which such a page has on hand:
 *
 *     const sort = useTableSort(bills, {
 *       number: (bill) => bill.number,
 *       due: (bill) => new Date(bill.dueDate),
 *       amount: (bill) => bill.total,
 *     });
 *     …
 *     <SortableTableHead sort={sort} column="due">{t("…")}</SortableTableHead>
 *     …
 *     {sort.rows.map((bill) => …)}
 *
 * Order: ascending, descending, then the page's own again. Empty values stay
 * last both ways (lib/table-sort).
 *
 * A list the server pages is sorted by the server instead — ordering the
 * rows on hand would sort one page and look like the whole list. Such a page
 * keeps the column with its other query state and gives the headers
 * `serverTableSort(current, onSortChange)`; only the columns its API can
 * order by get a SortableTableHead.
 */

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableHead } from "@/components/ui/table";
import { useUiText } from "@/components/ui/use-ui-text";
import {
  nextSort,
  sortRows,
  type SortDirection,
  type SortValue,
} from "@/lib/table-sort";

/** What a sortable header reads: the sorted column, and its click. */
export interface TableSortState {
  key: string | null;
  direction: SortDirection;
  toggle: (column: string) => void;
}

export interface TableSort<T> extends TableSortState {
  /** The rows in the chosen order (the input itself while unsorted). */
  rows: T[];
}

export function useTableSort<T>(
  rows: readonly T[],
  columns: Record<string, (row: T) => SortValue>,
): TableSort<T> {
  const { language } = useUiText();
  const [state, setState] = React.useState<{
    key: string | null;
    direction: SortDirection;
  }>({ key: null, direction: "asc" });

  const valueOf = state.key ? columns[state.key] : undefined;
  const sorted = React.useMemo(
    () =>
      valueOf
        ? sortRows(rows, (row) => valueOf(row), state.direction, language)
        : (rows as T[]),
    [rows, valueOf, state.direction, language],
  );

  return {
    rows: sorted,
    key: state.key,
    direction: state.direction,
    toggle: (column) => setState((current) => nextSort(current, column)),
  };
}

/**
 * Headers for a list the server sorts: a click asks for the next order
 * (ascending, descending, then none — the page's default) through
 * `onSortChange`, and the page re-queries.
 */
export function serverTableSort(
  current: { key: string | null; direction: SortDirection },
  onSortChange: (key: string | null, direction: SortDirection) => void,
): TableSortState {
  return {
    key: current.key,
    direction: current.direction,
    toggle: (column) => {
      const next = nextSort(current, column);
      onSortChange(next.key, next.direction);
    },
  };
}

export function SortableTableHead({
  sort,
  column,
  className,
  children,
  ...props
}: React.ComponentProps<typeof TableHead> & {
  sort: TableSortState;
  column: string;
}) {
  const { text } = useUiText();
  const direction = sort.key === column ? sort.direction : null;
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <TableHead
      {...props}
      className={className}
      aria-sort={
        direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"
      }
    >
      <button
        type="button"
        onClick={() => sort.toggle(column)}
        title={text("ui.sortHint", "Sort by this column")}
        className={cn(
          "-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          direction && "text-foreground",
        )}
      >
        <span>{children}</span>
        <Icon
          aria-hidden="true"
          className={cn("h-3.5 w-3.5 shrink-0", !direction && "opacity-40")}
        />
      </button>
    </TableHead>
  );
}
