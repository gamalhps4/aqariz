"use client";

/**
 * Words the shared UI parts say on their own — "Close", "No results found.",
 * "Pick a date" — in the reader's language.
 *
 * These parts render everywhere, including places the localization provider
 * may not reach, so they read the context directly and fall back to English
 * instead of throwing like `useLocalizationContext` does.
 */

import { useCallback, useContext, useSyncExternalStore } from "react";
import { LocalizationContext } from "@/components/providers/LocalizationProvider";

export function useUiText() {
  const localization = useContext(LocalizationContext);
  // `t` is stable for a language, so `text` is too — safe in hook deps.
  const translate = localization?.t;
  const text = useCallback(
    (key: string, english: string): string =>
      translate ? translate(key, { defaultValue: english }) : english,
    [translate],
  );
  return { language: localization?.language ?? "en", text };
}

/**
 * The page's reading direction, for the Radix parts that stamp their own
 * `dir` attribute on what they render — menus, selects, scroll areas. Left
 * alone they stamp "ltr" and pin their contents left to right on an Arabic
 * page, so these parts hand them this instead.
 *
 * It follows `<html dir>`, which the settings provider keeps in step with the
 * language and the right-to-left switch. The server can't read that, so the
 * server render (and hydration) goes by the language.
 */
export function useUiDirection(): "ltr" | "rtl" {
  const rtlLanguage = useContext(LocalizationContext)?.isRTL ?? false;
  return useSyncExternalStore(
    watchDocumentDirection,
    readDocumentDirection,
    () => (rtlLanguage ? "rtl" : "ltr"),
  );
}

function watchDocumentDirection(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["dir"],
  });
  return () => observer.disconnect();
}

function readDocumentDirection(): "ltr" | "rtl" {
  return document.documentElement.dir === "rtl" ? "rtl" : "ltr";
}
