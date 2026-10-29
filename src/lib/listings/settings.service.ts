import "server-only";

/**
 * PropertyPro - The office's listing details, read and saved
 *
 * See ./settings.ts for what they are and why they live in the organization's
 * settings document. Reading is under the caller's own organization context
 * (an office may read its own row); saving is under the platform bypass,
 * because the organization table is platform-writable only — and is confined
 * to the caller's own organization by taking its id from the session, never
 * from the request.
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedAccessUser } from "@/lib/api-utils";
import { daysBetween, riyadhDay } from "./dates";
import { notFound } from "./errors";
import {
  mergeOfficeSettings,
  readOfficeSettings,
  withOfficeSettings,
  type OfficeListingSettings,
  type OfficeSettingsInput,
} from "./settings";
import type { OfficeSettingsDto } from "./types";

function toDto(
  settings: OfficeListingSettings,
  officeSlug: string,
): OfficeSettingsDto {
  return {
    ...settings,
    falExpired:
      settings.falLicenceExpiry !== null &&
      daysBetween(riyadhDay(), settings.falLicenceExpiry) < 0,
    officeSlug,
  };
}

export async function getOfficeSettings(
  user: AuthenticatedAccessUser,
): Promise<OfficeSettingsDto> {
  const organization = await db.organization.findFirst({
    where: { id: user.organizationId! },
    select: { slug: true, settings: true },
  });
  if (!organization) throw notFound("Office");
  return toDto(readOfficeSettings(organization.settings), organization.slug);
}

export async function saveOfficeSettings(
  user: AuthenticatedAccessUser,
  input: OfficeSettingsInput,
): Promise<{ before: OfficeSettingsDto; after: OfficeSettingsDto }> {
  const organizationId = user.organizationId!;
  return bypassOrgScope(async () => {
    const organization = await db.organization.findFirst({
      where: { id: organizationId },
      select: { slug: true, settings: true },
    });
    if (!organization) throw notFound("Office");

    const current = readOfficeSettings(organization.settings);
    const merged = mergeOfficeSettings(current, input);
    await db.organization.update({
      where: { id: organizationId },
      data: {
        settings: withOfficeSettings(
          organization.settings,
          merged,
        ) as Prisma.InputJsonValue,
      },
    });
    return {
      before: toDto(current, organization.slug),
      after: toDto(merged, organization.slug),
    };
  });
}
