"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "@/components/ui/app-image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TestimonialContent } from "@/lib/marketing/landing-types";

/** The carousel's own words, in the page's language. `{count}` and
 * `{number}` are filled in here. */
export interface TestimonialLabels {
  previous: string;
  next: string;
  /** "Show review {number}". */
  show: string;
  /** "{count} out of 5 stars". */
  stars: string;
}

const ENGLISH_LABELS: TestimonialLabels = {
  previous: "Previous review",
  next: "Next review",
  show: "Show review {number}",
  stars: "{count} out of 5 stars",
};

/**
 * A space between two pieces of the quote when neither brings one. Documents
 * saved before the console stopped trimming the pieces lost the spaces around
 * the highlight ("units —99% on-time rentwith"); this puts them back.
 */
function gap(left: string, right: string): string {
  if (!left || !right) return "";
  return /\s$/.test(left) || /^\s/.test(right) ? "" : " ";
}

/** Five stars with `rating` of them filled. */
function Stars({ rating, label }: { rating: number; label: string }) {
  const filled = Math.min(5, Math.max(0, Math.round(rating)));
  return (
    <div
      className="mb-3 flex text-lg leading-none"
      role="img"
      aria-label={label.replace("{count}", String(filled))}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          aria-hidden
          className={index < filled ? "text-amber-400" : "text-slate-200"}
        >
          ★
        </span>
      ))}
    </div>
  );
}

/**
 * Customer reviews. The slides, their order and the autoplay interval all come
 * from the Platform Console; the arrows and dots only render from two slides up,
 * so a single review looks exactly like the original static block.
 *
 * Autoplay is a convenience, never the only way through: it pauses on hover and
 * on keyboard focus, stops for good the moment a visitor picks a slide, and
 * never starts under `prefers-reduced-motion`.
 */
export function TestimonialSection({
  content,
  labels = ENGLISH_LABELS,
}: {
  content: TestimonialContent;
  labels?: TestimonialLabels;
}) {
  const slides = content.slides;
  const count = slides.length;
  const [requestedIndex, setActive] = useState(0);
  // A slide removed in the console can leave the stored index past the end;
  // clamping here rather than in an effect keeps the render self-consistent.
  const active = requestedIndex < count ? requestedIndex : 0;
  const [paused, setPaused] = useState(false);
  // Set once a visitor uses the arrows or dots — their choice outranks the timer.
  const [interacted, setInteracted] = useState(false);

  const go = useCallback(
    (index: number) => {
      setInteracted(true);
      setActive(((index % count) + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (count < 2 || interacted || paused) return;
    const seconds = content.autoplaySeconds;
    if (!seconds || seconds <= 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % count),
      seconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [count, interacted, paused, content.autoplaySeconds]);

  if (count === 0) return null;

  return (
    <section className="relative mx-auto max-w-6xl px-5 pt-20 sm:px-8 lg:pt-[168.5px]">
      <blockquote className="mx-auto mb-10 max-w-4xl text-center text-2xl font-bold leading-tight tracking-[-.03em] text-slate-800 sm:text-3xl">
        {content.quoteBefore}
        {gap(content.quoteBefore, content.quoteHighlight)}
        <span className="text-blue-600">{content.quoteHighlight}</span>
        {gap(content.quoteHighlight, content.quoteAfter)}
        {content.quoteAfter}
      </blockquote>

      <div
        // Hover and focus both suspend the timer; `focus-within` covers the
        // arrows and dots, which are the only focusable things inside.
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        <div
          aria-live="polite"
          aria-atomic="false"
          className="group relative overflow-hidden rounded-[2rem] border-4 border-white shadow-2xl shadow-slate-900/15"
        >
          {slides.map((slide, index) => {
            const current = index === active;
            return (
              <div
                key={index}
                aria-hidden={!current}
                // The first slide holds the box open in flow; the rest stack on
                // top of it, so the section keeps one height across reviews.
                className={`transition-opacity duration-500 ease-out motion-reduce:transition-none ${
                  index === 0 ? "relative" : "absolute inset-0"
                } ${current ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"}`}
              >
                {slide.image ? (
                  <Image
                    src={slide.image}
                    alt={slide.imageAlt}
                    width={1672}
                    height={941}
                    priority={index === 0}
                    className="aspect-[16/8.5] min-h-[420px] w-full object-cover object-center"
                  />
                ) : (
                  <div className="aspect-[16/8.5] min-h-[420px] w-full bg-slate-100" />
                )}
                <div className="absolute bottom-5 start-5 max-w-sm rounded-2xl bg-white/95 p-5 shadow-xl backdrop-blur sm:bottom-8 sm:start-8 sm:p-6">
                  <Stars rating={slide.rating} label={labels.stars} />
                  <p className="text-sm leading-6 text-slate-600">{slide.cardQuote}</p>
                  <p className="mt-4 text-sm font-bold text-slate-950">
                    {slide.authorName}
                  </p>
                  <p className="text-xs text-slate-400">{slide.authorTitle}</p>
                </div>
              </div>
            );
          })}

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(active - 1)}
                aria-label={labels.previous}
                className="absolute start-4 top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-lg transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
              >
                <ChevronLeft className="size-5 rtl:-scale-x-100" />
              </button>
              <button
                type="button"
                onClick={() => go(active + 1)}
                aria-label={labels.next}
                className="absolute end-4 top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-lg transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
              >
                <ChevronRight className="size-5 rtl:-scale-x-100" />
              </button>
            </>
          )}
        </div>

        {count > 1 && (
          <div className="mt-7 flex justify-center gap-2">
            {slides.map((slide, index) => (
              <button
                key={index}
                type="button"
                onClick={() => go(index)}
                aria-label={`${labels.show.replace("{number}", String(index + 1))}${
                  slide.authorName ? ` — ${slide.authorName}` : ""
                }`}
                aria-current={index === active}
                className={`h-2 rounded-full transition-all ${
                  index === active ? "w-8 bg-blue-600" : "w-2 bg-slate-200 hover:bg-slate-300"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
