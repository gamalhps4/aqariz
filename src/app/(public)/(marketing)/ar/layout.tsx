/**
 * The Arabic marketing pages: /ar, /ar/pricing, /ar/contact and the Arabic
 * blog under /ar/blog.
 *
 * They are prerendered like the English ones (the parent layout's
 * `force-static`), so the root layout draws `<html lang="en" dir="ltr">` for
 * them as for every static page — it cannot read a cookie, and must not, or
 * the pages would render per request. Language and direction are set here
 * instead, on the page's own wrapper: Tailwind's `rtl:` variants match
 * `[dir="rtl"] *`, and logical utilities (`ms-*`, `start-*`) follow the
 * inherited direction, so every section mirrors from this one attribute.
 *
 * Typeface: the English pages are set in Figtree (`../layout.tsx`), which has
 * no Arabic. `font-sans` is the app's Cairo, already loaded by the root layout
 * (`--font-sans-app`), so no second copy of the font is fetched.
 *
 * `data-marketing-lang` lets globals.css reset letter-spacing for the Arabic
 * copy: the design's tracking is tuned for Latin and pulls Arabic's joined
 * letters apart.
 */
export default function ArabicMarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      lang="ar"
      dir="rtl"
      data-marketing-lang="ar"
      className="flex flex-1 flex-col font-sans"
    >
      {children}
    </div>
  );
}
