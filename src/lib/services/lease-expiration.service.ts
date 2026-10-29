import { db } from "@/lib/db/prisma";
import { LeaseStatus } from "@/types";
import { applyLeaseStatusSideEffects } from "@/lib/services/lease-lifecycle.service";
import { startOfBusinessDay } from "@/lib/dates/business-day";

export const leaseExpirationService = {
  /**
   * Check for expired leases and update their status
   * This should be run by a daily cron job
   */
  checkAndExpireLeases: async () => {
    try {
      // An end date is the contract's last day, stored at that day's
      // midnight, and the contract is in force until the day is over.
      // Compared with "now", a sweep run on the last day expired it that
      // morning — freeing the unit and cancelling its open payments while it
      // still had a day to run. Only a last day before today has passed —
      // today on Riyadh's calendar, not the server's.
      const startOfToday = startOfBusinessDay();

      const expiredLeases = await db.lease.findMany({
        where: {
          status: LeaseStatus.ACTIVE,
          endDate: { lt: startOfToday },
        },
      });

      console.log(`Found ${expiredLeases.length} leases to expire.`);

      const results = {
        processed: 0,
        errors: 0,
        details: [] as any[],
      };

      for (const lease of expiredLeases) {
        try {
          await db.lease.update({
            where: { id: lease.id },
            data: { status: LeaseStatus.EXPIRED },
          });

          // Side effects of the expiration:
          // 1. Unit back to "available" (+ property derived-state resync)
          // 2. Open payments on the lease are cancelled
          await applyLeaseStatusSideEffects(
            { ...lease, status: LeaseStatus.EXPIRED },
            { statusChanged: true }
          );

          results.processed++;
          results.details.push({
            leaseId: lease.id,
            status: "success",
            message: "Lease expired successfully",
          });
        } catch (error: any) {
          console.error(`Error expiring lease ${lease.id}:`, error);
          results.errors++;
          results.details.push({
            leaseId: lease.id,
            status: "error",
            message: error.message,
          });
        }
      }

      return results;
    } catch (error) {
      console.error("Error in checkAndExpireLeases:", error);
      throw error;
    }
  },
};
