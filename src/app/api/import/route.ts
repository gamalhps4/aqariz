/**
 * PropertyPro - Spreadsheet import
 *
 * GET                               → the resources this caller may import
 * GET  ?resource=…&template=1       → download a starter CSV
 * GET  ?resource=…&template=1&format=xlsx → the same starter as Excel
 * POST multipart file + resource + dryRun → validate, then import
 *
 * The file may be CSV or Excel (.xlsx); either is read into the same rows
 * before an importer sees it.
 *
 * Dry run is the default so nothing writes unless the caller opts in; the UI
 * always validates first and shows the result before offering to commit.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  IMPORT_TEMPLATES,
  buildTemplate,
  buildTemplateXlsx,
  runImport,
  type ImportResource,
} from "@/lib/import/importers";
import { parseCsv, type ParsedCsv } from "@/lib/import/csv";
import { importFileKind, readXlsxTable } from "@/lib/import/xlsx";
import {
  recordDomainAudit,
  type DomainResource,
} from "@/lib/audit-domain";
import { AuditAction } from "@/lib/audit-service";
import { hasAnyPermission } from "@/lib/permissions-manager";
import { INVOICE_PAYMENT_PERMISSIONS } from "@/lib/finance-permissions";

/** Comfortably larger than a few thousand rows, small enough to parse in
 * memory without thinking about it. */
const MAX_BYTES = 5 * 1024 * 1024;

const RESOURCES: ImportResource[] = [
  "properties",
  "units",
  "tenants",
  "leases",
  "payments",
];

/**
 * What a resource asks of the caller beyond `bulk_operations`: the rights of
 * the screen that records the same thing one at a time, so an import is
 * never a way to do in bulk what the caller may not do once.
 *
 *   - Contracts: POST /api/leases asks for lease_create or lease_management.
 *   - Payments: recording against an installment (PATCH /api/invoices/<id>
 *     `add_payment`) asks for INVOICE_PAYMENT_PERMISSIONS.
 *
 * `api` is that screen's API, whose package module the import must also
 * pass (see `moduleRefusal`).
 */
const RESOURCE_ACCESS: Partial<
  Record<ImportResource, { permissions: readonly string[]; api: string }>
> = {
  leases: { permissions: ["lease_create", "lease_management"], api: "/api/leases" },
  payments: { permissions: INVOICE_PAYMENT_PERMISSIONS, api: "/api/invoices" },
};

/** Where each import's audit entry is filed. */
const AUDIT_RESOURCE: Record<ImportResource, DomainResource> = {
  properties: "property",
  units: "property",
  tenants: "tenant",
  leases: "lease",
  payments: "payment",
};

function isResource(value: string | null): value is ImportResource {
  return Boolean(value && RESOURCES.includes(value as ImportResource));
}

function mayImport(user: AuthenticatedAccessUser, resource: ImportResource) {
  const access = RESOURCE_ACCESS[resource];
  return !access || hasAnyPermission(user.permissions, access.permissions);
}

/**
 * The package gate of the screen behind a resource, asked the way the API
 * gate asks it for that screen's own requests (api-utils): this route is
 * gated as the Import module, so without this an office whose package leaves
 * out contracts or collections could still create them from a file. Null
 * when the package includes it.
 */
async function moduleRefusal(
  user: AuthenticatedAccessUser,
  resource: ImportResource,
): Promise<string | null> {
  const access = RESOURCE_ACCESS[resource];
  if (!access) return null;
  const [
    { apiModuleCandidates, decideModuleAccess },
    { getOrganizationModules },
    { planFeatureLabel },
    { canAccessNavItem },
  ] = await Promise.all([
    import("@/lib/billing/modules"),
    import("@/lib/billing/entitlements"),
    import("@/lib/billing/plan-constants"),
    import("@/lib/role-utils"),
  ]);
  const candidates = apiModuleCandidates(access.api);
  if (!candidates) return null;
  const { plan, state } = await getOrganizationModules(user.organizationId!);
  const decision = decideModuleAccess(
    candidates,
    (key) => state.enabled.has(key),
    { applies: (node) => canAccessNavItem(user, node) },
  );
  if (decision.allowed) return null;
  const label = planFeatureLabel(decision.blockedKey ?? candidates[0].key);
  return `${label} is not included in the ${plan?.name ?? "current"} plan.`;
}

