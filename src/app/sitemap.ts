import type { MetadataRoute } from "next";
import { listPublicPaths } from "@/lib/listings/public";
import { appBaseUrl } from "@/lib/listings/urls";
import { languagePair } from "@/lib/marketing/landing-i18n";
import { blogSitemapEntries } from "@/lib/blog/posts";
import { blogPostPath } from "@/lib/blog/paths";

/**
 * The public surface in the sitemap: the product's own marketing pages (in
 * English and, where one exists, in Arabic under /ar), every published blog
 * post in each language it is written in, and every office's public listings
 * — each office with a published listing, and each published listing
 * (lib/listings/public.ts: only ones whose licence is current and whose unit
 * is still vacant). Everything under /dashboard,
 * /admin, /auth and /api is either private or non-indexable, and robots.ts
 * disallows those paths explicitly.
 *
 * Read on every request rather than at build time: a listing published this
 * morning belongs in the sitemap this afternoon, and one taken down or whose
 * licence has expired must leave it. If the database cannot be reached the
 * marketing pages are still listed — a sitemap that answers is worth more than
 * a complete one that fails.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = appBaseUrl();

  const lastModified = new Date();

  // Each page with an Arabic twin is listed in both languages, each entry
  // naming the other (the same pairs the pages' own hreflang links give).
  const bilingual = (
    englishPath: string,
    changeFrequency: "weekly" | "monthly",
    priority: number,
  ): MetadataRoute.Sitemap => {
    const pair = languagePair(englishPath);
    const alternates = {
      languages: {
        en: `${baseUrl}${pair.en}`,
        "ar-SA": `${baseUrl}${pair.ar}`,
      },
    };
    return [
      { url: `${baseUrl}${pair.en}`, lastModified, changeFrequency, priority, alternates },
      { url: `${baseUrl}${pair.ar}`, lastModified, changeFrequency, priority, alternates },
    ];
  };

  const pages: MetadataRoute.Sitemap = [
    ...bilingual("/", "weekly", 1),
    ...bilingual("/pricing", "weekly", 0.9),
    ...bilingual("/contact", "monthly", 0.6),
    ...bilingual("/blog", "weekly", 0.7),
    {
      url: `${baseUrl}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  // A post is listed once per language it has; a post in both names the
  // other version, as its page's hreflang links do.
  let posts: MetadataRoute.Sitemap = [];
  try {
    posts = (await blogSitemapEntries()).flatMap((entry) => {
      const paths = Object.fromEntries(
        entry.langs.map((lang) => [lang, `${baseUrl}${blogPostPath(entry.slug, lang)}`]),
      );
      const alternates =
        entry.langs.length > 1
          ? { languages: { en: paths.en, "ar-SA": paths.ar } }
          : undefined;
      return entry.langs.map((lang) => ({
        url: paths[lang],
        lastModified: entry.updatedAt,
        changeFrequency: "monthly" as const,
        priority: 0.6,
        ...(alternates ? { alternates } : {}),
      }));
    });
  } catch (error) {
    console.error("sitemap: could not read the blog posts", error);
  }

  try {
    const listings = await listPublicPaths();
    return [
      ...pages,
      ...posts,
      ...listings.map((entry) => ({
        url: `${baseUrl}${entry.path}`,
        lastModified: entry.lastModified,
        // An office's page changes whenever one of its listings does.
        changeFrequency: "daily" as const,
        priority: entry.path.split("/").length > 3 ? 0.7 : 0.6,
      })),
    ];
  } catch (error) {
    console.error("sitemap: could not read the public listings", error);
    return [...pages, ...posts];
  }
}
