/**
 * PropertyPro - The frame of an office's public pages
 *
 * The office's own name and logo, its brokerage licence (FAL) and a switch
 * between Arabic and English — not the platform's header, which belongs to the
 * product's marketing site. Arabic and right to left unless the link asks for
 * English; the `dir` and `lang` are set here, on the page's own wrapper, so
 * the page reads the same whatever the visitor's other cookies say.
 */

import Image from "@/components/ui/app-image";
import Link from "next/link";
import { Building2, Languages, MessageCircle, Phone } from "lucide-react";
import { directionOf, publicText, type PublicLang } from "@/lib/listings/public-text";
import type { PublicOffice } from "@/lib/listings/public-types";
import { telUrl, whatsappUrl } from "@/lib/listings/phone";

interface PublicShellProps {
  office: PublicOffice;
  lang: PublicLang;
  /** The same page in the other language. */
  switchHref: string;
  /** Where the office's name links to (its page); omitted on the office page itself. */
  homeHref?: string;
  children: React.ReactNode;
}

export function PublicShell({
  office,
  lang,
  switchHref,
  homeHref,
  children,
}: PublicShellProps) {
  const text = (key: string, values?: Record<string, string | number>) =>
    publicText(lang, key, values);

  const brand = (
    <span className="flex items-center gap-3">
      {office.logoUrl ? (
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border bg-background">
          <Image
            src={office.logoUrl}
            alt=""
            fill
            className="object-contain p-1"
            sizes="44px"
          />
        </span>
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="h-6 w-6" />
        </span>
      )}
      <span className="flex flex-col leading-tight">
        <span className="text-base font-semibold sm:text-lg">{office.name}</span>
        {office.falLicenceNumber && (
          <span className="text-xs text-muted-foreground">
            {text("marketing.public.fal")}{" "}
            <bdi dir="ltr">{office.falLicenceNumber}</bdi>
          </span>
        )}
      </span>
    </span>
  );

  return (
    <div
      dir={directionOf(lang)}
      lang={lang}
      className="min-h-screen bg-muted/30 text-foreground"
    >
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {homeHref ? (
            <Link href={homeHref} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {brand}
            </Link>
          ) : (
            brand
          )}
          <nav className="flex items-center gap-2" aria-label={office.name}>
            {office.phone && (
              <a
                href={telUrl(office.phone)}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <Phone className="h-4 w-4" />
                <span className="hidden sm:inline" dir="ltr">
                  {office.phone}
                </span>
                <span className="sm:hidden">{text("marketing.public.call")}</span>
              </a>
            )}
            {office.whatsapp && (
              <a
                href={whatsappUrl(office.whatsapp)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 px-3 py-1.5 text-sm text-success hover:bg-success/10"
              >
                <MessageCircle className="h-4 w-4" />
                {text("marketing.public.whatsapp")}
              </a>
            )}
            <Link
              href={switchHref}
              prefetch={false}
              hrefLang={lang === "ar" ? "en" : "ar"}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Languages className="h-4 w-4" />
              {text("marketing.public.switchLanguage")}
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      <footer className="border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <p>{text("marketing.public.footer", { office: office.name })}</p>
        </div>
      </footer>
    </div>
  );
}
