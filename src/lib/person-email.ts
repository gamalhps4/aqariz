import "server-only";

import { authDb } from "@/lib/db/prisma";

/**
 * PropertyPro - Is this email address free?
 *
 * `User.email` is unique across the whole platform — every organization, and
 * archived rows as well — so the question cannot be asked through `db`, which
 * sees one organization and hides archived rows. Asked through `db`, an
 * address held elsewhere looked free and the write then failed on the unique
 * index with a raw database error.
 *
 * Compared without regard to case: sign-in treats "A@x.com" and "a@x.com" as
 * one address, so the office must not be able to save them as two people.
 */
export async function isEmailTaken(
  email: string,
  exceptUserId?: string,
): Promise<boolean> {
  const found = await authDb.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      deletedAt: undefined,
      ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(found);
}
