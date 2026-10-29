/**
 * PropertyPro - Which rows a `where` matches, for tests
 *
 * A scope bug is a query that returns more rows than it should, and the only
 * way to catch one is to count the rows — see scripts/verify-staff-scope.ts,
 * which does it against a database. This reads enough of Prisma's filter
 * language over plain objects for a unit test to ask the same question of a
 * `where` clause: which of these rows come back.
 *
 * It covers what the scoped queries use —
 *
 *   equality and null; `in`, `notIn`, `not`; `lt`, `lte`, `gt`, `gte`;
 *   AND, OR, NOT; a to-one relation as a nested object; a to-many relation
 *   through `some`, `none` and `every`
 *
 * — and throws on anything else, including a column the row does not carry.
 * A condition this file cannot read fails the test rather than passing it,
 * and every condition is read even once one has already failed, so that an
 * unreadable one cannot hide behind it.
 *
 * A key set to `undefined` is no condition at all, as in Prisma.
 */

type Row = Record<string, unknown>;

const SCALAR_OPERATORS = new Set([
  "equals",
  "in",
  "notIn",
  "not",
  "lt",
  "lte",
  "gt",
  "gte",
]);

const LIST_OPERATORS = new Set(["some", "none", "every"]);

/**
 * Prisma operators this file knows of and does not read. Named so that one of
 * them on a NULL column is refused like any other, rather than being taken
 * for a filter on a relation that is not there.
 */
const UNREAD_OPERATORS = new Set([
  "contains",
  "startsWith",
  "endsWith",
  "mode",
  "search",
  "has",
  "hasEvery",
  "hasSome",
  "isEmpty",
  "is",
  "isNot",
  "path",
  "string_contains",
  "string_starts_with",
  "string_ends_with",
  "array_contains",
  "array_starts_with",
  "array_ends_with",
]);

/** Like `every`, without stopping at the first miss. */
function all<T>(items: readonly T[], holds: (item: T) => boolean): boolean {
  return items.map(holds).every(Boolean);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** Dates compare by the instant they name; everything else as it is. */
function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function equal(left: unknown, right: unknown): boolean {
  return comparable(left) === comparable(right);
}

function isNull(value: unknown): boolean {
  return value === null || value === undefined;
}

/** `{ in: [...] }`, `{ gte: … }` and the rest, against one column's value. */
function matchesScalar(
  value: unknown,
  filter: Record<string, unknown>,
): boolean {
  return all(Object.entries(filter), ([operator, operand]) => {
    if (operand === undefined) return true;

    switch (operator) {
      case "equals":
        return equal(value, operand);
      case "in":
        return asList(operand).some((candidate) => equal(value, candidate));
      // As in SQL, a NULL is neither in a list nor out of it — except that
      // Prisma writes an empty list as no condition at all.
      case "notIn":
        if (asList(operand).length === 0) return true;
        return (
          !isNull(value) &&
          !asList(operand).some((candidate) => equal(value, candidate))
        );
      case "not":
        if (operand === null) return !isNull(value);
        if (isNull(value)) return false;
        return isPlainObject(operand)
          ? !matchesScalar(value, operand)
          : !equal(value, operand);
      case "lt":
      case "lte":
      case "gt":
      case "gte": {
        if (isNull(value)) return false;
        const left = comparable(value) as number;
        const right = comparable(operand) as number;
        if (operator === "lt") return left < right;
        if (operator === "lte") return left <= right;
        if (operator === "gt") return left > right;
        return left >= right;
      }
      default:
        throw new Error(`where-matcher: "${operator}" is not supported`);
    }
  });
}

/** Whether one row satisfies a `where` clause. */
export function matchesWhere(candidate: object, where: object): boolean {
  const row = candidate as Row;
  return all(Object.entries(where), ([key, condition]) => {
    if (condition === undefined) return true;

    if (key === "AND" || key === "OR" || key === "NOT") {
      const hits = asList(condition).map((clause) =>
        matchesWhere(row, clause as object),
      );
      if (key === "AND") return hits.every(Boolean);
      if (key === "OR") return hits.some(Boolean);
      return !hits.some(Boolean);
    }

    // A fixture that lacks the column would otherwise read as "no match" and
    // make every narrowing test pass for the wrong reason.
    if (!(key in row)) {
      throw new Error(`where-matcher: the row has no "${key}"`);
    }
    const value = row[key];

    if (condition === null) return value === null;
    if (!isPlainObject(condition)) return equal(value, condition);

    const operators = Object.keys(condition);
    if (operators.length === 0) {
      throw new Error(`where-matcher: empty filter on "${key}"`);
    }
    const unread = operators.find((operator) => UNREAD_OPERATORS.has(operator));
    if (unread) {
      throw new Error(`where-matcher: "${unread}" is not supported`);
    }
    if (operators.every((operator) => SCALAR_OPERATORS.has(operator))) {
      return matchesScalar(value, condition);
    }
    if (operators.every((operator) => LIST_OPERATORS.has(operator))) {
      const related = (value ?? []) as object[];
      return all(operators, (operator) => {
        const clause = condition[operator] as object;
        const hits = related.filter((entry) => matchesWhere(entry, clause));
        if (operator === "some") return hits.length > 0;
        if (operator === "none") return hits.length === 0;
        return hits.length === related.length;
      });
    }

    const known = (operator: string) =>
      SCALAR_OPERATORS.has(operator) || LIST_OPERATORS.has(operator);
    if (operators.some(known)) {
      throw new Error(
        `where-matcher: "${operators.find((operator) => !known(operator))}" is not supported`,
      );
    }

    // A to-one relation: the related row has to exist and match. Anything
    // else under keys this file does not know is a filter it cannot read.
    if (isPlainObject(value)) return matchesWhere(value, condition);
    if (value === null) return false;
    throw new Error(`where-matcher: cannot read the filter on "${key}"`);
  });
}

/** The rows a query with this `where` would return, in fixture order. */
export function rowsMatching<T extends object>(
  rows: readonly T[],
  where: object,
): T[] {
  return rows.filter((row) => matchesWhere(row, where));
}
