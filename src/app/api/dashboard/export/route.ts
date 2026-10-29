/**
 * PropertyPro - Dashboard Data Export API
 * Exports dashboard data in various formats
 */

import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  leaseScope,
  maintenanceScope,
  paymentScope,
  propertyScope,
  tenantRecordScope,
} from "@/lib/db/scopes";
import { formatCurrency } from "@/lib/utils/formatting";
import { UserRole } from "@/types";
import { requirePlanFeature } from "@/lib/billing/entitlements";
import { buildCsv } from "@/lib/reports/csv";
import { businessToday } from "@/lib/dates/business-day";

export const POST = withPermissionAndDB("data_export")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      await requirePlanFeature(user.organizationId!, "data_export");
      const {
        format = "json",
        dateRange,
        includeDetails = false,
      } = await request.json();

      const now = new Date();
      const startDate = dateRange?.start
        ? new Date(dateRange.start)
        : new Date(now.getFullYear(), 0, 1);
      const endDate = dateRange?.end ? new Date(dateRange.end) : now;

      // An export is the widest read in the product, so it is scoped exactly
      // like the screens it mirrors: an owner exports their portfolio, a
      // restricted employee only the buildings assigned to them. Tenants are
      // reached through their leases, which is why that fragment is a
      // relation filter rather than a list of ids.
      const propertyWhere = propertyScope(user);
      const leaseWhere = leaseScope(user);
      const paymentWhere = paymentScope(user);
      const maintenanceWhere = maintenanceScope(user);
      const tenantWhere = tenantRecordScope(user);

      // Fetch dashboard data
      const [properties, leasesRaw, tenants, maintenanceRaw, paymentsRaw] =
        await Promise.all([
          includeDetails
            ? db.property.findMany({
                where: { deletedAt: null, ...propertyWhere },
                include: { units: { where: { deletedAt: null } } },
              })
            : db.property.findMany({
                where: { deletedAt: null, ...propertyWhere },
                select: { id: true, name: true, type: true, totalUnits: true },
              }),
          includeDetails
            ? db.lease.findMany({
                where: {
                  deletedAt: null,
                  createdAt: { gte: startDate, lte: endDate },
                  ...leaseWhere,
                },
                include: {
                  tenant: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      email: true,
                    },
                  },
                  property: { select: { id: true, name: true } },
                },
              })
            : db.lease.findMany({
                where: {
                  deletedAt: null,
                  createdAt: { gte: startDate, lte: endDate },
                  ...leaseWhere,
                },
                select: {
                  id: true,
                  status: true,
                  startDate: true,
                  endDate: true,
                },
              }),
          includeDetails
            ? db.user.findMany({
                where: {
                  role: UserRole.TENANT,
                  deletedAt: null,
                  createdAt: { gte: startDate, lte: endDate },
                  ...tenantWhere,
                },
                // Sensitive columns stay out of exports (ssn now lives
                // only on the Tenant profile, which this export never reads).
                omit: { integrations: true },
              })
            : db.user.findMany({
                where: {
                  role: UserRole.TENANT,
                  deletedAt: null,
                  createdAt: { gte: startDate, lte: endDate },
                  ...tenantWhere,
                },
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  tenantStatus: true,
                },
              }),
          includeDetails
            ? db.maintenanceRequest.findMany({
                where: {
                  deletedAt: null,
                  createdAt: { gte: startDate, lte: endDate },
                  ...maintenanceWhere,
                },
                include: { property: { select: { id: true, name: true } } },
              })
            : db.maintenanceRequest.findMany({
                where: {
                  deletedAt: null,
                  createdAt: { gte: startDate, lte: endDate },
                  ...maintenanceWhere,
                },
                select: {
                  id: true,
                  title: true,
                  status: true,
                  priority: true,
                  estimatedCost: true,
                  actualCost: true,
                },
              }),
          includeDetails
            ? db.payment.findMany({
                where: {
                  deletedAt: null,
                  createdAt: { gte: startDate, lte: endDate },
                  ...paymentWhere,
                },
                include: {
                  tenant: {
                    select: { id: true, firstName: true, lastName: true },
                  },
                  property: { select: { id: true, name: true } },
                },
              })
            : db.payment.findMany({
                where: {
                  deletedAt: null,
                  createdAt: { gte: startDate, lte: endDate },
                  ...paymentWhere,
                },
                select: {
                  id: true,
                  amount: true,
                  status: true,
                  type: true,
                  paidDate: true,
                  dueDate: true,
                },
              }),
        ]);

      // Preserve the old populated shape: `tenantId` / `propertyId` carry the
      // related record when details were requested.
      const leases = includeDetails
        ? (leasesRaw as any[]).map((lease) => ({
            ...lease,
            tenantId: lease.tenant ?? lease.tenantId,
            propertyId: lease.property ?? lease.propertyId,
            tenant: undefined,
            property: undefined,
          }))
        : (leasesRaw as any[]);

      const maintenance = includeDetails
        ? (maintenanceRaw as any[]).map((request) => ({
            ...request,
            propertyId: request.property ?? request.propertyId,
            property: undefined,
          }))
        : (maintenanceRaw as any[]);

      const payments = includeDetails
        ? (paymentsRaw as any[]).map((payment) => ({
            ...payment,
            tenantId: payment.tenant ?? payment.tenantId,
            propertyId: payment.property ?? payment.propertyId,
            tenant: undefined,
            property: undefined,
          }))
        : (paymentsRaw as any[]);

      // Calculate summary metrics
      const summary = {
        totalProperties: properties.length,
        totalUnits: properties.reduce(
          (sum: number, p: any) => sum + (p.totalUnits || 1),
          0
        ),
        totalTenants: tenants.length,
        activeTenants: tenants.filter((t: any) => t.tenantStatus === "active")
          .length,
        totalLeases: leases.length,
        activeLeases: leases.filter((l) => l.status === "active").length,
        totalMaintenance: maintenance.length,
        openMaintenance: maintenance.filter((m) =>
          ["submitted", "assigned"].includes(m.status)
        ).length,
        totalPayments: payments.length,
        paidPayments: payments.filter((p) => p.status === "paid").length,
        totalRevenue: payments
          .filter((p) => p.status === "paid")
          .reduce((sum, p) => sum + (p.amount || 0), 0),
        totalMaintenanceCost: maintenance.reduce(
          (sum, m) => sum + (m.actualCost || m.estimatedCost || 0),
          0
        ),
      };

      const exportData = {
        generatedAt: now.toISOString(),
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
        summary,
        data: includeDetails
          ? {
              properties,
              leases,
              tenants,
              maintenance,
              payments,
            }
          : {
              propertyCount: properties.length,
              leaseCount: leases.length,
              tenantCount: tenants.length,
              maintenanceCount: maintenance.length,
              paymentCount: payments.length,
            },
      };

      if (format === "csv") {
        // Convert to CSV format for summary data
        const csvData = [
          ["Metric", "Value"],
          ["Total Properties", summary.totalProperties],
          ["Total Units", summary.totalUnits],
          ["Total Tenants", summary.totalTenants],
          ["Active Tenants", summary.activeTenants],
          ["Total Leases", summary.totalLeases],
          ["Active Leases", summary.activeLeases],
          ["Total Maintenance", summary.totalMaintenance],
          ["Open Maintenance", summary.openMaintenance],
          ["Total Payments", summary.totalPayments],
          ["Paid Payments", summary.paidPayments],
          ["Total Revenue", formatCurrency(summary.totalRevenue)],
          ["Maintenance Cost", formatCurrency(summary.totalMaintenanceCost)],
        ];

        // The shared CSV writer: byte-order mark, quoting, formula guard.
        const csvContent = buildCsv(csvData);

        return new Response(csvContent, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="dashboard-export-${businessToday(
              now,
            )}.csv"`,
          },
        });
      }

      return createSuccessResponse(
        exportData,
        "Dashboard data exported successfully"
      );
    } catch (error) {
      return handleApiError(error ?? "Failed to export dashboard data");
    }
  }
);
