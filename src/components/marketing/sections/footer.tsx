import Link from "next/link";
import { ArrowRight, ArrowUp, Mail } from "lucide-react";
import { Brand } from "./brand";
import { Button } from "@/components/ui/button";
import { getPlatformSettings } from "@/lib/platform/settings";
import type { FooterContent } from "@/lib/marketing/landing-types";
import type { MarketingLang } from "@/lib/marketing/landing-i18n";
import { siteText } from "@/lib/marketing/site-text";

/**
 * Marketing footer: a brand column (lockup, blurb, CTA, support address) beside
 * headed link columns, closed by a hairline meta row. It renders on the
 * homepage, the standalone marketing pages and the auth pages, so it stays light
 * and quiet — the brand presence is a tinted top edge rather than a colour band.
 */
export async function FooterSection({
  content,
  lang = "en",
}: {
  content: FooterContent;
  /** The page's language; `content` is already in it (and its links point
   * at that language's pages). */
  lang?: MarketingLang;
}) {
  const { general } = await getPlatformSettings();
  const showCta = Boolean(content.ctaLabel && content.ctaHref);

  return (
    <footer
      id="resources"
      className="relative overflow-hidden border-t border-slate-200/70 bg-slate-50"
    >
      {/* Brand-tinted top edge + a soft wash that fades within the first screenful. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(55%_100%_at_50%_0%,rgba(37,99,235,.06),transparent_70%)]"
      />

      <div className="relative mx-auto max-w-7xl px-5 pb-10 pt-16 sm:px-8 lg:px-10 lg:pt-20">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] lg:gap-x-16">
          <div className="col-span-2 md:col-span-3 md:max-w-sm lg:col-span-1 lg:max-w-none">
            <Link
              href={lang === "ar" ? "/ar" : "/"}
              aria-label={siteText(lang, "header.home", { name: general.platformName })}
              className="inline-flex"
            >
              <Brand name={general.platformName} logoUrl={general.logoLight} />
            </Link>
            {content.tagline && (
              <p className="mt-5 text-sm leading-relaxed text-slate-500">
                {content.tagline}
              </p>
            )}
            {showCta && (
              <Button
                asChild
                size="sm"
                className="mt-6 rounded-full bg-blue-600 px-5 shadow-lg shadow-blue-600/20 hover:bg-blue-700"
              >
                <Link href={content.ctaHref}>
                  {content.ctaLabel} <ArrowRight className="rtl:-scale-x-100" />
                </Link>
              </Button>
            )}
            {general.supportEmail && (
              <a
                href={`mailto:${general.supportEmail}`}
                className="mt-6 inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-blue-600"
              >
                <Mail className="size-4 text-slate-400" />
                {general.supportEmail}
              </a>
            )}
          </div>

          {content.columns.map((column, index) => (
            <nav key={column.title || index} aria-label={column.title || undefined}>
              {column.title && (
                <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-950">
                  {column.title}
                </h2>
              )}
              <ul className="mt-4 space-y-3 text-sm">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-slate-500 transition hover:text-blue-600"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-16 flex flex-col-reverse items-start gap-4 border-t border-slate-200/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">{content.copyright}</p>
          {/* "#top" is the spec'd fragment for the top of the document, so this
              needs no id on the page and no client-side handler. */}
          <a
            href="#top"
            className="group inline-flex items-center gap-2 text-xs font-medium text-slate-500 transition hover:text-blue-600"
          >
            {siteText(lang, "footer.backToTop")}
            <span className="grid size-6 place-items-center rounded-full border border-slate-200 transition group-hover:border-blue-200 group-hover:bg-blue-50">
              <ArrowUp className="size-3 transition group-hover:-translate-y-0.5" />
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}
