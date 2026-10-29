/**
 * PropertyPro - Finding a row's tenant and unit
 *
 * A spreadsheet from another system knows people and flats by what is
 * printed on the contract — a national ID or iqama, an email, a mobile
 * number, a building's name and a unit's number — never by our ids. The
 * contract and payment importers both resolve those here.
 *
 * Matching is strict where money is at stake:
 *
 *   - A tenant is found by national ID / iqama first, then email, then
 *     phone. The first of those that names exactly one tenant decides; one
 *     that names nobody is passed over (a tenant imported from a list of
 *     names has no ID on file yet), and one that names several is not
 *     guessed between.
 *   - When the row's other identifiers name a *different* tenant, the row is
 *     refused: an ID belonging to one person beside the phone of another is
 *     a file mistake, and a contract or a payment on the wrong person is the
 *     costly kind.
 *   - A unit is its building's name plus its number. Two buildings answering
 *     to the same name are reported, not chosen between.
 *
 * No database: the importer loads the candidates and these decide.
 */

import { toE164 } from "@/lib/messaging/providers";
import { codeKey, nameKey, westernDigits, type RowProblem } from "./cells";
import { pick } from "./csv";

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export interface TenantKeys {
  idNumber: string;
  email: string;
  phone: string;
}

/** The tenant columns of a row, under every spelling the templates accept. */
export function readTenantKeys(row: Record<string, string>): TenantKeys {
  return {
    idNumber: pick(
      row,
      "tenantIdNumber",
      "idNumber",
      "nationalId",
      "iqama",
      "iqamaNumber",
      "tenantNationalId",
    ),
    email: pick(row, "tenantEmail", "email", "emailAddress"),
    phone: pick(row, "tenantPhone", "phone", "mobile", "phoneNumber"),
  };
}

export function hasTenantKey(keys: TenantKeys): boolean {
  return Boolean(keys.idNumber || keys.email || keys.phone);
}

export interface TenantRecord {
  id: string;
  idNumber: string | null;
  email: string | null;
  phone: string | null;
}

export interface TenantDirectory {
  byIdNumber: Map<string, string[]>;
  byEmail: Map<string, string[]>;
  byPhone: Map<string, string[]>;
}

const idNumberKey = (value: string) => codeKey(value);
const emailKey = (value: string) => value.trim().toLowerCase();
/**
 * A phone number as E.164 where it can be read as one — "050 123 4567",
 * "+966501234567" and "00966501234567" are the same number — and as its bare
 * digits otherwise, so an unusual number still matches itself.
 */
const phoneKey = (value: string) => {
  const western = westernDigits(value);
  return toE164(western) ?? western.replace(/\D/g, "");
};

function addTo(map: Map<string, string[]>, key: string, id: string) {
  if (!key) return;
  const ids = map.get(key);
  if (!ids) map.set(key, [id]);
  else if (!ids.includes(id)) ids.push(id);
}

export function tenantDirectory(records: readonly TenantRecord[]): TenantDirectory {
  const directory: TenantDirectory = {
    byIdNumber: new Map(),
    byEmail: new Map(),
    byPhone: new Map(),
  };
  for (const record of records) {
    if (record.idNumber) addTo(directory.byIdNumber, idNumberKey(record.idNumber), record.id);
    if (record.email) addTo(directory.byEmail, emailKey(record.email), record.id);
    if (record.phone) addTo(directory.byPhone, phoneKey(record.phone), record.id);
  }
  return directory;
}

export type TenantMatch =
  | { ok: true; tenantId: string }
  | { ok: false; issue: RowProblem };

