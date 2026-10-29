/**
 * PropertyPro - Localization Hook
 * React hook for accessing localization features
 *
 * Reads the LocalizationProvider every page is wrapped in. It used to keep a
 * copy of its own — state seeded from the shared service and a saved locale
 * applied from localStorage after mount — so the few screens using it (the
 * building page, the unit dialogs, image upload) could draw in a different
 * language from the rest of the page, and redraw on load when the two
 * disagreed. Outside a provider (a test, a stray portal) it answers from the
 * shared service, without state.
 */

"use client";

import { useContext } from "react";
import {
  localizationService,
  Currency,
  Locale,
  TranslateOptions,
} from "@/lib/services/localization.service";
import { LocalizationContext } from "@/components/providers/LocalizationProvider";

export interface LocalizationContextType {
  currentLocale: string;
  currentCurrency: string;
  locale: Locale | undefined;
  currency: Currency | undefined;
  allLocales: Locale[];
  allCurrencies: Currency[];
  setLocale: (localeCode: string) => void;
  setCurrency: (currencyCode: string) => void;
  formatCurrency: (
    amount: number,
    currencyCode?: string,
    options?: any
  ) => string;
  formatDate: (date: Date | string, options?: any) => string;
  formatTime: (date: Date | string, options?: any) => string;
  formatNumber: (number: number, options?: any) => string;
  formatPercentage: (value: number, options?: any) => string;
  convertCurrency: (
    amount: number,
    fromCurrency: string,
    toCurrency: string
  ) => number;
  isRTL: boolean;
  firstDayOfWeek: number;
  language: string;
  t: (key: string, options?: TranslateOptions) => string;
}

/** The shared service's current settings, for use outside any provider. */
function fromService(): LocalizationContextType {
  const currentLocale = localizationService.getCurrentLocale();
  const currentCurrency = localizationService.getCurrentCurrency();
  const language = (currentLocale || "en").split("-")[0].toLowerCase();
  return {
    currentLocale,
    currentCurrency,
    locale: localizationService.getLocale(currentLocale),
    currency: localizationService.getCurrency(currentCurrency),
    allLocales: localizationService.getAllLocales(),
    allCurrencies: localizationService.getAllCurrencies(),
    setLocale: (localeCode) => localizationService.setLocale(localeCode),
    setCurrency: (currencyCode) => localizationService.setCurrency(currencyCode),
    formatCurrency: (amount, currencyCode, options) =>
      localizationService.formatCurrency(amount, currencyCode, options),
    formatDate: (date, options) => localizationService.formatDate(date, options),
    formatTime: (date, options) => localizationService.formatTime(date, options),
    formatNumber: (number, options) =>
      localizationService.formatNumber(number, options),
    formatPercentage: (value, options) =>
      localizationService.formatPercentage(value, options),
    convertCurrency: (amount, fromCurrency, toCurrency) =>
      localizationService.convertCurrency(amount, fromCurrency, toCurrency),
    isRTL: localizationService.isRTL(currentLocale),
    firstDayOfWeek: localizationService.getFirstDayOfWeek(currentLocale),
    language,
    t: (key, options) =>
      localizationService.translate(key, { language, ...(options || {}) }),
  };
}

export function useLocalization(): LocalizationContextType {
  const context = useContext(LocalizationContext);
  return context ?? fromService();
}

// Utility hook for currency formatting only
export function useCurrency() {
  const { formatCurrency, currentCurrency, currency, convertCurrency } =
    useLocalization();

  return {
    formatCurrency,
    currentCurrency,
    currency,
    convertCurrency,
  };
}

// Utility hook for date/time formatting only
export function useDateTime() {
  const { formatDate, formatTime, currentLocale, locale } = useLocalization();

  return {
    formatDate,
    formatTime,
    currentLocale,
    locale,
  };
}

// Utility hook for number formatting only
export function useNumberFormat() {
  const { formatNumber, formatPercentage, currentLocale } = useLocalization();

  return {
    formatNumber,
    formatPercentage,
    currentLocale,
  };
}
