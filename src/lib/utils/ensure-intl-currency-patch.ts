/**
 * PropertyPro - Intl NumberFormat Currency Patch
 * Ensures all currency formatting honours the active localization currency.
 */

import { localizationService } from "@/lib/services/localization.service";

let isPatched = false;

const isBrowser = typeof window !== "undefined";

function resolveCurrencyOverride(
  options?: Intl.NumberFormatOptions
): Intl.NumberFormatOptions | undefined {
  if (!options || typeof options !== "object") {
    return options;
  }

  if (options.style !== "currency") {
    return options;
  }

  const currentCurrency = localizationService.getCurrentCurrency();
  const shouldOverride =
    !options.currency ||
    options.currency === "USD" ||
    options.currency === "US Dollar";

  if (!shouldOverride || !currentCurrency) {
    return options;
  }

  return {
    ...options,
    currency: currentCurrency,
  };
}

function resolveLocaleOverride(
  locales?: Intl.LocalesArgument,
  options?: Intl.NumberFormatOptions
): Intl.LocalesArgument | undefined {
  if (locales && locales !== "en-US") {
    return locales;
  }

  if (!options || options.style !== "currency") {
    return locales;
  }

  return localizationService.getCurrentLocale();
}

export function ensureIntlCurrencyPatch(): void {
  if (isPatched) return;
  if (typeof Intl === "undefined" || typeof Intl.NumberFormat !== "function")
    return;

  const OriginalNumberFormat = Intl.NumberFormat;

  const PatchedNumberFormat = function NumberFormat(
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions
  ) {
    const patchedOptions = resolveCurrencyOverride(options);
    const patchedLocales = resolveLocaleOverride(locales, patchedOptions);

    // The original constructor can safely be called with new, returning the formatter instance.
    const formatter = new OriginalNumberFormat(
      patchedLocales as Intl.LocalesArgument,
      patchedOptions
    );

    return formatter;
  } as unknown as typeof Intl.NumberFormat;

  // Preserve prototype chain and static helpers
  PatchedNumberFormat.prototype = OriginalNumberFormat.prototype;
  Object.setPrototypeOf(PatchedNumberFormat, OriginalNumberFormat);
  if ("supportedLocalesOf" in OriginalNumberFormat) {
    // Bind to original constructor to keep native behaviour intact.
    (
      PatchedNumberFormat as unknown as typeof Intl.NumberFormat
    ).supportedLocalesOf =
      OriginalNumberFormat.supportedLocalesOf.bind(OriginalNumberFormat);
  }

  Intl.NumberFormat = PatchedNumberFormat as typeof Intl.NumberFormat;
  isPatched = true;
}

// Automatically patch when this module is imported in the browser runtime.
if (isBrowser) {
  ensureIntlCurrencyPatch();
}
