/**
 * PropertyPro SaaS - Landing page content (types + defaults)
 *
 * Pure data module shared by the server render path (homepage + section
 * components), the DB service (`@/lib/marketing/landing`), and the Platform
 * Console editor (`/admin/landing`). It contains NO server-only imports so it
 * is safe to pull into the client editor bundle.
 *
 * `DEFAULT_LANDING` is the verbatim copy currently hardcoded on the homepage. It
 * doubles as (a) the one-time seed for a fresh database and (b) the fallback when
 * the DB is empty/unavailable, so the page renders identically before any edit.
 */

export const LANDING_SECTION_KEYS = [
  "hero",
  "product",
  "features",
  "howItWorks",
  "testimonial",
  "pricing",
  "cta",
  "footer",
] as const;

export type LandingSectionKey = (typeof LANDING_SECTION_KEYS)[number];

/**
 * Sections the operator adds take part in the same ordering and on/off list as
 * the built-in eight, under the key `custom:<id>`. The id is the section's own
 * (`CustomSection.id`), so reordering or renaming never re-keys its Arabic text.
 */
export const CUSTOM_SECTION_PREFIX = "custom:";

export type CustomSectionKey = `custom:${string}`;

/** A slot in the homepage's ordered list: a built-in section or a custom one. */
export type LandingSlotKey = LandingSectionKey | CustomSectionKey;

/** Lowercase letters, digits and hyphens; what the console generates. */
export const CUSTOM_SECTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** How many sections an operator can add. A homepage with more than this many
 * extra bands has stopped being a landing page. */
export const MAX_CUSTOM_SECTIONS = 12;

export function isCustomSectionKey(key: unknown): key is CustomSectionKey {
  return (
    typeof key === "string" &&
    key.startsWith(CUSTOM_SECTION_PREFIX) &&
    CUSTOM_SECTION_ID_PATTERN.test(key.slice(CUSTOM_SECTION_PREFIX.length))
  );
}

export function customSectionKey(id: string): CustomSectionKey {
  return `${CUSTOM_SECTION_PREFIX}${id}`;
}

export function customSectionIdOf(key: CustomSectionKey): string {
  return key.slice(CUSTOM_SECTION_PREFIX.length);
}

/** Human labels + descriptions for the editor section list. */
export const LANDING_SECTION_META: Record<
  LandingSectionKey,
  { label: string; description: string }
> = {
  hero: { label: "Hero", description: "Headline, sub-text, CTAs and hero image" },
  product: {
    label: "Product preview",
    description: "Section title, panel background and per-tab screenshots of the preview",
  },
  features: {
    label: "Features",
    description:
      "Heading, the five feature cards, the closing link tile and the integrations strip",
  },
  howItWorks: {
    label: "How it works",
    description: "The 3 animated steps, their screenshots and the closing panel",
  },
  testimonial: {
    label: "Testimonial",
    description: "Headline plus the customer review slides and how they advance",
  },
  pricing: { label: "Pricing", description: "Heading above the plan cards (cards come from Plans)" },
  cta: { label: "Final CTA", description: "Closing call-to-action band" },
  footer: { label: "Footer", description: "Brand blurb, button and the footer link columns" },
};

/**
 * The header is editable but is not a body section — it renders on every public
 * route, so it can be neither reordered nor hidden from the homepage list. The
 * console gives it its own card, using this meta.
 */
export const LANDING_HEADER_META = {
  label: "Navigation",
  description: "Top navigation links and the sign-in / get-started buttons",
};

/** Everything the section editor can open: the body sections, the header and
 * any custom section. */
export type LandingEditorKey = LandingSlotKey | "header";

/** The built-in blocks that carry text (everything the editor opens except a
 * custom section). Their Arabic overlays are stored under the same names. */
export type LandingBlockKey = LandingSectionKey | "header";

// ---------------------------------------------------------------------------
// Per-section content shapes
// ---------------------------------------------------------------------------

