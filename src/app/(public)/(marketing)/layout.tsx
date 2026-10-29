import { Figtree } from "next/font/google";

// The Figma artboards are set in Neue Plak, which is a commercial Monotype face
// we don't license. Figtree lands within 1.4% of Neue Plak's advance widths
// (measured off Figma's own raster exports), so the designed line breaks and
// column widths of the marketing pages hold.
//
// Scoped to these pages only, and to their English versions: every screen a
// person reads in Arabic — sign-in, sign-up, password reset, two-factor,
// onboarding, the whole dashboard, and the Arabic marketing pages under /ar
// (`ar/layout.tsx` switches back) — is set in the app's one face, Cairo, from
// the root layout. Figtree carries no Arabic, so it used to leave those
// screens to whatever the operating system had.
const figtree = Figtree({ subsets: ["latin"], display: "swap" });

/**
 * Prerendered, whoever asks.
 *
 * The root layout reads the language cookie so dashboard and sign-in pages are
 * drawn in the office's language from the first byte; reading a cookie makes a
 * page render per request. These pages do not change with the reader, so
 * `force-static` keeps them prerendered (and on their `revalidate` cadence):
 * under it the root layout is handed an empty cookie jar and draws them in
 * English, left to right (`STATIC_PAGE_LOCALE`), which is the language their
 * copy is written in. The Arabic pages under /ar are prerendered the same way
 * and set their own language and direction on their wrapper (`ar/layout.tsx`).
 */
export const dynamic = "force-static";

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={`${figtree.className} flex flex-1 flex-col`}>
      {children}
    </div>
  );
}