export function matchTenant(
  directory: TenantDirectory,
  keys: TenantKeys,
): TenantMatch {
  // Strongest first: the order the decision is made in.
  const given = [
    { value: keys.idNumber.trim(), ids: directory.byIdNumber.get(idNumberKey(keys.idNumber)) },
    { value: keys.email.trim(), ids: directory.byEmail.get(emailKey(keys.email)) },
    { value: keys.phone.trim(), ids: directory.byPhone.get(phoneKey(keys.phone)) },
  ].filter((key) => key.value);

  if (given.length === 0) {
    return {
      ok: false,
      issue: {
        message: "Give the tenant's national ID / iqama, email or phone",
        code: "tenantKeyMissing",
      },
    };
  }

  const deciding = given.find((key) => (key.ids?.length ?? 0) > 0);
  if (!deciding) {
    const value = given.map((key) => key.value).join(" / ");
    return {
      ok: false,
      issue: {
        message: `No tenant matches ${value} — add the tenant first`,
        code: "tenantNotFound",
        values: { value },
      },
    };
  }
  if (deciding.ids!.length > 1) {
    return {
      ok: false,
      issue: {
        message: `${deciding.value} matches more than one tenant — give the national ID / iqama`,
        code: "tenantAmbiguous",
        values: { value: deciding.value },
      },
    };
  }

  const tenantId = deciding.ids![0];
  const contradicted = given.find(
    (key) => key.ids && key.ids.length > 0 && !key.ids.includes(tenantId),
  );
  if (contradicted) {
    return {
      ok: false,
      issue: {
        message: `${deciding.value} and ${contradicted.value} belong to different tenants`,
        code: "tenantConflict",
        values: { first: deciding.value, second: contradicted.value },
      },
    };
  }

  return { ok: true, tenantId };
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface UnitKeys {
  building: string;
  unitNumber: string;
}

export function readUnitKeys(row: Record<string, string>): UnitKeys {
  return {
    building: pick(row, "buildingName", "building", "propertyName", "property"),
    unitNumber: pick(row, "unitNumber", "unit", "unitNo"),
  };
}

export interface UnitRecord {
  id: string;
  unitNumber: string;
  status: string;
  propertyId: string;
  propertyName: string;
}

export interface UnitDirectory {
  /** Building name key → the ids of the buildings answering to it. */
  buildings: Map<string, string[]>;
  /** `${propertyId}|${unit key}` → the units with that number there. */
  units: Map<string, UnitRecord[]>;
}

export function unitDirectory(records: readonly UnitRecord[]): UnitDirectory {
  const directory: UnitDirectory = { buildings: new Map(), units: new Map() };
  for (const record of records) {
    addTo(directory.buildings, nameKey(record.propertyName), record.propertyId);
    const key = `${record.propertyId}|${codeKey(record.unitNumber)}`;
    directory.units.set(key, [...(directory.units.get(key) ?? []), record]);
  }
  return directory;
}

/** A building with no units still has to be found by name. */
export function addBuilding(
  directory: UnitDirectory,
  building: { id: string; name: string },
): void {
  addTo(directory.buildings, nameKey(building.name), building.id);
}

export type UnitMatch =
  | { ok: true; unit: UnitRecord }
  | { ok: false; issue: RowProblem };

export function matchUnit(directory: UnitDirectory, keys: UnitKeys): UnitMatch {
  const building = keys.building.trim();
  const unitNumber = keys.unitNumber.trim();
  if (!building || !unitNumber) {
    return {
      ok: false,
      issue: {
        message: "Missing required building name and unit number",
        code: "unitKeyMissing",
      },
    };
  }

  const buildingIds = directory.buildings.get(nameKey(building)) ?? [];
  if (buildingIds.length === 0) {
    return {
      ok: false,
      issue: {
        message: `No building named "${building}"`,
        code: "buildingNotFound",
        values: { building },
      },
    };
  }
  if (buildingIds.length > 1) {
    return {
      ok: false,
      issue: {
        message: `More than one building is named "${building}"`,
        code: "buildingAmbiguous",
        values: { building },
      },
    };
  }

  const units =
    directory.units.get(`${buildingIds[0]}|${codeKey(unitNumber)}`) ?? [];
  if (units.length !== 1) {
    return {
      ok: false,
      issue: units.length === 0
        ? {
            message: `"${building}" has no unit ${unitNumber}`,
            code: "unitNotFound",
            values: { building, unit: unitNumber },
          }
        : {
            message: `"${building}" has more than one unit ${unitNumber}`,
            code: "unitAmbiguous",
            values: { building, unit: unitNumber },
          },
    };
  }
  return { ok: true, unit: units[0] };
}
