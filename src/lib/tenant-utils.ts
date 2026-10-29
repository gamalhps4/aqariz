/**
 * PropertyPro - Tenant Utilities
 * Helper functions for working with tenant profiles across the application
 */

import { db } from "@/lib/db/prisma";
import { getOrgContext } from "@/lib/tenancy/context";
import type { Tenant, User } from "@/generated/prisma/client";

export type TenantProfile = Tenant & {
  user?: Pick<User, "id" | "firstName" | "lastName" | "email" | "phone"> | null;
};

interface EnsureTenantProfileOptions {
  /** When true, a soft-deleted profile is restored instead of recreated. */
  includeSoftDeleted?: boolean;
  /** Include the owning user's contact fields on the returned profile. */
  populate?: boolean;
}

/**
 * Finds (or lazily provisions) a tenant profile for the supplied user. This is
 * critical for brand new tenant accounts that have not completed onboarding
 * yet but still need a placeholder profile so the API can respond gracefully.
 *
 * Runs under the caller's org context; the row is stamped with that org.
 */
export async function ensureTenantProfile(
  userId: string,
  options: EnsureTenantProfileOptions = {},
): Promise<TenantProfile | null> {
  if (!userId) return null;

  const { includeSoftDeleted = false, populate } = options;
  const include = populate
    ? {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      }
    : undefined;

  // Include soft-deleted rows in the lookup (naming deletedAt opts out of the
  // default filter; Prisma ignores the undefined value): a soft-deleted
  // profile must be restored, not recreated — userId is unique.
  let tenant = await db.tenant.findFirst({
    where: { userId, deletedAt: undefined },
    include,
  });

  if (!tenant) {
    const organizationId = getOrgContext()?.organizationId;
    const user = await db.user.findFirst({ where: { id: userId } });
    if (!user || !organizationId) return null;

    tenant = await db.tenant.upsert({
      where: { userId },
      update: includeSoftDeleted ? {} : { deletedAt: null },
      create: {
        userId,
        organizationId,
        applicationDate: user.createdAt ?? new Date(),
        backgroundCheckStatus: "pending",
      },
      include,
    });
  } else if (tenant.deletedAt && !includeSoftDeleted) {
    tenant = await db.tenant.update({
      where: { id: tenant.id },
      data: { deletedAt: null },
      include,
    });
  }

  return tenant as TenantProfile | null;
}
