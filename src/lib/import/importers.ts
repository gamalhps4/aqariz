import "server-only";

/**
 * PropertyPro - Spreadsheet importers
 *
 * Bulk onboarding for people migrating in from a spreadsheet or another tool.
 * The file may be CSV or Excel (.xlsx): the route reads either into the same
 * rows (csv.ts, xlsx.ts), so nothing below knows which it was.
 *
 * Two rules shape the design:
 *
 *   1. **Dry run first.** Every importer validates the whole file and reports
 *      per-row errors without writing anything. Discovering on row 400 that
 *      the file is wrong, with 399 rows already committed, is the failure mode
 *      that makes people distrust imports.
 *   2. **Row-level isolation.** In a real run, one bad row is skipped and
 *      reported; it does not abort the rows around it. A 500-row file with two
 *      typos should import 498 rows, not zero.
 *
 * Plan limits are enforced against the whole batch before any write, so an
 * import cannot be used to walk past a seat or property cap.
 *
 * Contracts and payments live in their own files (lease-importer.ts,
 * payment-importer.ts): they create through the services the screens use
 * rather than writing rows here, and need more room to say why a row fails.
 */

import { authDb, db } from "@/lib/db/prisma";
import { PropertyStatus, PropertyType, UserRole } from "@/types";
import { enforcePlanLimit } from "@/lib/billing/entitlements";
import { countTenantAccounts } from "@/lib/billing/usage";
import { pick, toDate, toNumber, type ParsedCsv } from "./csv";
import { buildCsv } from "@/lib/reports/csv";
import { readTenantRow } from "./tenant-row";
import { buildXlsx } from "./xlsx";
import { importLeases } from "./lease-importer";
import { importPayments } from "./payment-importer";
import {
  emptyResult,
  rowNumber,
  type ImportActor,
  type ImportResource,
  type ImportResult,
} from "./result";

export type {
  ImportActor,
  ImportResource,
  ImportResult,
  RowIssue,
} from "./result";

const PROPERTY_TYPES = new Set<string>(Object.values(PropertyType));
const PROPERTY_STATUSES = new Set<string>(Object.values(PropertyStatus));

export const IMPORT_TEMPLATES: Record<
  ImportResource,
  { columns: string[]; sample: string[] }
> = {
  properties: {
    columns: [
      "name",
      "type",
      "street",
      "city",
      "state",
      "zipCode",
      "country",
      "status",
      "description",
      "yearBuilt",
    ],
    sample: [
      "Maple Court",
      "apartment",
      "12 Maple Street",
      "Austin",
      "TX",
      "78701",
      "USA",
      "available",
      "Six-unit walk-up",
      "1998",
    ],
  },
  units: {
    columns: [
      "propertyName",
      "unitNumber",
      "bedrooms",
      "bathrooms",
      "squareFootage",
      "rentAmount",
      "securityDeposit",
      "status",
    ],
    sample: ["Maple Court", "1A", "2", "1", "780", "1450", "1450", "available"],
  },
  // One name column, as on the tenant form and the contract; firstName and
  // lastName are still read when a file carries them instead. The sample's
  // email is blank on purpose: most tenants are recorded without one.
  tenants: {
    columns: ["fullName", "phone", "email", "moveInDate", "notes"],
    sample: [
      "Mohammed Al Otaibi",
      "+966 50 123 4567",
      "",
      "2026-03-01",
      "Referred by the building supervisor",
    ],
  },
  // One contract per row. The tenant is found by any one of the three
  // tenant columns (ID first), the unit by building name and unit number.
  // The sample is priced as a total, the form's default; rentAmount is for a
  // contract priced per installment instead.
  leases: {
    columns: [
      "contractNumber",
      "tenantIdNumber",
      "tenantEmail",
      "tenantPhone",
      "buildingName",
      "unitNumber",
      "startDate",
      "endDate",
      "paymentFrequency",
      "rentAmount",
      "contractAmount",
      "securityDeposit",
      "status",
      "notes",
    ],
    sample: [
      "20123456789",
      "1012345678",
      "",
      "+966 50 123 4567",
      "Maple Court",
      "1A",
      "2026-03-01",
      "2027-02-28",
      "monthly",
      "",
      "18000",
      "1500",
      "active",
      "Moved over from the old system",
    ],
  },
  // Money already received on an installment. The contract is its number,
  // or the tenant with the building and unit; the installment its invoice
  // number or its due date.
  payments: {
    columns: [
      "contractNumber",
      "tenantIdNumber",
      "tenantEmail",
      "tenantPhone",
      "buildingName",
      "unitNumber",
      "invoiceNumber",
      "dueDate",
      "amount",
      "paidDate",
      "paymentMethod",
      "reference",
      "notes",
    ],
    sample: [
      "20123456789",
      "",
      "",
      "",
      "",
      "",
      "",
      "2026-03-01",
      "1500",
      "2026-03-03",
      "bank_transfer",
      "TRX-558812",
      "March rent",
    ],
  },
};

