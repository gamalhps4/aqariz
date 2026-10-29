import Link from "next/link";
import Image from "@/components/ui/app-image";
import type { ReactNode } from "react";
import { Emphasis } from "@/lib/marketing/rich-text";
import type { FeaturesContent } from "@/lib/marketing/landing-types";

// Source of truth: Figma "PropertyPro" → page "Saas" → frame "Desktop - 1"
// (node 4:3055), the features band between y=1550 and y=2765 of the 1440px
// artboard. That puts the section on a 950px column of 298.149 x 283.771
// artwork tiles with 27.35px column gaps.
//
// Each tile is a container (`@container`), so every position inside it is a
// percentage of the tile and every length — type, radius, border, shadow — is
// in `cqw`. The illustrations therefore stay true to the design at any card
// width instead of only lining up at 298px.
const ASSETS = "/images/marketing/features";

const TILE_FACE =
  "absolute inset-0 overflow-hidden rounded-[5.702cqw] bg-gradient-to-b from-[#c5cde0] to-[#dde1ed]";

/** The file's "Card Inside Shadow" effect: drop-shadow 0 9 14.6 #1600DE21. */
const INSET_SHADOW = "shadow-[0_3.019cqw_4.897cqw_rgba(22,0,222,0.13)]";

/**
 * One absolutely-positioned artwork layer. `box` carries the Figma geometry
 * (left/top/width/height as tile percentages); `fit` picks the object-fit for
 * the exported asset.
 */
