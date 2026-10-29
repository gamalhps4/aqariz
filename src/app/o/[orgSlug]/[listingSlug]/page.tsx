/**
 * PropertyPro - One listing, on the office's public page
 *
 * /o/{office}/{listing}: photos, price and what it is per, the facts about the
 * unit, the description, the amenities, the advertising licence number (and
 * the office's brokerage licence), Call and WhatsApp buttons and the inquiry
 * form. Arabic and right to left unless the link says ?lang=en.
 *
 * What is drawn is exactly what lib/listings/public.ts returns, and that
 * returns nothing for a draft, an archived ad, a listing whose licence has run
 * out, one whose unit has been let, or another office's — those are a plain
 * 404, so nothing about a hidden listing is confirmed to a stranger.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Bath,
  BedDouble,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Layers,
  MapPin,
  MessageCircle,
  Phone,
  Ruler,
  ShieldCheck,
} from "lucide-react";
import { InquiryForm, type InquiryFormLabels } from "@/components/listings/public/InquiryForm";
import { PublicGallery } from "@/components/listings/public/PublicGallery";
import { PublicShell } from "@/components/listings/public/PublicShell";
import { riyadhDay } from "@/lib/listings/dates";
import { telUrl, whatsappUrl } from "@/lib/listings/phone";
import { getPublicListing, getPublicOffice } from "@/lib/listings/public";
import {
  formatArea,
  formatDay,
  jsonLd,
  locationLine,
  metaDescription,
  offerLabel,
  pick,
  priceLine,
  titleOf,
  unitTypeName,
} from "@/lib/listings/public-format";
import {
  otherLang,
  publicText,
  resolvePublicLang,
  type PublicLang,
} from "@/lib/listings/public-text";
import { absoluteUrl, appBaseUrl, listingPath, officePath } from "@/lib/listings/urls";

interface PageProps {
  params: Promise<{ orgSlug: string; listingSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function withLang(path: string, lang: PublicLang): string {
  return lang === "en" ? `${path}?lang=en` : path;
}

function formLabels(lang: PublicLang): InquiryFormLabels {
  const text = (key: string) => publicText(lang, `marketing.public.form.${key}`);
  return {
    heading: text("heading"),
    hint: text("hint"),
    name: text("name"),
    phone: text("phone"),
    phoneHint: text("phoneHint"),
    email: text("email"),
    message: text("message"),
    messagePlaceholder: text("messagePlaceholder"),
    submit: text("submit"),
    sending: text("sending"),
    successTitle: text("successTitle"),
    successText: text("successText"),
    again: text("again"),
    honeypot: text("honeypot"),
    failed: text("failed"),
    rateLimited: text("rateLimited"),
    notAvailable: text("notAvailable"),
    privacy: text("privacy"),
    error: {
      name_required: text("error.name_required"),
      name_too_long: text("error.name_too_long"),
      phone_invalid: text("error.phone_invalid"),
      email_invalid: text("error.email_invalid"),
      message_too_long: text("error.message_too_long"),
    },
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { orgSlug, listingSlug } = await params;
  const query = await searchParams;
  const lang = resolvePublicLang(query.lang);
  const notAvailable: Metadata = {
    title: { absolute: publicText(lang, "marketing.public.notFound") },
    robots: { index: false, follow: false },
  };

  const office = await getPublicOffice(orgSlug);
  if (!office) return notAvailable;
  const view = await getPublicListing(office.id, listingSlug);
  if (!view) return notAvailable;

  const path = listingPath(office.slug, view.slug);
  const title = `${titleOf(view, lang)} | ${office.name}`;
  const description = metaDescription(
    pick(lang, view.descriptionAr, view.descriptionEn) ||
      [
        offerLabel(view.type, lang),
        unitTypeName(view.facts, lang),
        locationLine(view),
        priceLine(view, lang),
      ]
        .filter(Boolean)
        .join(" — "),
  );
  const cover = view.photos[0];

  return {
    metadataBase: new URL(appBaseUrl()),
    title: { absolute: title },
    description,
    alternates: {
      canonical: withLang(path, lang),
      languages: {
        "ar-SA": withLang(path, "ar"),
        en: withLang(path, "en"),
      },
    },
    openGraph: {
      type: "website",
      title,
      description,
      url: absoluteUrl(withLang(path, lang)),
      siteName: office.name,
      locale: lang === "ar" ? "ar_SA" : "en_US",
      ...(cover
        ? { images: [{ url: cover.startsWith("/") ? absoluteUrl(cover) : cover }] }
        : {}),
    },
    twitter: {
      card: cover ? "summary_large_image" : "summary",
      title,
      description,
      ...(cover
        ? { images: [cover.startsWith("/") ? absoluteUrl(cover) : cover] }
        : {}),
    },
  };
}

export default async function ListingPage({ params, searchParams }: PageProps) {
  const { orgSlug, listingSlug } = await params;
  const query = await searchParams;
  const lang = resolvePublicLang(query.lang);

  const office = await getPublicOffice(orgSlug);
  if (!office) notFound();
  const view = await getPublicListing(office.id, listingSlug);
  if (!view) notFound();

  const text = (key: string, values?: Record<string, string | number>) =>
    publicText(lang, key, values);

  const path = listingPath(office.slug, view.slug);
  const title = titleOf(view, lang);
  const description = pick(lang, view.descriptionAr, view.descriptionEn);
  const place = locationLine(view);
  const phone = view.phone ?? office.phone;
  const whatsapp = view.whatsapp ?? office.whatsapp;
  const available =
    view.facts.availableFrom && view.facts.availableFrom > riyadhDay()
      ? text("marketing.public.availableFrom", {
          date: formatDay(view.facts.availableFrom, lang),
        })
      : text("marketing.public.availableNow");

  const facts: Array<{ id: string; icon: React.ReactNode; label: string; value: string }> = [
    {
      id: "type",
      icon: <Building2 className="h-5 w-5" />,
      label: text("marketing.public.fact.type"),
      value: unitTypeName(view.facts, lang),
    },
    ...(view.facts.bedrooms > 0
      ? [
          {
            id: "bedrooms",
            icon: <BedDouble className="h-5 w-5" />,
            label: text("marketing.public.bedrooms"),
            value: String(view.facts.bedrooms),
          },
        ]
      : []),
    ...(view.facts.bathrooms > 0
      ? [
          {
            id: "bathrooms",
            icon: <Bath className="h-5 w-5" />,
            label: text("marketing.public.bathrooms"),
            value: String(view.facts.bathrooms),
          },
        ]
      : []),
    {
      id: "area",
      icon: <Ruler className="h-5 w-5" />,
      label: text("marketing.public.fact.area"),
      value: formatArea(view.facts.area, lang),
    },
    ...(view.facts.floor !== null
      ? [
          {
            id: "floor",
            icon: <Layers className="h-5 w-5" />,
            label: text("marketing.public.fact.floor"),
            value: String(view.facts.floor),
          },
        ]
      : []),
    {
      id: "availability",
      icon: <CalendarCheck className="h-5 w-5" />,
      label: text("marketing.public.fact.availability"),
      value: available,
    },
  ];

  const structured = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: title,
    description: description || undefined,
    url: absoluteUrl(withLang(path, lang)),
    datePosted: view.publishedAt ?? undefined,
    image: view.photos.map((photo) => (photo.startsWith("/") ? absoluteUrl(photo) : photo)),
    offers: {
      "@type": "Offer",
      price: view.price,
      priceCurrency: view.currency,
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: view.city ?? undefined,
      addressRegion: view.district ?? undefined,
      addressCountry: "SA",
    },
  };

  const shareText = text("marketing.public.whatsappText", {
    title,
    url: absoluteUrl(withLang(path, lang)),
  });

  return (
    <PublicShell
      office={office}
      lang={lang}
      homeHref={withLang(officePath(office.slug), lang)}
      switchHref={withLang(path, otherLang(lang))}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(structured) }}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          <PublicGallery
            photos={view.photos}
            alt={title}
            labels={{
              previous: text("marketing.public.gallery.previous"),
              next: text("marketing.public.gallery.next"),
              counter: text("marketing.public.gallery.counter"),
              none: text("marketing.public.gallery.none"),
            }}
          />

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {offerLabel(view.type, lang)}
              </span>
              {place && (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {place}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
              {title}
            </h1>
            <p className="text-2xl font-bold text-primary">{priceLine(view, lang)}</p>
          </section>

          <section aria-label={text("marketing.public.facts")}>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {facts.map((fact) => (
                <div
                  key={fact.id}
                  className="flex items-center gap-3 rounded-xl border bg-background p-3"
                >
                  <span className="text-muted-foreground">{fact.icon}</span>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                    <dd className="truncate text-sm font-medium">{fact.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </section>

          {description && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">
                {text("marketing.public.description")}
              </h2>
              <p className="whitespace-pre-line leading-relaxed text-foreground/90">
                {description}
              </p>
            </section>
          )}

          {view.amenities.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">{text("marketing.public.amenities")}</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {view.amenities.map((amenity) => (
                  <li key={amenity} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    {amenity}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border bg-background p-4">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {text("marketing.public.licences")}
            </h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {text("marketing.public.adLicence")}
                </dt>
                <dd className="font-medium">
                  <bdi dir="ltr">{view.licenceNumber}</bdi>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {text("marketing.public.adLicenceValid")}
                </dt>
                <dd className="font-medium">{formatDay(view.licenceExpiry, lang)}</dd>
              </div>
              {office.falLicenceNumber && (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {text("marketing.public.falLicence")}
                  </dt>
                  <dd className="font-medium">
                    <bdi dir="ltr">{office.falLicenceNumber}</bdi>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">
                  {text("marketing.public.office")}
                </dt>
                <dd className="font-medium">{office.name}</dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {(phone || whatsapp) && (
            <div className="grid gap-2 rounded-2xl border bg-background p-4">
              {phone && (
                <a
                  href={telUrl(phone)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                >
                  <Phone className="h-4 w-4" />
                  {text("marketing.public.call")}
                  <bdi dir="ltr" className="opacity-90">
                    {phone}
                  </bdi>
                </a>
              )}
              {whatsapp && (
                <a
                  href={whatsappUrl(whatsapp, shareText)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-success/40 px-4 py-2.5 text-sm font-medium text-success transition hover:bg-success/10"
                >
                  <MessageCircle className="h-4 w-4" />
                  {text("marketing.public.whatsapp")}
                </a>
              )}
            </div>
          )}
          <div className="rounded-2xl border bg-background p-4">
            <InquiryForm
              listingId={view.id}
              labels={formLabels(lang)}
              dir={lang === "ar" ? "rtl" : "ltr"}
            />
          </div>
        </aside>
      </div>
    </PublicShell>
  );
}
