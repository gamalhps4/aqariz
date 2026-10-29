/**
 * PropertyPro SaaS - Plan cards in Arabic
 *
 * Plans are rows edited in /admin/plans, in English. Each may carry an Arabic
 * version of the text its public card prints (`Plan.translations.ar`); /ar and
 * /ar/pricing read the card through `localizePlan`, which takes every field
 * from the Arabic where it was given and from the English where it was not.
 *
 * Between the two sits the wording the plans were seeded with: a fresh
 * install's cards say "per month", "Start free trial", "Up to 25 properties".
 * Those phrases have a shipped Arabic here, used only while the English is
 * still word for word the seeded phrase — so /ar/pricing reads in Arabic
 * before anyone opens the plan form, and a rewritten English line is never
 * shown a translation of something else.
 *
 * Pure (no server imports): the console's plan form loads it too.
 */

import type {
  BillingPlanDefinition,
  PlanArabicText,
  PlanTranslations,
} from "./plan-constants";
import type { MarketingLang } from "@/lib/marketing/landing-i18n";

/** The seeded plans' wording, in Arabic. Exact English → Arabic. */
const SEEDED_PHRASES_AR: Readonly<Record<string, string>> = {
  // Names
  Free: "المجانية",
  Starter: "الأساسية",
  Professional: "الاحترافية",
  Business: "الأعمال",
  // Descriptions
  "For evaluating PropertyPro with a small portfolio.":
    "لتجربة PropertyPro مع محفظة عقارية صغيرة.",
  "For small property-management teams.": "لفرق إدارة العقارات الصغيرة.",
  "For growing portfolios and operations teams.":
    "للمحافظ العقارية النامية وفرق التشغيل.",
  "For large organizations requiring unlimited scale.":
    "للمنشآت الكبيرة التي تحتاج إلى التوسع دون حدود.",
  // Price suffixes
  "per month": "شهريًا",
  "per year": "سنويًا",
  // Features headers
  "Everything in Free +": "كل ما في المجانية +",
  "Everything in Starter +": "كل ما في الأساسية +",
  "Everything in Professional +": "كل ما في الاحترافية +",
  // Buttons
  "Get started": "ابدأ الآن",
  "Start free trial": "ابدأ تجربتك المجانية",
  "Start for free": "ابدأ مجانًا",
  "Contact sales": "تواصل مع المبيعات",
  // Highlights
  "Up to 3 properties": "حتى 3 عقارات",
  "3 team members": "3 أعضاء في الفريق",
  "Core property management": "الإدارة الأساسية للعقارات",
  "Custom branding": "هوية مخصصة",
  "Tenant chat & portal": "بوابة المستأجرين والمحادثات",
  "Email support": "دعم عبر البريد الإلكتروني",
  "Up to 25 properties": "حتى 25 عقارًا",
  "10 team members": "10 أعضاء في الفريق",
  "Data export": "تصدير البيانات",
  "Up to 100 properties": "حتى 100 عقار",
  "50 team members": "50 عضوًا في الفريق",
  "Advanced analytics": "تحليلات متقدمة",
  "Unlimited properties": "عقارات بلا حدود",
  "Unlimited team members": "أعضاء فريق بلا حدود",
  "Priority support": "دعم بأولوية",
};

const TEXT_FIELDS = [
  "name",
  "description",
  "priceSuffix",
  "featuresHeader",
  "ctaLabel",
] as const;

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * The stored `translations` column as a well-formed value: only the known
 * fields, only non-empty strings, `highlights` kept by position. Null when
 * there is no Arabic at all.
 */
export function normalizePlanTranslations(raw: unknown): PlanTranslations | null {
  if (!raw || typeof raw !== "object") return null;
  const ar = (raw as Record<string, unknown>).ar;
  if (!ar || typeof ar !== "object") return null;
  const source = ar as Record<string, unknown>;
  const text: PlanArabicText = {};
  for (const field of TEXT_FIELDS) {
    const value = cleanText(source[field]);
    if (value) text[field] = value;
  }
  if (Array.isArray(source.highlights)) {
    const highlights = source.highlights.map((item) => cleanText(item) ?? "");
    while (highlights.length > 0 && highlights[highlights.length - 1] === "") {
      highlights.pop();
    }
    if (highlights.length > 0) text.highlights = highlights;
  }
  return Object.keys(text).length > 0 ? { ar: text } : null;
}

/** Arabic for one English line: the operator's, else the seeded phrase's. */
function arabicFor(english: string, given: string | undefined): string {
  return given || SEEDED_PHRASES_AR[english.trim()] || english;
}

/** The text a pricing card prints, in `lang`. Prices, links and flags are untouched. */
export function localizePlan<T extends BillingPlanDefinition>(
  plan: T,
  lang: MarketingLang,
): T {
  if (lang === "en") return plan;
  const ar = plan.translations?.ar ?? {};
  return {
    ...plan,
    name: arabicFor(plan.name, ar.name),
    description: plan.description
      ? arabicFor(plan.description, ar.description)
      : plan.description,
    priceSuffix: arabicFor(plan.priceSuffix, ar.priceSuffix),
    featuresHeader: plan.featuresHeader
      ? arabicFor(plan.featuresHeader, ar.featuresHeader)
      : plan.featuresHeader,
    ctaLabel: arabicFor(plan.ctaLabel, ar.ctaLabel),
    highlights: plan.highlights.map((highlight, index) =>
      arabicFor(highlight, ar.highlights?.[index]),
    ),
  };
}
