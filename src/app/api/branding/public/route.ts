/**
 * PropertyPro - Public Branding API
 * Returns branding information (logo, company name) without authentication
 * Used for login page and other public-facing pages
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { runWithOrgContext, bypassOrgScope } from "@/lib/tenancy/context";
import {
  getPublicBranding,
  DEFAULT_PUBLIC_BRANDING,
  type PublicBranding,
} from "@/lib/utils/public-branding";

// Default branding values (single source: public-branding helper)
const DEFAULT_BRANDING = DEFAULT_PUBLIC_BRANDING;

/**
 * GET /api/branding/public - Get public branding information
 * No authentication required - used for login page
 */
export async function GET(request: NextRequest) {
  try {
    // Until hostname/subdomain routing is added, callers must identify the
    // organization by its public slug. Never fall back to an arbitrary admin,
    // which would leak one customer's branding into another login screen.
    const slug = (request.headers.get("x-propertypro-org-slug") ||
      request.nextUrl.searchParams.get("organization"))
      ?.trim()
      .toLowerCase();

    if (!slug || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
      return NextResponse.json({
        success: true,
        data: DEFAULT_BRANDING,
      });
    }

    // Slug → organization is a cross-tenant lookup by design (public page).
    const organization = await bypassOrgScope(() =>
      db.organization.findFirst({
        where: { slug, status: { in: ["active", "trial"] } },
        select: { id: true, ownerId: true, branding: true, name: true },
      }),
    );

    if (!organization) {
      return NextResponse.json({ success: true, data: DEFAULT_BRANDING });
    }

    // The organization's display-settings branding (shared owner resolution;
    // same source as the PWA manifest and login page).
    const displayBranding = await runWithOrgContext(
      {
        organizationId: organization.id,
        isPlatformAdmin: false,
      },
      () => getPublicBranding(),
    );

    // getPublicBranding fills defaults for missing fields; layer the
    // organization-level fallbacks in between (display → organization → default).
    const orgBranding =
      (organization.branding as Record<string, string | undefined>) ?? {};
    const pick = (key: keyof PublicBranding, orgValue?: string) =>
      displayBranding[key] !== DEFAULT_BRANDING[key]
        ? displayBranding[key]
        : orgValue || DEFAULT_BRANDING[key];

    const branding = {
      logoLight: pick("logoLight", orgBranding.logoUrl),
      logoDark: pick("logoDark", orgBranding.logoUrl),
      favicon: pick("favicon"),
      primaryColor: pick("primaryColor", orgBranding.primaryColor),
      secondaryColor: pick("secondaryColor"),
      companyName: pick(
        "companyName",
        orgBranding.companyName || organization.name,
      ),
    };

    return NextResponse.json({
      success: true,
      data: branding,
    });
  } catch (error) {
    console.error("Public branding API error:", error);
    // Return default branding on error
    return NextResponse.json({
      success: true,
      data: DEFAULT_BRANDING,
    });
  }
}
