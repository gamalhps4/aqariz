/**
 * PropertyPro - Company Info (server-side)
 *
 * Kept in a separate module from `company-info.ts` because it reaches into
 * server-only code. Server callers (emails, invoice/receipt PDFs) import
 * `getCompanyInfoServer` from here. Resolves the ORGANIZATION's branding
 * owner and reads that user's display/profile settings.
 */

import type { CompanyInfo } from "./company-info";
import { db } from "@/lib/db/prisma";
import { resolveGlobalDisplayOwnerId } from "@/lib/utils/global-display-owner";
import { bypassOrgScope, getOrgContext } from "@/lib/tenancy/context";
import { isReportLanguage, type ReportLanguage } from "@/lib/reports/labels";
import { DEFAULT_LANGUAGE } from "@/lib/regional/region";
import { pickDocumentLogo } from "@/lib/invoice/logo-utils";

export interface OrgDocumentPreferences {
  /** What a document is written in when nobody asked for a language. */
  language: ReportLanguage;
  /** The office's date-format setting, or null for the market's. */
  dateFormat: string | null;
}

/**
 * How the office writes its documents — the language and date format of its
 * display settings — in one read.
 *
 * Used when nobody asked: an invoice PDF made in the background, or a receipt
 * emailed when a payment is recorded. Falls back to the market's language and
 * date format.
 */
export async function getOrgDocumentPreferences(): Promise<OrgDocumentPreferences> {
  const fallback: OrgDocumentPreferences = {
    language: isReportLanguage(DEFAULT_LANGUAGE) ? DEFAULT_LANGUAGE : "en",
    dateFormat: null,
  };
  try {
    const ownerId = await resolveGlobalDisplayOwnerId();
    if (!ownerId) return fallback;
    const settings = await db.displaySettings.findFirst({
      where: { userId: ownerId, isActive: true },
      select: { language: true, dateFormat: true },
    });
    const language = settings?.language?.split("-")[0];
    return {
      language: isReportLanguage(language) ? language : fallback.language,
      dateFormat: settings?.dateFormat ?? null,
    };
  } catch {
    return fallback;
  }
}

/**
 * The language the office works in — its display settings' language.
 * Falls back to the market's language.
 */
export async function getOrgDisplayLanguage(): Promise<ReportLanguage> {
  return (await getOrgDocumentPreferences()).language;
}

/**
 * The name the office signed up under.
 *
 * It is who issued an invoice or receipt until the office fills in its
 * branding — before, an office without branding had a made-up US company
 * printed on its documents instead.
 */
export async function getOrganizationName(): Promise<string | null> {
  const organizationId = getOrgContext()?.organizationId;
  if (!organizationId) return null;
  try {
    // The organization row is platform-level, outside the org-scoped models.
    const organization = await bypassOrgScope(() =>
      db.organization.findFirst({
        where: { id: organizationId },
        select: { name: true },
      }),
    );
    return organization?.name?.trim() || null;
  } catch {
    return null;
  }
}

export async function getCompanyInfoServer(): Promise<CompanyInfo | null> {
  try {
    const adminId = await resolveGlobalDisplayOwnerId();

    const displaySettings = adminId
      ? await db.displaySettings.findFirst({
          where: { userId: adminId, isActive: true },
        })
      : null;
    const profileSettings = adminId
      ? await db.profileSettings.findFirst({
          where: { userId: adminId },
        })
      : null;

    const branding = (displaySettings?.branding ?? {}) as Record<
      string,
      string | undefined
    >;

    const companyName =
      branding.companyName || (await getOrganizationName()) || undefined;
    const companyAddress = branding.companyAddress;
    if (!companyName && !companyAddress) {
      return null;
    }

    const profile = (profileSettings?.profile ?? {}) as Record<
      string,
      string | undefined
    >;

    return {
      name: companyName || "",
      address: companyAddress || "",
      phone: profile.phone || "",
      email: profile.email || "",
      website: profile.website || "",
      // The office's own logo — never the app's placeholder artwork.
      logo: pickDocumentLogo(branding),
      primaryColor: branding.primaryColor || undefined,
      // Its VAT registration number: what makes an invoice a tax invoice.
      vatNumber: branding.taxNumber?.trim() || undefined,
    };
  } catch (error) {
    console.error("Error fetching company info (server):", error);
    return null;
  }
}
