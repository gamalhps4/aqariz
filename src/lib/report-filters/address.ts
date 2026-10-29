/**
 * PropertyPro - A report's filters, written in the address and read back
 *
 * The applied filters of a report page live in its address
 * (`?ownerId=…&startDate=…`), so a reload keeps them and so does a link sent
 * to someone else. Two rules make that work, and both are here so they can be
 * pinned by tests rather than by reading a page:
 *
 *   - Only a value that differs from its default is written. The address of an
 *     unfiltered report stays clean, and a value that is not there reads as
 *     its default — which is what makes Reset, restoring the defaults the
 *     opening period included, a matter of removing them.
 *   - Parameters the filters do not own — which tab is open, which register is
 *     chosen — are never touched.
 *
 * Pure: no window, no router. The hook (components/reports/use-report-filters)
 * does the reading and the writing of the real address.
 */

export type FilterValues = Record<string, string>;

/**
 * What the address says the filters are: the defaults, then — when the address
 * names none of the filters itself — whatever an older link asked for, then
 * anything the address names.
 */
export function readAddress(
  query: string,
  defaults: FilterValues,
  legacy?: (params: URLSearchParams) => Partial<FilterValues> | null,
): FilterValues {
  const params = new URLSearchParams(query);
  const keys = Object.keys(defaults);
  const values: FilterValues = { ...defaults };
  if (legacy && !keys.some((key) => params.has(key))) {
    Object.assign(values, legacy(params) ?? {});
  }
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null) values[key] = value;
  }
  return values;
}

/**
 * The changes to make to the address to show these values: a filter that is
 * set and differs from its default is written; any other is removed, and so is
 * every parameter an older link used. `null` means "remove".
 */
export function addressPatch(
  values: FilterValues,
  defaults: FilterValues,
  legacyKeys: readonly string[] = [],
): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const key of Object.keys(defaults)) {
    patch[key] = values[key] && values[key] !== defaults[key] ? values[key] : null;
  }
  for (const key of legacyKeys) patch[key] = null;
  return patch;
}

/**
 * A query string with a patch applied: values are set, `null` and empty
 * values removed, everything else left exactly as it was.
 */
export function applyPatch(
  query: string,
  patch: Record<string, string | null>,
): string {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params.toString();
}