function Layer({
  src,
  box,
  fit = "object-fill",
  className = "",
}: {
  src: string;
  box: string;
  fit?: string;
  className?: string;
}) {
  return (
    <div className={`absolute ${box} ${className}`}>
      <Image
        src={`${ASSETS}/${src}`}
        alt=""
        fill
        sizes="300px"
        // SVGs bypass the optimizer (no `dangerouslyAllowSVG` configured) so the
        // vector data Figma exported is served untouched.
        unoptimized={src.endsWith(".svg")}
        className={fit}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-card artwork (Figma group ids in the comments)
// ---------------------------------------------------------------------------

/** 4:3148 — a single exported illustration on the inner panel. */
function TenantScreeningArt() {
  return (
    <Layer
      src="tenant-screening.png"
      box={`left-[4.957%] top-[5.223%] h-[88.020%] w-[90.087%] overflow-hidden rounded-[2.348cqw] ${INSET_SHADOW}`}
      fit="object-cover"
    />
  );
}

/** 4:3152 — same shape as above with a 10px inner radius. */
function MaintenanceArt() {
  return (
    <Layer
      src="maintenance.png"
      box={`left-[5.432%] top-[5.223%] h-[88.020%] w-[89.133%] overflow-hidden rounded-[3.354cqw] ${INSET_SHADOW}`}
      fit="object-cover"
    />
  );
}

/** 4:3155 — two listing cards fanned out at -11.63° and +14.33°. */
function ListingsArt() {
  return (
    <>
      <Layer
        src="listing-card.png"
        box={`left-[9.215%] top-[20.646%] h-[49.397%] w-[39.528%] -rotate-[11.63deg] overflow-hidden rounded-[2.683cqw] ${INSET_SHADOW}`}
        fit="object-cover"
      />
      <Layer
        src="applications-card.png"
        box="left-[44.397%] top-[26.851%] h-[54.759%] w-[44.156%] rotate-[14.33deg] overflow-hidden rounded-[2.683cqw] shadow-[-5.702cqw_4.696cqw_4.897cqw_rgba(22,0,222,0.1)]"
        fit="object-cover"
      />
    </>
  );
}

/** 4:3117 — the "Payment" screen, rebuilt from the design's primitives. */
function RentCollectionArt() {
  const rowLabel =
    "absolute text-[3.354cqw] font-bold leading-[1.2] tracking-[0.067cqw] text-[#6b6384]";
  const rowMeta =
    "absolute text-[2.643cqw] leading-[1.2] tracking-[0.053cqw] text-[rgba(69,64,86,0.7)]";
  const sectionLabel =
    "absolute text-[3.354cqw] font-bold leading-[1.2] tracking-[0.067cqw] text-[rgba(69,64,86,0.8)]";

  return (
    <>
      <div
        className={`absolute left-[4.954%] top-[5.223%] h-[88.020%] w-[89.915%] rounded-[2.348cqw] ${INSET_SHADOW}`}
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgb(240, 241, 246) 0%, rgb(254, 254, 254) 100%)",
        }}
      />

      <Layer
        src="back-arrow.svg"
        box="left-[10.497%] top-[9.803%] h-[3.893%] w-[5.419%] rotate-180"
      />
      <p className="absolute left-[40.275%] top-[8.754%] whitespace-nowrap text-[4.696cqw] font-bold leading-[1.2] tracking-[0.094cqw] text-[rgba(69,64,86,0.52)]">
        Payment
      </p>

      <p className={`${sectionLabel} left-[11.440%] top-[20.838%] w-[34.292%]`}>
        Next Payment Due
      </p>
      <div className="absolute left-[10.749%] top-[26.902%] h-[20.284%] w-[78.507%] rounded-[2.643cqw] border-[0.294cqw] border-[#c8c2d3] bg-white" />
      <p className="absolute left-[16.233%] top-[31.695%] w-[36.236%] text-[4.698cqw] font-bold leading-[1.2] tracking-[0.094cqw] text-[#453f59]">
        SAR 1,200
      </p>
      <p className="absolute left-[16.233%] top-[40.325%] w-[35.080%] text-[2.643cqw] font-bold leading-[1.2] tracking-[0.053cqw] text-[rgba(69,64,86,0.52)]">
        July Rent - Due in 5 Days
      </p>
      <div className="absolute left-[53.745%] top-[30.067%] h-[8.410%] w-[32.787%] rounded-[2.643cqw] border-[0.294cqw] border-[#c8c2d3] bg-gradient-to-b from-[#3176f0] to-[#516eff]" />
      <p className="absolute left-[62.988%] top-[32.223%] w-[24.677%] text-[3.524cqw] font-bold leading-[1.2] tracking-[0.070cqw] text-white">
        Auto-Pay
      </p>

      <p className={`${sectionLabel} left-[11.440%] top-[51.690%] w-[33.130%]`}>
        Payment History
      </p>
      <div className="absolute left-[10.749%] top-[57.910%] h-[18.116%] w-[78.507%] rounded-[2.643cqw] border-[0.294cqw] border-[#c8c2d3] bg-white" />
      <Layer
        src="paid-check.svg"
        box="left-[15.381%] top-[61.296%] h-[4.464%] w-[4.249%]"
      />
      <p className={`${rowLabel} left-[22.961%] top-[61.296%] w-[36.236%]`}>
        June - Paid
      </p>
      <p className={`${rowMeta} left-[52.470%] top-[61.818%] w-[35.080%]`}>
        <span className="font-bold">SAR 1,200</span> Paid 2 days early
      </p>
      <Layer
        src="paid-check.svg"
        box="left-[15.381%] top-[68.066%] h-[4.464%] w-[4.249%]"
      />
      <p className={`${rowLabel} left-[22.961%] top-[68.066%] w-[36.236%]`}>
        May- Paid
      </p>
      <p className={`${rowMeta} left-[52.470%] top-[68.594%] w-[35.080%]`}>
        Paid On-time
      </p>

      {/* Bottom toolbar: the exported bar (with its blur) plus the two icons. */}
      <Layer
        src="rent-toolbar.svg"
        box="left-[0.054%] top-[72.242%] h-[22.973%] w-[99.716%]"
      />
      <div className="absolute left-[56.435%] top-[82.912%] h-[8.182%] w-[16.179%] rounded-[14.422cqw] bg-gradient-to-b from-[#3176f0] to-[#516eff]" />
      <Layer
        src="card-icon.svg"
        box="left-[61.485%] top-[84.808%] h-[4.166%] w-[4.909%]"
      />
      <Layer
        src="card-dot.svg"
        box="left-[62.438%] top-[87.148%] h-[0.969%] w-[0.922%]"
      />
      <div
        className="absolute left-[78.491%] top-[82.338%] h-[8.508%] w-[8.786%] bg-[#afb9d0]"
        style={{
          maskImage: `url(${ASSETS}/bank-icon.png)`,
          maskRepeat: "no-repeat",
          maskSize: "6.224cqw 6.224cqw",
          maskPosition: "0.924cqw 1.389cqw",
        }}
      />
    </>
  );
}

