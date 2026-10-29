"use client";

/**
 * PropertyPro - The lists behind a report's filter pickers
 *
 * One request for every list a page's filter bar needs
 * (`/api/reports/filter-options`), scoped by the server to what the reader may
 * see. Read when the page opens and not kept: the lists are the reader's own,
 * so nothing here outlives the page they were read for.
 */

import { useEffect, useState } from "react";
import type {
  FilterOptionKey,
  FilterOptions,
} from "@/lib/report-filters/options";

export interface FilterOptionsState {
  /** Absent until the lists arrive. */
  options: FilterOptions | undefined;
  loading: boolean;
  failed: boolean;
}

export function useReportFilterOptions(
  include: readonly FilterOptionKey[],
): FilterOptionsState {
  const key = include.join(",");
  const [state, setState] = useState<FilterOptionsState>({
    options: undefined,
    loading: true,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/reports/filter-options?include=${key}`);
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !payload?.success) {
          setState({ options: undefined, loading: false, failed: true });
          return;
        }
        setState({
          options: payload.data as FilterOptions,
          loading: false,
          failed: false,
        });
      } catch {
        if (!cancelled) {
          setState({ options: undefined, loading: false, failed: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}
