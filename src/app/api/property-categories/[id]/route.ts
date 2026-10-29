/**
 * PropertyPro - Single Property/Unit Category API
 *
 * Rename, reorder, deactivate or remove one category. The `slug` is never
 * editable: it is the value already written into `Property.type` /
 * `Unit.unitType` rows, so changing it would silently orphan live records.
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
  isValidObjectId,
} from "@/lib/api-utils";
import { validateSchema, propertyCategoryUpdateSchema } from "@/lib/validations";
import {
  categoryUsageCount,
  type CategoryKind,
} from "@/lib/property-categories";

// ============================================================================
// PATCH /api/property-categories/[id]
// ============================================================================

export const PATCH = withPermissionAndDB("property_edit")(
  async (
    _user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid category ID", 400);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const validation = validateSchema(propertyCategoryUpdateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const existing = await db.propertyCategory.findFirst({
        where: { id },
        select: { id: true, kind: true, slug: true },
      });
      if (!existing) {
        return createErrorResponse("Category not found", 404);
      }

      const input = validation.data;
      const updated = await db.propertyCategory.update({
        where: { id: existing.id },
        data: {
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.nameAr !== undefined ? { nameAr: input.nameAr || null } : {}),
          ...(input.description !== undefined
            ? { description: input.description || null }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.sortOrder !== undefined
            ? { sortOrder: input.sortOrder }
            : {}),
        },
      });

      return createSuccessResponse(
        { category: updated },
        "Category updated successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update category");
    }
  },
);

// ============================================================================
// DELETE /api/property-categories/[id]
// ============================================================================

export const DELETE = withPermissionAndDB("property_delete")(
  async (
    _user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid category ID", 400);
      }

      const category = await db.propertyCategory.findFirst({
        where: { id },
        select: { id: true, kind: true, slug: true, isSystem: true },
      });
      if (!category) {
        return createErrorResponse("Category not found", 404);
      }

      // Seeded defaults stay in the list so historical rows keep a label;
      // an organization that does not use one deactivates it instead.
      if (category.isSystem) {
        return createErrorResponse(
          "Built-in categories cannot be deleted — deactivate it instead so existing records keep their label",
          400,
        );
      }

      const inUse = await categoryUsageCount(
        category.kind as CategoryKind,
        category.slug,
      );
      if (inUse > 0) {
        return createErrorResponse(
          `This category is still used by ${inUse} record${inUse === 1 ? "" : "s"}. Deactivate it instead.`,
          409,
        );
      }

      await db.propertyCategory.update({
        where: { id: category.id },
        data: { deletedAt: new Date(), isActive: false },
      });

      return createSuccessResponse(
        { id: category.id },
        "Category deleted successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to delete category");
    }
  },
);