/** 4:3164 — transactions table beside a stack of report cards. */
function AccountingArt() {
  const panel = `absolute overflow-hidden rounded-[3.354cqw] ${INSET_SHADOW}`;

  return (
    <>
      <div
        className={`${panel} left-[5.121%] top-[5.219%] h-[90.348%] w-[43.888%] bg-[#fcfdfe]`}
      />
      <Layer
        src="transactions.png"
        box="left-[7.181%] top-[9.455%] h-[81.877%] w-[39.773%] overflow-hidden rounded-[3.354cqw]"
      />

      <div
        className={`${panel} left-[51.276%] top-[5.219%] h-[13.345%] w-[43.888%] bg-[#fdfefe]`}
      />
      {/* Both report images are cropped windows onto a wider export, so they
          carry Figma's own scale/offset instead of being stretched to fit. */}
      <div className="absolute left-[62.465%] top-[7.439%] h-[8.909%] w-[19.284%] overflow-hidden mix-blend-darken">
        <Image
          src={`${ASSETS}/reports-header.png`}
          alt=""
          width={364}
          height={73}
          sizes="130px"
          className="absolute left-0 top-0 h-full w-[219.26%] max-w-none"
        />
      </div>

      <div
        className={`${panel} left-[51.276%] top-[21.637%] h-[24.107%] w-[43.888%] bg-white`}
      />
      <div className="absolute left-[54.620%] top-[23.473%] h-[20.433%] w-[35.805%] overflow-hidden rounded-[3.354cqw]">
        <Image
          src={`${ASSETS}/expense-bars.png`}
          alt=""
          width={486}
          height={236}
          sizes="130px"
          className="absolute left-[-3.98%] top-0 h-full w-[111.86%] max-w-none"
        />
      </div>

      <div
        className={`${panel} left-[51.276%] top-[48.814%] h-[30.728%] w-[43.888%] bg-[#fefefe]`}
      />
      <Layer
        src="expense-donut.png"
        box="left-[54.620%] top-[51.154%] h-[26.046%] w-[37.200%] overflow-hidden rounded-[3.354cqw]"
        fit="object-cover"
      />

      <div
        className={`${panel} left-[51.276%] top-[83.057%] h-[12.513%] w-[43.888%] bg-[#edf2f7]`}
      />
      <Layer
        src="generate-report.png"
        box="left-[58.880%] top-[85.809%] h-[7.006%] w-[28.682%]"
      />
    </>
  );
}

// Artwork is keyed by the card title so the console can reorder the cards
// without the illustrations drifting onto the wrong copy; unknown titles fall
// back to the slot's position. The Arabic page keys it by the English titles
// (`artTitles`), since its own titles are translations.
const FEATURE_ART: { title: string; art: ReactNode }[] = [
  { title: "Tenant Screening", art: <TenantScreeningArt /> },
  { title: "Fastest Rent Collection", art: <RentCollectionArt /> },
  { title: "Maintenance Requests", art: <MaintenanceArt /> },
  { title: "Listings & Rental Applications", art: <ListingsArt /> },
  { title: "Accounting & Reports", art: <AccountingArt /> },
];

function artFor(title: string, index: number) {
  const byTitle = FEATURE_ART.find(
    (entry) => entry.title.toLowerCase() === title.trim().toLowerCase(),
  );
  return (byTitle ?? FEATURE_ART[index])?.art ?? null;
}