export interface CtaLink {
  label: string;
  href: string;
}

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterColumn {
  /** Heading above the column ("Product", "Company", …). Blank renders the
   * links with no heading. */
  title: string;
  links: FooterLink[];
}

export interface HeaderContent {
  navLinks: CtaLink[];
  signIn: CtaLink;
  cta: CtaLink;
}

export interface HeroContent {
  eyebrow: string;
  headingTop: string;
  headingHighlight: string;
  headingBottom: string;
  subtext: string;
  primaryCta: CtaLink;
  secondaryCta: CtaLink;
  bullets: string[];
  image: string;
  imageAlt: string;
}

export interface ProductTab {
  /** Tab label shown in the strip above the preview. */
  label: string;
  /** Optional uploaded screenshot. When empty, the built-in mockup for this
   * slot (by position) is rendered instead. */
  image: string;
}

export interface ProductContent {
  headingLine1: string;
  headingLine2: string;
  /** The gradient plate the heading, tab strip and preview window sit on. */
  panelImage: string;
  /** One entry per tab, in order. Labels are editable; an uploaded image
   * replaces the built-in mockup window for that tab. */
  tabs: ProductTab[];
}

export interface FeatureCard {
  title: string;
  description: string;
  /** Optional uploaded image. When empty, the positional built-in artwork shows. */
  image: string;
}

export interface FeaturesContent {
  eyebrow: string;
  /** Mixed-weight headline — see `@/lib/marketing/rich-text`. */
  heading: string;
  /** Exactly five cards; each may override its built-in artwork with an image. */
  cards: FeatureCard[];
  /** The blue tile that closes the grid — a link, not a card. */
  moreCard: {
    label: string;
    href: string;
    /** Caption under the tile; supports `**bold**`. */
    caption: string;
  };
  /** The "Powerful tools & Integrations" strip under the grid. */
  integrations: {
    /** Two lines of mixed-weight copy; supports `**bold**` and `\n`. */
    text: string;
    image: string;
    imageAlt: string;
  };
}

export interface HowItWorksStep {
  title: string;
  description: string;
  /** Optional uploaded screenshot. When empty, the built-in mockup for this
   * position is rendered instead. */
  image: string;
}

export interface HowItWorksContent {
  eyebrow: string;
  heading: string;
  /** Exactly three steps, in order. */
  steps: HowItWorksStep[];
  /** Closing blue panel, revealed once the three steps have played. */
  finalHeading: string;
  finalBody: string;
}

export interface TestimonialSlide {
  image: string;
  imageAlt: string;
  cardQuote: string;
  authorName: string;
  authorTitle: string;
  /** Filled stars, 0–5. */
  rating: number;
}

export interface TestimonialContent {
  quoteBefore: string;
  quoteHighlight: string;
  quoteAfter: string;
  /** One entry per review. The arrows and dots only appear from two up. */
  slides: TestimonialSlide[];
  /** Seconds between automatic advances. 0 turns autoplay off. */
  autoplaySeconds: number;
}

export interface PricingContent {
  eyebrow: string;
  headingLine1: string;
  headingLine2: string;
  subtext: string;
}

/** Icons offered for the four CTA tiles. Stored as a key so the JSON document
 * never carries a component reference; unknown keys fall back to the first. */
export const CTA_CARD_ICON_KEYS = [
  "building",
  "users",
  "wallet",
  "chat",
  "wrench",
  "chart",
  "file",
  "shield",
] as const;

export type CtaCardIconKey = (typeof CTA_CARD_ICON_KEYS)[number];

export interface CtaCard {
  title: string;
  icon: CtaCardIconKey;
  href: string;
}

export interface CtaContent {
  heading: string;
  subheading: string;
  cardEyebrow: string;
  cardTitle: string;
  cardCta: CtaLink;
  /** The underlined price line inside the panel. */
  priceLink: CtaLink;
  /** Panel background and the dashboard screenshot bleeding off its right edge. */
  panelImage: string;
  dashboardImage: string;
  dashboardImageAlt: string;
  /** Shared pill label on all four tiles. */
  learnMoreLabel: string;
  /** Exactly four tiles. */
  cards: CtaCard[];
}

