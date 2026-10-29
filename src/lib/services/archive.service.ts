/**
 * PropertyPro - Archive & Trash
 *
 * Deleting a record anywhere in the product stamps `deletedAt` rather than
 * removing the row; this module is the one place that reads those rows back,
 * restores them, and — for the two roles allowed to — destroys them.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: permanent deletion belongs to the
 * System Owner (the account's owner) and the platform Super Admin. Nobody
 * else, at any permission level, may destroy an archived record. Restoring is
 * open to anyone who can manage the underlying records, because it is not
 * destructive.
 */

import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import {
  compoundScope,
  invoiceScope,
  leaseScope,
  maintenanceScope,
  paymentScope,
  propertyScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/types";
import {
  InstallmentPaymentError,
  restoreRecordedPayment,
} from "@/lib/services/payment-invoice-linking.service";
import { attachmentUrls, deleteStoredFiles } from "@/lib/stored-files";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { translateFor } from "@/lib/i18n/translate";
import { codeLabel, STATUS_TABLES } from "@/lib/i18n/code-label";
import { paymentMethodLabel } from "@/lib/payments/methods";
import { maintenanceCategoryText, maintenanceStatusText } from "@/lib/maintenance-labels";

/**
 * The categories the scope names, in the order it names them, followed by the
 * money and works records.
 *
 * Those last three were the gap the review found: deleting an invoice, a
 * payment or a maintenance request stamped `deletedAt` like everything else,
 * but no category listed them — so the row left the working list and appeared
 * nowhere, unrecoverable through the UI. Anything soft-deleted must be
 * reachable here or the delete is indistinguishable from data loss.
 */
export const ARCHIVE_CATEGORIES = [
  "owners",
  "clients",
  "compounds",
  "buildings",
  "units",
  "management_agreements",
  "investment_agreements",
  "lease_contracts",
  "invoices",
  "payments",
  "maintenance",
] as const;

export type ArchiveCategory = (typeof ARCHIVE_CATEGORIES)[number];

export function isArchiveCategory(value: unknown): value is ArchiveCategory {
  return ARCHIVE_CATEGORIES.includes(value as ArchiveCategory);
}

export interface ArchivedRecord {
  id: string;
  category: ArchiveCategory;
  label: string;
  sublabel: string;
  deletedAt: string;
  createdAt: string;
  /** Extra context a reviewer needs before restoring or destroying. */
  detail: string | null;
}

export interface ArchiveCategoryCount {
  category: ArchiveCategory;
  count: number;
}

/**
 * Reading soft-deleted rows means opting out of the automatic
 * `deletedAt: null` filter. Naming `deletedAt` at all is how a caller does
 * that (see src/lib/db/prisma.ts) — here with `{ not: null }`, which is the
 * exact inverse of the default.
 */
const ARCHIVED_ONLY = { deletedAt: { not: null } } as const;

/**
 * A contract reaches the archive two ways. Deleting one (drafts only) stamps
 * `deletedAt`; "Archive" on a terminated or expired one stamps `archivedAt`
 * instead (api/leases/[id]), because its invoices and payments stay on the
 * books. This tab used to read only the first, so an archived contract left
 * the Leases list and appeared nowhere here — what the client reported as
 * "deleted contracts do not go to the Archive".
 *
 * `deletedAt: undefined` at the top level is the opt-out from the client's
 * automatic `deletedAt: null` (see ARCHIVED_ONLY), and the caller's scope
 * goes in an AND because it may carry an OR of its own.
 */
function archivedLeaseWhere(
  scope: Prisma.LeaseWhereInput,
): Prisma.LeaseWhereInput {
  return {
    deletedAt: undefined,
    AND: [
      { OR: [{ deletedAt: { not: null } }, { archivedAt: { not: null } }] },
      scope,
    ],
  };
}

function iso(value: Date | null | undefined): string {
  return value ? value.toISOString() : new Date(0).toISOString();
}

function personName(user?: {
  firstName?: string | null;
  lastName?: string | null;
} | null): string {
  return `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();
}

/** How many archived records sit in each category. */
/**
 * The scope fragment for one archive category.
 *
 * Deleted rows are still the organization's rows, and an employee narrowed to
 * a few buildings has no more business reading — or restoring — what was
 * deleted elsewhere than they do reading the live records. This service was
 * built before staff could be narrowed and took no actor at all.
 *
 * Categories that hang off a building use the matching rule from ./scopes;
 * the ones that do not are handled where they are read.
 */
function categoryScope(
  category: ArchiveCategory,
  actor: ScopeActor,
): Record<string, unknown> {
  switch (category) {
    case "compounds":
      return compoundScope(actor);
    case "buildings":
      return propertyScope(actor);
    case "units":
      // A unit belongs to a building, so the building rule is the unit rule.
      return Object.keys(propertyScope(actor)).length
        ? { property: propertyScope(actor) }
        : {};
    case "lease_contracts":
      return leaseScope(actor);
    case "invoices":
      return invoiceScope(actor);
    case "payments":
      return paymentScope(actor);
    case "maintenance":
      return maintenanceScope(actor);
    case "management_agreements":
    case "investment_agreements": {
      // An agreement is attached to a building OR to a compound, and only one
      // of the two columns is set. Matching on the building alone dropped
      // every compound-level agreement, including for the compound the
      // reader holds — so this asks for either.
      const properties = propertyScope(actor);
      if (Object.keys(properties).length === 0) return {};
      return {
        OR: [{ property: properties }, { compound: compoundScope(actor) }],
      };
    }
    case "owners":
    case "clients":
      // A person is not a building. An owner or tenant record carries no
      // property of its own, and narrowing "who was deleted" to the buildings
      // someone holds would hide a deletion rather than protect it — the
      // restore gate below is where that judgement belongs.
      return {};
    default:
      return {};
  }
}

export async function archiveCounts(
  actor: ScopeActor,
): Promise<ArchiveCategoryCount[]> {
  const [
    owners,
    clients,
    compounds,
    buildings,
    units,
    management,
    investment,
    leases,
    invoices,
    payments,
    maintenance,
  ] = await Promise.all([
    // Each count is narrowed the same way its listing is, so the badge on a
    // category and the rows behind it describe the same set. A count that
    // promised twelve and opened onto three would be worse than no count.
    db.owner.count({ where: { ...ARCHIVED_ONLY, ...categoryScope("owners", actor) } }),
    db.tenant.count({ where: { ...ARCHIVED_ONLY, ...categoryScope("clients", actor) } }),
    db.compound.count({ where: { ...ARCHIVED_ONLY, ...categoryScope("compounds", actor) } }),
    db.property.count({ where: { ...ARCHIVED_ONLY, ...categoryScope("buildings", actor) } }),
    db.unit.count({ where: { ...ARCHIVED_ONLY, ...categoryScope("units", actor) } }),
    db.agreement.count({
      where: { ...ARCHIVED_ONLY, kind: "management", ...categoryScope("management_agreements", actor) },
    }),
    db.agreement.count({
      where: { ...ARCHIVED_ONLY, kind: "investment", ...categoryScope("investment_agreements", actor) },
    }),
    db.lease.count({ where: archivedLeaseWhere(categoryScope("lease_contracts", actor)) }),
    db.invoice.count({ where: { ...ARCHIVED_ONLY, ...categoryScope("invoices", actor) } }),
    db.payment.count({ where: { ...ARCHIVED_ONLY, ...categoryScope("payments", actor) } }),
    db.maintenanceRequest.count({ where: { ...ARCHIVED_ONLY, ...categoryScope("maintenance", actor) } }),
  ]);

  return [
    { category: "owners", count: owners },
    { category: "clients", count: clients },
    { category: "compounds", count: compounds },
    { category: "buildings", count: buildings },
    { category: "units", count: units },
    { category: "management_agreements", count: management },
    { category: "investment_agreements", count: investment },
    { category: "lease_contracts", count: leases },
    { category: "invoices", count: invoices },
    { category: "payments", count: payments },
    { category: "maintenance", count: maintenance },
  ];
}

/** Archived records in one category, most recently deleted first. */
export async function listArchived(
  category: ArchiveCategory,
  /** Required: see categoryScope. */
  options: {
    actor: ScopeActor;
    search?: string;
    limit?: number;
    /** The reader's language, for the words in a record's detail line. */
    language?: string;
  },
): Promise<ArchivedRecord[]> {
  const take = Math.min(options.limit ?? 100, 500);
  const language = options.language ?? "en";
  const tr = (key: string, english: string, values?: Record<string, string | number>) =>
    translateFor(language, key, values, english);
  const query = options.search?.trim();
  const scope = categoryScope(category, options.actor);

  switch (category) {
    case "owners": {
      const rows = await db.owner.findMany({
        where: { ...ARCHIVED_ONLY, ...scope },
        include: {
          user: {
            select: { firstName: true, lastName: true, email: true, phone: true },
          },
        },
        orderBy: { deletedAt: "desc" },
        take,
      });
      return rows
        .map((row) => ({
          id: row.id,
          category,
          label: row.companyName || personName(row.user) || "—",
          // Many owners are recorded without an email; their phone is what
          // tells two of the same name apart.
          sublabel: row.user?.email || row.user?.phone || "",
          deletedAt: iso(row.deletedAt),
          createdAt: iso(row.createdAt),
          detail: null,
        }))
        .filter((row) => matches(row, query));
    }

    case "clients": {
      const rows = await db.tenant.findMany({
        where: { ...ARCHIVED_ONLY, ...scope },
        include: {
          user: {
            select: { firstName: true, lastName: true, email: true, phone: true },
          },
        },
        orderBy: { deletedAt: "desc" },
        take,
      });
      return rows
        .map((row) => ({
          id: row.id,
          category,
          label: personName(row.user) || "—",
          sublabel: row.user?.email || row.user?.phone || "",
          deletedAt: iso(row.deletedAt),
          createdAt: iso(row.createdAt),
          detail: null,
        }))
        .filter((row) => matches(row, query));
    }

    case "compounds": {
      const rows = await db.compound.findMany({
        where: { ...ARCHIVED_ONLY, ...scope },
        orderBy: { deletedAt: "desc" },
        take,
      });
      return rows
        .map((row) => ({
          id: row.id,
          category,
          label: row.name,
          sublabel: [row.code, row.addressCity].filter(Boolean).join(" · "),
          deletedAt: iso(row.deletedAt),
          createdAt: iso(row.createdAt),
          detail: null,
        }))
        .filter((row) => matches(row, query));
    }

    case "buildings": {
      const rows = await db.property.findMany({
        where: { ...ARCHIVED_ONLY, ...scope },
        select: {
          id: true,
          name: true,
          addressCity: true,
          totalUnits: true,
          deletedAt: true,
          createdAt: true,
        },
        orderBy: { deletedAt: "desc" },
        take,
      });
      return rows
        .map((row) => ({
          id: row.id,
          category,
          label: row.name,
          sublabel: row.addressCity,
          deletedAt: iso(row.deletedAt),
          createdAt: iso(row.createdAt),
          detail: `${row.totalUnits} unit(s)`,
        }))
        .filter((row) => matches(row, query));
    }

    case "units": {
      const rows = await db.unit.findMany({
        where: { ...ARCHIVED_ONLY, ...scope },
        include: { property: { select: { name: true } } },
        orderBy: { deletedAt: "desc" },
        take,
      });
      return rows
        .map((row) => ({
          id: row.id,
          category,
          label: row.unitNumber,
          sublabel: row.property?.name ?? "",
          deletedAt: iso(row.deletedAt),
          createdAt: iso(row.createdAt),
          detail: row.unitType,
        }))
        .filter((row) => matches(row, query));
    }

    case "management_agreements":
    case "investment_agreements": {
      const kind =
        category === "management_agreements" ? "management" : "investment";
      const rows = await db.agreement.findMany({
        where: { ...ARCHIVED_ONLY, kind, ...scope },
        include: {
          owner: { select: { firstName: true, lastName: true } },
          property: { select: { name: true } },
          compound: { select: { name: true } },
        },
        orderBy: { deletedAt: "desc" },
        take,
      });
      return rows
        .map((row) => ({
          id: row.id,
          category,
          label: row.agreementNumber ?? "(no number)",
          sublabel: personName(row.owner),
          deletedAt: iso(row.deletedAt),
          createdAt: iso(row.createdAt),
          detail:
            row.property?.name ??
            row.compound?.name ??
            "Whole portfolio",
        }))
        .filter((row) => matches(row, query));
    }

    case "lease_contracts": {
      const rows = await db.lease.findMany({
        where: archivedLeaseWhere(scope),
        include: {
          tenant: { select: { firstName: true, lastName: true } },
          property: { select: { name: true } },
          unit: { select: { unitNumber: true } },
        },
        // Either stamp moves `updatedAt`; the exact order is by whichever
        // one put the contract here, below.
        orderBy: { updatedAt: "desc" },
        take,
      });
      return rows
        .map((row) => ({
          id: row.id,
          category,
          label: row.contractNumber ?? "(no number)",
          sublabel: personName(row.tenant),
          deletedAt: iso(row.deletedAt ?? row.archivedAt),
          createdAt: iso(row.createdAt),
          detail: [row.property?.name, row.unit?.unitNumber]
            .filter(Boolean)
            .join(" · "),
        }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
        .filter((row) => matches(row, query));
    }

    case "invoices": {
      const rows = await db.invoice.findMany({
        where: { ...ARCHIVED_ONLY, ...scope },
        include: {
          tenant: { select: { firstName: true, lastName: true } },
          property: { select: { name: true } },
        },
        orderBy: { deletedAt: "desc" },
        take,
      });
      return rows
        .map((row) => ({
          id: row.id,
          category,
          label: row.invoiceNumber,
          sublabel: personName(row.tenant),
          deletedAt: iso(row.deletedAt),
          createdAt: iso(row.createdAt),
          // The reviewer's first question about a deleted invoice is whether
          // money was already taken against it.
          detail: `${row.currency} ${row.totalAmount} · ${tr("archive.detail.paid", "{amount} paid", { amount: `${row.currency} ${row.amountPaid}` })} · ${row.property?.name ?? ""}`.trim(),
        }))
        .filter((row) => matches(row, query));
    }

    case "payments": {
      const rows = await db.payment.findMany({
        where: { ...ARCHIVED_ONLY, ...scope },
        include: {
          tenant: { select: { firstName: true, lastName: true } },
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { deletedAt: "desc" },
        take,
      });
      return rows
        .map((row) => ({
          id: row.id,
          category,
          label: `${row.currency} ${row.amount}`,
          sublabel: personName(row.tenant),
          deletedAt: iso(row.deletedAt),
          createdAt: iso(row.createdAt),
          detail: [
            row.invoice?.invoiceNumber
              ? tr("leases.charge.invoiceRef", "Invoice {reference}", {
                  reference: row.invoice.invoiceNumber,
                })
              : null,
            paymentMethodLabel(row.paymentMethod, (key, o) => tr(key, o?.defaultValue ?? "")),
            codeLabel(language, row.status, STATUS_TABLES),
          ]
            .filter(Boolean)
            .join(" · "),
        }))
        .filter((row) => matches(row, query));
    }

    case "maintenance": {
      const rows = await db.maintenanceRequest.findMany({
        where: { ...ARCHIVED_ONLY, ...scope },
        include: {
          property: { select: { name: true } },
          tenant: { select: { firstName: true, lastName: true } },
        },
        orderBy: { deletedAt: "desc" },
        take,
      });
      return rows
        .map((row) => ({
          id: row.id,
          category,
          label: row.title,
          sublabel: row.property?.name ?? "",
          deletedAt: iso(row.deletedAt),
          createdAt: iso(row.createdAt),
          detail: [
            personName(row.tenant),
            maintenanceCategoryText(row.category, tr),
            maintenanceStatusText(row.status, tr),
          ]
            .filter(Boolean)
            .join(" · "),
        }))
        .filter((row) => matches(row, query));
    }
  }
}

function matches(record: ArchivedRecord, query?: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    record.label.toLowerCase().includes(needle) ||
    record.sublabel.toLowerCase().includes(needle) ||
    (record.detail ?? "").toLowerCase().includes(needle)
  );
}

/**
 * Restoring writes `deletedAt: null`. Every model here also carries a partial
 * unique index that only applies to live rows (a unit number per property, a
 * contract number per organization), so a restore can collide with a record
 * created since. That surfaces as a P2002 rather than silently overwriting.
 */
export class RestoreConflictError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "RestoreConflictError";
  }
}

export async function restoreArchived(
  category: ArchiveCategory,
  id: string,
  actor: ScopeActor,
): Promise<{ id: string; label: string } | null> {
  // Resolved through the scoped listing, so a record the caller cannot see
  // is a record they cannot act on — the gate comes free rather than being a
  // second check that could drift from the first.
  const found = (await listArchived(category, { actor, limit: 500 })).find(
    (record) => record.id === id,
  );
  if (!found) return null;

  try {
    switch (category) {
      case "owners":
        await restorePerson("owner", id);
        break;
      case "clients":
        await restorePerson("tenant", id);
        break;
      case "compounds":
        await db.compound.update({ where: { id }, data: { deletedAt: null } });
        break;
      case "buildings":
        await db.property.update({ where: { id }, data: { deletedAt: null } });
        break;
      case "units": {
        const unit = await db.unit.update({
          where: { id },
          data: { deletedAt: null },
          select: { propertyId: true },
        });
        // Archiving the unit took it off its building's unit count; putting
        // it back has to add it again.
        await resyncBuilding(unit.propertyId, `archive-restore:${id}`);
        break;
      }
      case "management_agreements":
      case "investment_agreements":
        await db.agreement.update({ where: { id }, data: { deletedAt: null } });
        break;
      case "lease_contracts":
        // Whichever stamp put it here; see archivedLeaseWhere. Clearing
        // `archivedAt` is what "Unarchive" on the contract does.
        await db.lease.update({
          where: { id },
          data: { deletedAt: null, archivedAt: null },
        });
        break;
      case "invoices":
        await db.invoice.update({ where: { id }, data: { deletedAt: null } });
        postAfterCommit("invoice", id);
        break;
      case "payments":
        // Deleting a payment took its money back off the installment it
        // paid; clearing `deletedAt` alone would bring the payment back while
        // the installment went on reading as unpaid. The restore re-applies
        // it, and refuses when the installment has since been settled.
        try {
          await restoreRecordedPayment(id);
        } catch (error) {
          if (error instanceof InstallmentPaymentError) {
            throw new RestoreConflictError(error.message);
          }
          throw error;
        }
        break;
      case "maintenance":
        await db.maintenanceRequest.update({
          where: { id },
          data: { deletedAt: null },
        });
        break;
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new RestoreConflictError(
        "A live record has since taken this one's number or identifier. Rename that record first, then restore.",
      );
    }
    throw error;
  }

  return { id, label: found.label };
}

/**
 * Put an owner or a tenant back: the profile row the archive lists, and the
 * user row every list and contract reads.
 *
 * Deleting archives both, and restoring used to clear the profile alone — so a
 * restored tenant stayed hidden, their user row still stamped. The user is
 * only touched when it is that kind of person's own account and is archived:
 * a member of staff who also holds an owner profile keeps their account
 * exactly as it is.
 */
async function restorePerson(kind: "owner" | "tenant", id: string): Promise<void> {
  await runWithOrgTransaction(async (tx) => {
    const profile =
      kind === "owner"
        ? await tx.owner.update({
            where: { id },
            data: { deletedAt: null, isActive: true },
            select: { userId: true },
          })
        : await tx.tenant.update({
            where: { id },
            data: { deletedAt: null },
            select: { userId: true },
          });

    await tx.user.updateMany({
      where: {
        id: profile.userId,
        role: kind === "owner" ? UserRole.OWNER : UserRole.TENANT,
        deletedAt: { not: null },
      },
      data: { deletedAt: null, isActive: true },
    });
  });
}

/**
 * Recount a building's units and status after one of them comes or goes.
 * Best effort, like the unit routes' own sync: the record is already right,
 * and a failed recount must not undo it.
 */
async function resyncBuilding(propertyId: string, triggeredBy: string) {
  try {
    const { propertyStatusSynchronizer } = await import(
      "@/lib/services/property-status-sync.service"
    );
    await propertyStatusSynchronizer.syncPropertyStatus(propertyId, {
      triggeredBy,
      logChanges: true,
    });
  } catch (error) {
    console.warn(`Could not resync building ${propertyId} after ${triggeredBy}`, error);
  }
}

export class PurgeBlockedError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "PurgeBlockedError";
  }
}

/**
 * Journal entries a document was posted to — live or reversed. The books
 * keep a document's history, so once it reached them it is never destroyed
 * (a deleted payment's entry is reversed, not erased, and the reversal still
 * names it). Zero for an office that keeps no books.
 */
async function postedEntryCount(kind: "invoice" | "payment", id: string): Promise<number> {
  const sources = kind === "invoice" ? ["invoice"] : ["payment", "payment_refund"];
  const [entries, settlements] = await Promise.all([
    db.journalEntry.count({ where: { sourceType: { in: sources }, sourceId: id } }),
    // What an owner or a customer paid on an invoice posts as the invoice's
    // settlements, one entry each (`<invoice id>:<n>`).
    kind === "invoice"
      ? db.journalEntry.count({
          where: { sourceType: "invoice_settlement", sourceId: { startsWith: `${id}:` } },
        })
      : Promise.resolve(0),
  ]);
  return entries + settlements;
}

/**
 * What still points at a record, counted BEFORE any delete is attempted.
 *
 * Relying on the database to refuse the delete is not enough, and this was a
 * real bug: `Invoice.leaseId` is an optional foreign key, which PostgreSQL
 * resolves as ON DELETE SET NULL. Destroying an archived lease therefore did
 * not fail — it silently blanked the link on a paid invoice, leaving money in
 * the ledger attached to no contract. Optional references orphan quietly;
 * only required ones raise. So every reference is counted here instead.
 */
async function blockingReferences(
  category: ArchiveCategory,
  id: string,
): Promise<Array<{ label: string; count: number }>> {
  const tally = async (label: string, count: Promise<number>) => ({
    label,
    count: await count,
  });

  const checks: Array<Promise<{ label: string; count: number }>> = [];

  switch (category) {
    case "buildings":
      checks.push(
        tally("units", db.unit.count({ where: { propertyId: id, deletedAt: undefined } })),
        tally("contracts", db.lease.count({ where: { propertyId: id, deletedAt: undefined } })),
        tally("invoices", db.invoice.count({ where: { propertyId: id, deletedAt: undefined } })),
        tally("payments", db.payment.count({ where: { propertyId: id, deletedAt: undefined } })),
        tally("expenses", db.expense.count({ where: { propertyId: id, deletedAt: undefined } })),
        tally("agreements", db.agreement.count({ where: { propertyId: id, deletedAt: undefined } })),
      );
      break;

    case "units":
      checks.push(
        tally("contracts", db.lease.count({ where: { unitId: id, deletedAt: undefined } })),
      );
      break;

    case "lease_contracts":
      checks.push(
        tally("invoices", db.invoice.count({ where: { leaseId: id, deletedAt: undefined } })),
        tally("payments", db.payment.count({ where: { leaseId: id, deletedAt: undefined } })),
        tally(
          "recurring payments",
          db.recurringPayment.count({ where: { leaseId: id, deletedAt: undefined } }),
        ),
        tally(
          "security deposits",
          db.securityDeposit.count({ where: { leaseId: id, deletedAt: undefined } }),
        ),
      );
      break;

    case "compounds":
      checks.push(
        tally("properties", db.property.count({ where: { compoundId: id, deletedAt: undefined } })),
        tally("agreements", db.agreement.count({ where: { compoundId: id, deletedAt: undefined } })),
      );
      break;

    case "invoices":
      checks.push(
        // Payment.invoiceId is optional, so PostgreSQL would SET NULL rather
        // than refuse — money in the ledger attached to no invoice.
        tally(
          "payments",
          db.payment.count({ where: { invoiceId: id, deletedAt: undefined } }),
        ),
        tally("journal entries", postedEntryCount("invoice", id)),
      );
      break;

    case "payments":
      checks.push(
        tally(
          "receipts",
          db.paymentReceipt.count({ where: { paymentId: id } }),
        ),
        // Late fees carry the parent payment's id in a plain column with no
        // foreign key behind it, so nothing but this count stops the delete.
        tally(
          "late fees",
          db.payment.count({
            where: { parentPaymentId: id, deletedAt: undefined },
          }),
        ),
        // Same story for the id list an invoice keeps of what paid it.
        tally(
          "invoices",
          db.invoice.count({
            where: { paymentIds: { has: id }, deletedAt: undefined },
          }),
        ),
        tally("journal entries", postedEntryCount("payment", id)),
      );
      break;

    case "maintenance":
      checks.push(
        tally(
          "work orders",
          db.workOrder.count({
            where: { maintenanceRequestId: id, deletedAt: undefined },
          }),
        ),
      );
      break;

    // Owner and tenant PROFILES are referenced by nothing: properties,
    // contracts and agreements all point at the underlying user, not at the
    // profile row. Agreements are referenced by nothing at all.
    case "owners":
    case "clients":
    case "management_agreements":
    case "investment_agreements":
      break;
  }

  const results = await Promise.all(checks);
  return results.filter((entry) => entry.count > 0);
}

/**
 * Permanently destroy an archived record.
 *
 * Callers MUST have already established that the actor is the System Owner or
 * a platform Super Admin — this function does not re-check, because it has no
 * access to the session. The route is the gate.
 */

export async function purgeArchived(
  category: ArchiveCategory,
  id: string,
  actor: ScopeActor,
): Promise<{ id: string; label: string } | null> {
  // Resolved through the scoped listing, so a record the caller cannot see
  // is a record they cannot act on — the gate comes free rather than being a
  // second check that could drift from the first.
  const found = (await listArchived(category, { actor, limit: 500 })).find(
    (record) => record.id === id,
  );
  if (!found) return null;

  const blockers = await blockingReferences(category, id);
  const posted = blockers.find((entry) => entry.label === "journal entries");
  if (posted) {
    throw new PurgeBlockedError(
      `This record is in the office's books (${posted.count} journal ${posted.count === 1 ? "entry" : "entries"}). The books keep it for good, so it stays in the archive.`,
    );
  }
  if (blockers.length > 0) {
    const summary = blockers
      .map((entry) => `${entry.count} ${entry.label}`)
      .join(", ");
    throw new PurgeBlockedError(
      `${summary} still reference this record. Remove or reassign them first — destroying it would leave that history pointing at nothing.`,
    );
  }

  // The files the record holds, removed once the row is gone — see
  // lib/stored-files.ts. Archiving keeps them, so a restore finds them.
  let files: Array<string | null | undefined> = [];

  try {
    switch (category) {
      case "owners":
        await db.owner.delete({ where: { id } });
        break;
      case "clients": {
        const profile = await db.tenant.findFirst({
          where: { id, ...ARCHIVED_ONLY },
          select: {
            userId: true,
            user: { select: { avatar: true, deletedAt: true } },
          },
        });
        await db.tenant.delete({ where: { id } });
        // The photo the tenant delete used to destroy on the spot. Only an
        // archived tenant's: a live account keeps its picture whatever
        // happens to a profile row.
        if (profile?.user?.avatar && profile.user.deletedAt) {
          files = [profile.user.avatar];
          await db.user.updateMany({
            where: { id: profile.userId, ...ARCHIVED_ONLY },
            data: { avatar: null },
          });
        }
        break;
      }
      case "compounds":
        await db.compound.delete({ where: { id } });
        break;
      case "buildings": {
        const building = await db.property.findFirst({
          where: { id, ...ARCHIVED_ONLY },
          select: { images: true, attachments: true },
        });
        await db.property.delete({ where: { id } });
        files = [
          ...(building?.images ?? []),
          ...attachmentUrls(building?.attachments),
        ];
        break;
      }
      case "units": {
        const unit = await db.unit.findFirst({
          where: { id, ...ARCHIVED_ONLY },
          select: { images: true, attachments: true },
        });
        await db.unit.delete({ where: { id } });
        files = [...(unit?.images ?? []), ...attachmentUrls(unit?.attachments)];
        break;
      }
      case "management_agreements":
      case "investment_agreements":
        await db.agreement.delete({ where: { id } });
        break;
      case "lease_contracts": {
        const lease = await db.lease.findFirst({
          where: archivedLeaseWhere({ id }),
          select: { documents: true },
        });
        // A contract's documents name it by a plain column, not a foreign
        // key, so nothing would stop them outliving it. They go with it —
        // the ones deleted from the contract earlier too, whose files were
        // kept for exactly this moment.
        const documents = await db.document.findMany({
          where: { leaseId: id, deletedAt: undefined },
          select: { id: true, fileUrl: true, r2ObjectKey: true },
        });
        await runWithOrgTransaction(async (tx) => {
          await tx.lease.delete({ where: { id } });
          if (documents.length > 0) {
            await tx.document.deleteMany({
              where: { id: { in: documents.map((document) => document.id) } },
            });
          }
        });
        files = [
          ...(lease?.documents ?? []),
          ...documents.map((document) => document.r2ObjectKey || document.fileUrl),
        ];
        break;
      }
      case "invoices":
        await db.invoice.delete({ where: { id } });
        break;
      case "payments":
        await db.payment.delete({ where: { id } });
        break;
      case "maintenance":
        await db.maintenanceRequest.delete({ where: { id } });
        break;
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      throw new PurgeBlockedError(
        "Other records still reference this one — invoices, payments or contracts. Remove those first; deleting this would leave financial history pointing at nothing.",
      );
    }
    throw error;
  }

  await deleteStoredFiles(files);

  return { id, label: found.label };
}
