/**
 * PropertyPro - Property & Unit Category API
 *
 * Serves the selectable category lists that replaced the hard-coded
 * `PropertyType` enum and `unitType` union, and lets an organization extend
 * them. Defaults are seeded on first read (see `ensureDefaultCategories`).
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
} from "@/lib/api-utils";
import { validateSchema } from "@/lib/validations";
import {
  propertyCategoryCreateSchema,
  propertyCategoryQuerySchema,
} from "@/lib/validations";
import {
  listCategories,
  toCategorySlug,
  type CategoryKind,
} from "@/lib/property-categories";

// ============================================================================
// GET /api/property-categories?kind=property|unit&activeOnly=true
// ============================================================================

export const GET = withPermissionAndDB("property_view")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);

      const validation = validateSchema(propertyCategoryQuerySchema, {
        kind: searchParams.get("kind") || undefined,
        activeOnly: searchParams.get("activeOnly") || undefined,
      });
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const kind: CategoryKind = validation.data.kind ?? "property";
      const activeOnly = validation.data.activeOnly === "true";

      const categories = await listCategories(user.organizationId!, kind, {
        activeOnly,
      });

      return createSuccessResponse(
        { categories },
        "Categories retrieved successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to retrieve categories");
    }
  },
);

// ============================================================================
// POST /api/property-categories - add a custom category
// ============================================================================

export const POST = withPermissionAndDB("property_create")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const validation = validateSchema(propertyCategoryCreateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const input = validation.data;
      const kind = input.kind as CategoryKind;
      const slug = input.slug ? toCategorySlug(input.slug) : toCategorySlug(input.nameEn);

      if (!slug) {
        return createErrorResponse(
          "Category name must contain at least one letter or number",
          400,
        );
      }

      // A soft-deleted row still holds the (org, kind, slug) unique key, so a
      // plain create would fail with a 500 on the second attempt to add back a
      // category someone deleted. Revive it instead.
      const archived = await db.propertyCategory.findFirst({
        where: { kind, slug, deletedAt: { not: null } },
        select: { id: true },
      });

      if (archived) {
        const revived = await db.propertyCategory.update({
          where: { id: archived.id },
          data: {
            nameEn: input.nameEn,
            nameAr: input.nameAr ?? null,
            description: input.description ?? null,
            isActive: input.isActive ?? true,
            sortOrder: input.sortOrder ?? 999,
            deletedAt: null,
          },
        });
        return createSuccessResponse(
          { category: revived },
          "Category restored successfully",
        );
      }

      const duplicate = await db.propertyCategory.findFirst({
        where: { kind, slug },
        select: { id: true },
      });
      if (duplicate) {
        return createErrorResponse(
          `A ${kind === "unit" ? "unit type" : "property category"} with this name already exists`,
          409,
        );
      }

      const created = await db.propertyCategory.create({
        data: {
          organizationId: user.organizationId!,
          kind,
          slug,
          nameEn: input.nameEn,
          nameAr: input.nameAr ?? null,
          description: input.description ?? null,
          isSystem: false,
          isActive: input.isActive ?? true,
          sortOrder: input.sortOrder ?? 999,
        },
      });

      return createSuccessResponse(
        { category: created },
        "Category created successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to create category");
    }
  },
);
