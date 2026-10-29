"use client";

/**
 * PropertyPro - The filters of a report page: what is chosen, and what ran
 *
 * Two sets of values, kept apart on purpose:
 *
 *   draft    what the controls show — changing a control changes only this;
 *   applied  what the report was last run with — only Apply (or Reset) moves
 *            it, and the figures, the export and the address all follow it.
 *
 * Changing an owner, then a building, then a date used to ask the report one
 * question per control, two of them about a combination nobody wanted. Now it
 * is asked once, when the reader says so.
 *
 * The applied values live in the address (`?ownerId=…&startDate=…`), not in
 * the page: a reload keeps them, and so does a link sent to someone else.
 * Only values that differ from their default are written, so the address of
 * an unfiltered report stays clean — and reading a missing one as its default
 * is what makes Reset, which restores the defaults (the opening period
 * included), a matter of clearing them.
 *
 * Values are strings, as they are in an address. A filter that is not set is
 * the empty string.
 */

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  addressPatch,
  applyPatch,
  readAddress,
  type FilterValues,
} from "@/lib/report-filters/address";

export type { FilterValues };

export interface ReportFiltersConfig {
  /**
   * Every filter the page has, with the value it opens on and returns to on
   * Reset. A function, so a period that opens on "the year so far" is worked
   * out when the page opens rather than when the module was loaded.
   */
  defaults: () => FilterValues;
  /**
   * An older way of asking for the same thing in the address — the dashboard's
   * `?range=this-month` link — turned into filter values. Read only when the
   * address carries none of the filters itself, and dropped from the address
   * the first time filters are applied.
   */
  legacy?: (params: URLSearchParams) => Partial<FilterValues> | null;
  /** The address parameters `legacy` reads. */
  legacyKeys?: readonly string[];
}

/**
 * Change parameters of the address that are not filters — which tab is open,
 * which report is chosen — without adding a history entry or reloading.
 * `null` (or an empty string) removes one.
 *
 * Next.js folds `history.replaceState` into its router, so `useSearchParams`
 * follows.
 */
export function replaceQuery(patch: Record<string, string | null>): void {
  if (typeof window === "undefined") return;
  const query = applyPatch(window.location.search, patch);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

export function useReportFilters(config: ReportFiltersConfig) {
  const search = useSearchParams();
  const searchKey = search.toString();

  // The values the page opens on. Worked out once: a page left open across
  // midnight keeps the period it opened on until the reader resets it.
  const [defaults] = useState<FilterValues>(() => config.defaults());
  const keys = useMemo(() => Object.keys(defaults), [defaults]);
  const legacy = config.legacy;
  const legacyKeys = config.legacyKeys;

  // What ran: the address, as filter values. Held as text so that a change to
  // some other parameter — the open tab — leaves it, and everything that
  // depends on it, untouched.
  const appliedKey = useMemo(
    () => JSON.stringify(readAddress(searchKey, defaults, legacy)),
    [defaults, legacy, searchKey],
  );
  const applied = useMemo(
    () => JSON.parse(appliedKey) as FilterValues,
    [appliedKey],
  );

  // What the controls show. It follows the address when the address moves for
  // a reason other than this page applying it — a menu link to the same
  // report, or the browser's back button — which is adjusting state while
  // rendering, as React documents, rather than an effect.
  const [draft, setDraft] = useState<FilterValues>(applied);
  const [seen, setSeen] = useState(appliedKey);
  if (seen !== appliedKey) {
    setSeen(appliedKey);
    setDraft(applied);
  }

  const writeAddress = useCallback(
    (values: FilterValues) => {
      replaceQuery(addressPatch(values, defaults, legacyKeys));
    },
    [defaults, legacyKeys],
  );

  const setField = useCallback((patch: Partial<FilterValues>) => {
    setDraft((current) => ({ ...current, ...patch } as FilterValues));
  }, []);

  /** Run the report with what the controls show. */
  const apply = useCallback(() => {
    writeAddress(draft);
  }, [draft, writeAddress]);

  /** Back to the defaults — the opening period included — and run. */
  const reset = useCallback(() => {
    setDraft(defaults);
    writeAddress(defaults);
  }, [defaults, writeAddress]);

  const pending = keys.some((key) => draft[key] !== applied[key]);
  /** The report is narrowed by something other than its defaults. */
  const narrowed = keys.some((key) => applied[key] !== defaults[key]);

  return {
    /** What the controls show. */
    draft,
    /** What the report was last run with. */
    applied,
    /** The values every filter returns to. */
    defaults,
    /** Change what the controls show. */
    setField,
    apply,
    reset,
    /** The controls show something the report has not been run with. */
    pending,
    /** The report is narrowed — or the controls are — so Reset has work to do. */
    canReset: pending || narrowed,
    narrowed,
  };
}

/**
 * The applied filters as request parameters: only the ones the page names,
 * and only the ones that are set. An empty filter is no filter.
 */
export function filterParams(
  values: FilterValues,
  keys: readonly string[],
  extra: Record<string, string | undefined> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  for (const key of keys) {
    if (values[key]) params.set(key, values[key]);
  }
  return params;
}