export function FeaturesSection({
  content,
  artTitles,
}: {
  content: FeaturesContent;
  /** The English card titles, when `content` is a translation of them. */
  artTitles?: string[];
}) {
  return (
    <section
      id="features"
      className="mx-auto max-w-[950px] px-5 pt-20 sm:px-8 lg:pt-[132.8px]"
    >
      <p className="text-[16px] font-semibold leading-[1.2] tracking-[0.96px] text-[#0059ff]">
        {content.eyebrow}
      </p>
      {/* Set light, with the console's `**bold**` runs supplying the weight
          changes the design mixes inside the sentence. */}
      <h2 className="mt-[25.84px] max-w-[424px] text-[36px] font-light leading-[1.2] tracking-[0.72px] text-[#2f2158]">
        <Emphasis text={content.heading} />
      </h2>

      <div className="mt-[76.32px] grid gap-x-[27.35px] gap-y-[44.19px] sm:grid-cols-2 lg:grid-cols-3">
        {content.cards.map((card, index) => (
          <article key={card.title || index}>
            <div className="@container relative aspect-[298.149/283.771]">
              {/* The built-in artwork is a drawing of the English product
                  (its "SAR 1,200", its "Payment" screen), laid out left to
                  right; it stays that way on the Arabic page too. */}
              <div className={TILE_FACE} dir="ltr" lang="en">
                {card.image ? (
                  // A console upload replaces the built-in artwork, filling the
                  // tile edge to edge.
                  <Image
                    src={card.image}
                    alt={card.title}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 300px"
                    className="object-cover"
                  />
                ) : (
                  artFor(artTitles?.[index] ?? card.title, index)
                )}
              </div>
            </div>
            {/* Titles are set nowrap in the file — "Listings & Rental
                Applications" is meant to run past its column, not wrap. */}
            <h3 className="mt-[21.9px] text-[20px] font-bold leading-[1.2] tracking-[0.4px] text-[#342b50] lg:whitespace-nowrap">
              {card.title}
            </h3>
            <p className="mt-[8.71px] text-[15px] leading-[1.2] tracking-[0.3px] text-[#535353]">
              {card.description}
            </p>
          </article>
        ))}

        {/* 4:3100 — the closing tile is a link rather than a card. */}
        <article>
          <Link
            href={content.moreCard.href}
            className="@container group relative block aspect-[298.149/283.771]"
          >
            {/* `cqw` only resolves on descendants of the `@container`, so the
                face is a child rather than the link itself. */}
            <div className="absolute inset-0 overflow-hidden rounded-[5.702cqw] bg-[#2b55ff] transition group-hover:bg-[#1f45e0]">
              {/* Logical positions: on the Arabic page the label starts at the
                  right and the arrow, turned round, points the way it reads. */}
              <Layer
                src="logo-mark.svg"
                box="start-[36.363%] top-[28.470%] h-[29.822%] w-[23.283%]"
              />
              <span className="absolute start-[7.519%] top-[79.543%] whitespace-nowrap text-[8.385cqw] leading-normal text-white">
                {content.moreCard.label}
              </span>
              <Layer
                src="arrow-right.svg"
                box="start-[72.185%] top-[82.940%] h-[5.190%] w-[18.505%] transition-transform group-hover:translate-x-[1.5%] rtl:-scale-x-100 rtl:group-hover:-translate-x-[1.5%]"
              />
            </div>
          </Link>
          <div className="mt-[21.9px] h-[24px]" aria-hidden />
          <p className="mt-[8.71px] text-[15px] leading-[1.2] tracking-[0.3px] text-[#535353]">
            <Emphasis text={content.moreCard.caption} />
          </p>
        </article>
      </div>

      <div className="mt-[72.02px] flex flex-wrap items-center justify-between gap-8">
        <p className="max-w-[406.28px] text-[20px] font-light leading-[1.38] text-[#323232]">
          <Emphasis text={content.integrations.text} />
        </p>
        {content.integrations.image && (
          <Image
            src={content.integrations.image}
            alt={content.integrations.imageAlt}
            width={371}
            height={98}
            sizes="372px"
            className="h-[97.968px] w-[371.462px] object-contain"
          />
        )}
      </div>
    </section>
  );
}
