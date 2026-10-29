import "./globals.css";
import { Cairo } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { ServiceWorkerProvider } from "@/components/providers/ServiceWorkerProvider";
import { getPublicBranding } from "@/lib/utils/public-branding";
import { getPwaIconUrl } from "@/lib/utils/branding-icons";
import { resolveRequestLocale } from "@/lib/i18n/request-locale";
import { translateFor } from "@/lib/i18n/translate";

/**
 * One typeface for the whole product, in both scripts.
 *
 * The review asked twice — "change the font", and "use one consistent,
 * readable Arabic-compatible font throughout the system". Inter was loaded
 * with the Latin subset only, so every Arabic screen silently fell back to
 * whatever the operating system offered: Tahoma on one machine, Geeza Pro on
 * another, and a different set of letterforms, weights and line heights on
 * each. That is the opposite of consistent, and it is why Arabic pages looked
 * unlike the rest of the product.
 *
 * Cairo covers Arabic and Latin in one family designed together, so a screen
 * mixing a tenant's Arabic name with a Latin contract number sets both in the
 * same voice. It is also the face most Saudi offices already read in.
 *
 * To change it, swap the import and this call — everything downstream reads
 * `--font-sans`.
 */
const appFont = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-sans-app",
  display: "swap",
});

// Read branding per request so the document title, app name, and apple-touch
// icon track the configured company instead of a baked-in "PropertyPro".
export async function generateMetadata(): Promise<Metadata> {
  const [branding, locale] = await Promise.all([
    getPublicBranding(),
    resolveRequestLocale(),
  ]);
  const companyName = branding.companyName || "PropertyPro";

  return {
    applicationName: companyName,
    title: {
      default: companyName,
      template: `%s | ${companyName}`,
    },
    description: translateFor(
      locale.language,
      "app.description",
      undefined,
      "Comprehensive property management solution for landlords, property managers, and tenants.",
    ),
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: companyName,
    },
    // The tab icon is the configured favicon (the office's, else the
    // platform's — lib/utils/public-branding). There is no app/favicon.ico:
    // as a file convention it was always drawn, whatever was configured.
    icons: {
      icon: branding.favicon,
      shortcut: branding.favicon,
      apple: getPwaIconUrl(192, branding.favicon),
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await getPublicBranding();
  return {
    themeColor: branding.primaryColor || "#2563eb",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The office's language and direction, from the request's cookies, so the
  // first paint is already Arabic and right to left for an Arabic office —
  // and the providers start in the same language the server drew, which is
  // what keeps React from redrawing the page on load (error #418). The public
  // marketing pages stay prerendered; see lib/i18n/request-locale.ts.
  const locale = await resolveRequestLocale();

  return (
    // The variable goes on <html> so it is in scope for portalled content —
    // dialogs and toasts render outside <body>'s tree.
    <html
      lang={locale.language}
      dir={locale.dir}
      className={appFont.variable}
      suppressHydrationWarning
    >
      <body className={appFont.className} suppressHydrationWarning>
        <Providers initialLocale={locale}>
          {children}
          <Toaster />
        </Providers>
        <ServiceWorkerProvider />
      </body>
    </html>
  );
}