export interface FooterContent {
  ctaLabel: string;
  ctaHref: string;
  /** Short blurb under the brand lockup. */
  tagline: string;
  columns: FooterColumn[];
  copyright: string;
}

export interface SeoContent {
  title: string;
  description: string;
}

export const CUSTOM_SECTION_IMAGE_POSITIONS = ["start", "end", "top", "none"] as const;
export type CustomSectionImagePosition =
  (typeof CUSTOM_SECTION_IMAGE_POSITIONS)[number];

export const CUSTOM_SECTION_BACKGROUNDS = ["white", "tinted"] as const;
export type CustomSectionBackground = (typeof CUSTOM_SECTION_BACKGROUNDS)[number];

/**
 * A band the operator adds to the homepage: a heading, body copy, an optional
 * image beside or above it, and an optional button. `start`/`end` are the
 * reading direction's sides, so the Arabic page mirrors the layout on its own.
 */
export interface CustomSection {
  id: string;
  heading: string;
  /** Paragraphs separated by a blank line; supports `**bold**` and line
   * breaks (see `@/lib/marketing/rich-text`). */
  body: string;
  image: string;
  imageAlt: string;
  imagePosition: CustomSectionImagePosition;
  /** Leave the label empty to show no button. */
  ctaLabel: string;
  ctaHref: string;
  background: CustomSectionBackground;
}

/** A new, empty custom section as the console adds it. */
export function emptyCustomSection(id: string): CustomSection {
  return {
    id,
    heading: "",
    body: "",
    image: "",
    imageAlt: "",
    imagePosition: "end",
    ctaLabel: "",
    ctaHref: "",
    background: "white",
  };
}

export interface LandingSectionMeta {
  key: LandingSlotKey;
  enabled: boolean;
  order: number;
}

/**
 * A text-only overlay of a content block: the same shape with every field
 * optional. Only strings are read from it — images, links, icons and numbers
 * always come from the English block (see `@/lib/marketing/landing-i18n`).
 */
export type TextOverlay<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? TextOverlay<U>[]
    : T extends object
      ? { [K in keyof T]?: TextOverlay<T[K]> }
      : never;

/** The Arabic page's text, block by block, plus the custom sections by id. */
export interface LandingOverlay {
  header?: TextOverlay<HeaderContent>;
  hero?: TextOverlay<HeroContent>;
  product?: TextOverlay<ProductContent>;
  features?: TextOverlay<FeaturesContent>;
  howItWorks?: TextOverlay<HowItWorksContent>;
  testimonial?: TextOverlay<TestimonialContent>;
  pricing?: TextOverlay<PricingContent>;
  cta?: TextOverlay<CtaContent>;
  footer?: TextOverlay<FooterContent>;
  seo?: TextOverlay<SeoContent>;
  custom?: Record<string, TextOverlay<CustomSectionText>>;
}

/** The part of a custom section that is translated. */
export type CustomSectionText = Pick<
  CustomSection,
  "heading" | "body" | "imageAlt" | "ctaLabel"
>;

/** Translations by language. Only Arabic ships; English is the blocks. */
export interface LandingTranslations {
  ar?: LandingOverlay;
}

export interface LandingData {
  sections: LandingSectionMeta[];
  /** Top navigation. Renders on every public route, so it is not part of the
   * orderable/toggleable body-section list. */
  header: HeaderContent;
  hero: HeroContent;
  product: ProductContent;
  features: FeaturesContent;
  howItWorks: HowItWorksContent;
  testimonial: TestimonialContent;
  pricing: PricingContent;
  cta: CtaContent;
  footer: FooterContent;
  seo: SeoContent;
  /** Sections the operator added, in no particular order — `sections` places
   * them. */
  customSections: CustomSection[];
  /** The Arabic overlay. As read by `getLandingContent()` its gaps are already
   * filled from the shipped translation wherever the English text is still
   * the shipped English, so the console edits what /ar actually shows. */
  translations: LandingTranslations;
}

