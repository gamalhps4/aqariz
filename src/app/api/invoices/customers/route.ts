/**
 * PropertyPro - Who an invoice can be raised to
 *
 * GET /api/invoices/customers?type=tenant|owner|property&search=
 *
 * The pickers of the invoice form: tenants with their live contracts (and
 * each contract's tax setting, which decides whether its rent is VAT-exempt
 * or standard-rated), owners with their VAT number and buildings, and the
 * buildings themselves. Asked here rather than of the tenants, owners and
 * buildings screens, which need their own rights: someone who raises
 * invoices needs names, not the whole client record. Everything is narrowed
 * by the caller's scope.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  leaseScope,
  ownerRecordScope,
  propertyScope,
  tenantRecordScope,
  withScope,
} from "@/lib/db/scopes";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { INVOICE_CREATE_PERMISSIONS } from "@/lib/finance-permissions";
import { UserRole } from "@/types";

const LIMIT = 50;

function nameOf(user: { firstName?: string | null; lastName?: string | null; email?: string | null }) {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || "—";
}

function nameSearch(search: string) {
  return search
    ? {
        OR: [
          { firstName: { contains: search, mode: "insensitive" as const } },
          { lastName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};
}

export const GET = withPermissionAndDB([...INVOICE_CREATE_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const type = searchParams.get("type") ?? "tenant";
      const search = (searchParams.get("search") ?? "").trim();

      if (type === "property") {
        const properties = await db.property.findMany({
          where: withScope(
            search ? { name: { contains: search, mode: "insensitive" } } : {},
            propertyScope(user),
          ),
          select: { id: true, name: true, ownerId: true },
          orderBy: { name: "asc" },
          take: 200,
        });
        return createSuccessResponse({ properties }, "Buildings retrieved");
      }

      if (type === "owner") {
        const owners = await db.user.findMany({
          where: withScope(
            {
              AND: [
                nameSearch(search),
                {
                  OR: [
                    { role: UserRole.OWNER },
                    { propertiesOwned: { some: { deletedAt: null } } },
                  ],
                },
              ],
            },
            ownerRecordScope(user),
          ),
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            ownerProfile: {
              select: {
                companyName: true,
                taxNumber: true,
                addressStreet: true,
                addressDistrict: true,
                addressCity: true,
                addressCountry: true,
              },
            },
            propertiesOwned: {
              where: withScope({ deletedAt: null }, propertyScope(user)),
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            },
          },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
          take: LIMIT,
        });
        return createSuccessResponse(
          {
            owners: owners.map((owner) => {
              const profile = owner.ownerProfile;
              return {
                id: owner.id,
                name: profile?.companyName?.trim() || nameOf(owner),
                email: owner.email,
                vatNumber: profile?.taxNumber ?? null,
                address:
                  [
                    profile?.addressStreet,
                    profile?.addressDistrict,
                    profile?.addressCity,
                    profile?.addressCountry,
                  ]
                    .map((part) => part?.trim())
                    .filter(Boolean)
                    .join(", ") || null,
                properties: owner.propertiesOwned,
              };
            }),
          },
          "Owners retrieved",
        );
      }

      if (type !== "tenant") {
        return createErrorResponse(`Unknown customer type "${type}"`, 400);
      }

      const tenants = await db.user.findMany({
        where: withScope(
          { role: UserRole.TENANT, ...nameSearch(search) },
          tenantRecordScope(user),
        ),
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          leasesAsTenant: {
            where: withScope(
              { status: { in: ["active", "pending"] }, deletedAt: null },
              leaseScope(user),
            ),
            select: {
              id: true,
              propertyId: true,
              startDate: true,
              endDate: true,
              taxEnabled: true,
              taxRate: true,
              property: { select: { name: true } },
              unit: { select: { unitNumber: true } },
            },
            orderBy: { startDate: "desc" },
          },
        },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        take: LIMIT,
      });
      return createSuccessResponse(
        {
          tenants: tenants.map((tenant) => ({
            id: tenant.id,
            name: nameOf(tenant),
            email: tenant.email,
            leases: tenant.leasesAsTenant.map((lease) => ({
              id: lease.id,
              propertyId: lease.propertyId,
              propertyName: lease.property?.name ?? "",
              unitNumber: lease.unit?.unitNumber ?? null,
              startDate: lease.startDate,
              endDate: lease.endDate,
              taxEnabled: lease.taxEnabled,
              taxRate: Number(lease.taxRate),
            })),
          })),
        },
        "Tenants retrieved",
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
);
