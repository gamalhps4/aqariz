import type { Metadata } from "next";
import Link from "next/link";
import { getPlatformSettings } from "@/lib/platform/settings";
import type { MarketingLang } from "@/lib/marketing/landing-i18n";
import { languageAlternates } from "@/lib/marketing/seo";
import { siteText } from "@/lib/marketing/site-text";
import {
  MarketingPageShell,
  MarketingPageHeader,
} from "@/components/marketing/page-shell";
import {
  ContactSection,
  type ContactFormLabels,
  type ContactTopic,
} from "@/components/marketing/contact-form";
import { LEGAL_POSTAL_ADDRESS } from "@/lib/marketing/legal";

export async function contactMetadata(lang: MarketingLang): Promise<Metadata> {
  const { general } = await getPlatformSettings();
  const values = { name: general.platformName };
  return {
    title: siteText(lang, "contactPage.metaTitle", values),
    description: siteText(lang, "contactPage.metaDescription", values),
    ...languageAlternates("/contact", lang),
  };
}

const TOPICS: ContactTopic[] = ["support", "sales", "billing", "security"];

/** Every word the (client) form shows, read from the catalogue for `lang`. */
function contactFormLabels(lang: MarketingLang): ContactFormLabels {
  const text = (key: string) => siteText(lang, `contact.${key}`);
  return {
    formTitle: text("formTitle"),
    formLead: text("formLead"),
    topic: text("topic"),
    topics: Object.fromEntries(
      TOPICS.map((topic) => [
        topic,
        {
          title: text(`topics.${topic}.title`),
          hint: text(`topics.${topic}.hint`),
        },
      ]),
    ) as ContactFormLabels["topics"],
    sent: text("sent"),
    name: text("name"),
    email: text("email"),
    company: text("company"),
    subject: text("subject"),
    message: text("message"),
    messagePlaceholder: text("messagePlaceholder"),
    honeypot: text("honeypot"),
    preferMail: text("preferMail"),
    mailSubject: text("mailSubject"),
    sending: text("sending"),
    send: text("send"),
    success: text("success"),
    error: {
      failed: text("error.failed"),
      rateLimited: text("error.rateLimited"),
      name: text("error.name"),
      email: text("error.email"),
      subject: text("error.subject"),
      message: text("error.message"),
    },
  };
}

/** /contact and /ar/contact: the enquiry form and the signed-in shortcut. */
export async function MarketingContactPage({ lang }: { lang: MarketingLang }) {
  const { general } = await getPlatformSettings();
  const support = general.supportEmail || "support@example.com";
  const text = (key: string) => siteText(lang, `contactPage.${key}`);

  return (
    <MarketingPageShell lang={lang}>
      <MarketingPageHeader
        eyebrow={text("eyebrow")}
        title={text("title")}
        lead={text("lead")}
      />

      <ContactSection supportEmail={support} labels={contactFormLabels(lang)} />

      <div className="mx-auto mt-12 max-w-4xl px-5 pb-24 sm:px-8">
        <div className="rounded-2xl bg-slate-50 p-8">
          <h2 className="text-lg font-semibold text-slate-900">
            {text("accountTitle")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {text("accountBody")}{" "}
            <Link
              href="/dashboard/settings/billing"
              className="font-medium text-blue-600 hover:underline"
            >
              {text("billingLink")}
            </Link>{" "}
            {text("accountBodyAfter")}
          </p>
          {LEGAL_POSTAL_ADDRESS && (
            <p className="mt-5 border-t border-slate-200 pt-5 text-sm text-slate-600">
              <span className="font-medium text-slate-900">
                {text("postalAddress")}
              </span>{" "}
              {LEGAL_POSTAL_ADDRESS}
            </p>
          )}
        </div>
      </div>
    </MarketingPageShell>
  );
}
