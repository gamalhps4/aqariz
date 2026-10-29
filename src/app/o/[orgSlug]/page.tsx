/**
 * PropertyPro - An office's public listings page
 *
 * /o/{office}: the properties an office is advertising right now, in Arabic
 * and right to left unless the link says ?lang=en. Only what the public read
 * path allows (lib/listings/public.ts): published listings with a current
 * advertising licence whose unit is still vacant.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { PublicListingCard } from "@/components/listings/public/PublicListingCard";
import { PublicShell } from "@/components/listings/public/PublicShell";
import { isListingType, type ListingType } from "@/lib/listings/constants";
import { getPublicListings, getPublicOffice } from "@/lib/listings/public";
import {
  otherLang,
  publicText,
  resolvePublicLang,
  type PublicLang,
} from "@/lib/listings/public-text";
import { absoluteUrl, appBaseUrl, listingPath, officePath } from "@/lib/listings/urls";

interface PageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A path with this page's own query: the language, the type, the page number. */
function withQuery(
  path: string,
  query: { lang: PublicLang; type?: ListingType; page?: number },
): string {
  const params = new URLSearchParams();
  if (query.lang === "en") params.set("lang", "en");
  if (query.type) params.set("type", query.type);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { orgSlug } = await params;
  const query = await searchParams;
  const lang = resolvePublicLang(query.lang);
  const office = await getPublicOffice(orgSlug);

  if (!office) {
    return {
      title: { absolute: publicText(lang, "marketing.public.notFound") },
      robots: { index: false, follow: false },
    };
  }

  const path = officePath(office.slug);
  const title = publicText(lang, "marketing.public.office.metaTitle", {
    office: office.name,
  });
  const description = publicText(lang, "marketing.public.office.metaDescription", {
    office: office.name,
  });

  return {
    metadataBase: new URL(appBaseUrl()),
    title: { absolute: title },
    description,
    alternates: {
      canonical: withQuery(path, { lang }),
      languages: {
        "ar-SA": withQuery(path, { lang: "ar" }),
        en: withQuery(path, { lang: "en" }),
      },
    },
    openGraph: {
      type: "website",
      title,
      description,
      url: absoluteUrl(withQuery(path, { lang })),
      siteName: office.name,
      locale: lang === "ar" ? "ar_SA" : "en_US",
      ...(office.logoUrl
        ? {
            images: [
              {
                url: office.logoUrl.startsWith("/")
                  ? absoluteUrl(office.logoUrl)
                  : office.logoUrl,
              },
            ],
          }
        : {}),
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function OfficePage({ params, searchParams }: PageProps) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const lang = resolvePublicLang(query.lang);
  const askedType = first(query.type);
  const type = isListingType(askedType) ? askedType : undefined;
  const page = Math.max(1, parseInt(first(query.page) ?? "1", 10) || 1);

  const office = await getPublicOffice(orgSlug);
  if (!office) notFound();

  const result = await getPublicListings(office, { type, page });
  const base = officePath(office.slug);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const text = (key: string, values?: Record<string, string | number>) =>
    publicText(lang, key, values);

  const tabs: Array<{ id: string; type?: ListingType; label: string }> = [
    { id: "all", label: text("marketing.public.office.all") },
    { id: "rent", type: "rent", label: text("marketing.public.office.forRent") },
    { id: "sale", type: "sale", label: text("marketing.public.office.forSale") },
  ];

  return (
    <PublicShell
      office={office}
      lang={lang}
      switchHref={withQuery(base, { lang: otherLang(lang), type })}
    >
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {text("marketing.public.office.heading", { office: office.name })}
          </h1>
          <p className="text-muted-foreground">
            {text("marketing.public.office.subheading")}
          </p>
        </div>

        <nav className="flex flex-wrap gap-2" aria-label={text("marketing.public.office.filter")}>
          {tabs.map((tab) => {
            const active = (tab.type ?? null) === (type ?? null);
            return (
              <Link
                key={tab.id}
                href={withQuery(base, { lang, type: tab.type })}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-accent"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {result.rows.length === 0 ? (
          <div className="rounded-2xl border bg-background p-12 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 font-medium">{text("marketing.public.office.empty")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {text("marketing.public.office.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {result.rows.map((view) => (
              <PublicListingCard
                key={view.id}
                view={view}
                lang={lang}
                href={withQuery(listingPath(office.slug, view.slug), { lang })}
              />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <nav
            className="flex items-center justify-center gap-3 text-sm"
            aria-label={text("marketing.public.office.pages")}
          >
            {page > 1 ? (
              <Link
                href={withQuery(base, { lang, type, page: page - 1 })}
                prefetch={false}
                rel="prev"
                className="rounded-lg border bg-background px-3 py-1.5 hover:bg-accent"
              >
                {text("marketing.public.office.previous")}
              </Link>
            ) : null}
            <span className="text-muted-foreground">
              {text("marketing.public.office.pageOf", { page, total: totalPages })}
            </span>
            {page < totalPages ? (
              <Link
                href={withQuery(base, { lang, type, page: page + 1 })}
                prefetch={false}
                rel="next"
                className="rounded-lg border bg-background px-3 py-1.5 hover:bg-accent"
              >
                {text("marketing.public.office.next")}
              </Link>
            ) : null}
          </nav>
        )}
      </div>
    </PublicShell>
  );
}
