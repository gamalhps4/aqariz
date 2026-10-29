/**
 * PropertyPro SaaS - Personal data export (GDPR / CCPA)
 *
 * Everything the platform holds about the calling account, as one JSON
 * download. Scoped to the *person*, not the organization: a landlord
 * exporting themselves must not walk away with their tenants' records, so
 * this returns rows where the caller is the subject (their profile, their
 * sessions, their leases, their payments, their messages) rather than
 * everything their role can read.
 *
 * Organization-wide exports remain a separate, plan-gated feature
 * (/api/dashboard/export).
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  handleApiError,
  withAccessAndDB,
} from "@/lib/api-utils";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { authDb } from "@/lib/db/prisma";
import {
  auditService,
  AuditCategory,
  AuditAction,
  AuditSeverity,
} from "@/lib/audit-service";
import { businessToday } from "@/lib/dates/business-day";

export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const [
        profile,
        organization,
        sessions,
        tenantProfile,
        leases,
        payments,
        invoices,
        maintenanceRequests,
        documents,
        notifications,
        messages,
        auditTrail,
      ] = await Promise.all([
        db.user.findFirst({
          where: { id: user.id },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            avatar: true,
            bio: true,
            address: true,
            city: true,
            location: true,
            website: true,
            role: true,
            isActive: true,
            emailVerified: true,
            dateOfBirth: true,
            // PII single home: employmentInfo lives on the Tenant profile
            tenantProfile: { select: { employmentInfo: true } },
            emergencyContacts: true,
            createdAt: true,
            updatedAt: true,
            lastLogin: true,
          },
        }),
        db.organization.findFirst({
          where: { id: user.organizationId! },
          select: { id: true, name: true, slug: true, createdAt: true },
        }),
        // Session rows are bypass-scoped infrastructure; filtered to this user.
        bypassOrgScope(() =>
          authDb.session.findMany({
            where: { userId: user.id },
            select: {
              id: true,
              ipAddress: true,
              userAgent: true,
              deviceType: true,
              browser: true,
              os: true,
              createdAt: true,
              updatedAt: true,
              expiresAt: true,
            },
          }),
        ),
        db.tenant.findFirst({ where: { userId: user.id } }),
        db.lease.findMany({ where: { tenantId: user.id } }),
        db.payment.findMany({ where: { tenantId: user.id } }),
        db.invoice.findMany({ where: { tenantId: user.id } }),
        db.maintenanceRequest.findMany({ where: { tenantId: user.id } }),
        db.document.findMany({
          where: { OR: [{ uploadedById: user.id }, { tenantId: user.id }] },
          select: {
            id: true,
            name: true,
            type: true,
            category: true,
            fileUrl: true,
            fileSize: true,
            mimeType: true,
            createdAt: true,
          },
        }),
        db.notification.findMany({ where: { userId: user.id } }),
        db.message.findMany({ where: { senderId: user.id } }),
        db.auditLog.findMany({
          where: { userId: user.id },
          orderBy: { timestamp: "desc" },
          take: 1000,
        }),
      ]);

      const payload = {
        exportedAt: new Date().toISOString(),
        subject: { userId: user.id, email: user.email },
        notice:
          "This export contains the personal data PropertyPro holds about this account. Records belonging to other people are not included. Documents are listed with their storage URLs rather than embedded.",
        profile,
        organization,
        sessions,
        tenantProfile,
        leases,
        invoices,
        payments,
        maintenanceRequests,
        documents,
        notifications,
        messages,
        auditTrail,
      };

      await auditService.logEvent(
        {
          category: AuditCategory.DATA_EXPORT,
          action: AuditAction.BULK_EXPORT,
          severity: AuditSeverity.MEDIUM,
          description: "Personal data export requested",
          resourceType: "user",
          resourceId: user.id,
          resourceName: user.email,
          tags: ["gdpr", "export"],
        },
        auditService.extractContextFromRequest(request, user),
      );

      const filename = `propertypro-my-data-${businessToday()}.json`;

      return new Response(JSON.stringify(payload, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to export your data");
    }
  },
);
