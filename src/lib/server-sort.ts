/**
 * PropertyPro - Header clicks on a list the server keeps in order
 *
 * A header click cycles ascending, descending, then back to the page's own
 * order (lib/table-sort `nextSort`). Some server-sorted lists have no "own
 * order" apart from a column's — transactions by date, newest first; the
 * registers by date — and their sort menus always name a column. There the
 * third step would ask for the order already on screen and the click would
 * seem to do nothing, so these lists turn the column around instead and are
 * never without an order.
 *
 * Pure: the list pages and the tests import it.
 */

import type { SortDirection } from "./table-sort";

/**
 * The order to ask the server for after a header click, given the order on
 * screen and what DataTable proposed (`key` null: "back to the default").
 */
export function keepSorted(
  current: { key: string; direction: SortDirection },
  proposed: { key: string | null; direction: SortDirection },
): { key: string; direction: SortDirection } {
  if (proposed.key !== null) return { key: proposed.key, direction: proposed.direction };
  return { key: current.key, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** "name-asc" → { key: "name", direction: "asc" }, for APIs that take one `sort` value. */
export function parseSortValue(
  value: string,
): { key: string; direction: SortDirection } {
  const at = value.lastIndexOf("-");
  const direction = value.slice(at + 1) === "asc" ? "asc" : "desc";
  return { key: at > 0 ? value.slice(0, at) : value, direction };
}
