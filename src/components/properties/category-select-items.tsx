"use client";

/**
 * PropertyPro - Category dropdown options
 *
 * Drops into any existing `<SelectContent>` in place of a hand-written list of
 * `<SelectItem>`s. Every property/unit picker in the app renders through this,
 * so adding a category in settings reaches all of them at once.
 */

import { SelectItem } from "@/components/ui/select";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  categoryLabel,
  usePropertyCategories,
  type CategoryKind,
} from "@/hooks/use-property-categories";

interface CategorySelectItemsProps {
  kind?: CategoryKind;
  /**
   * Value/label for a leading "any" row on filter dropdowns. Radix forbids an
   * empty string value, so filters use a sentinel like "all".
   */
  allValue?: string;
  allLabel?: string;
  /**
   * A slug that must stay selectable even when deactivated — the value already
   * on the record being edited. Without it, opening an old record silently
   * blanks its category.
   */
  includeSlug?: string | null;
}

export function CategorySelectItems({
  kind = "property",
  allValue,
  allLabel,
  includeSlug,
}: CategorySelectItemsProps) {
  const { language } = useLocalizationContext();
  const { categories } = usePropertyCategories(kind, { activeOnly: true });

  const known = new Set(categories.map((category) => category.slug));
  const orphan = includeSlug && !known.has(includeSlug) ? includeSlug : null;

  return (
    <>
      {allValue !== undefined && (
        <SelectItem value={allValue}>{allLabel ?? "All"}</SelectItem>
      )}
      {categories.map((category) => (
        <SelectItem key={category.id} value={category.slug}>
          {categoryLabel(category, language)}
        </SelectItem>
      ))}
      {orphan && (
        <SelectItem key={orphan} value={orphan}>
          {orphan}
        </SelectItem>
      )}
    </>
  );
}