// ---------------------------------------------------------------------------
// Defaults (verbatim from the original hardcoded homepage)
// ---------------------------------------------------------------------------

export const DEFAULT_LANDING: LandingData = {
  sections: LANDING_SECTION_KEYS.map((key, index) => ({
    key,
    enabled: true,
    order: index,
  })),
  // The design labels "Resources" and "Support" have no routes of their own, so
  // the defaults point at the nearest real destinations. Every href here must
  // resolve to something — the console can repoint them once pages exist.
  //
  // "Blog" is last on purpose: the Arabic overlay lines up with these by
  // position, and a link inserted earlier would shift every saved
  // translation after it. A saved navigation keeps its own links — the
  // operator adds this one in /admin/landing.
  header: {
    navLinks: [
      { label: "Features", href: "/#features" },
      { label: "Resources", href: "/#how-it-works" },
      { label: "Support", href: "/contact" },
      { label: "Pricing", href: "/pricing" },
      { label: "Blog", href: "/blog" },
    ],
    signIn: { label: "Sign in", href: "/auth/signin" },
    cta: { label: "Get Started", href: "/auth/signup" },
  },
  hero: {
    eyebrow: "All-In-One",
    headingTop: "Property",
    headingHighlight: "Management",
    headingBottom: "Made Simple",
    subtext:
      "Collect rent, screen tenants, and manage maintenance — without extra tools.",
    primaryCta: { label: "Start Your Free Trial", href: "/auth/signup" },
    secondaryCta: { label: "View Demo", href: "#product" },
    bullets: ["No credit card required", "14-day free trial"],
    image: "/images/marketing/hero-visual.jpg",
    imageAlt:
      "Rent, occupancy, maintenance and application highlights around a modern apartment building",
  },
  product: {
    headingLine1: "Discover Your New",
    headingLine2: "Property Management Platform",
    panelImage: "/images/marketing/product/panel-gradient.jpg",
    tabs: [
      { label: "Dashboard", image: "" },
      { label: "Properties", image: "" },
      { label: "Tenants", image: "" },
      { label: "Leases", image: "" },
      { label: "Maintenance", image: "" },
      { label: "Transactions", image: "" },
      { label: "Finances", image: "" },
      { label: "Chat", image: "" },
    ],
  },
  features: {
    eyebrow: "Features",
    heading: "**Everything** You Need. Nothing **You Don’t.**",
    cards: [
      {
        title: "Tenant Screening",
        description:
          "Choose better tenants with accurate credit, criminal, and eviction checks.",
        image: "",
      },
      {
        title: "Fastest Rent Collection",
        description:
          "Get paid on time with autopay, reminders, and fast, secure deposits.",
        image: "",
      },
      {
        title: "Maintenance Requests",
        description:
          "Track, assign, and resolve repairs without endless calls or messages.",
        image: "",
      },
      {
        title: "Listings & Rental Applications",
        description:
          "Publish listings everywhere and accept rental applications in one place.",
        image: "",
      },
      {
        title: "Accounting & Reports",
        description:
          "Track, assign, and resolve repairs without endless calls or messages.",
        image: "",
      },
    ],
    moreCard: {
      label: "See All Features",
      href: "/auth/signup",
      caption:
        "And that’s just the beginning — see what else **PropertyPro** can do.",
    },
    integrations: {
      text:
        "**Powerful tools** & **Integrations**\nto manage rentals **faster** and **stress-free.**",
      image: "/images/marketing/features/integrations.png",
      imageAlt: "Zoom, Slack, Webex and Microsoft Teams",
    },
  },
  howItWorks: {
    eyebrow: "3 Simple Steps",
    heading: "How It Works?",
    steps: [
      {
        title: "Sign Up for PropertyPro",
        description:
          "Create your free account in seconds. Just provide your basic info and verify your email. You’re ready to start!",
        image: "",
      },
      {
        title: "Add properties & Tenants",
        description:
          "Import your portfolio, leases, contacts, and opening balances—or add them as you go.",
        image: "",
      },
      {
        title: "Automate operations",
        description:
          "Turn on rent collection and reminders. PropertyPro keeps every stakeholder informed.",
        image: "",
      },
    ],
    finalHeading: "Now **Relax** and let\n**PropertyPro** Work!",
    finalBody:
      "That’s it — you’re live! PropertyPro will send reminders, answer tenant questions, and organize maintenance tasks, with notifications and a dashboard to keep you updated.",
  },
  testimonial: {
    quoteBefore:
      "“Trusted by landlords & property managers managing thousands of units — ",
    quoteHighlight: "99% on-time rent",
    quoteAfter: " with PropertyPro.”",
    // One shipped review. The console adds the rest — the defaults deliberately
    // do not invent customers to fill the carousel out.
    slides: [
      {
        image: "/images/marketing/customer-story.png",
        imageAlt: "Property manager sharing his PropertyPro experience",
        cardQuote:
          "“Since switching to PropertyPro, rent is automated, tenants communicate better, and I have more time to grow.”",
        authorName: "Michael Carter",
        authorTitle: "Property Manager, Austin TX",
        rating: 5,
      },
    ],
    autoplaySeconds: 7,
  },
  pricing: {
    eyebrow: "Pricing",
    headingLine1: "Affordable Pricing",
    headingLine2: "Scalable Plans",
    subtext:
      "Collect rent, screen tenants, and manage maintenance — without extra tools.",
  },
  cta: {
    heading: "Try PropertyPro For Free!",
    subheading: "Start Adding Your Property Now.",
    cardEyebrow: "No payment required",
    cardTitle: "Free up to 10 units*",
    cardCta: { label: "Go to your dashboard", href: "/auth/signup" },
    // Riyal, as every price on the site (lib/regional/region).
    priceLink: { label: "100 units at SAR 29", href: "/pricing" },
    panelImage: "/images/marketing/cta/panel-bg.jpg",
    dashboardImage: "/images/marketing/cta/dashboard.png",
    dashboardImageAlt: "The PropertyPro properties dashboard",
    learnMoreLabel: "Learn More",
    cards: [
      { title: "Property Management", icon: "building", href: "/auth/signup" },
      { title: "Tenant Management", icon: "users", href: "/auth/signup" },
      { title: "Finance", icon: "wallet", href: "/auth/signup" },
      { title: "Live Chat", icon: "chat", href: "/auth/signup" },
    ],
  },
  footer: {
    ctaLabel: "Start free trial",
    ctaHref: "/auth/signup",
    tagline:
      "Rent collection, tenant screening, maintenance and accounting — one platform for the whole portfolio.",
    // Every link here must resolve to a real destination. The columns are
    // editable in /admin/landing, so an operator can add pages later — but the
    // defaults must never ship pointing at "#".
    columns: [
      {
        title: "Product",
        links: [
          { label: "Features", href: "/#features" },
          { label: "How it works", href: "/#how-it-works" },
          { label: "Pricing", href: "/pricing" },
          { label: "Tenant portal", href: "/#product" },
          { label: "Start free trial", href: "/auth/signup" },
        ],
      },
      {
        title: "Company",
        // "Blog" last, for the same reason as in the header's links.
        links: [
          { label: "Contact us", href: "/contact" },
          { label: "Support", href: "/contact" },
          { label: "Sign in", href: "/auth/signin" },
          { label: "Blog", href: "/blog" },
        ],
      },
      {
        title: "Legal",
        links: [
          { label: "Terms of Service", href: "/terms" },
          { label: "Privacy Policy", href: "/privacy" },
        ],
      },
    ],
    copyright: "© 2026 PropertyPro. All rights reserved.",
  },
  seo: {
    title: "All-in-one Property Management Software",
    description:
      "Collect rent, screen tenants, manage maintenance, leases, and accounting from one powerful property management platform.",
  },
  customSections: [],
  // Nothing stored: the Arabic page reads the shipped translation
  // (`DEFAULT_LANDING_AR`) wherever the English is still this default.
  translations: {},
};

