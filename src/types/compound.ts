/**
 * PropertyPro - Compound (residential complex) client types
 *
 * Mirrors what `/api/compounds` returns after `presentCompound` reshapes the
 * flat address columns into a nested object.
 */

export interface CompoundParty {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface CompoundAddress {
  street: string;
  city: string;
  /** Neighbourhood (حي); see Property.addressDistrict. */
  district?: string | null;
  state: string;
  zipCode: string;
  country: string;
}

export interface CompoundStats {
  propertyCount: number;
  unitCount: number;
  occupiedUnits: number;
  availableUnits: number;
  occupancyRate: number;
  activeLeases: number;
  monthlyRent: number;
  outstandingBalance: number;
}

export interface CompoundChildProperty {
  id: string;
  name: string;
  type: string;
  status: string;
  addressStreet: string;
  addressCity: string;
  totalUnits: number;
  isMultiUnit: boolean;
  images: string[];
  ownerId: string;
  createdAt: string;
}

export interface CompoundListItem {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  address: CompoundAddress;
  totalArea: number | null;
  yearBuilt: number | null;
  notes: string | null;
  owner: CompoundParty | null;
  manager: CompoundParty | null;
  createdAt: string;
  updatedAt: string;
  stats?: CompoundStats;
}

export interface CompoundDetail extends CompoundListItem {
  amenities: Array<{ name: string; description?: string; category: string }>;
  images: string[];
  properties: CompoundChildProperty[];
  stats: CompoundStats;
}