/**
 * The uploaded file as rows, whichever kind it is. Throws a message meant
 * for the person who uploaded it.
 */
async function readTable(file: File): Promise<ParsedCsv> {
  const bytes = await file.arrayBuffer();
  switch (importFileKind(new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength)))) {
    case "xlsx":
      return readXlsxTable(bytes);
    case "xls":
      throw new Error(
        "This is an old Excel 97–2003 (.xls) file. Save it as .xlsx or CSV and try again.",
      );
    default:
      return parseCsv(new TextDecoder("utf-8").decode(bytes));
  }
}

export const GET = withPermissionAndDB("bulk_operations")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const params = request.nextUrl.searchParams;
      const resource = params.get("resource");

      if (!isResource(resource)) {
        return createSuccessResponse({
          resources: RESOURCES.filter((key) => mayImport(user, key)).map(
            (key) => ({
              key,
              columns: IMPORT_TEMPLATES[key].columns,
            }),
          ),
          maxBytes: MAX_BYTES,
        });
      }

      if (params.get("format") === "xlsx") {
        const workbook = await buildTemplateXlsx(resource);
        return new Response(new Uint8Array(workbook), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="propertypro-${resource}-template.xlsx"`,
          },
        });
      }

      return new Response(buildTemplate(resource), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="propertypro-${resource}-template.csv"`,
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to build the template");
    }
  },
);

export const POST = withPermissionAndDB("bulk_operations")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const formData = await request.formData();
      const file = formData.get("file");
      const resource = formData.get("resource");
      // Anything but an explicit "false" stays a dry run — a mis-typed flag
      // must not turn a preview into a write.
      const dryRun = String(formData.get("dryRun") ?? "true") !== "false";

      if (!isResource(typeof resource === "string" ? resource : null)) {
        return createErrorResponse(
          `resource must be one of: ${RESOURCES.join(", ")}`,
          400,
        );
      }
      const kind = resource as ImportResource;
      if (!mayImport(user, kind)) {
        return createErrorResponse("Insufficient permissions", 403);
      }
      const notInPlan = await moduleRefusal(user, kind);
      if (notInPlan) {
        return createErrorResponse(
          notInPlan,
          402,
          "Upgrade the subscription to turn this on.",
          "plan_feature_required",
        );
      }

      if (!(file instanceof File)) {
        return createErrorResponse("A CSV or Excel file is required", 400);
      }
      if (file.size === 0) {
        return createErrorResponse("The file is empty", 400);
      }
      if (file.size > MAX_BYTES) {
        return createErrorResponse(
          `The file is larger than ${MAX_BYTES / 1024 / 1024}MB. Split it and import in batches.`,
          413,
        );
      }

      // A file that cannot be read as rows is the uploader's to fix — said
      // as a 400 with the reason, not as a failed import.
      let table: ParsedCsv;
      try {
        table = await readTable(file);
      } catch (error) {
        return createErrorResponse(
          error instanceof Error ? error.message : "The file could not be read",
          400,
        );
      }

      const result = await runImport({
        resource: kind,
        table,
        organizationId: user.organizationId!,
        ownerId: user.id,
        actor: user,
        dryRun,
      });

      if (!dryRun && result.imported > 0) {
        await recordDomainAudit({
          user,
          request,
          resource: AUDIT_RESOURCE[kind],
          action: AuditAction.BULK_IMPORT,
          resourceId: `import:${resource}`,
          resourceName: file.name,
          description: `Imported ${result.imported} ${resource} from ${file.name}`,
          newValues: {
            imported: result.imported,
            skipped: result.skipped,
            errors: result.errors.length,
          },
        });
      }

      return createSuccessResponse(
        result,
        dryRun
          ? `${result.valid} of ${result.totalRows} rows are ready to import`
          : `Imported ${result.imported} of ${result.totalRows} rows`,
      );
    } catch (error) {
      return handleApiError(error, "Import failed");
    }
  },
);
