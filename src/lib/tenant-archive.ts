import "server-only";

import { runWithOrgTransaction } from "@/lib/db/prisma";
import { UserRole } from "@/types";

/**
 * PropertyPro - Moving tenants to the archive
 *
 * A tenant is two rows: the user, which the tenant list reads and every
 * contract points at, and an optional profile, which is what the archive's
 * Tenants category lists. Deleting one used to stamp the user, and the profile
 * only if there was one — and a tenant recorded without national ID, company
 * details or employment has none. Such a tenant left the list and appeared in
 * no archive: from the office's side, deleted for good, which is what the
 * archive exists to prevent.
 *
 * So both are stamped, in one transaction, and a missing profile is created
 * already archived. Restoring clears both (archive.service), and nothing
 * stored — the photo, the documents — is destroyed until the archive's
 * permanent delete.
 */
export async function archiveTenantRecords(
  userIds: readonly string[],
  organizationId: string,
): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return 0;

  return runWithOrgTransaction(async (tx) => {
    const now = new Date();

    // A transaction reads without the soft-delete filter, so every
    // `deletedAt` condition below is written out.
    const users = await tx.user.findMany({
      where: { id: { in: ids }, role: UserRole.TENANT, deletedAt: null },
      select: { id: true, createdAt: true },
    });
    const live = users.map((user) => user.id);
    if (live.length === 0) return 0;
    const createdAt = new Map(users.map((user) => [user.id, user.createdAt]));

    const profiles = await tx.tenant.findMany({
      where: { userId: { in: live } },
      select: { userId: true },
    });
    const withProfile = new Set(profiles.map((profile) => profile.userId));

    await tx.tenant.updateMany({
      where: { userId: { in: live }, deletedAt: null },
      data: { deletedAt: now },
    });
    const missing = live.filter((id) => !withProfile.has(id));
    if (missing.length > 0) {
      await tx.tenant.createMany({
        data: missing.map((userId) => ({
          userId,
          organizationId,
          applicationDate: createdAt.get(userId) ?? now,
          deletedAt: now,
        })),
      });
    }

    const archived = await tx.user.updateMany({
      where: { id: { in: live }, deletedAt: null },
      data: { deletedAt: now, isActive: false },
    });
    return archived.count;
  });
}
