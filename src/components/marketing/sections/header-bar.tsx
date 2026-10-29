"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HeaderContent } from "@/lib/marketing/landing-types";
import {
  alternateLanguagePath,
  directionOfLang,
  marketingLangOf,
  type MarketingLang,
} from "@/lib/marketing/landing-i18n";

/** One language's navigation, drawn on the server. */
export interface HeaderView {
  header: HeaderContent;
  homeHref: string;
  homeLabel: string;
  /** The switch's label: the *other* language's own name. */
  switchLabel: string;
}

// Source of truth: Figma "PropertyPro" → "Desktop - 1", the nav pill 4:3066 —
// 1202.596 x 64.779 at (112.07, 23.49), white on a 1px #ddd hairline with a
// 0 18 33.4 rgba(33,12,97,.06) shadow. Links are 15px SemiBold #525252 centred
// on the frame; the CTA is 124.017 x 38.213 in #2b55ff.
//
// The language comes from the address: /ar and below are the Arabic pages.
// The header sets its own `dir` and `lang` there because it sits outside the
// page's Arabic wrapper. The sign-in screens (/auth/…) keep it exactly as it
// was — English links, no language switch, the document's own direction —
// since their language is the office's setting, not the address.
export function HeaderBar({
  brand,
  views,
  blogTwins = [],
}: {
  brand: ReactNode;
  views: Record<MarketingLang, HeaderView>;
  /** Slugs of the blog posts published in both languages. */
  blogTwins?: readonly string[];
}) {
  const pathname = usePathname();
  const onAuthScreen = Boolean(pathname?.startsWith("/auth"));
  const lang: MarketingLang = onAuthScreen ? "en" : marketingLangOf(pathname);
  const { header, homeHref, homeLabel, switchLabel } = views[lang];
  const crowded = header.navLinks.length > 4;
  const other: MarketingLang = lang === "ar" ? "en" : "ar";

  // A real link to the same page in the other language, labelled in that
  // language and marked as such for screen readers and translation tools.
  // Where the centred links leave no room, and on phones, it shrinks to the
  // globe; the label stays for screen readers and as the tooltip. Drawn in two
  // places, one shown at a time (display:none keeps the other out of the a11y
  // tree).
  const languageSwitch = (className: string, labelClassName: string) => (
    <Link
      href={alternateLanguagePath(pathname, blogTwins)}
      hrefLang={other}
      lang={other}
      title={switchLabel}
      className={`items-center gap-1.5 whitespace-nowrap text-[15px] font-semibold text-[#525252] transition hover:text-[#2b55ff] ${className}`}
    >
      <Globe className="size-4" aria-hidden />
      <span className={labelClassName}>{switchLabel}</span>
    </Link>
  );

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6 lg:px-8 lg:pt-[23.49px]"
      {...(onAuthScreen ? {} : { dir: directionOfLang(lang), lang })}
    >
      <div className="relative mx-auto flex h-16 max-w-[1202.596px] items-center rounded-full border border-[#ddd] bg-white ps-4 pe-3 shadow-[0_18px_33.4px_rgba(33,12,97,0.06)] sm:px-6 lg:h-[64.779px] lg:ps-6 lg:pe-[20.7px]">
        <Link href={homeHref} aria-label={homeLabel} className="flex min-w-8">
          {brand}
        </Link>
        {/* Tablets: the centred links already crowd the buttons (they touch
            "Sign in" below ~830px), so the switch sits beside the brand. */}
        {!onAuthScreen && languageSwitch("ms-3 hidden md:max-lg:inline-flex", "sr-only")}
        {/* The Arabic labels sit a little closer: "تسجيل الدخول" is wider
            than "Sign in", and the centred links must clear it. A fifth link
            (the shipped navigation has five since the blog) draws them closer
            and a point smaller until there is room for the design's spacing,
            so they clear the buttons and the language switch at tablet and
            small-laptop widths too. Below 840px even four ran into "Sign in"
            ("PricingSign in" on a portrait tablet), so the links start
            there; narrower screens get the buttons alone, as phones do. */}
        <nav
          className={`absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 text-[15px] font-semibold text-[#525252] min-[840px]:flex ${
            lang === "ar"
              ? crowded
                ? "md:gap-3 md:text-[14px] lg:gap-4 xl:gap-11.25 xl:text-[15px]"
                : "md:gap-4 lg:gap-6 xl:gap-11.25"
              : crowded
                ? "md:gap-4 md:text-[14px] lg:gap-7 lg:text-[15px] xl:gap-11.25"
                : "lg:gap-11.25"
          }`}
        >
          {header.navLinks.map(({ label, href }) => (
            <Link key={label} className="transition hover:text-[#2b55ff]" href={href}>
              {label}
            </Link>
          ))}
        </nav>
        {/* Phones keep "Sign in" beside the call to action: a point smaller
            and tighter, with the switch down to its globe, all four fit at
            320px in Arabic, whose "تسجيل الدخول" is the widest. The brand
            gives way first: its name drops out where it no longer fits. */}
        <div className="ms-auto flex shrink-0 items-center gap-1 ps-2 sm:gap-4 lg:gap-7">
          {!onAuthScreen &&
            languageSwitch(
              "inline-flex md:max-lg:hidden max-sm:px-1.5 max-sm:py-2",
              "max-sm:sr-only lg:max-xl:sr-only",
            )}
          {header.signIn.label && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="px-2.5 text-[14px] font-semibold text-[#525252] hover:text-[#2b55ff] sm:px-4 sm:text-[15px]"
            >
              <Link href={header.signIn.href}>{header.signIn.label}</Link>
            </Button>
          )}
          {header.cta.label && (
            <Button
              asChild
              size="sm"
              className="rounded-[40px] bg-[#2b55ff] px-3.5 text-[14px] font-bold shadow-lg shadow-[#2b55ff]/20 hover:bg-[#1f45e0] sm:px-5 sm:text-[15px] lg:h-[38.213px] lg:w-[124.017px] lg:px-0"
            >
              <Link href={header.cta.href}>{header.cta.label}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
