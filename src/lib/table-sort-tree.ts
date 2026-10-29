/**
 * PropertyPro - Sorting a table that is a tree
 *
 * The income statement and the balance sheet list accounts under their
 * headings, depth-first, each line indented by its depth. Sorted as a flat
 * list, a sub-account would leave its heading and land under another one.
 * So a tree sorts the way a grouped table should: the lines under one
 * heading among themselves, each line taking what sits under it along.
 *
 * Pure: the report kit and the tests import it.
 */

import { sortRows, type SortDirection, type SortValue } from "./table-sort";

interface Node<T> {
  row: T;
  children: Node<T>[];
}

/**
 * `rows` in depth-first order, a line's sub-lines right after it with a
 * greater depth; returned in the same shape, siblings in the column's order.
 */
export function sortTreeRows<T>(
  rows: readonly T[],
  depthOf: (row: T) => number,
  valueOf: (row: T) => SortValue,
  direction: SortDirection,
  language = "en",
): T[] {
  const roots: Node<T>[] = [];
  const path: Node<T>[] = [];
  for (const row of rows) {
    const node: Node<T> = { row, children: [] };
    while (path.length > 0 && depthOf(path[path.length - 1].row) >= depthOf(row)) {
      path.pop();
    }
    (path.length > 0 ? path[path.length - 1].children : roots).push(node);
    path.push(node);
  }
  const flatten = (siblings: Node<T>[]): T[] =>
    sortRows(siblings, (node) => valueOf(node.row), direction, language).flatMap(
      (node) => [node.row, ...flatten(node.children)],
    );
  return flatten(roots);
}
