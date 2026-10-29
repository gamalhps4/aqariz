"use client";

/**
 * PropertyPro - A listing's photos, on its public page
 *
 * One large photo, arrows, and a strip of thumbnails. Only addresses the
 * image optimiser can fetch reach this component (the server filters them), so
 * every `<Image>` here is safe to draw.
 */

import { useState } from "react";
import Image from "@/components/ui/app-image";
import { Building2, ChevronLeft, ChevronRight } from "lucide-react";

interface PublicGalleryProps {
  photos: string[];
  alt: string;
  labels: {
    previous: string;
    next: string;
    /** "Photo {number} of {total}" */
    counter: string;
    none: string;
  };
}

export function PublicGallery({ photos, alt, labels }: PublicGalleryProps) {
  const [index, setIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <Building2 className="h-12 w-12" />
          <span className="text-sm">{labels.none}</span>
        </div>
      </div>
    );
  }

  const current = Math.min(index, photos.length - 1);
  const go = (delta: number) =>
    setIndex((value) => (value + delta + photos.length) % photos.length);

  return (
    <div className="space-y-2">
      <div className="group relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-muted">
        <Image
          key={photos[current]}
          src={photos[current]}
          alt={`${alt} — ${labels.counter
            .replace("{number}", String(current + 1))
            .replace("{total}", String(photos.length))}`}
          fill
          priority={current === 0}
          className="object-cover"
          sizes="(max-width: 1024px) 100vw, 800px"
        />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={labels.previous}
              className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-2 text-white opacity-90 transition hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={labels.next}
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-2 text-white opacity-90 transition hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronRight className="h-5 w-5 rtl:rotate-180" />
            </button>
            <span className="absolute bottom-2 end-2 rounded-full bg-black/55 px-2.5 py-0.5 text-xs text-white">
              {labels.counter
                .replace("{number}", String(current + 1))
                .replace("{total}", String(photos.length))}
            </span>
          </>
        )}
      </div>

      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((photo, position) => (
            <button
              key={`${photo}-${position}`}
              type="button"
              onClick={() => setIndex(position)}
              aria-current={position === current}
              aria-label={labels.counter
                .replace("{number}", String(position + 1))
                .replace("{total}", String(photos.length))}
              className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                position === current
                  ? "border-primary"
                  : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              <Image
                src={photo}
                alt=""
                fill
                className="object-cover"
                sizes="96px"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
