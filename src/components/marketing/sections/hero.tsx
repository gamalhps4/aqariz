import Link from "next/link";
import Image from "@/components/ui/app-image";
import { CircleCheck } from "lucide-react";
import type { HeroContent } from "@/lib/marketing/landing-types";

// Source of truth: Figma "PropertyPro" → "Desktop - 1" (node 4:3055), the hero
// at y 143.86–595.76 of the 1440px artboard.
//
// Geometry below is measured, not eyeballed. The file bakes the CTA row into a
// flat export ("image 20", 4:3077) — buttons have to be real controls, so they
// are rebuilt from that export's own pixels:
//
//   primary   195.90 x 43.74  #4f35f3, label 15px bold white
//   secondary 137.59 x 41.91  #e1e3e6, label 15px bold #0f172b
//   pill gap  15.49    check icon 12.76  bullets 13px #62748e
//
// Both pills carry explicit width/height at lg so the pill boxes stay exact
// even though the artboard's Neue Plak and our Inter set the labels a hair
// differently. The right-hand visual (4:3056) genuinely is one composed image.
//
// Columns are 486.915 : 769.123 with the copy inset 150px and the visual
// bleeding to within 34.19px of the right edge — asymmetric in the design, so
// the padding is a percentage of the 1440 frame rather than centred.
export function HeroSection({ content }: { content: HeroContent }) {
  return (
    <section className="mx-auto grid max-w-[1440px] items-start gap-10 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[486.915fr_769.123fr] lg:gap-0 lg:pb-[60.5px] lg:ps-[10.417%] lg:pe-[2.374%] lg:pt-[55.59px]">
      {/* min-w-0: the h1 below is deliberately wider than this column, and a
          grid item's automatic minimum size would otherwise widen the 486.915fr
          track to fit it — stealing ~90px from the visual. */}
      <div className="min-w-0 lg:pt-[69.44px]">
        {/* 4:3075 is 577.027px wide — wider than the copy column — so "Property
            Management" stays on one line and runs past the subtext. Three lines
            at 45 x 1.09 = 147px, matching the node's height exactly. */}
        <h1 className="text-[34px] leading-[1.09] text-[#191435] sm:text-[45px] lg:w-[577.027px] lg:max-w-none">
          <span className="block font-light">{content.eyebrow}</span>
          <span className="block font-bold text-[#2b55ff]">
            {content.headingTop} {content.headingHighlight}
          </span>
          <span className="block font-bold">{content.headingBottom}</span>
        </h1>

        {/* Figma sets this at 0.32px tracking; Figtree needs 3px more room than
            Neue Plak to keep "without" on line 1, so 0.2px buys it back. 0.12px
            per character is invisible; the designed line break is not. */}
        <p className="mt-8 max-w-[486.915px] text-[16px] leading-[1.2] tracking-[0.2px] text-[#535353] lg:mt-[51.39px]">
          {content.subtext}
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-[15.49px] lg:mt-[30.35px]">
          <Link
            href={content.primaryCta.href}
            className="inline-flex items-center justify-center rounded-full bg-[#4f35f3] px-[30px] py-[13px] text-[15px] font-bold leading-none text-white shadow-[0_10px_30px_rgba(0,0,255,0.25)] transition hover:bg-[#4429e6] lg:h-[43.74px] lg:w-[195.9px] lg:px-0 lg:py-0"
          >
            {content.primaryCta.label}
          </Link>
          <Link
            href={content.secondaryCta.href}
            className="inline-flex items-center justify-center rounded-full bg-[#e1e3e6] px-[31px] py-[12px] text-[15px] font-bold leading-none text-[#0f172b] transition hover:bg-[#d7d9dd] lg:h-[41.91px] lg:w-[137.59px] lg:px-0 lg:py-0"
          >
            {content.secondaryCta.label}
          </Link>
        </div>

        {/* The export sets this row in 32.81px from the column edge and 31.89px
            below the buttons rather than flush-left under them — those are the
            ring's own edges. lucide insets its circle by 1/24 of the box, so the
            box is 12.76 x 24/22 = 13.92 and the offsets back off by that inset. */}
        <div className="mt-7 flex flex-wrap items-center gap-x-[15.82px] gap-y-2 lg:mt-[31.31px] lg:ps-[32.57px]">
          {content.bullets.map((bullet) => (
            <span
              key={bullet}
              className="inline-flex items-center gap-[4.88px] text-[13px] leading-none text-[#62748e]"
            >
              <CircleCheck className="size-[13.92px] shrink-0 text-[#4f35f3]" />
              {bullet}
            </span>
          ))}
        </div>
      </div>

      {content.image && (
        <div className="relative aspect-[769.123/432.862] w-full">
          <Image
            src={content.image}
            alt={content.imageAlt}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 770px"
            className="object-contain"
          />
        </div>
      )}
    </section>
  );
}
