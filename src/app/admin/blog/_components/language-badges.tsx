"use client";

import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MarketingLang } from "@/lib/marketing/landing-i18n";

type LanguageState = "complete" | "partial" | "empty";

/**
 * "EN" / "AR" per language a post has: solid when that language is on the
 * site (a title and content), dashed when it is half-written, absent when
 * there is nothing. The full state is in the tooltip and for screen readers.
 */
export function LanguageBadges({
  languages,
}: {
  languages: Record<MarketingLang, LanguageState>;
}) {
  const { t } = useLocalizationContext();
  const names: Record<MarketingLang, string> = {
    en: t("platform.blog.lang.en", { defaultValue: "English" }),
    ar: t("platform.blog.lang.ar", { defaultValue: "Arabic" }),
  };
  return (
    <>
      {(["en", "ar"] as const).map((lang) => {
        const state = languages[lang];
        if (state === "empty") return null;
        const description =
          state === "complete"
            ? t("platform.blog.lang.complete", {
                defaultValue: "{language}: ready",
                values: { language: names[lang] },
              })
            : t("platform.blog.lang.partial", {
                defaultValue: "{language}: needs a title and content",
                values: { language: names[lang] },
              });
        return (
          <Badge
            key={lang}
            variant={state === "complete" ? "info" : "outline"}
            className={cn("px-1.5 py-0 text-[10px] uppercase", state === "partial" && "border-dashed opacity-80")}
            title={description}
          >
            <span aria-hidden>{lang}</span>
            <span className="sr-only">{description}</span>
          </Badge>
        );
      })}
    </>
  );
}
