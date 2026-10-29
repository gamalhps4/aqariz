import type { Metadata } from "next";
import Image from "@/components/ui/app-image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Newspaper } from "lucide-react";
import { getPlatformSettings } from "@/lib/platform/settings";
import type { MarketingLang } from "@/lib/marketing/landing-i18n";
import { languageAlternates, partialLanguageAlternates } from "@/lib/marketing/seo";
import { siteText } from "@/lib/marketing/site-text";
import { appBaseUrl, absoluteUrl } from "@/lib/listings/urls";
import { jsonLd } from "@/lib/listings/public-format";
import { formatPostDate } from "@/lib/blog/format";
import { isOptimizableImage } from "@/lib/blog/image-hosts";
import { hasLanguage, localizePost } from "@/lib/blog/languages";
import { parseMarkdown, plainText, truncateText } from "@/lib/blog/markdown";
import { BlogContent } from "@/lib/blog/markdown-render";
import { blogIndexPath, blogPostPath, isBlogSlugParam } from "@/lib/blog/paths";
import {
  getPublishedPost,
  listPublishedPosts,
  type BlogCardRow,
} from "@/lib/blog/posts";
import {
  MarketingPageShell,
  MarketingPageHeader,
} from "@/components/marketing/page-shell";

/**
 * The blog: /blog and /ar/blog (and their numbered pages), and each post at
 * /blog/<slug> and /ar/blog/<slug>. One set of components for both
 * languages, as with the other marketing pages; the Arabic pages' direction
 * and typeface come from their layout (`(marketing)/ar/layout.tsx`).
 *
 * Each blog lists only the posts written in its language, and a post's page
 * exists only in the languages it has — the other is a 404, never the post
 * in the wrong language.
 */

const text = (lang: MarketingLang, key: string, values?: Record<string, string | number>) =>
  siteText(lang, `blog.${key}`, values);

const OG_LOCALE: Record<MarketingLang, string> = { en: "en_US", ar: "ar_SA" };

// ---------------------------------------------------------------------------
// Shared parts
// ---------------------------------------------------------------------------

/**
 * A cover image in a box of fixed proportions. Optimised by next/image when
 * its host is one next.config.ts allows (the console's uploads always are);
 * any other address the API accepted is drawn as a plain image.
 */
