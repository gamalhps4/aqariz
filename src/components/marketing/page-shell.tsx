import type { ReactNode } from "react";
import { getLandingContentFor } from "@/lib/marketing/landing";
import type { MarketingLang } from "@/lib/marketing/landing-i18n";
import { FooterSection } from "@/components/marketing/sections/footer";

/**
 * Chrome for the standalone marketing pages (pricing, contact, legal). The
 * home page composes its own sections from the landing CMS; these pages are
 * fixed content that still needs the same footer. The header comes from the
 * (public) layout that every public route shares. `lang` picks the footer's
 * language; the Arabic pages' `dir` is set by their layout (`/ar`).
 */
export async function MarketingPageShell({
  children,
  lang = "en",
}: {
  children: ReactNode;
  lang?: MarketingLang;
}) {
  const landing = await getLandingContentFor(lang);

  return (
    <div className="flex-1 bg-white pt-20">
      <main>{children}</main>
      <FooterSection content={landing.footer} lang={lang} />
    </div>
  );
}

/** Shared page header: eyebrow, title, and an optional lead paragraph. */
export function MarketingPageHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 pt-16 text-center sm:px-8 sm:pt-24">
      {eyebrow && (
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-600">
          {eyebrow}
        </p>
      )}
      <h1 className="mt-3 text-4xl font-bold tracking-[-0.02em] text-slate-900 text-balance sm:text-5xl">
        {title}
      </h1>
      {lead && (
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
          {lead}
        </p>
      )}
    </div>
  );
}

/**
 * Long-form legal copy. Sections are plain data so the two policy pages stay
 * readable and share one set of typographic rules.
 */
export function LegalDocument({
  lastUpdated,
  intro,
  sections,
}: {
  lastUpdated: string;
  intro: string;
  sections: Array<{ heading: string; body: ReactNode }>;
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
      <p className="text-sm text-slate-500">Last updated: {lastUpdated}</p>
      <p className="mt-6 text-lg leading-relaxed text-slate-700">{intro}</p>

      <nav aria-label="Contents" className="mt-10 rounded-xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-slate-500">
          Contents
        </h2>
        <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          {sections.map((section, index) => (
            <li key={section.heading}>
              <a
                href={`#section-${index + 1}`}
                className="text-slate-700 transition hover:text-blue-600"
              >
                {index + 1}. {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-12 space-y-10">
        {sections.map((section, index) => (
          <section key={section.heading} id={`section-${index + 1}`}>
            <h2 className="text-xl font-semibold tracking-[-0.01em] text-slate-900">
              {index + 1}. {section.heading}
            </h2>
            <div className="mt-3 space-y-3 leading-relaxed text-slate-700 [&_li]:ms-5 [&_li]:list-disc [&_ul]:space-y-2">
              {section.body}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