// ---------------------------------------------------------------------------
// Testimonial compatibility
// ---------------------------------------------------------------------------

/** The flat single-review shape stored before the carousel existed. */
interface LegacyTestimonial {
  image?: unknown;
  imageAlt?: unknown;
  cardQuote?: unknown;
  authorName?: unknown;
  authorTitle?: unknown;
}

const LEGACY_TESTIMONIAL_KEYS: (keyof LegacyTestimonial)[] = [
  "image",
  "imageAlt",
  "cardQuote",
  "authorName",
  "authorTitle",
];

function toSlide(stored: unknown, fallback: TestimonialSlide): TestimonialSlide {
  const raw = (stored ?? {}) as Partial<TestimonialSlide>;
  const str = (value: unknown, spare: string) =>
    typeof value === "string" ? value : spare;
  return {
    image: str(raw.image, fallback.image),
    imageAlt: str(raw.imageAlt, fallback.imageAlt),
    cardQuote: str(raw.cardQuote, fallback.cardQuote),
    authorName: str(raw.authorName, fallback.authorName),
    authorTitle: str(raw.authorTitle, fallback.authorTitle),
    rating:
      typeof raw.rating === "number" && Number.isFinite(raw.rating)
        ? Math.min(5, Math.max(0, Math.round(raw.rating)))
        : fallback.rating,
  };
}

