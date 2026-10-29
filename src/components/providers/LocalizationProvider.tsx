/**
 * PropertyPro - Localization Provider
 * Context provider for localization features
 */

"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  localizationService,
  Currency,
  Locale,
  TranslateOptions,
} from "@/lib/services/localization.service";
import { ensureIntlCurrencyPatch } from "@/lib/utils/ensure-intl-currency-patch";
import { APP_CURRENCY } from "@/lib/regional/region";
import { useSettings } from "@/components/providers/SettingsProvider";

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
  loading: boolean;
  language: string;
  t: (key: string, options?: TranslateOptions) => string;
}

const LocalizationContext = createContext<LocalizationContextType | undefined>(
  undefined
);

export function useLocalizationContext(): LocalizationContextType {
  const context = useContext(LocalizationContext);
  if (!context) {
    throw new Error(
      "useLocalizationContext must be used within a LocalizationProvider"
    );
  }
  return context;
}
import { formatCurrency } from "@/lib/utils/formatting";

interface LocalizationProviderProps {
  children: React.ReactNode;
  /** A key of LOCALES ("ar-SA") — the language the server drew the page in. */
  initialLocale?: string;
  /** An ISO 4217 code — the currency the server drew the page in. */
  initialCurrency?: string;
}

/**
 * Point the browser's shared localization service at the language and
 * currency the server drew the page in, before anything renders.
 *
 * Code outside React (PDF drawing, `formatDisplayDate`, toasts) reads the
 * service directly, so it has to agree with the provider from the first
 * render rather than from an effect after hydration — by then some of the
 * page is still being hydrated, and anything reading the service would draw
 * in the new language over HTML written in the old one (React error #418).
 * The server's copy is shared by every request, so it is never touched.
 */
let browserServiceSeeded = false;
function seedBrowserService(localeCode: string, currencyCode: string): void {
  if (browserServiceSeeded || typeof window === "undefined") return;
  browserServiceSeeded = true;
  localizationService.setLocale(localeCode);
  localizationService.setCurrency(currencyCode);
}

/** A locale the service knows, or its starting one. */
function knownLocale(code: string | undefined): string {
  return code && localizationService.getLocale(code)
    ? code
    : localizationService.getCurrentLocale();
}

/**
 * The currency to draw in: riyal, whatever was asked (lib/regional/region).
 * A cookie, a saved setting or localStorage from when an office could pick
 * dollars must not switch the screen to them.
 */
function knownCurrency(_code?: string): string {
  return APP_CURRENCY;
}

