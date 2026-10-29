import { HeaderSection } from "@/components/marketing/sections/header";

/**
 * Chrome shared by every public route — landing, marketing pages, and the auth
 * screens. The header lives here rather than in each page so the Platform
 * Console brand (name + logo) renders identically everywhere; previously three
 * separate call sites each cached it on their own ISR cadence, so a branding
 * change landed on some pages and not others.
 *
 * Footers stay with the pages: the homepage's is a CMS-orderable section, and
 * the marketing/auth shells render their own.
 *
 * No typeface is set here: the auth screens are read in Arabic and use the
 * app's face (Cairo, from the root layout); the English marketing pages set
 * their own in `(marketing)/layout.tsx`.
 */
export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col">
      <HeaderSection />
      {children}
    </div>
  );
}
