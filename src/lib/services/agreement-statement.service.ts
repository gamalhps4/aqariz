/**
 * PropertyPro - A management agreement's statement
 *
 * "Management Agreement Statement" is the first report under Properties &
 * Operations in the review, and the client wants it in the Wazi layout it
 * already reconciles against. That layout is the owner's statement — the rent
 * roll, the payments, the commission and the VAT on it, and who owes whom at
 * the close — read over the buildings one agreement covers. So this is that
 * statement, narrowed, rather than a second set of sums that could drift from
 * the first.
 *
 * Narrowed in time as well as to buildings: it covers the part of the period
 * the agreement held them, and charges that agreement's own commission — so
 * the statement that closes on its last day settles it in full, and the one
 * it was renewed by starts where it stops.
 */

import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { propertyScope, type ScopeActor } from "@/lib/db/scopes";
import {
  feeLabel,
  feeParts,
  heldUnder,
  loadAgreements,
  type AgreementRow,
  type FeeParts,
} from "@/lib/services/agreement.service";
import {
  getOwnerStatement,
  type OwnerStatement,
} from "@/lib/services/owner-statement.service";

export interface AgreementStatementHeader {
  id: string;
  agreementNumber: string | null;
  kind: string;
  ownerId: string;
  ownerName: string;
  scopeType: "property" | "compound" | "portfolio";
  /** The building or compound it covers; null for a whole-portfolio agreement. */
  scopeName: string | null;
  feeLabel: string;
  /** The same fee as data, for the details line in the reader's language. */
  fee: FeeParts;
  commissionBasis: string;
  status: string;
  startDate: string;
  endDate: string | null;
  currency: string;
}

export interface AgreementStatement {
  agreement: AgreementStatementHeader;
  /** The buildings the statement was read over. */
  properties: Array<{ id: string; name: string }>;
  statement: OwnerStatement;
}

/**
 * Build one agreement's statement for a period — read over the part of it
 * the agreement held its buildings.
 *
 * Returns null when the agreement does not exist, or when every building it
 * covers is outside what the reader may see — an employee assigned a few
 * buildings learns nothing about an agreement on the others.
 */
export async function getAgreementStatement(
  agreementId: string,
  options: {
    actor: ScopeActor;
    startDate: Date;
    endDate: Date;
    currentUserId?: string;
  },
): Promise<AgreementStatement | null> {
  const agreement = await db.agreement.findFirst({
    where: { id: agreementId, deletedAt: null },
    include: {
      owner: { select: { firstName: true, lastName: true } },
      property: { select: { name: true } },
      compound: { select: { name: true } },
    },
  });
  if (!agreement) return null;

  // The buildings it is written for: the one it names, its compound's, or
  // everything the owner holds.
  const named: Prisma.PropertyWhereInput = {
    deletedAt: null,
    ownerId: agreement.ownerId,
    ...(agreement.propertyId ? { id: agreement.propertyId } : {}),
    ...(agreement.compoundId ? { compoundId: agreement.compoundId } : {}),
  };
  const scope = propertyScope(options.actor);
  const [buildings, readable, agreements] = await Promise.all([
    db.property.findMany({
      where: named,
      select: { id: true, name: true, ownerId: true, compoundId: true },
      orderBy: { name: "asc" },
    }),
    db.property.findMany({
      where: { AND: [named, scope] },
      select: { id: true },
    }),
    loadAgreements({ ownerId: agreement.ownerId }),
  ]);

  // A reader narrowed to some buildings learns nothing about an agreement on
  // the others — nor about one that names no building still standing, which
  // only its own owner may open.
  const restricted = Object.keys(scope).length > 0;
  if (
    restricted &&
    readable.length === 0 &&
    (buildings.length > 0 || !options.actor.isOwner)
  ) {
    return null;
  }

  // What it actually held, and when: inside the period asked for, over its
  // own term, and only while no other agreement had precedence — a more
  // specific one, the one it was re-signed as, or an investment agreement.
  // The statement is read over that time and no further. Closing it on the
  // agreement's own last day is what settles an agreement that has ended:
  // read to the end of a longer period, its buildings are the next
  // agreement's, or nobody's, and its commission came out at nothing.
  const requested = { startDate: options.startDate, endDate: options.endDate };
  const readableIds = new Set(readable.map((property) => property.id));
  const { held, covered } = heldUnder(
    agreement.id,
    agreements,
    buildings.filter((building) => readableIds.has(building.id)),
    requested,
  );
  const heldIds = new Set(held.map(({ propertyId }) => propertyId));
  const visible = buildings
    .filter((building) => heldIds.has(building.id))
    .map((building) => ({ id: building.id, name: building.name }));
  const period = covered ?? requested;

  const statement = await getOwnerStatement(agreement.ownerId, {
    actor: options.actor,
    startDate: period.startDate,
    endDate: period.endDate,
    propertyIds: visible.map((property) => property.id),
    agreementId: agreement.id,
    currentUserId: options.currentUserId,
  });
  if (!statement) return null;

  return {
    agreement: {
      id: agreement.id,
      agreementNumber: agreement.agreementNumber,
      kind: agreement.kind,
      ownerId: agreement.ownerId,
      ownerName:
        `${agreement.owner?.firstName ?? ""} ${agreement.owner?.lastName ?? ""}`.trim() ||
        "—",
      scopeType: agreement.propertyId
        ? "property"
        : agreement.compoundId
          ? "compound"
          : "portfolio",
      scopeName: agreement.property?.name ?? agreement.compound?.name ?? null,
      feeLabel: feeLabel(agreement as unknown as AgreementRow),
      fee: feeParts(agreement as unknown as AgreementRow),
      commissionBasis: agreement.commissionBasis,
      status: agreement.status,
      startDate: agreement.startDate.toISOString(),
      endDate: agreement.endDate ? agreement.endDate.toISOString() : null,
      currency: agreement.currency,
    },
    properties: visible,
    statement,
  };
}
