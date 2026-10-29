"use client";

/**
 * PropertyPro - Property category / unit type options
 *
 * Every property and unit form used to render a hard-coded `<SelectItem>` list,
 * which is exactly what made the category set impossible to extend without a
 * deploy. This hook is the single client-side source for those options.
 *
 * The list is small, identical for everyone in an organization and changes
 * rarely, so one in-flight promise per kind is shared across all mounted
 * forms rather than each dropdown issuing its own request.
 */

import { useCallback, useEffect, useState } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export type CategoryKind = "property" | "unit";

export interface CategoryOption {
  id: string;
  kind: CategoryKind;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
}

type CacheKey = `${CategoryKind}:${"active" | "all"}`;

const cache = new Map<CacheKey, Promise<CategoryOption[]>>();

function cacheKey(kind: CategoryKind, activeOnly: boolean): CacheKey {
  return `${kind}:${activeOnly ? "active" : "all"}`;
}

function load(kind: CategoryKind, activeOnly: boolean): Promise<CategoryOption[]> {
  const key = cacheKey(kind, activeOnly);
  let pending = cache.get(key);
  if (!pending) {
    const query = new URLSearchParams({ kind });
    if (activeOnly) query.set("activeOnly", "true");
    pending = fetch(`/api/property-categories?${query.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => (payload?.data?.categories as CategoryOption[]) ?? [])
      .catch(() => [] as CategoryOption[]);
    cache.set(key, pending);
  }
  return pending;
}

/** Drop the shared cache — call after adding, editing or removing a category. */
export function refreshPropertyCategories(): void {
  cache.clear();
}

/** Pick a label for the active language, falling back to English then slug. */
export function categoryLabel(
  category: Pick<CategoryOption, "slug" | "nameEn" | "nameAr">,
  language?: string,
): string {
  if (language?.toLowerCase().startsWith("ar") && category.nameAr) {
    return category.nameAr;
  }
  return category.nameEn || category.slug;
}

export interface UsePropertyCategoriesResult {
  categories: CategoryOption[];
  loading: boolean;
  /** Localised label for a stored slug; falls back to the slug itself. */
  labelFor: (slug: string | null | undefined) => string;
  reload: () => void;
}

export function usePropertyCategories(
  kind: CategoryKind = "property",
  options: { activeOnly?: boolean } = {},
): UsePropertyCategoriesResult {
  const activeOnly = options.activeOnly ?? true;
  const { language } = useLocalizationContext();
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load(kind, activeOnly)
      .then((result) => {
        if (cancelled) return;
        setCategories(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, activeOnly, nonce]);

  const labelFor = useCallback(
    (slug: string | null | undefined) => {
      if (!slug) return "";
      const match = categories.find((category) => category.slug === slug);
      // A slug with no row is a category that was removed after the record was
      // created — show the raw key rather than an empty cell.
      return match ? categoryLabel(match, language) : slug;
    },
    [categories, language],
  );

  const reload = useCallback(() => {
    refreshPropertyCategories();
    setNonce((value) => value + 1);
  }, []);

  return { categories, loading, labelFor, reload };
}

/**
 * A building type in the reader's language: the organization's own category
 * name when it has one (Arabic on an Arabic screen), else the catalogue's
 * wording for the legacy types (`properties.type.*`), else the slug as words.
 * Screens used to print the stored slug — "residential_building" — as is.
 */
export function usePropertyTypeLabel(): (
  slug: string | null | undefined,
) => string {
  const { t } = useLocalizationContext();
  const { labelFor } = usePropertyCategories("property", { activeOnly: false });
  return useCallback(
    (slug: string | null | undefined) => {
      if (!slug) return "";
      const named = labelFor(slug);
      if (named && named !== slug) return named;
      return t(`properties.type.${slug}`, {
        defaultValue: slug.replace(/_/g, " "),
      });
    },
    [labelFor, t],
  );
}
