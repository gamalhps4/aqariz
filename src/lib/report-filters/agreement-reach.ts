/**
 * PropertyPro - Which buildings an agreement governs
 *
 * An agreement is made with an owner and names one building, one compound, or
 * neither — the owner's whole portfolio. So it governs the owner's buildings:
 * the one it names, the ones in the compound it names, or all of them.
 *
 * Read the same way by the agreement report (which keeps to the agreements
 * that reach the buildings a reader holds) and by the filter bar (which
 * offers only the agreements that reach the building chosen), so what one
 * lists the other can find.
 *
 * Pure: no database, no session.
 */

/** What an agreement says about the buildings it covers. */
export interface AgreementReach {
  ownerId: string;
  propertyId: string | null;
  compoundId: string | null;
}

/** What a building says about who holds it and where it sits. */
export interface BuildingReach {
  id: string;
  ownerId: string;
  compoundId: string | null;
}

/** Whether the agreement governs the building. */
export function agreementGoverns(
  agreement: AgreementReach,
  building: BuildingReach,
): boolean {
  if (building.ownerId !== agreement.ownerId) return false;
  if (agreement.propertyId) return building.id === agreement.propertyId;
  if (agreement.compoundId) return building.compoundId === agreement.compoundId;
  return true;
}

/** The buildings, among those given, that the agreement governs. */
export function governedBy<T extends BuildingReach>(
  agreement: AgreementReach,
  buildings: readonly T[],
): T[] {
  return buildings.filter((building) => agreementGoverns(agreement, building));
}
