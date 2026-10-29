/**
 * PropertyPro - Payment Synchronization Enhancement Migration
 *
 * Converted from the Mongo-era migration to Prisma/Postgres.
 *
 * Everything the original migration back-filled is now guaranteed by the
 * relational schema itself:
 *   - `version`, `lastSyncedAt`, `syncStatus` are NOT NULL columns with
 *     defaults on the `payments` table — every row always has them.
 *   - The one-rent-payment-per-lease-per-due-date uniqueness lives in the
 *     database as a partial unique index (created by the SQL migrations).
 *   - The old Tenant-collection reference fix-up was a one-time Mongo repair;
 *     `payments.tenantId` is now a foreign key to `users`.
 *
 * The exported API is preserved for its callers (the admin migrate route and
 * the payment-sync initializer): `up` reports success and surfaces any
 * remaining reference inconsistencies, `down` is a no-op, and
 * `isNeeded`/`getStatus` report that the schema already enforces the fields.
 */

import { db } from "@/lib/db/prisma";

export interface MigrationResult {
  success: boolean;
  message: string;
  stats: {
    paymentsUpdated: number;
    tenantReferencesFixed: number;
    indexesCreated: number;
    errors: string[];
  };
}

/**
 * Run the migration
 */
export async function up(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    message: "",
    stats: {
      paymentsUpdated: 0,
      tenantReferencesFixed: 0,
      indexesCreated: 0,
      errors: [],
    },
  };

  try {
    // Sync fields and indexes are enforced by the Postgres schema; nothing to
    // back-fill. Still validate data consistency (old Step 4) and report it.
    const inconsistentPayments = await db.$queryRaw<Array<{ id: string }>>`
      SELECT p.id
      FROM payments p
      JOIN leases l ON p."leaseId" = l.id
      WHERE p."tenantId" <> l."tenantId"
         OR p."propertyId" <> l."propertyId"
    `;

    if (inconsistentPayments.length > 0) {
      result.stats.errors.push(
        `Found ${inconsistentPayments.length} payments with inconsistent references`
      );
      console.warn(
        `⚠️ Found ${inconsistentPayments.length} payments with inconsistent references`
      );
    }

    result.success = true;
    result.message =
      "Payment sync enhancement is enforced by the Postgres schema; no data migration was necessary";
  } catch (error) {
    result.success = false;
    result.message =
      error instanceof Error ? error.message : "Migration failed";
    result.stats.errors.push(result.message);
    console.error("❌ Migration failed:", error);
  }

  return result;
}

/**
 * Rollback the migration
 */
export async function down(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    message: "",
    stats: {
      paymentsUpdated: 0,
      tenantReferencesFixed: 0,
      indexesCreated: 0,
      errors: [],
    },
  };

  try {
    // The sync columns are NOT NULL with defaults in the relational schema and
    // cannot be "unset"; rollback is a no-op on Postgres.
    result.success = true;
    result.message =
      "Rollback is a no-op: payment sync fields are part of the Postgres schema";
  } catch (error) {
    result.success = false;
    result.message = error instanceof Error ? error.message : "Rollback failed";
    result.stats.errors.push(result.message);
    console.error("❌ Rollback failed:", error);
  }

  return result;
}

/**
 * Check if migration is needed
 */
export async function isNeeded(): Promise<boolean> {
  try {
    // version / lastSyncedAt / syncStatus are NOT NULL columns with defaults —
    // no payment can be missing them.
    return false;
  } catch (error) {
    console.error("Error checking migration status:", error);
    return false;
  }
}

/**
 * Get migration status
 */
export async function getStatus(): Promise<{
  needed: boolean;
  stats: {
    totalPayments: number;
    paymentsWithSyncFields: number;
    paymentsWithoutSyncFields: number;
  };
}> {
  try {
    const totalPayments = await db.payment.count({
      where: { deletedAt: undefined },
    });

    // The schema guarantees the sync fields on every row.
    return {
      needed: false,
      stats: {
        totalPayments,
        paymentsWithSyncFields: totalPayments,
        paymentsWithoutSyncFields: 0,
      },
    };
  } catch (error) {
    console.error("Error getting migration status:", error);
    return {
      needed: false,
      stats: {
        totalPayments: 0,
        paymentsWithSyncFields: 0,
        paymentsWithoutSyncFields: 0,
      },
    };
  }
}
