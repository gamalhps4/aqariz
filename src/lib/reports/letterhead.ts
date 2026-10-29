import "server-only";

/**
 * PropertyPro - Who issued a report
 *
 * The managing office's name, registration numbers and logo, printed above
 * every exported PDF (and the name and numbers above every Excel sheet). The
 * Wazi statements this product is reconciled against carry them, and without
 * them an owner receives a table that could have come from anywhere.
 *
 * Read from the same branding document the login page and the PWA manifest
 * use, so the name on a statement is the name the owner already sees — there
 * is no second place to keep it in step.
 *
 * `commercialRegistration` and `taxNumber` live in that branding JSON rather
 * than in columns of their own. They are two optional strings an office types
 * once in Settings → Branding, and the blob already holds exactly that kind
 * of detail; a migration would buy nothing.
 */

import { cache } from "react";
import { db } from "@/lib/db/prisma";
import { resolveGlobalDisplayOwnerId } from "@/lib/utils/global-display-owner";
import { getPlatformSettings } from "@/lib/platform/settings";
import { pickDocumentLogo } from "@/lib/invoice/logo-utils";
import { loadServerLogo } from "./logo-image";
import type { ReportLetterhead } from "./pdf";
import type { StatementLetterhead } from "@/types/owner";

interface OrgDocumentSettings {
  branding: Record<string, string | undefined> | null;
  /** The office's date-format setting, for the printed-on date. */
  dateFormat: string | null;
}

/**
 * The office's branding and date format — one row, read once per request.
 *
 * Never throws: a report that cannot read them prints without a letterhead
 * and with the market's date format rather than failing the download. An
 * export that works is worth more than a heading.
 */
const readOrgDocumentSettings = cache(
  async (): Promise<OrgDocumentSettings> => {
    try {
      const ownerId = await resolveGlobalDisplayOwnerId();
      if (!ownerId) return { branding: null, dateFormat: null };

      const displaySettings = await db.displaySettings.findFirst({
        where: { userId: ownerId, isActive: true },
        select: { branding: true, dateFormat: true },
      });

      return {
        branding:
          (displaySettings?.branding as
            | Record<string, string | undefined>
            | null
            | undefined) ?? null,
        dateFormat: displaySettings?.dateFormat ?? null,
      };
    } catch (error) {
      console.error("getReportDocumentSettings error:", error);
      return { branding: null, dateFormat: null };
    }
  },
);

export interface ReportDocumentSettings {
  /** Who issued the report, or null when the office has no branding yet. */
  letterhead: ReportLetterhead | null;
  /** The office's date-format setting ("DD/MM/YYYY"), or null when unknown. */
  dateFormat: string | null;
}

/**
 * The letterhead and date format a printed report is written with, from one
 * read of the office's display settings.
 *
 * The letterhead carries the logo's address, not the image: only a PDF draws
 * it, so the fetch and decode happen in `withLetterheadLogo`, for PDFs alone.
 */
export async function getReportDocumentSettings(): Promise<ReportDocumentSettings> {
  const { branding, dateFormat } = await readOrgDocumentSettings();

  const companyName = branding?.companyName?.trim() ?? "";
  const logoUrl = pickDocumentLogo(branding) ?? null;
  const letterhead: ReportLetterhead | null =
    companyName || logoUrl
      ? {
          companyName,
          commercialRegistration:
            branding?.commercialRegistration?.trim() || null,
          taxNumber: branding?.taxNumber?.trim() || null,
          logoUrl,
        }
      : null;

  return { letterhead, dateFormat };
}

/**
 * The letterhead as a statement screen shows it: the same office, the same
 * registration number and the same logo as its PDF and Excel exports. Null
 * when the office has no branding yet.
 */
export async function getStatementLetterhead(): Promise<StatementLetterhead | null> {
  const { letterhead } = await getReportDocumentSettings();
  if (!letterhead) return null;
  return {
    companyName: letterhead.companyName,
    commercialRegistration: letterhead.commercialRegistration ?? null,
    taxNumber: letterhead.taxNumber ?? null,
    logoUrl: letterhead.logoUrl ?? null,
  };
}

/**
 * The letterhead with its logo loaded and ready to draw. Unchanged when there
 * is no logo or it cannot be read — the letterhead then prints without it.
 */
export async function withLetterheadLogo(
  letterhead: ReportLetterhead | null | undefined,
): Promise<ReportLetterhead | null> {
  if (!letterhead) return null;
  if (letterhead.logo || !letterhead.logoUrl) return letterhead;
  const logo = await loadServerLogo(letterhead.logoUrl);
  return logo ? { ...letterhead, logo } : letterhead;
}

/**
 * The letterhead for a *platform* export — the super-admin console's own.
 *
 * `getReportDocumentSettings` above resolves a managing office's branding,
 * which is the right answer for every report inside a tenant's dashboard and
 * the wrong one here: a list of every organization on the platform does not
 * belong to any one of them, and stamping one customer's company name across
 * it would be worse than leaving it blank.
 *
 * So the platform console's exports carry the platform's own name instead.
 * There is no commercial registration to print: the vendor's own is not
 * recorded anywhere, and inventing a field nobody fills in would only put an
 * empty line on the page.
 */
export const getPlatformLetterhead = cache(
  async (): Promise<ReportLetterhead | null> => {
    try {
      const settings = await getPlatformSettings();
      const name = settings.general.platformName?.trim();
      if (!name) return null;
      return { companyName: name };
    } catch (error) {
      console.error("getPlatformLetterhead error:", error);
      return null;
    }
  },
);
