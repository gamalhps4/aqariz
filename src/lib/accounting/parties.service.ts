/**
 * PropertyPro - Tenants and owners, for a journal line's party
 *
 * A manual journal or an opening balance can be kept in a tenant's or an
 * owner's sub-ledger. The pickers ask here rather than the tenants and
 * owners screens, which need their own rights: an accountant keeping the
 * books needs names, not the whole client record.
 */

import { db } from "@/lib/db/prisma";

export interface PartyOption {
  id: string;
  name: string;
  email: string | null;
}

export async function searchParties(
  type: "tenant" | "owner",
  search: string | null,
  limit = 20,
): Promise<PartyOption[]> {
  const text = search?.trim();
  const users = await db.user.findMany({
    where: {
      role: type,
      ...(text
        ? {
            OR: [
              { firstName: { contains: text, mode: "insensitive" } },
              { lastName: { contains: text, mode: "insensitive" } },
              { email: { contains: text, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: Math.min(Math.max(limit, 1), 50),
  });
  return users.map((user) => ({
    id: user.id,
    name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || "—",
    email: user.email,
  }));
}
