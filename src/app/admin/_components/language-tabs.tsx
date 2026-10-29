"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type ContentLang = "en" | "ar";

const TABS: { value: ContentLang; label: string }[] = [
  // Each language is named in itself, the way a language switch reads.
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

/** The id of a tab, for the panel's `aria-labelledby`. */
export function languageTabId(idBase: string, lang: ContentLang): string {
  return `${idBase}-tab-${lang}`;
}

/** The id of the panel the tabs control. */
export function languagePanelId(idBase: string): string {
  return `${idBase}-panel`;
}

/**
 * "English | العربية" — which language a console form is editing.
 *
 * A WAI-ARIA tab list: one tab in the tab order, arrow keys (and Home/End)
 * move between them, and each tab points at the panel it controls. The caller
 * renders that panel with `role="tabpanel"`, `id={languagePanelId(idBase)}`
 * and `aria-labelledby={languageTabId(idBase, value)}`.
 */
export function LanguageTabs({
  value,
  onChange,
  label,
  idBase,
  className,
}: {
  value: ContentLang;
  onChange: (lang: ContentLang) => void;
  /** What the tab list chooses, for screen readers ("Content language"). */
  label: string;
  idBase: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      // Two tabs: either arrow moves to the other one, in either direction.
      next = (index + 1) % TABS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = TABS.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    onChange(TABS[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex h-9 items-center rounded-md bg-muted p-1 text-muted-foreground",
        className,
      )}
    >
      {TABS.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={languageTabId(idBase, tab.value)}
            aria-selected={selected}
            aria-controls={languagePanelId(idBase)}
            tabIndex={selected ? 0 : -1}
            lang={tab.value}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex h-7 items-center rounded-sm px-3 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected && "bg-background text-foreground shadow-sm",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
