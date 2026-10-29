import Link from "next/link";
import Image from "@/components/ui/app-image";
import {
  BarChart3,
  Building2,
  FileText,
  MessageSquareShare,
  ShieldCheck,
  UsersRound,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CtaCardIconKey, CtaContent } from "@/lib/marketing/landing-types";

// Source of truth: Figma "PropertyPro" → "Desktop - 1" (node 4:3055), the
// closing band at y 5795–6489 of the 1440px artboard.
//
// The block is a 1208.714 x 556.826 grid: a 710.756-wide panel spanning both
// rows beside a 2x2 of 238.979 x 274.666 cards, with 10px column gaps and a
// 7.494px row gap. The panel is a container so its copy and button scale with
// it; the cards keep fixed type, which stays readable when they shrink.
//
// Positions are logical (`start-*`), so on the Arabic page the composition
// mirrors as a whole — copy on the right, the dashboard bleeding off the left
// — instead of setting right-to-left copy on the side the eye reaches last.
// Left to right they are the same lengths the design gives as `left`.
const ASSETS = "/images/marketing/cta";

/**
 * 4:3372..4:3375 — the icons the four tiles can carry, at 38% opacity as the
 * file sets them. The console stores a key, not a component, so the JSON
 * document stays serialisable; an unrecognised key falls back to the building.
 */
const CARD_ICONS: Record<CtaCardIconKey, LucideIcon> = {
  building: Building2,
  users: UsersRound,
  wallet: Wallet,
  chat: MessageSquareShare,
  wrench: Wrench,
  chart: BarChart3,
  file: FileText,
  shield: ShieldCheck,
};

/** 4:3382 etc. — the pill is identical on all four cards. */
function LearnMore({ label }: { label: string }) {
  return (
    <span className="absolute bottom-[18.2px] start-[24px] flex h-[26.956px] w-[114.976px] items-center justify-between rounded-full bg-white px-[16.6px] text-[10.581px] font-bold text-[#2d2d2d]">
      {label}
      <Image
        src={`${ASSETS}/arrow-sm.svg`}
        alt=""
        width={18}
        height={8}
        unoptimized
        className="w-[17.634px] transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
      />
    </span>
  );
}

export function CtaSection({ content }: { content: CtaContent }) {
  return (
    <section className="mx-auto max-w-[1208.714px] px-5 pt-20 pb-24 sm:px-8 lg:pt-[154px] lg:pb-[179.9px]">
      <h2 className="text-[32px] leading-[0.97] tracking-[0.64px] text-[#2f2158] sm:text-[48px] sm:tracking-[0.96px] [&:lang(ar)]:leading-[1.2]">
        <span className="font-bold">{content.heading}</span>
        <br />
        <span className="font-light">{content.subheading}</span>
      </h2>

      <div className="mt-8 grid grid-cols-2 gap-[10px] sm:mt-[42.99px] lg:aspect-[1208.714/556.826] lg:grid-cols-[710.756fr_238.979fr_238.979fr] lg:grid-rows-2 lg:gap-y-[7.494px]">
        {/* 4:3366 — the gradient plate, the dashboard bleeding off its right
            edge, and the two edge fades that sit over it. */}
        <div className="@container relative col-span-2 aspect-[710.756/556.826] overflow-hidden rounded-[10px] lg:col-span-1 lg:row-span-2 lg:aspect-auto">
          {content.panelImage && (
            <Image
              src={content.panelImage}
              alt=""
              fill
              sizes="(max-width: 1024px) 100vw, 711px"
              // The plate's gradient leans with the composition.
              className="object-cover rtl:-scale-x-100"
            />
          )}

          {content.dashboardImage && (
            <div className="absolute start-[41.001%] top-[5.463%] h-[104.430%] w-[65.985%] overflow-hidden rounded-[20px] border-[10px] border-white/40">
              <Image
                src={content.dashboardImage}
                alt={content.dashboardImageAlt}
                fill
                sizes="(max-width: 1024px) 66vw, 470px"
                className="object-cover"
              />
            </div>
          )}

          <div className="absolute start-[83.377%] top-[3.500%] h-[96.500%] w-[16.623%] bg-gradient-to-l from-[rgba(49,83,255,0.22)] to-transparent rtl:bg-gradient-to-r" />
          <div className="absolute start-[39.659%] top-[79.388%] h-[21.218%] w-[60.979%] bg-gradient-to-t from-[rgba(49,83,255,0.22)] to-transparent" />

          <p className="absolute start-[4.995%] top-[7.503%] text-[2.814cqw] leading-[0.97] tracking-[-0.056cqw] text-white">
            {content.cardEyebrow}
          </p>
          <p className="absolute start-[4.995%] top-[12.917%] text-[2.814cqw] leading-[0.97] tracking-[-0.056cqw] text-white">
            {content.cardTitle}
          </p>
          <Link
            href={content.priceLink.href}
            className="absolute start-[4.995%] top-[53.383%] text-[2.814cqw] font-bold leading-[0.97] tracking-[-0.056cqw] text-white underline decoration-from-font underline-offset-2"
          >
            {content.priceLink.label}
          </Link>

          <Link
            href={content.cardCta.href}
            className="group absolute start-[4.036%] top-[88.936%] flex h-[6.863%] w-[32.980%] items-center justify-between rounded-full bg-white px-[3.307cqw] text-[2.111cqw] font-bold text-[#2d2d2d] transition hover:bg-white/90"
          >
            {content.cardCta.label}
            <Image
              src={`${ASSETS}/arrow-lg.svg`}
              alt=""
              width={26}
              height={8}
              unoptimized
              className="w-[3.658cqw] transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
            />
          </Link>
        </div>

        {content.cards.map(({ title, icon, href }, index) => {
          const Icon = CARD_ICONS[icon] ?? Building2;
          return (
            <Link
              key={title || index}
              href={href}
              className="group relative aspect-[238.979/274.666] rounded-[10px] bg-[#efefef] px-[24px] pt-[29.3px] transition hover:bg-[#e7e7e7] lg:aspect-auto"
            >
              <Icon
                className="size-6 text-[#3f3f3f] opacity-[0.38]"
                strokeWidth={2}
              />
              <p className="mt-[12.7px] max-w-[194.52px] text-[20px] font-bold leading-[1.05] tracking-[-0.8px] text-[#3f3f3f]">
                {title}
              </p>
              <LearnMore label={content.learnMoreLabel} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
