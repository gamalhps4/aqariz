/**
 * PropertyPro - Pickers that narrow one another
 *
 * Choosing a compound leaves only its buildings to choose among, choosing a
 * building leaves only its units, and so on: the pickers are narrowed by the
 * ones above them, and a choice made below that no longer fits is cleared
 * rather than left quietly filtering the report to nothing.
 *
 * Done over the lists the endpoint already sent, so narrowing costs no round
 * trip — and the endpoint only ever sent what the reader may see, so nothing
 * here can offer more.
 *
 * Narrowing runs downward only. A contract does not restrict the building
 * picker, though it sits in one; choosing parents first is how the pickers
 * are meant to be read, and a child that implied its parents would make every
 * pick a hidden filter on four others.
 *
 * Pure: the filter bar and the tests call these with plain objects.
 */

import type {
  AgreementOption,
  BuildingOption,
  CompoundOption,
  ContractOption,
  FilterOptions,
  OwnerOption,
  TenantOption,
  UnitOption,
} from "./options";
import { agreementGoverns } from "./agreement-reach";
import type { FilterIdKey } from "./params";

/** What is chosen so far. An absent or empty value is "all". */
export type Selection = Partial<Record<FilterIdKey, string>>;

const chosen = (value: string | undefined): value is string => Boolean(value);

/**
 * The buildings left to choose among, as ids — or null when the buildings were
 * never loaded, in which case nothing can be narrowed by them.
 */
function buildingIds(
  options: FilterOptions,
  selection: Selection,
): Set<string> | null {
  if (!options.buildings) return null;
  return new Set(
    visibleBuildings(options, selection).map((building) => building.id),
  );
}

/** The buildings an owner and a compound leave to choose among. */
export function visibleBuildings(
  options: FilterOptions,
  selection: Selection,
): BuildingOption[] {
  return (options.buildings ?? []).filter(
    (building) =>
      (!chosen(selection.ownerId) || building.ownerId === selection.ownerId) &&
      (!chosen(selection.compoundId) ||
        building.compoundId === selection.compoundId),
  );
}

/** The compounds holding a building of the chosen owner. */
export function visibleCompounds(
  options: FilterOptions,
  selection: Selection,
): CompoundOption[] {
  const compounds = options.compounds ?? [];
  // Which compounds an owner is in is read off their buildings; without
  // those there is nothing to narrow by.
  if (!chosen(selection.ownerId) || !options.buildings) return compounds;
  const held = new Set(
    (options.buildings ?? [])
      .filter((building) => building.ownerId === selection.ownerId)
      .map((building) => building.compoundId),
  );
  return compounds.filter((compound) => held.has(compound.id));
}

/** The owners of a building in the chosen compound. */
export function visibleOwners(
  options: FilterOptions,
  selection: Selection,
): OwnerOption[] {
  const owners = options.owners ?? [];
  if (!chosen(selection.compoundId) || !options.buildings) return owners;
  const holding = new Set(
    (options.buildings ?? [])
      .filter((building) => building.compoundId === selection.compoundId)
      .map((building) => building.ownerId),
  );
  return owners.filter((owner) => holding.has(owner.id));
}

/** The units of the chosen building — or of every building left to choose. */
export function visibleUnits(
  options: FilterOptions,
  selection: Selection,
): UnitOption[] {
  const buildings = buildingIds(options, selection);
  return (options.units ?? []).filter(
    (unit) =>
      (!buildings || buildings.has(unit.propertyId)) &&
      (!chosen(selection.propertyId) || unit.propertyId === selection.propertyId),
  );
}

/** The contracts on the buildings left, in the chosen unit, held by the tenant. */
export function visibleContracts(
  options: FilterOptions,
  selection: Selection,
): ContractOption[] {
  const buildings = buildingIds(options, selection);
  return (options.contracts ?? []).filter(
    (contract) =>
      (!buildings || buildings.has(contract.propertyId)) &&
      (!chosen(selection.propertyId) ||
        contract.propertyId === selection.propertyId) &&
      (!chosen(selection.unitId) || contract.unitId === selection.unitId) &&
      (!chosen(selection.tenantId) || contract.tenantId === selection.tenantId),
  );
}