function Cover({
  src,
  alt,
  sizes,
  priority = false,
}: {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
}) {
  if (isOptimizableImage(src)) {
    return (
      <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a host next/image is not configured for
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className="absolute inset-0 size-full object-cover"
    />
  );
}

function Tags({ tags, label }: { tags: string[]; label: string }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li
          key={tag}
          className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

export async function blogIndexMetadata(
  lang: MarketingLang,
  page: number,
): Promise<Metadata> {
  const { general } = await getPlatformSettings();
  const title =
    page > 1 ? text(lang, "pageTitle", { page }) : text(lang, "metaTitle");
  const description = text(lang, "metaDescription", { name: general.platformName });
  const path = blogIndexPath(lang, page);
  return {
    title,
    description,
    // The first page names its twin; later pages differ between the two
    // blogs (each lists its own language's posts), so they only name
    // themselves.
    ...(page > 1
      ? { metadataBase: new URL(appBaseUrl()), alternates: { canonical: path } }
      : languageAlternates("/blog", lang)),
    openGraph: {
      type: "website",
      title,
      description,
      url: path,
      siteName: general.platformName,
      locale: OG_LOCALE[lang],
    },
  };
}

function PostCard({ post, lang }: { post: BlogCardRow; lang: MarketingLang }) {
  const words = localizePost({ ...post, contentEn: "", contentAr: "" }, lang);
  const href = blogPostPath(post.slug, lang);
  const date = post.publishedAt ?? post.updatedAt;
  return (
    <li>
      <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-[0_24px_50px_-30px_rgba(15,23,42,.35)]">
        <div className="relative aspect-[16/9] overflow-hidden bg-slate-100">
          {post.coverImage ? (
            <Cover
              src={post.coverImage}
              alt={words.coverAlt}
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
            />
          ) : (
            <div
              aria-hidden
              className="flex size-full items-center justify-center bg-[radial-gradient(120%_120%_at_0%_0%,#eef2ff_0%,#f8fafc_55%,#f1f5f9_100%)]"
            >
              <Newspaper className="size-10 text-blue-600/25" strokeWidth={1.5} />
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col p-6">
          <time dateTime={date.toISOString()} className="text-sm text-slate-500">
            {formatPostDate(date, lang)}
          </time>
          <h2 className="mt-2 text-lg font-semibold leading-snug text-slate-900 transition text-balance group-hover:text-blue-600">
            {/* The whole card is the link: the title's link is stretched over
                it (and draws the focus ring round all of it), so there is one
                link per card for screen readers. */}
            <Link
              href={href}
              className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-blue-600"
            >
              {words.title}
            </Link>
          </h2>
          {words.excerpt && (
            <p className="mt-3 line-clamp-3 text-[15px] leading-relaxed text-slate-600">
              {words.excerpt}
            </p>
          )}
          {post.tags.length > 0 && (
            <div className="mt-5">
              <Tags tags={post.tags.slice(0, 4)} label={text(lang, "post.tags")} />
            </div>
          )}
          <span
            aria-hidden
            className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-semibold text-blue-600"
          >
            {text(lang, "readMore")}
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
          </span>
        </div>
      </article>
    </li>
  );
}

function Pagination({
  lang,
  page,
  pageCount,
}: {
  lang: MarketingLang;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const linkClass =
    "inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700";
  return (
    <nav
      aria-label={text(lang, "pagination.label")}
      className="mt-16 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-slate-200 pt-8"
    >
      {page > 1 ? (
        <Link href={blogIndexPath(lang, page - 1)} rel="prev" className={`${linkClass} justify-self-start`}>
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          {text(lang, "pagination.newer")}
        </Link>
      ) : (
        <span />
      )}
      <p className="text-center text-sm text-slate-500">
        {text(lang, "pagination.status", { page, count: pageCount })}
      </p>
      {page < pageCount ? (
        <Link href={blogIndexPath(lang, page + 1)} rel="next" className={`${linkClass} justify-self-end`}>
          {text(lang, "pagination.older")}
          <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** /blog and /ar/blog, and their numbered pages: the newest posts first. */
export async function MarketingBlogIndexPage({
  lang,
  page,
}: {
  lang: MarketingLang;
  page: number;
}) {
  const { posts, pageCount } = await listPublishedPosts(lang, page);
  // A page past the end (the blog shrank since a link was made) is a 404;
  // the first page always exists, empty or not.
  if (page > 1 && page > pageCount) notFound();

  return (
    <MarketingPageShell lang={lang}>
      <MarketingPageHeader
        eyebrow={text(lang, "eyebrow")}
        title={page > 1 ? text(lang, "pageTitle", { page }) : text(lang, "title")}
        lead={page > 1 ? undefined : text(lang, "lead")}
      />

      <div className="mx-auto mt-14 max-w-7xl px-5 pb-24 sm:px-8 lg:px-10">
        {posts.length > 0 ? (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} lang={lang} />
            ))}
          </ul>
        ) : (
          <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center">
            <Newspaper className="mx-auto size-10 text-slate-400" strokeWidth={1.5} aria-hidden />
            <h2 className="mt-4 text-lg font-semibold text-slate-900">
              {text(lang, "empty.title")}
            </h2>
            <p className="mt-2 text-slate-600">{text(lang, "empty.body")}</p>
          </div>
        )}
        <Pagination lang={lang} page={page} pageCount={pageCount} />
      </div>
    </MarketingPageShell>
  );
}

// ---------------------------------------------------------------------------
// A post
// ---------------------------------------------------------------------------

/** The post at `slug` in `lang`, or null — a malformed slug never reaches the
 * database. */
async function postFor(slug: string, lang: MarketingLang) {
  if (!isBlogSlugParam(slug)) return null;
  return getPublishedPost(slug, lang);
}

/** The description a search result shows: the operator's, else the excerpt,
 * else the opening of the post. */
function descriptionOf(words: ReturnType<typeof localizePost>): string {
  return (
    words.seoDescription ||
    words.excerpt ||
    truncateText(plainText(parseMarkdown(words.content)), 160)
  );
}

export async function blogPostMetadata(
  slug: string,
  lang: MarketingLang,
): Promise<Metadata> {
  const post = await postFor(slug, lang);
  if (!post) return {};
  const { general } = await getPlatformSettings();
  const words = localizePost(post, lang);
  const title = words.seoTitle || words.title;
  const description = descriptionOf(words);
  const paths = {
    ...(hasLanguage(post, "en") ? { en: blogPostPath(post.slug, "en") } : {}),
    ...(hasLanguage(post, "ar") ? { ar: blogPostPath(post.slug, "ar") } : {}),
  };
  const other: MarketingLang = lang === "ar" ? "en" : "ar";
  const images = post.coverImage
    ? [{ url: post.coverImage, ...(words.coverAlt ? { alt: words.coverAlt } : {}) }]
    : undefined;

  return {
    title,
    description,
    ...partialLanguageAlternates(paths, lang),
    authors: post.authorName ? [{ name: post.authorName }] : undefined,
    keywords: post.tags.length > 0 ? post.tags : undefined,
    openGraph: {
      type: "article",
      title,
      description,
      url: blogPostPath(post.slug, lang),
      siteName: general.platformName,
      locale: OG_LOCALE[lang],
      ...(paths[other] ? { alternateLocale: [OG_LOCALE[other]] } : {}),
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      ...(post.authorName ? { authors: [post.authorName] } : {}),
      ...(post.tags.length > 0 ? { tags: post.tags } : {}),
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description,
      ...(images ? { images: images.map((image) => image.url) } : {}),
    },
  };
}

/** An address for structured data, which must be absolute. */
function absoluteImage(src: string): string {
  return src.startsWith("/") ? absoluteUrl(src) : src;
}

/** /blog/<slug> and /ar/blog/<slug>. */
export async function MarketingBlogPostPage({
  slug,
  lang,
}: {
  slug: string;
  lang: MarketingLang;
}) {
  const post = await postFor(slug, lang);
  if (!post) notFound();

  const { general } = await getPlatformSettings();
  // The stored logo is a placeholder path until one is uploaded (the
  // console's sidebar makes the same check); a publisher logo that does not
  // exist is worse than none.
  const logo =
    general.logoLight && !general.logoLight.startsWith("/images/logo")
      ? absoluteImage(general.logoLight)
      : null;
  const words = localizePost(post, lang);
  const date = post.publishedAt ?? post.updatedAt;
  const url = absoluteUrl(blogPostPath(post.slug, lang));
  const backClass =
    "inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-blue-600";

  // Article structured data: what search engines show as the headline, the
  // date and the author, in the page's language.
  const structured = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: truncateText(words.title, 110),
    description: descriptionOf(words),
    inLanguage: lang === "ar" ? "ar" : "en",
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: date.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    ...(post.coverImage ? { image: [absoluteImage(post.coverImage)] } : {}),
    ...(post.tags.length > 0 ? { keywords: post.tags.join(", ") } : {}),
    author: post.authorName
      ? { "@type": "Person", name: post.authorName }
      : { "@type": "Organization", name: general.platformName },
    publisher: {
      "@type": "Organization",
      name: general.platformName,
      ...(logo ? { logo: { "@type": "ImageObject", url: logo } } : {}),
    },
  };

  return (
    <MarketingPageShell lang={lang}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
      <article className="pb-24">
        <header className="mx-auto max-w-3xl px-5 pt-14 sm:px-8 sm:pt-20">
          <Link href={blogIndexPath(lang)} className={backClass}>
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
            {text(lang, "post.back")}
          </Link>
          <p className="mt-8 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-slate-500">
            <time dateTime={date.toISOString()}>{formatPostDate(date, lang)}</time>
            {post.authorName && (
              <>
                <span aria-hidden>·</span>
                <span>{text(lang, "post.by", { name: post.authorName })}</span>
              </>
            )}
          </p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.15] tracking-[-0.02em] text-slate-900 text-balance sm:text-5xl">
            {words.title}
          </h1>
          {words.excerpt && (
            <p className="mt-5 text-lg leading-relaxed text-slate-600 sm:text-xl">
              {words.excerpt}
            </p>
          )}
        </header>

        {post.coverImage && (
          <div className="mx-auto mt-10 max-w-5xl px-5 sm:px-8">
            <div className="relative aspect-[16/9] overflow-hidden rounded-3xl bg-slate-100 shadow-[0_24px_60px_-30px_rgba(15,23,42,.35)]">
              <Cover
                src={post.coverImage}
                alt={words.coverAlt}
                sizes="(max-width: 1024px) 100vw, 1024px"
                priority
              />
            </div>
          </div>
        )}

        <div className="mx-auto mt-12 max-w-3xl px-5 sm:px-8">
          <BlogContent source={words.content} />
          {post.tags.length > 0 && (
            <div className="mt-12">
              <Tags tags={post.tags} label={text(lang, "post.tags")} />
            </div>
          )}
          <div className="mt-14 border-t border-slate-200 pt-8">
            <Link href={blogIndexPath(lang)} className={backClass}>
              <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
              {text(lang, "post.backToBlog")}
            </Link>
          </div>
        </div>
      </article>
    </MarketingPageShell>
  );
}
