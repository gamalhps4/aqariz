import Link from "next/link";
import Image from "@/components/ui/app-image";
import { ArrowRight } from "lucide-react";
import { Emphasis } from "@/lib/marketing/rich-text";
import type { CustomSection } from "@/lib/marketing/landing-types";

/** Paragraphs are separated by a blank line; a single line break stays a
 * line break inside its paragraph (`Emphasis`). */
function paragraphsOf(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** A path on this site goes through the router; anything else is a plain
 * link out (the console only stores http(s) addresses besides paths). */
function SectionLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/**
 * A section the operator added in the console: heading, body copy, an
 * optional image and an optional button. It borrows the homepage's own
 * vocabulary — the #2f2158 headings, the #535353 body, the brand-blue pill,
 * the large rounded media — so a band written in the console sits between the
 * designed ones without looking pasted in.
 *
 * `start`/`end` place the image on the reading direction's sides: the DOM
 * order is the reading order, and the grid follows `dir`, so the Arabic page
 * mirrors the band with no extra rules. A section with nothing in it is not
 * drawn at all.
 */
export function CustomSectionView({ section }: { section: CustomSection }) {
  const paragraphs = paragraphsOf(section.body);
  const image = section.imagePosition !== "none" ? section.image.trim() : "";
  const showButton = Boolean(section.ctaLabel.trim() && section.ctaHref.trim());
  if (!section.heading.trim() && paragraphs.length === 0 && !image) return null;

  const beside = Boolean(image) && section.imagePosition !== "top";
  const centred = !beside;
  const tinted = section.background === "tinted";

  const copy = (
    <div className={centred ? "mx-auto max-w-3xl text-center" : "min-w-0"}>
      {section.heading.trim() && (
        <h2 className="text-[30px] font-bold leading-[1.2] tracking-[-0.01em] text-[#2f2158] text-balance sm:text-[40px]">
          {section.heading}
        </h2>
      )}
      {paragraphs.length > 0 && (
        <div className="mt-5 space-y-4 text-[16px] leading-[1.7] text-[#535353] sm:text-[17px]">
          {paragraphs.map((paragraph, index) => (
            <p key={index}>
              <Emphasis text={paragraph} />
            </p>
          ))}
        </div>
      )}
      {showButton && (
        <SectionLink
          href={section.ctaHref}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#2b55ff] px-6 py-3 text-[15px] font-bold leading-none text-white shadow-lg shadow-[#2b55ff]/20 transition hover:bg-[#1f45e0]"
        >
          {section.ctaLabel}
          <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </SectionLink>
      )}
    </div>
  );

  const media = image ? (
    <div
      className={`relative w-full overflow-hidden rounded-[24px] bg-slate-100 shadow-[0_24px_60px_-30px_rgba(15,23,42,.35)] ${
        beside ? "aspect-[4/3]" : "mx-auto mt-12 aspect-[16/9] max-w-5xl"
      }`}
    >
      <Image
        src={image}
        alt={section.imageAlt}
        fill
        sizes={beside ? "(max-width: 1024px) 100vw, 560px" : "(max-width: 1024px) 100vw, 1024px"}
        className="object-cover"
      />
    </div>
  ) : null;

  return (
    <section
      id={`section-${section.id}`}
      className={
        tinted
          ? "mt-20 bg-[#f5f7ff] py-16 sm:py-20 lg:mt-[120px] lg:py-24"
          : "pt-20 lg:pt-[120px]"
      }
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        {beside ? (
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            {section.imagePosition === "start" ? (
              <>
                {media}
                {copy}
              </>
            ) : (
              <>
                {copy}
                {media}
              </>
            )}
          </div>
        ) : (
          <>
            {copy}
            {media}
          </>
        )}
      </div>
    </section>
  );
}
