/**
 * PropertyPro - One listing on an office's page
 */

import Image from "@/components/ui/app-image";
import Link from "next/link";
import { Bath, BedDouble, Building2, MapPin, Ruler } from "lucide-react";
import {
  formatArea,
  locationLine,
  offerLabel,
  priceLine,
  titleOf,
  unitTypeName,
} from "@/lib/listings/public-format";
import { publicText, type PublicLang } from "@/lib/listings/public-text";
import type { PublicListingView } from "@/lib/listings/public-types";

interface PublicListingCardProps {
  view: PublicListingView;
  href: string;
  lang: PublicLang;
}

export function PublicListingCard({ view, href, lang }: PublicListingCardProps) {
  const photo = view.photos[0];
  const title = titleOf(view, lang);
  const place = locationLine(view);

  return (
    <Link
      href={href}
      prefetch={false}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="relative aspect-[4/3] bg-muted">
        {photo ? (
          <Image
            src={photo}
            alt={title}
            fill
            className="object-cover transition duration-300 group-hover:scale-[1.03]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Building2 className="h-10 w-10" />
          </div>
        )}
        <span className="absolute start-3 top-3 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium shadow-sm">
          {offerLabel(view.type, lang)}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-lg font-semibold text-primary">{priceLine(view, lang)}</p>
        <h2 className="line-clamp-2 text-base font-medium leading-snug">{title}</h2>
        {place && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {place}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-sm text-muted-foreground">
          <span>{unitTypeName(view.facts, lang)}</span>
          {view.facts.bedrooms > 0 && (
            <span
              className="inline-flex items-center gap-1"
              title={publicText(lang, "marketing.public.bedrooms")}
            >
              <BedDouble className="h-4 w-4" />
              {view.facts.bedrooms}
            </span>
          )}
          {view.facts.bathrooms > 0 && (
            <span
              className="inline-flex items-center gap-1"
              title={publicText(lang, "marketing.public.bathrooms")}
            >
              <Bath className="h-4 w-4" />
              {view.facts.bathrooms}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Ruler className="h-4 w-4" />
            {formatArea(view.facts.area, lang)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {publicText(lang, "marketing.public.licenceShort")}{" "}
          <bdi dir="ltr">{view.licenceNumber}</bdi>
        </p>
      </div>
    </Link>
  );
}