/**
 * The tenants holding a contract where the pickers above leave one — not
 * narrowed by the tenant or the contract chosen, or picking either would
 * leave only itself to choose.
 */
export function visibleTenants(
  options: FilterOptions,
  selection: Selection,
): TenantOption[] {
  // Who holds a contract where is read off the contracts; without them there
  // is nothing to narrow by.
  if (!options.contracts) return options.tenants ?? [];
  const holding = new Set(
    visibleContracts(options, {
      ...selection,
      tenantId: undefined,
      leaseId: undefined,
    }).map((contract) => contract.tenantId),
  );
  return (options.tenants ?? []).filter((tenant) => holding.has(tenant.id));
}

/**
 * Whether an agreement governs a building: the owner's, and either that one
 * building, or the compound it names, or — naming neither — every building
 * the owner holds. The reading agreement-reports.service makes too.
 */
export function agreementReaches(
  agreement: AgreementOption,
  building: BuildingOption,
): boolean {
  return agreementGoverns(agreement, building);
}

/** The agreements that govern a building the pickers above leave. */
export function visibleAgreements(
  options: FilterOptions,
  selection: Selection,
): AgreementOption[] {
  const agreements = options.agreements ?? [];
  if (
    !chosen(selection.ownerId) &&
    !chosen(selection.compoundId) &&
    !chosen(selection.propertyId)
  ) {
    return agreements;
  }
  // Which buildings an agreement reaches is read off the buildings; without
  // them only the owner can narrow the list.
  if (!options.buildings) {
    return agreements.filter(
      (agreement) =>
        !chosen(selection.ownerId) || agreement.ownerId === selection.ownerId,
    );
  }
  const buildings = visibleBuildings(options, selection).filter(
    (building) =>
      !chosen(selection.propertyId) || building.id === selection.propertyId,
  );
  return agreements.filter(
    (agreement) =>
      (!chosen(selection.ownerId) || agreement.ownerId === selection.ownerId) &&
      buildings.some((building) => agreementReaches(agreement, building)),
  );
}

/** Which key of `Selection` each picker's list answers to. */
const PICKERS: ReadonlyArray<{
  key: FilterIdKey;
  list: keyof FilterOptions;
  visible: (
    options: FilterOptions,
    selection: Selection,
  ) => Array<{ id: string }>;
}> = [
  { key: "ownerId", list: "owners", visible: visibleOwners },
  { key: "compoundId", list: "compounds", visible: visibleCompounds },
  { key: "propertyId", list: "buildings", visible: visibleBuildings },
  { key: "unitId", list: "units", visible: visibleUnits },
  { key: "tenantId", list: "tenants", visible: visibleTenants },
  { key: "leaseId", list: "contracts", visible: visibleContracts },
  { key: "agreementId", list: "agreements", visible: visibleAgreements },
];

/**
 * The selection with every choice that no longer fits what is chosen above it
 * cleared.
 *
 * `changed` is the picker the reader just used. Owner and compound are both
 * at the top, so a pair that does not go together has no "above" to say which
 * to keep; the one just touched wins, and the other is cleared.
 *
 * A choice is only judged against a list that was loaded: a list the page did
 * not ask for, or that failed to arrive, clears nothing.
 */
export function pruneSelection(
  options: FilterOptions,
  selection: Selection,
  changed?: FilterIdKey,
): Selection {
  let next: Selection = { ...selection };

  if (
    chosen(next.ownerId) &&
    chosen(next.compoundId) &&
    options.buildings &&
    !options.buildings.some(
      (building) =>
        building.ownerId === next.ownerId &&
        building.compoundId === next.compoundId,
    )
  ) {
    next =
      changed === "ownerId"
        ? { ...next, compoundId: undefined }
        : { ...next, ownerId: undefined };
  }

  // Each pass can clear a choice another was narrowed by; two settle it.
  for (let pass = 0; pass < 3; pass += 1) {
    let cleared = false;
    for (const picker of PICKERS) {
      const value = next[picker.key];
      if (!chosen(value) || options[picker.list] === undefined) continue;
      const stillOffered = picker
        .visible(options, next)
        .some((entry) => entry.id === value);
      if (!stillOffered) {
        next = { ...next, [picker.key]: undefined };
        cleared = true;
      }
    }
    if (!cleared) break;
  }

  return next;
}
