-- The marketing site's blog: posts written in the platform console
-- (/admin/blog) and read at /blog and /ar/blog.
--
-- One row per post with both languages in it. The slug, the cover image, the
-- tags and the author are shared; the title, excerpt, content, cover
-- description and search overrides are per language. A language exists on
-- the site when its title and content are both filled, so an English-only
-- post is on /blog and not on /ar/blog (lib/blog/languages.ts). Content is a
-- small Markdown subset rendered to React elements, never to HTML
-- (lib/blog/markdown.ts).
--
-- A new table, so its column defaults are safe: no insert the application
-- already makes can reach it before this runs. Until it does, the public
-- pages show an empty blog and the console answers 503.

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "excerptEn" TEXT NOT NULL DEFAULT '',
    "excerptAr" TEXT NOT NULL DEFAULT '',
    "contentEn" TEXT NOT NULL DEFAULT '',
    "contentAr" TEXT NOT NULL DEFAULT '',
    "seoTitleEn" TEXT,
    "seoTitleAr" TEXT,
    "seoDescriptionEn" TEXT,
    "seoDescriptionAr" TEXT,
    "coverImage" TEXT,
    "coverImageAlt" TEXT,
    "coverImageAltAr" TEXT,
    "authorName" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id"),
    -- The two states the console and the pages know. A typo in a script
    -- would otherwise leave a post that is neither drafted nor live.
    CONSTRAINT "blog_posts_status_check" CHECK ("status" IN ('draft', 'published')),
    -- The address rule the API applies (lib/blog/slug.ts): lowercase ASCII
    -- words joined by single hyphens, so every slug is a plain URL segment.
    CONSTRAINT "blog_posts_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 96),
    -- A published post is readable in at least one language.
    CONSTRAINT "blog_posts_published_language_check" CHECK (
      "status" <> 'published'
      OR ("titleEn" <> '' AND "contentEn" <> '')
      OR ("titleAr" <> '' AND "contentAr" <> '')
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_status_publishedAt_idx" ON "blog_posts"("status", "publishedAt");

-- Platform-wide like `plans`, `landing_pages` and `platform_announcements`:
-- only the platform writes. Reading is narrower than theirs on purpose: a
-- published post is public anyway, but a draft is unfinished writing, so only
-- the platform (the console runs with app.bypass_rls on) may read one. The
-- public pages read without the bypass and see published posts only.
ALTER TABLE "blog_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blog_posts" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_published ON "blog_posts" FOR SELECT USING ("status" = 'published');
CREATE POLICY platform_write ON "blog_posts" USING (
  current_setting('app.bypass_rls', true) = 'on'
) WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
);
