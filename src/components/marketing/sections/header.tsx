import { Brand } from "./brand";
import { HeaderBar, type HeaderView } from "./header-bar";
import { getPlatformSettings } from "@/lib/platform/settings";
import { getLandingContentFor } from "@/lib/marketing/landing";
import type { MarketingLang } from "@/lib/marketing/landing-i18n";
import { siteText } from "@/lib/marketing/site-text";
import { bilingualPostSlugs } from "@/lib/blog/posts";

// Top navigation. Its links and buttons are managed in the Platform Console
// (/admin/landing → Navigation), but it is not one of the orderable body
// sections: it renders on every public route, so it has no place in a list the
// homepage reorders. The brand (logo + name) comes from the console's branding
// settings.
//
// It lives in the (public) layout, above the pages, so it cannot be handed the
// page's language. Both languages' navigation are drawn here and the client
// part picks one by the address (`HeaderBar`): /ar… is Arabic. For the same
// reason it cannot know which blog post it sits above, so it is handed the
// slugs of the posts written in both languages, and the language switch on a
// post goes to its twin when it has one.
export async function HeaderSection() {
  const [{ general }, english, arabic, blogTwins] = await Promise.all([
    getPlatformSettings(),
    getLandingContentFor("en"),
    getLandingContentFor("ar"),
    bilingualPostSlugs(),
  ]);

  const view = (lang: MarketingLang): HeaderView => ({
    header: (lang === "ar" ? arabic : english).header,
    homeHref: lang === "ar" ? "/ar" : "/",
    homeLabel: siteText(lang, "header.home", { name: general.platformName }),
    switchLabel: siteText(lang, "header.switchLanguage"),
  });

  return (
    <HeaderBar
      brand={<Brand name={general.platformName} logoUrl={general.logoLight} shrink />}
      views={{ en: view("en"), ar: view("ar") }}
      blogTwins={blogTwins}
    />
  );
}