export function LocalizationProvider({
  children,
  initialLocale,
  initialCurrency,
}: LocalizationProviderProps) {
  ensureIntlCurrencyPatch();

  // Currency + language now flow from the global SettingsProvider (single source of truth).
  const { settings: displaySettings } = useSettings();

  // The first render — on the server and in the browser alike — uses the
  // language and currency the server was told (the root layout reads them
  // from the request). Nothing is read from the browser here: a saved choice
  // that differed from the server's would make the two renders disagree.
  const [currentLocale, setCurrentLocale] = useState(() => {
    const localeCode = knownLocale(initialLocale);
    seedBrowserService(localeCode, knownCurrency(initialCurrency));
    return localeCode;
  });
  const [currentCurrency, setCurrentCurrency] = useState(() =>
    knownCurrency(initialCurrency)
  );
  const [locale, setLocale] = useState(
    localizationService.getLocale(currentLocale)
  );
  const [currency, setCurrency] = useState(
    localizationService.getCurrency(currentCurrency)
  );
  const [loading, setLoading] = useState(true);

  // Keep the latest currency in a ref so `applyCurrency` can stay referentially
  // stable. Without this, recreating `applyCurrency` on every currency change
  // re-runs the settings-sync effect below, which re-applies the saved currency
  // and reverts the user's just-made (unsaved) selection.
  const currentCurrencyRef = useRef(currentCurrency);
  useEffect(() => {
    currentCurrencyRef.current = currentCurrency;
  }, [currentCurrency]);

  const applyCurrency = useCallback(
    (requestedCode: string, persist = false) => {
      if (!requestedCode) {
        return;
      }
      const currencyCode = knownCurrency(requestedCode);

      const serviceCurrency = localizationService.getCurrentCurrency();
      if (
        currencyCode === currentCurrencyRef.current &&
        currencyCode === serviceCurrency
      ) {
        return;
      }

      localizationService.setCurrency(currencyCode);
      setCurrentCurrency(currencyCode);
      setCurrency(localizationService.getCurrency(currencyCode));

      if (persist && typeof window !== "undefined") {
        localStorage.setItem("PropertyPro-currency", currencyCode);
      }
    },
    []
  );

  // Initialize localization service.
  //
  // The language and currency are not chosen here any more: the server drew
  // the page in the office's language (the `pp-locale` cookie), the state
  // above starts from it, and the office's saved display settings keep it in
  // step once they load (the effect further down). Choosing again here — from
  // localStorage, or the browser's language on a first visit — changed the
  // language while parts of the page were still hydrating, which is what made
  // React redraw dashboard pages on every load.
  useEffect(() => {
    const initializeLocalization = async () => {
      try {
        // Update exchange rates
        await localizationService.updateExchangeRates();
      } catch (error) {
        console.error("Failed to initialize localization:", error);
      } finally {
        setLoading(false);
      }
    };

    initializeLocalization();
  }, []);

  const handleSetLocale = useCallback(
    (localeCode: string) => {
      localizationService.setLocale(localeCode);
      setCurrentLocale(localeCode);
      setLocale(localizationService.getLocale(localeCode));

      localStorage.setItem("PropertyPro-locale", localeCode);
    },
    []
  );

  const handleSetCurrency = useCallback(
    (currencyCode: string) => {
      applyCurrency(currencyCode, true);
    },
    [applyCurrency]
  );

  // Cross-tab currency changes coming from standalone currency switchers that
  // persist directly to localStorage (the SettingsProvider broadcast covers the
  // settings-form path).
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== "PropertyPro-currency" || !event.newValue) return;
      if (event.newValue === currentCurrency) return;
      applyCurrency(event.newValue, false);
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [applyCurrency, currentCurrency]);

  // Apply currency + language from the global SettingsProvider. This reacts to
  // the initial fetch and to live (same-tab/cross-tab) updates without a
  // separate network request.
  useEffect(() => {
    if (displaySettings?.currency) {
      applyCurrency(displaySettings.currency, true);
    }

    if (displaySettings?.language) {
      // Display settings store a short language code; locate a matching locale.
      const normalized = displaySettings.language.toLowerCase();
      const availableLocales = localizationService.getAllLocales();
      const matchingLocale = availableLocales.find(
        (locale) => locale.code.toLowerCase() === normalized
      );
      const localeByLanguage =
        matchingLocale ||
        availableLocales.find((locale) =>
          locale.code.toLowerCase().startsWith(`${normalized}-`)
        );

      if (localeByLanguage) {
        handleSetLocale(localeByLanguage.code);
      }
    }
  }, [
    displaySettings?.currency,
    displaySettings?.language,
    applyCurrency,
    handleSetLocale,
  ]);

  // The office's date format, for the date printed at the foot of a PDF drawn
  // in the browser. Nothing on screen renders from it, so no state is needed.
  useEffect(() => {
    if (displaySettings?.dateFormat) {
      localizationService.setDateFormat(displaySettings.dateFormat);
    }
  }, [displaySettings?.dateFormat]);

  // const formatCurrency = (
  //   amount: number,
  //   currencyCode?: string,
  //   options?: any
  // ) => {
  //   return localizationService.formatCurrency(amount, currencyCode, options);
  // };

  // Formatting follows this provider's language, passed explicitly, rather
  // than whatever the shared service was last set to — the same text on the
  // server and in the browser for the same language.
  const formatDate = (date: Date | string, options?: any) => {
    return localizationService.formatDate(date, {
      ...(options || {}),
      localeCode: options?.localeCode ?? currentLocale,
    });
  };

  const formatTime = (date: Date | string, options?: any) => {
    return localizationService.formatTime(date, {
      ...(options || {}),
      localeCode: options?.localeCode ?? currentLocale,
    });
  };

  const formatNumber = (number: number, options?: any) => {
    return localizationService.formatNumber(number, {
      ...(options || {}),
      localeCode: options?.localeCode ?? currentLocale,
    });
  };

  const formatPercentage = (value: number, options?: any) => {
    return localizationService.formatPercentage(value, {
      ...(options || {}),
      localeCode: options?.localeCode ?? currentLocale,
    });
  };

  const convertCurrency = (
    amount: number,
    fromCurrency: string,
    toCurrency: string
  ) => {
    return localizationService.convertCurrency(
      amount,
      fromCurrency,
      toCurrency
    );
  };

  const language = (currentLocale || "en").split("-")[0].toLowerCase();

  const t = useCallback(
    (key: string, options?: TranslateOptions) => {
      return localizationService.translate(key, {
        language,
        ...(options || {}),
      });
    },
    [language]
  );

  // The shared formatter reads the currency from the service, so its identity
  // never changed — and the React Compiler caches output on its inputs, so
  // anything drawn before the saved currency loaded kept the old symbol (a
  // Saudi office saw "$" on unit cards beside riyal totals). A new identity per
  // currency makes every cached use re-run.
  const formatCurrencyInCurrent = useCallback(
    (amount: number, currencyCode?: string, options?: any) =>
      formatCurrency(amount, currencyCode ?? currentCurrency, options),
    [currentCurrency]
  );

  const contextValue: LocalizationContextType = {
    currentLocale,
    currentCurrency,
    locale,
    currency,
    allLocales: localizationService.getAllLocales(),
    allCurrencies: localizationService.getAllCurrencies(),
    setLocale: handleSetLocale,
    setCurrency: handleSetCurrency,
    formatCurrency: formatCurrencyInCurrent,
    formatDate,
    formatTime,
    formatNumber,
    formatPercentage,
    convertCurrency,
    // From this provider's language, not the shared service's, for the same
    // reason as the formatters above.
    isRTL: localizationService.isRTL(currentLocale),
    firstDayOfWeek: localizationService.getFirstDayOfWeek(currentLocale),
    loading,
    language,
    t,
  };

  return (
    <LocalizationContext.Provider value={contextValue}>
      {children}
    </LocalizationContext.Provider>
  );
}

// Export the context for direct use if needed
export { LocalizationContext };
