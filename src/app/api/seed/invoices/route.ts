/**
 * PropertyPro - Invoice Seed API
 * Creates sample invoices for testing the tenant invoice history feature
 *
 * Off in production unless the deployment opts in, and removing them is held
 * to the archive purge's rule — see lib/demo-data-access.ts.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { UserRole, InvoiceStatus, InvoiceType } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  demoDataPurgeRefusal,
  demoDataReadRefusal,
  demoDataWriteRefusal,
} from "@/lib/demo-data-access";
import {
  auditService,
  AuditAction,
  AuditCategory,
  AuditSeverity,
} from "@/lib/audit-service";

export const POST = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // These are made-up invoices — one of them already "paid" — written
      // against real contracts.
      const refusal = demoDataWriteRefusal();
      if (refusal) {
        return createErrorResponse(refusal.message, refusal.status);
      }

      // First, let's check if we have any properties, tenants, and leases
      const properties = await db.property.findMany({ take: 5 });
      const tenants = await db.user.findMany({
        where: { role: UserRole.TENANT },
        take: 5,
      });
      const leases = await db.lease.findMany({ take: 5 });

      if (
        properties.length === 0 ||
        tenants.length === 0 ||
        leases.length === 0
      ) {
        return createErrorResponse(
          "Need at least one property, tenant, and lease to create sample invoices",
          400
        );
      }

      // Create sample invoices for each lease
      const sampleInvoices = [];

      for (let i = 0; i < Math.min(leases.length, 3); i++) {
        const lease = leases[i];
        const rentAmount = (lease.terms as any)?.rentAmount || 1200;

        // Create multiple invoices for each lease (past, current, future)
        const invoiceData = [
          {
            invoiceNumber: `INV-2024-${String(i * 3 + 1).padStart(3, "0")}`,
            tenantId: lease.tenantId,
            propertyId: lease.propertyId,
            leaseId: lease.id,
            unitId: lease.unitId,
            category: InvoiceType.RENT,
            issueDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
            dueDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
            status: InvoiceStatus.PAID,
            subtotal: rentAmount,
            totalAmount: rentAmount,
            amountPaid: rentAmount,
            balanceRemaining: 0,
            gracePeriodEnd: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
            lineItems: [
              {
                description: "Monthly Rent - Previous Month",
                amount: rentAmount,
                type: InvoiceType.RENT,
                quantity: 1,
                unitPrice: rentAmount,
              },
            ],
          },
          {
            invoiceNumber: `INV-2024-${String(i * 3 + 2).padStart(3, "0")}`,
            tenantId: lease.tenantId,
            propertyId: lease.propertyId,
            leaseId: lease.id,
            unitId: lease.unitId,
            category: InvoiceType.RENT,
            issueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
            dueDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000), // 25 days from now
            status: InvoiceStatus.ISSUED,
            subtotal: rentAmount,
            totalAmount: rentAmount,
            amountPaid: 0,
            balanceRemaining: rentAmount,
            gracePeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            lineItems: [
              {
                description: "Monthly Rent - Current Month",
                amount: rentAmount,
                type: InvoiceType.RENT,
                quantity: 1,
                unitPrice: rentAmount,
              },
            ],
          },
          {
            invoiceNumber: `INV-2024-${String(i * 3 + 3).padStart(3, "0")}`,
            tenantId: lease.tenantId,
            propertyId: lease.propertyId,
            leaseId: lease.id,
            unitId: lease.unitId,
            category: InvoiceType.RENT,
            issueDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
            dueDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago (overdue)
            status: InvoiceStatus.OVERDUE,
            subtotal: rentAmount,
            totalAmount: rentAmount,
            amountPaid: 600, // Partial payment
            balanceRemaining: rentAmount - 600,
            gracePeriodEnd: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
            lineItems: [
              {
                description: "Monthly Rent - Overdue",
                amount: rentAmount,
                type: InvoiceType.RENT,
                quantity: 1,
                unitPrice: rentAmount,
              },
            ],
          },
        ];

        sampleInvoices.push(...invoiceData);
      }

      // Create the invoices
      const createdInvoices = [];
      for (const invoiceData of sampleInvoices) {
        try {
          const invoice = await db.invoice.create({
            data: {
              ...invoiceData,
              organizationId: user.organizationId!,
            },
          });
          createdInvoices.push(invoice);
        } catch (error) {
          console.error("Error creating invoice:", error);
          // Continue with other invoices
        }
      }

      return createSuccessResponse(
        {
          created: createdInvoices.length,
          invoices: createdInvoices.map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            tenant: inv.tenantId,
            status: inv.status,
            amount: inv.totalAmount,
          })),
        },
        `Created ${createdInvoices.length} sample invoices`
      );
    } catch (error) {
      return handleApiError(error, "Failed to create sample invoices");
    }
  }
);

// GET endpoint to check existing data
export const GET = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // The switch the seeders answer to, and org-wide totals only for a
      // caller who sees the whole organization — see demoDataReadRefusal.
      const readRefusal = demoDataReadRefusal(user);
      if (readRefusal) {
        return createErrorResponse(readRefusal.message, readRefusal.status);
      }

      const properties = await db.property.findMany({
        select: { id: true, name: true },
        take: 5,
      });
      const tenants = await db.user.findMany({
        where: { role: UserRole.TENANT },
        select: { id: true, firstName: true, lastName: true, email: true },
        take: 5,
      });
      const leases = await db.lease.findMany({
        include: {
          tenant: { select: { id: true, firstName: true, lastName: true } },
          property: { select: { id: true, name: true } },
        },
        take: 5,
      });
      const invoices = await db.invoice.findMany({
        include: {
          tenant: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          property: { select: { id: true, name: true } },
        },
        take: 10,
      });

      return createSuccessResponse(
        {
          properties: properties.length,
          tenants: tenants.length,
          leases: leases.length,
          invoices: invoices.length,
          sampleData: {
            properties: properties.map((p) => ({ id: p.id, name: p.name })),
            tenants: tenants.map((t) => ({
              id: t.id,
              name: `${t.firstName} ${t.lastName}`,
            })),
            leases: leases.map((l) => ({
              id: l.id,
              tenant: l.tenant
                ? `${l.tenant.firstName} ${l.tenant.lastName}`
                : "No tenant",
              property: l.property?.name || "No property",
            })),
            invoices: invoices.map((i) => ({
              id: i.id,
              invoiceNumber: i.invoiceNumber,
              tenant: i.tenant
                ? `${i.tenant.firstName} ${i.tenant.lastName}`
                : "No tenant",
              property: i.property?.name || "No property",
              status: i.status,
              amount: i.totalAmount,
            })),
          },
        },
        "Sample data overview"
      );
    } catch (error) {
      return handleApiError(error, "Failed to retrieve sample data");
    }
  }
);

// DELETE endpoint to clean up test data
export const DELETE = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // A hard delete chosen by invoice number alone: a real invoice numbered
      // INV-2024-… goes with the seeded ones, archived or not. So it answers
      // to the rule for destroying an archived invoice.
      const refusal = demoDataPurgeRefusal(user);
      if (refusal) {
        return createErrorResponse(refusal.message, refusal.status);
      }

      // One statement, so it is already all or nothing.
      const result = await db.invoice.deleteMany({
        where: {
          invoiceNumber: { startsWith: "INV-2024-" },
          deletedAt: undefined, // remove soft-deleted seed rows too
        },
      });

      // Irreversible and role-restricted, so it is logged at high severity
      // with the actor attached, as the archive purge is.
      await auditService.logEvent(
        {
          category: AuditCategory.COMPLIANCE,
          action: AuditAction.BULK_DELETE,
          severity: AuditSeverity.HIGH,
          description: `Permanently deleted ${result.count} invoices numbered INV-2024-… through the invoice seed API`,
          resourceType: "invoice",
          details: { deleted: result.count, invoiceNumberPrefix: "INV-2024-" },
          tags: ["demo-data", "permanent-delete", "high_priority"],
          complianceFlags: ["permanent_deletion"],
        },
        auditService.extractContextFromRequest(request, user),
      );

      return createSuccessResponse(
        { deleted: result.count },
        `Deleted ${result.count} test invoices`
      );
    } catch (error) {
      return handleApiError(error, "Failed to delete test invoices");
    }
  }
);
