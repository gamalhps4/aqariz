import { getLandingContent } from "@/lib/marketing/landing";
import { FooterSection } from "@/components/marketing/sections/footer";

// Footer for the public auth pages (sign in, sign up, onboarding, error). The
// header comes from the (public) layout, which every public route shares; the
// footer stays here because the homepage's is a CMS-toggleable/orderable
// section, while on these pages it is always shown.
export default async function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { footer } = await getLandingContent();

  return (
    <div className="flex flex-1 flex-col bg-gray-50 pt-20 text-slate-950 dark:bg-gray-900 dark:text-gray-100">
      <main className="flex flex-1 flex-col">{children}</main>
      <FooterSection content={footer} />
    </div>
  );
}
