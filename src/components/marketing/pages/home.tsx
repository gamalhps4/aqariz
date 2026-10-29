import { Fragment } from "react";
import type { Metadata } from "next";
import { getPublicPlans } from "@/lib/billing/plans";
import { getPlatformSettings } from "@/lib/platform/settings";
import {
  getLandingContent,
  getLandingContentFor,
} from "@/lib/marketing/landing";
import {
  customSectionIdOf,
  isCustomSectionKey,
  type LandingSlotKey,
} from "@/lib/marketing/landing-types";
import type { MarketingLang } from "@/lib/marketing/landing-i18n";
import { buildPricingCards } from "@/lib/marketing/pricing-cards";
import { languageAlternates } from "@/lib/marketing/seo";
import { siteText } from "@/lib/marketing/site-text";
import { CtaSection } from "@/components/marketing/sections/cta";
import { ScrollSteps } from "@/components/marketing/scroll-steps";
import { HeroSection } from "@/components/marketing/sections/hero";
import { FooterSection } from "@/components/marketing/sections/footer";
import { ProductSection } from "@/components/marketing/sections/product";
import { FeaturesSection } from "@/components/marketing/sections/features";
import { TestimonialSection } from "@/components/marketing/sections/testimonial";
import { PricingSection } from "@/components/marketing/sections/pricing";
import { CustomSectionView } from "@/components/marketing/sections/custom";

/** The homepage's title and description, from the console's SEO fields (the
 * Arabic ones on /ar), with the two languages naming each other. */
export async function homeMetadata(lang: MarketingLang): Promise<Metadata> {
  const { seo } = await getLandingContentFor(lang);
  return {
    title: seo.title,
    description: seo.description,
    ...languageAlternates("/", lang),
  };
}

/**
 * The marketing homepage, in English (/) or Arabic (/ar). One page for both:
 * the content is the same document with the Arabic overlay applied, and the
 * section components take the page's words as props, so the two cannot drift
 * apart in anything but language. The Arabic page's direction and typeface
 * come from its layout (`(marketing)/ar/layout.tsx`).
 */
export async function MarketingHomePage({ lang }: { lang: MarketingLang }) {
  const [landing, english, plans, { general }] = await Promise.all([
    getLandingContentFor(lang),
    getLandingContent(),
    getPublicPlans(),
    getPlatformSettings(),
  ]);
  const text = (key: string) => siteText(lang, key);
  const pricingPlans = buildPricingCards(plans, lang);
  const customSections = new Map(
    landing.customSections.map((section) => [section.id, section]),
  );

  const renderSection = (key: LandingSlotKey) => {
    if (isCustomSectionKey(key)) {
      const section = customSections.get(customSectionIdOf(key));
      return section ? <CustomSectionView section={section} /> : null;
    }
    switch (key) {
      case "hero":
        return <HeroSection content={landing.hero} />;
      case "product":
        return (
          <ProductSection
            content={landing.product}
            screenshotAlt={text("product.screenshotAlt")}
          />
        );
      case "features":
        return (
          <FeaturesSection
            content={landing.features}
            // The built-in artwork is keyed by the English card titles.
            artTitles={
              lang === "ar"
                ? english.features.cards.map((card) => card.title)
                : undefined
            }
          />
        );
      case "howItWorks":
        return (
          <ScrollSteps
            content={landing.howItWorks}
            brandName={general.platformName}
          />
        );
      case "testimonial":
        return (
          <TestimonialSection
            content={landing.testimonial}
            labels={{
              previous: text("testimonial.previous"),
              next: text("testimonial.next"),
              show: text("testimonial.show"),
              stars: text("testimonial.stars"),
            }}
          />
        );
      case "pricing":
        return (
          <PricingSection
            content={landing.pricing}
            plans={pricingPlans}
            labels={{
              billingPeriod: text("pricing.billingPeriod"),
              monthly: text("pricing.monthly"),
              yearly: text("pricing.yearly"),
              popular: text("pricing.popular"),
            }}
          />
        );
      case "cta":
        return <CtaSection content={landing.cta} />;
      case "footer":
        return <FooterSection content={landing.footer} lang={lang} />;
      default:
        return null;
    }
  };

  return (
    <main className="flex-1 overflow-x-clip bg-white pt-20 text-slate-950 lg:pt-[88.27px]">
      {landing.sections
        .filter((section) => section.enabled)
        .map((section) => (
          <Fragment key={section.key}>{renderSection(section.key)}</Fragment>
        ))}
    </main>
  );
}