/** The header row plus one filled-in example, ready to download. */
export function buildTemplate(resource: ImportResource): string {
  const template = IMPORT_TEMPLATES[resource];
  // The shared CSV writer, so a template opens in Excel as UTF-8 like every
  // other CSV the product hands out. The importer reads the byte-order mark.
  return buildCsv([template.columns, template.sample]);
}

/** The same template as an Excel workbook, its columns kept as text. */
export function buildTemplateXlsx(resource: ImportResource): Promise<Buffer> {
  const template = IMPORT_TEMPLATES[resource];
  return buildXlsx([template.columns, template.sample], resource);
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

interface PropertyDraft {
  index: number;
  name: string;
  type: string;
  status: string;
  description?: string;
  yearBuilt: number | null;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

async function importProperties(
  table: ParsedCsv,
  organizationId: string,
  ownerId: string,
  dryRun: boolean,
): Promise<ImportResult> {
  const { rows } = table;
  const result = emptyResult("properties", dryRun, rows.length);
  const drafts: PropertyDraft[] = [];
  const seenNames = new Set<string>();

  rows.forEach((row, index) => {
    const name = pick(row, "name", "property", "propertyName");
    const street = pick(row, "street", "address", "addressStreet", "address1");
    const city = pick(row, "city", "addressCity");
    const state = pick(row, "state", "province", "addressState");
    const zipCode = pick(row, "zipCode", "zip", "postcode", "postalCode");

    const missing = [
      !name && "name",
      !street && "street",
      !city && "city",
      !state && "state",
      !zipCode && "zipCode",
    ].filter(Boolean);

    if (missing.length) {
      result.errors.push({
        row: rowNumber(index),
        message: `Missing required ${missing.join(", ")}`,
      });
      return;
    }

    const key = name.toLowerCase();
    if (seenNames.has(key)) {
      result.errors.push({
        row: rowNumber(index),
        message: `Duplicate property name "${name}" in this file`,
      });
      return;
    }
    seenNames.add(key);

    const rawType = pick(row, "type", "propertyType").toLowerCase();
    const type = PROPERTY_TYPES.has(rawType) ? rawType : PropertyType.APARTMENT;
    if (rawType && !PROPERTY_TYPES.has(rawType)) {
      result.warnings.push({
        row: rowNumber(index),
        message: `Unknown type "${rawType}" — imported as apartment`,
      });
    }

    const rawStatus = pick(row, "status").toLowerCase();
    const status = PROPERTY_STATUSES.has(rawStatus)
      ? rawStatus
      : PropertyStatus.AVAILABLE;

    drafts.push({
      index,
      name,
      type,
      status,
      description: pick(row, "description", "notes") || undefined,
      yearBuilt: toNumber(pick(row, "yearBuilt", "built")),
      street,
      city,
      state,
      zipCode,
      country: pick(row, "country") || "USA",
    });
  });

  result.valid = drafts.length;
  result.skipped = result.totalRows - drafts.length;

  if (drafts.length === 0) return result;

  // Names are how the units importer links rows, so a collision with an
  // existing property is an error rather than a silent second "Maple Court".
  const existing = await db.property.findMany({
    where: {
      name: { in: drafts.map((draft) => draft.name) },
      deletedAt: null,
    },
    select: { name: true },
  });
  const existingNames = new Set(
    existing.map((property) => property.name.toLowerCase()),
  );
  const fresh = drafts.filter((draft) => {
    if (existingNames.has(draft.name.toLowerCase())) {
      result.errors.push({
        row: rowNumber(draft.index),
        message: `A property named "${draft.name}" already exists`,
      });
      return false;
    }
    return true;
  });

  result.valid = fresh.length;
  result.skipped = result.totalRows - fresh.length;
  if (fresh.length === 0) return result;

  // Checked before any write: an import must not be a way around the plan.
  await enforcePlanLimit(
    organizationId,
    "properties",
    await db.property.count({ where: { deletedAt: null } }),
    fresh.length,
  );

  if (dryRun) return result;

  for (const draft of fresh) {
    try {
      await db.property.create({
        data: {
          organizationId,
          name: draft.name,
          description: draft.description,
          type: draft.type,
          status: draft.status,
          addressStreet: draft.street,
          addressCity: draft.city,
          addressState: draft.state,
          addressZipCode: draft.zipCode,
          addressCountry: draft.country,
          yearBuilt: draft.yearBuilt ?? undefined,
          ownerId,
          totalUnits: 1,
          isMultiUnit: false,
        },
      });
      result.imported++;
    } catch (error) {
      result.errors.push({
        row: rowNumber(draft.index),
        message: error instanceof Error ? error.message : "Failed to import",
      });
    }
  }

  result.skipped = result.totalRows - result.imported;
  return result;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

async function importUnits(
  table: ParsedCsv,
  organizationId: string,
  dryRun: boolean,
): Promise<ImportResult> {
  const { rows } = table;
  const result = emptyResult("units", dryRun, rows.length);

  // Units are attached by property NAME, because a spreadsheet exported from
  // another tool has no idea what our cuids are.
  const properties = await db.property.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  const propertyByName = new Map(
    properties.map((property) => [property.name.toLowerCase(), property.id]),
  );

  const drafts: Array<{
    index: number;
    propertyId: string;
    unitNumber: string;
    bedrooms: number | null;
    bathrooms: number | null;
    squareFootage: number | null;
    rentAmount: number | null;
    securityDeposit: number | null;
    status: string;
  }> = [];

  rows.forEach((row, index) => {
    const propertyName = pick(row, "propertyName", "property");
    const unitNumber = pick(row, "unitNumber", "unit", "number");

    if (!propertyName || !unitNumber) {
      result.errors.push({
        row: rowNumber(index),
        message: "Missing required propertyName, unitNumber",
      });
      return;
    }

    const propertyId = propertyByName.get(propertyName.toLowerCase());
    if (!propertyId) {
      result.errors.push({
        row: rowNumber(index),
        message: `No property named "${propertyName}" — import properties first`,
      });
      return;
    }

    const rawStatus = pick(row, "status").toLowerCase();
    drafts.push({
      index,
      propertyId,
      unitNumber,
      bedrooms: toNumber(pick(row, "bedrooms", "beds")),
      bathrooms: toNumber(pick(row, "bathrooms", "baths")),
      squareFootage: toNumber(pick(row, "squareFootage", "sqft", "size")),
      rentAmount: toNumber(pick(row, "rentAmount", "rent", "monthlyRent")),
      securityDeposit: toNumber(pick(row, "securityDeposit", "deposit")),
      status: PROPERTY_STATUSES.has(rawStatus)
        ? rawStatus
        : PropertyStatus.AVAILABLE,
    });
  });

  result.valid = drafts.length;
  result.skipped = result.totalRows - drafts.length;
  if (drafts.length === 0) return result;

  await enforcePlanLimit(
    organizationId,
    "units",
    await db.unit.count({ where: { deletedAt: null } }),
    drafts.length,
  );

  if (dryRun) return result;

  for (const draft of drafts) {
    try {
      const duplicate = await db.unit.findFirst({
        where: {
          propertyId: draft.propertyId,
          unitNumber: draft.unitNumber,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (duplicate) {
        result.errors.push({
          row: rowNumber(draft.index),
          message: `Unit ${draft.unitNumber} already exists on that property`,
        });
        continue;
      }

      await db.unit.create({
        data: {
          organizationId,
          propertyId: draft.propertyId,
          unitNumber: draft.unitNumber,
          bedrooms: draft.bedrooms ?? undefined,
          bathrooms: draft.bathrooms ?? undefined,
          squareFootage: draft.squareFootage ?? undefined,
          rentAmount: draft.rentAmount ?? 0,
          securityDeposit: draft.securityDeposit ?? 0,
          status: draft.status,
        },
      });
      result.imported++;
    } catch (error) {
      result.errors.push({
        row: rowNumber(draft.index),
        message: error instanceof Error ? error.message : "Failed to import",
      });
    }
  }

  result.skipped = result.totalRows - result.imported;
  return result;
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

async function importTenants(
  table: ParsedCsv,
  organizationId: string,
  dryRun: boolean,
): Promise<ImportResult> {
  const { rows } = table;
  const result = emptyResult("tenants", dryRun, rows.length);

  const drafts: Array<{
    index: number;
    firstName: string;
    lastName: string;
    email: string | null;
    phone?: string;
    moveInDate: Date | null;
    notes?: string;
  }> = [];
  const seenEmails = new Set<string>();

  rows.forEach((row, index) => {
    // Name and email rules are the tenant form's (lib/person-fields.ts): a
    // name is required and may be one word; an email may be left out.
    const read = readTenantRow({
      fullName: pick(row, "fullName", "name", "tenantName"),
      firstName: pick(row, "firstName", "first", "givenName"),
      lastName: pick(row, "lastName", "last", "surname", "familyName"),
      email: pick(row, "email", "emailAddress"),
    });
    if (!read.ok) {
      result.errors.push({ row: rowNumber(index), ...read.issue });
      return;
    }
    const { firstName, lastName, email } = read.value;

    if (email) {
      if (seenEmails.has(email)) {
        result.errors.push({
          row: rowNumber(index),
          message: `Duplicate email ${email} in this file`,
          code: "emailDuplicateInFile",
          values: { email },
        });
        return;
      }
      seenEmails.add(email);
    }

    drafts.push({
      index,
      firstName,
      lastName,
      email,
      phone: pick(row, "phone", "phoneNumber", "mobile") || undefined,
      moveInDate: toDate(pick(row, "moveInDate", "moveIn")),
      notes: pick(row, "notes", "applicationNotes") || undefined,
    });
  });

  // An address already held — anywhere on the platform, as the column is
  // unique across every organization — is found in the check, not on row
  // 400 of the real run. One query for the whole file.
  const emails = drafts
    .map((draft) => draft.email)
    .filter((email): email is string => Boolean(email));
  const taken = new Set(
    emails.length === 0
      ? []
      : (
          await authDb.user.findMany({
            where: {
              email: { in: emails, mode: "insensitive" },
              deletedAt: undefined,
            },
            select: { email: true },
          })
        ).map((user) => (user.email ?? "").toLowerCase()),
  );
  const fresh = drafts.filter((draft) => {
    if (draft.email && taken.has(draft.email)) {
      result.errors.push({
        row: rowNumber(draft.index),
        message: `An account already exists for ${draft.email}`,
        code: "emailTaken",
        values: { email: draft.email },
      });
      return false;
    }
    return true;
  });

  // In spreadsheet order: the address check above reports after the rest.
  result.errors.sort((a, b) => a.row - b.row);
  result.valid = fresh.length;
  result.skipped = result.totalRows - fresh.length;
  if (fresh.length === 0) return result;

  // Checked before any write, for the same reason the property and unit
  // importers are: an import must not be a way around the plan.
  await enforcePlanLimit(
    organizationId,
    "tenants",
    await countTenantAccounts(),
    fresh.length,
  );

  if (dryRun) return result;

  for (const draft of fresh) {
    try {
      // No password and no invitation: an import creates the record, and the
      // person is invited separately when the operator is ready. Silently
      // emailing a few hundred people is not what "import" should mean.
      await db.user.create({
        data: {
          organizationId,
          firstName: draft.firstName,
          lastName: draft.lastName,
          name: `${draft.firstName} ${draft.lastName}`.trim(),
          email: draft.email,
          phone: draft.phone,
          role: UserRole.TENANT,
          isActive: true,
          tenantStatus: "approved",
          moveInDate: draft.moveInDate ?? undefined,
          applicationNotes: draft.notes,
        },
      });
      result.imported++;
    } catch (error) {
      result.errors.push({
        row: rowNumber(draft.index),
        message: error instanceof Error ? error.message : "Failed to import",
        code: "failed",
      });
    }
  }

  result.skipped = result.totalRows - result.imported;
  return result;
}

export async function runImport(input: {
  resource: ImportResource;
  /** The file's rows, read from CSV or Excel. */
  table: ParsedCsv;
  organizationId: string;
  ownerId: string;
  /** The caller, for the imports that are checked against their buildings. */
  actor: ImportActor;
  dryRun: boolean;
}): Promise<ImportResult> {
  switch (input.resource) {
    case "properties":
      return importProperties(
        input.table,
        input.organizationId,
        input.ownerId,
        input.dryRun,
      );
    case "units":
      return importUnits(input.table, input.organizationId, input.dryRun);
    case "tenants":
      return importTenants(input.table, input.organizationId, input.dryRun);
    case "leases":
      return importLeases(input.table, input.actor, input.dryRun);
    case "payments":
      return importPayments(input.table, input.actor, input.dryRun);
    default:
      throw new Error("Unsupported import type");
  }
}