/**
 * The testimonial shipped as a single review held in flat `image`/`cardQuote`/
 * `authorName`… fields. Documents saved before the carousel still hold that
 * shape, so promote those fields to the first slide rather than dropping the
 * operator's review on the floor.
 *
 * This takes the **raw stored block**, not the block merged over the defaults:
 * merging fills `slides` in from `DEFAULT_LANDING` first, which would make a
 * legacy document indistinguishable from one that genuinely has slides.
 */
export function normalizeTestimonialSlides(stored: unknown): TestimonialSlide[] {
  const [fallback] = DEFAULT_LANDING.testimonial.slides;
  if (!stored || typeof stored !== "object") {
    return DEFAULT_LANDING.testimonial.slides;
  }
  const block = stored as { slides?: unknown } & LegacyTestimonial;

  if (Array.isArray(block.slides) && block.slides.length > 0) {
    return block.slides.map((slide) => toSlide(slide, fallback));
  }
  // No usable slides array. Rebuild one from the legacy flat fields when the
  // document carries any of them; otherwise the document simply has no
  // testimonial content and the shipped review stands.
  const hasLegacy = LEGACY_TESTIMONIAL_KEYS.some(
    (key) => typeof block[key] === "string" && block[key] !== "",
  );
  return hasLegacy
    ? [toSlide(block, fallback)]
    : DEFAULT_LANDING.testimonial.slides;
}

// ---------------------------------------------------------------------------
// Footer column compatibility
// ---------------------------------------------------------------------------

/**
 * Footer columns shipped originally as bare `FooterLink[][]` — link lists with
 * no headings. Documents saved before headings existed still hold that shape,
 * so both forms are normalised to `FooterColumn[]`, borrowing the default
 * heading for the matching position.
 */
export function normalizeFooterColumns(stored: unknown): FooterColumn[] {
  if (!Array.isArray(stored)) return DEFAULT_LANDING.footer.columns;
  return stored.map((column, index) => {
    const fallbackTitle = DEFAULT_LANDING.footer.columns[index]?.title ?? "";
    // Legacy shape: the column *is* the link array.
    if (Array.isArray(column)) {
      return { title: fallbackTitle, links: column as FooterLink[] };
    }
    const { title, links } = (column ?? {}) as Partial<FooterColumn>;
    return {
      title: typeof title === "string" ? title : fallbackTitle,
      links: Array.isArray(links) ? links : [],
    };
  });
}
