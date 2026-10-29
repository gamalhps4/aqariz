/**
 * PropertyPro - What the report filters can be set to
 *
 * The shapes the filter-options endpoint answers with and the filter bar
 * reads. Each option carries the keys that tie it to the others — a building
 * its owner and compound, a unit its building, a contract its building, unit
 * and tenant — which is what lets the bar narrow one picker by another
 * without asking the server again (./dependent.ts).
 *
 * Types only, so the page can import them without pulling the database in.
 */

export interface OwnerOption {
  id: string;
  /** The company when the owner has one, else the person's name. */
  label: string;
}

export interface CompoundOption {
  id: string;
  label: string;
}

export interface BuildingOption {
  id: string;
  label: string;
  /** Where it is — told apart from a building of the same name. */
  hint: string | null;
  compoundId: string | null;
  ownerId: string;
}

export interface UnitOption {
  id: string;
  /** The unit's number; the building is the hint. */
  label: string;
  hint: string | null;
  propertyId: string;
}

export interface TenantOption {
  id: string;
  label: string;
}

export interface ContractOption {
  id: string;
  /** The contract number, or empty when it has none. */
  label: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  propertyId: string;
  unitId: string;
  tenantId: string;
  status: string;
  startDate: string;
  endDate: string;
}

export interface AgreementOption {
  id: string;
  /** The agreement number, or empty when it has none. */
  label: string;
  ownerName: string;
  /** The building or compound it names; empty for a whole portfolio. */
  scopeName: string;
  ownerId: string;
  propertyId: string | null;
  compoundId: string | null;
  status: string;
  kind: string;
}

export const FILTER_OPTION_KEYS = [
  "owners",
  "compounds",
  "buildings",
  "units",
  "tenants",
  "contracts",
  "agreements",
] as const;

export type FilterOptionKey = (typeof FILTER_OPTION_KEYS)[number];

export function isFilterOptionKey(value: unknown): value is FilterOptionKey {
  return FILTER_OPTION_KEYS.includes(value as FilterOptionKey);
}

/**
 * The lists a page asked for. A list it did not ask for is absent — not
 * empty — so the bar can tell "nothing to choose from" from "never loaded"
 * and never clears a selection it has no list to check against.
 */
export interface FilterOptions {
  owners?: OwnerOption[];
  compounds?: CompoundOption[];
  buildings?: BuildingOption[];
  units?: UnitOption[];
  tenants?: TenantOption[];
  contracts?: ContractOption[];
  agreements?: AgreementOption[];
  /** Lists cut short at the endpoint's limit. */
  truncated?: Partial<Record<FilterOptionKey, boolean>>;
}
