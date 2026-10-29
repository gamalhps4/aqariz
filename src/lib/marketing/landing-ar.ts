/**
 * PropertyPro SaaS - The landing page's shipped Arabic
 *
 * `DEFAULT_LANDING` in Arabic, as a text-only overlay (the shape
 * `localizeLanding` reads): every string the English defaults carry, nothing
 * else — images, links and icons come from the English blocks. It is written
 * for a Saudi property-management office, in Modern Standard Arabic with
 * Western digits, and is what /ar shows before anyone edits anything.
 *
 * It only ever stands in for the English it translates. Where the operator has
 * changed an English field, this file's Arabic for it no longer applies
 * (`resolveArabicOverlay`): /ar shows the English until the console is given
 * an Arabic version, rather than a translation of copy that is gone.
 *
 * Pure data, no imports beyond types: the console bundle loads it too.
 */

import type { LandingOverlay } from "./landing-types";

export const DEFAULT_LANDING_AR = {
  header: {
    navLinks: [
      { label: "المزايا" },
      { label: "الموارد" },
      { label: "الدعم" },
      { label: "الأسعار" },
      { label: "المدونة" },
    ],
    signIn: { label: "تسجيل الدخول" },
    cta: { label: "ابدأ الآن" },
  },
  hero: {
    eyebrow: "منصة متكاملة",
    headingTop: "لإدارة",
    headingHighlight: "العقارات",
    headingBottom: "بكل سهولة",
    subtext:
      "حصّل الإيجارات، وتحقّق من المستأجرين، وأدِر طلبات الصيانة — دون الحاجة إلى أدوات إضافية.",
    primaryCta: { label: "ابدأ تجربتك المجانية" },
    secondaryCta: { label: "شاهد العرض" },
    bullets: ["لا حاجة إلى بطاقة ائتمانية", "تجربة مجانية لمدة 14 يومًا"],
    imageAlt:
      "أبرز مؤشرات الإيجار والإشغال والصيانة وطلبات الاستئجار حول مبنى سكني حديث",
  },
  product: {
    headingLine1: "اكتشف منصتك الجديدة",
    headingLine2: "لإدارة العقارات",
    tabs: [
      { label: "لوحة التحكم" },
      { label: "العقارات" },
      { label: "المستأجرون" },
      { label: "العقود" },
      { label: "الصيانة" },
      { label: "المعاملات" },
      { label: "المالية" },
      { label: "المحادثات" },
    ],
  },
  features: {
    eyebrow: "المزايا",
    heading: "**كل** ما تحتاجه، ولا شيء **يزيد عن حاجتك.**",
    cards: [
      {
        title: "التحقق من المستأجرين",
        description:
          "اختر مستأجرين أفضل بفحص دقيق للسجل الائتماني والسوابق وحالات الإخلاء السابقة.",
      },
      {
        title: "تحصيل أسرع للإيجارات",
        description:
          "احصل على مستحقاتك في موعدها مع الدفع التلقائي والتذكيرات والإيداعات السريعة والآمنة.",
      },
      {
        title: "طلبات الصيانة",
        description:
          "تابع أعمال الإصلاح وأسندها وأنجزها دون مكالمات أو رسائل لا تنتهي.",
      },
      {
        title: "الإعلانات وطلبات الاستئجار",
        description:
          "انشر إعلاناتك في كل مكان واستقبل طلبات الاستئجار في مكان واحد.",
      },
      {
        title: "المحاسبة والتقارير",
        // The English default repeats the maintenance card's description here;
        // the Arabic says what the card is about.
        description:
          "تابع الإيرادات والمصروفات واستخرج تقارير مالية دقيقة لمحفظتك العقارية.",
      },
    ],
    moreCard: {
      label: "جميع المزايا",
      caption: "وهذه مجرد البداية — اكتشف ما يقدمه **PropertyPro** أيضًا.",
    },
    integrations: {
      text: "**أدوات قوية** و**تكاملات**\nلإدارة الإيجارات **بسرعة أكبر** و**دون عناء.**",
      imageAlt: "Zoom وSlack وWebex وMicrosoft Teams",
    },
  },
  howItWorks: {
    eyebrow: "3 خطوات بسيطة",
    heading: "كيف يعمل؟",
    steps: [
      {
        title: "سجّل في PropertyPro",
        description:
          "أنشئ حسابك المجاني في ثوانٍ: أدخل بياناتك الأساسية وأكّد بريدك الإلكتروني، وستكون جاهزًا للبدء!",
      },
      {
        title: "أضف العقارات والمستأجرين",
        description:
          "استورد محفظتك العقارية والعقود وجهات الاتصال والأرصدة الافتتاحية، أو أضفها أولًا بأول.",
      },
      {
        title: "اجعل عملياتك تلقائية",
        description:
          "فعّل تحصيل الإيجارات والتذكيرات، وسيُبقي PropertyPro جميع الأطراف على اطّلاع دائم.",
      },
    ],
    finalHeading: "الآن **استرخِ** ودَع\n**PropertyPro** يعمل!",
    finalBody:
      "هذا كل شيء — أنت جاهز! سيرسل PropertyPro التذكيرات، ويجيب عن استفسارات المستأجرين، وينظّم مهام الصيانة، مع إشعارات ولوحة تحكم تُبقيك على اطّلاع دائم.",
  },
  testimonial: {
    quoteBefore:
      "«يثق به الملّاك ومديرو العقارات الذين يديرون آلاف الوحدات — ",
    quoteHighlight: "99% من الإيجارات تُحصَّل في موعدها",
    quoteAfter: " مع PropertyPro.»",
    slides: [
      {
        imageAlt: "مدير عقارات يشارك تجربته مع PropertyPro",
        cardQuote:
          "«منذ انتقالي إلى PropertyPro أصبح تحصيل الإيجارات تلقائيًا، وتحسّن تواصلي مع المستأجرين، وصار لديّ وقت أكبر للتوسع.»",
        authorName: "مايكل كارتر",
        authorTitle: "مدير عقارات، أوستن - تكساس",
      },
    ],
  },
  pricing: {
    eyebrow: "الأسعار",
    headingLine1: "أسعار مناسبة",
    headingLine2: "وباقات تنمو معك",
    subtext:
      "حصّل الإيجارات، وتحقّق من المستأجرين، وأدِر طلبات الصيانة — دون الحاجة إلى أدوات إضافية.",
  },
  cta: {
    heading: "جرّب PropertyPro مجانًا!",
    subheading: "ابدأ بإضافة عقارك الآن.",
    cardEyebrow: "دون أي دفعات",
    cardTitle: "مجانًا حتى 10 وحدات*",
    cardCta: { label: "انتقل إلى لوحة التحكم" },
    priceLink: { label: "100 وحدة بـ 29 ريالًا" },
    dashboardImageAlt: "لوحة العقارات في PropertyPro",
    learnMoreLabel: "اعرف المزيد",
    cards: [
      { title: "إدارة العقارات" },
      { title: "إدارة المستأجرين" },
      { title: "المالية" },
      { title: "المحادثة المباشرة" },
    ],
  },
  footer: {
    ctaLabel: "ابدأ تجربتك المجانية",
    tagline:
      "تحصيل الإيجارات، والتحقق من المستأجرين، والصيانة، والمحاسبة — منصة واحدة لمحفظتك العقارية كاملة.",
    columns: [
      {
        title: "المنتج",
        links: [
          { label: "المزايا" },
          { label: "كيف يعمل" },
          { label: "الأسعار" },
          { label: "بوابة المستأجرين" },
          { label: "ابدأ تجربتك المجانية" },
        ],
      },
      {
        title: "الشركة",
        links: [
          { label: "تواصل معنا" },
          { label: "الدعم" },
          { label: "تسجيل الدخول" },
          { label: "المدونة" },
        ],
      },
      {
        title: "قانوني",
        links: [{ label: "شروط الخدمة" }, { label: "سياسة الخصوصية" }],
      },
    ],
    copyright: "© 2026 PropertyPro. جميع الحقوق محفوظة.",
  },
  seo: {
    title: "برنامج متكامل لإدارة العقارات",
    description:
      "حصّل الإيجارات، وتحقّق من المستأجرين، وأدِر الصيانة والعقود والمحاسبة من منصة واحدة متكاملة لإدارة العقارات.",
  },
} satisfies LandingOverlay;
