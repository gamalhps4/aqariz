/**
 * PropertyPro SaaS - Employee building-scope verification
 *
 * Usage: pnpm verify:staff-scope       (exits non-zero on any failure)
 *
 * This WRITES: it creates a probe organization with its own buildings,
 * contracts and money, counts against that, and removes it again — also when
 * it crashes. Run it against a database you may write to.
 *
 * The executable spec for the second tier of isolation. RLS keeps
 * organizations apart and `verify:isolation` proves it; this proves the tier
 * inside one organization — that an employee narrowed to particular compounds
 * and buildings sees those and nothing else.
 *
 * It exists because that tier was got wrong repeatedly while it was being
 * built, and every mistake was the same shape: a rule applied to most call
 * sites and silently missed at one. A file-level search said a route was
 * scoped when only its GET was. A mechanical replacement covered nine archive
 * categories and skipped the tenth, whose `where` already had a second key.
 * Neither TypeScript nor the linter nor the build noticed any of it, because
 * nothing was malformed — the queries ran and returned too much.
 *
 * So the assertions below are counts against a known fixture, not shapes.
 * The only way to catch "returned more rows than it should" is to count the
 * rows.
 *
 * A later mistake had a different shape, and section G is its test: the rule
 * applied at the call site and then overwritten in the same object literal,
 * because the scope and the request's own filter were keyed on one column.
 *
 * Every case that was once a real defect has a test here. Do not delete one
 * because it looks redundant with its neighbour; the neighbour is what made
 * it look safe the first time.
 */

import "../lib/env/load-dotenv";
import { randomUUID } from "crypto";

import { mayWriteAgreement } from "@/lib/db/agreement-write";
import { authDb, basePrisma, db, runWithOrgTransaction } from "@/lib/db/prisma";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import {
  agreementScope,
  compoundScope,
  invoiceScope,
  leaseScope,
  maintenanceScope,
  paymentScope,
  propertyScope,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import { resolveStaffPropertyIds } from "@/lib/db/staff-scope";
import {
  ARCHIVE_CATEGORIES,
  archiveCounts,
  listArchived,
} from "@/lib/services/archive.service";
import { getCollectionReport } from "@/lib/services/collection.service";
import { getEntityStatement } from "@/lib/services/entity-statement.service";
import { getLeaseReport } from "@/lib/services/lease-reports.service";
import { getOccupancyReport } from "@/lib/services/occupancy-report.service";
import { getMaintenanceReport } from "@/lib/services/maintenance-report.service";
import { listOwners } from "@/lib/services/owner.service";
import {
  getCollectionsByBuildingReport,
  getCollectionsReport,
  getExpensesByBuildingReport,
  getOutstandingReport,
} from "@/lib/services/payment-reports.service";
import { revenueService } from "@/lib/services/revenue.service";
import { transactionService } from "@/lib/services/transaction.service";

let passed = 0;
let failed = 0;

/**
 * What removes the probe organization. Kept out here so a crash part-way
 * through can still run it: the fixture is written to whatever database the
 * script is pointed at, and it used to be left there whenever one of the
 * queries below threw, because the cleanup was only registered once every
 * assertion had run.
 */
const cleanup: Array<() => Promise<unknown>> = [];

function ok(name: string) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function fail(name: string, detail?: unknown) {
  failed += 1;
  console.error(`  ✗ ${name}`);
  if (detail !== undefined) console.error(`    ${String(detail)}`);
}
function expect(name: string, actual: unknown, wanted: unknown) {
  if (actual === wanted) ok(`${name} (${String(actual)})`);
  else fail(name, `expected ${String(wanted)}, got ${String(actual)}`);
}

async function main() {
  const runId = randomUUID().slice(0, 8);
  const slug = `staff-scope-${runId}`;
  console.log("\nEmployee building-scope verification\n");

  // ---- fixture ------------------------------------------------------------
  // `authDb` bypasses RLS and is used only to reach across organizations —
  // creating the probe organization before any context exists, and checking
  // afterwards that it is gone. Everything between runs on `db` under the
  // probe's own context, because a count taken on the bypass client counts
  // every organization's rows and would pass for the wrong reason.
  // One organization, two compounds, two buildings each. Everything below is
  // counted against these, so the expected numbers are literal rather than
  // derived — a derived expectation can be wrong in the same way the code is.
  const org = await bypassOrgScope(() =>
    authDb.organization.create({
      data: {
        name: "Staff scope probe",
        slug,
        ownerId: "probe",
        status: "active",
      },
    }),
  );

  // Registered before anything else is written, so there is no point after
  // this at which a failure leaves rows behind.
  cleanup.push(async () =>
    runWithOrgTransaction(
      async (tx) => {
        const where = { organizationId: org.id };
        await tx.expense.deleteMany({ where });
        await tx.payment.deleteMany({ where });
        await tx.invoice.deleteMany({ where });
        await tx.maintenanceRequest.deleteMany({ where });
        await tx.lease.deleteMany({ where });
        await tx.agreement.deleteMany({ where });
        await tx.unit.deleteMany({ where });
        await tx.property.deleteMany({ where });
        await tx.compound.deleteMany({ where });
        await tx.user.deleteMany({ where });
        await tx.organization.deleteMany({ where: { id: org.id } });
      },
      { bypass: true },
    ),
  );

  const owner = await bypassOrgScope(() =>
    authDb.user.create({
      data: {
        email: `owner-${runId}@scope.test`,
        firstName: "Probe",
        lastName: "Owner",
        organizationId: org.id,
        role: "admin",
      },
    }),
  );
  const tenantUser = await bypassOrgScope(() =>
    authDb.user.create({
      data: {
        email: `tenant-${runId}@scope.test`,
        firstName: "Probe",
        lastName: "Tenant",
        organizationId: org.id,
        role: "tenant",
      },
    }),
  );

  const result = await runWithOrgContext(
    { organizationId: org.id, isPlatformAdmin: false },
    async () => {
      const address = {
        addressStreet: "Probe St",
        addressCity: "Riyadh",
        addressState: "Riyadh Region",
        addressZipCode: "11111",
      };

      const mkCompound = (name: string) =>
        db.compound.create({
          data: { organizationId: org.id, name, ...address },
        });
      const compoundA = await mkCompound(`A-${runId}`);
      const compoundB = await mkCompound(`B-${runId}`);

      const mkProperty = (name: string, compoundId: string | null) =>
        db.property.create({
          data: {
            organizationId: org.id,
            name,
            type: "apartment",
            ...address,
            compoundId,
            ownerId: owner.id,
          },
        });
      const a1 = await mkProperty(`A1-${runId}`, compoundA.id);
      const a2 = await mkProperty(`A2-${runId}`, compoundA.id);
      const b1 = await mkProperty(`B1-${runId}`, compoundB.id);
      const b2 = await mkProperty(`B2-${runId}`, compoundB.id);
      const inA = [a1.id, a2.id];

      // One unit, one contract, one invoice, one payment and one maintenance
      // request per building — so "half of everything" is the expected answer
      // for someone holding one of the two compounds.
      for (const property of [a1, a2, b1, b2]) {
        const unit = await db.unit.create({
          data: {
            organizationId: org.id,
            propertyId: property.id,
            unitNumber: "1",
            rentAmount: 1000,
          },
        });
        const lease = await db.lease.create({
          data: {
            organizationId: org.id,
            propertyId: property.id,
            unitId: unit.id,
            tenantId: tenantUser.id,
            startDate: new Date(Date.now() - 86_400_000),
            endDate: new Date(Date.now() + 30 * 86_400_000),
            status: "active",
            rentAmount: 1000,
            terms: {},
          },
        });
        const invoice = await db.invoice.create({
          data: {
            organizationId: org.id,
            invoiceNumber: `INV-${runId}-${property.id.slice(-4)}`,
            tenantId: tenantUser.id,
            propertyId: property.id,
            leaseId: lease.id,
            category: "rent",
            issueDate: new Date(),
            dueDate: new Date(),
            subtotal: 1000,
            totalAmount: 1000,
            // Left owing, so the receivables registers have a row to list.
            balanceRemaining: 1000,
          },
        });
        await db.payment.create({
          data: {
            organizationId: org.id,
            tenantId: tenantUser.id,
            propertyId: property.id,
            leaseId: lease.id,
            invoiceId: invoice.id,
            amount: 1000,
            amountPaid: 1000,
            status: "paid",
            type: "rent",
            dueDate: new Date(),
            paidDate: new Date(),
          },
        });
        await db.maintenanceRequest.create({
          data: {
            organizationId: org.id,
            propertyId: property.id,
            tenantId: tenantUser.id,
            title: "probe",
            description: "probe",
            category: "Plumbing",
          },
        });
        await db.expense.create({
          data: {
            organizationId: org.id,
            propertyId: property.id,
            category: "Maintenance",
            description: "probe",
            amount: 100,
            date: new Date(),
            createdById: owner.id,
          },
        });
      }
      // And one with no building: the office's own overhead, which belongs to
      // nobody's portfolio.
      await db.expense.create({
        data: {
          organizationId: org.id,
          category: "Office",
          description: "probe overhead",
          amount: 100,
          date: new Date(),
          createdById: owner.id,
        },
      });

      // Archived rows, including the three shapes an agreement can take. The
      // compound-level one is here because filtering agreements on the
      // building alone once hid every one of them; the last, naming neither,
      // is the owner's blanket agreement over their whole portfolio.
      const archivedAt = new Date();
      await db.property.update({
        where: { id: a2.id },
        data: { deletedAt: archivedAt },
      });
      for (const [property, compound] of [
        [a1.id, null],
        [null, compoundA.id],
        [b1.id, null],
        [null, compoundB.id],
        [null, null],
      ] as Array<[string | null, string | null]>) {
        await db.agreement.create({
          data: {
            organizationId: org.id,
            kind: "management",
            status: "terminated",
            ownerId: owner.id,
            propertyId: property,
            compoundId: compound,
            startDate: new Date(),
            deletedAt: archivedAt,
          },
        });
      }

      // ---- actors -----------------------------------------------------------
      const assignedIds = await resolveStaffPropertyIds({
        compoundIds: [compoundA.id],
        propertyIds: [],
      });
      const staff: ScopeActor = { id: owner.id, isTenant: false, isOwner: false };
      const narrowed: ScopeActor = { ...staff, scopedPropertyIds: assignedIds };
      const nothing: ScopeActor = { ...staff, scopedPropertyIds: [] };
      // A property owner holding the same one building. The scope reads the
      // list on the actor, so this needs no second set of rows.
      const landlord: ScopeActor = {
        id: owner.id,
        isTenant: false,
        isOwner: true,
        ownedPropertyIds: assignedIds,
      };

      console.log("== A. Resolving an assignment ==");
      // a2 is archived, and the resolver excludes soft-deleted buildings.
      expect("a compound resolves to its live buildings", assignedIds.length, 1);
      expect(
        "and only to its own",
        assignedIds.every((id) => inA.includes(id)),
        true,
      );

      const afterMove = await (async () => {
        await db.property.update({
          where: { id: b2.id },
          data: { compoundId: compoundA.id },
        });
        const ids = await resolveStaffPropertyIds({
          compoundIds: [compoundA.id],
          propertyIds: [],
        });
        await db.property.update({
          where: { id: b2.id },
          data: { compoundId: compoundB.id },
        });
        return ids.length;
      })();
      // Resolved per request, not stored: a building added to an assigned
      // compound is reachable at once, with nobody re-saving the employee.
      expect("a building added to the compound is picked up", afterMove, 2);

      console.log("\n== B. Fail-closed ==");
      // The distinction the whole design rests on: undefined is "not
      // narrowed", an empty array is "narrowed to nothing".
      const countFor = async (actor: ScopeActor) => ({
        properties: await db.property.count({
          where: { deletedAt: null, ...propertyScope(actor) },
        }),
        leases: await db.lease.count({
          where: { deletedAt: null, ...leaseScope(actor) },
        }),
        invoices: await db.invoice.count({
          where: { deletedAt: null, ...invoiceScope(actor) },
        }),
        payments: await db.payment.count({
          where: { deletedAt: null, ...paymentScope(actor) },
        }),
        maintenance: await db.maintenanceRequest.count({
          where: { deletedAt: null, ...maintenanceScope(actor) },
        }),
        compounds: await db.compound.count({
          where: { deletedAt: null, ...compoundScope(actor) },
        }),
      });

      const none = await countFor(nothing);
      for (const [model, value] of Object.entries(none)) {
        expect(`restricted with nothing assigned sees no ${model}`, value, 0);
      }

      console.log("\n== C. An unrestricted employee is untouched ==");
      const all = await countFor(staff);
      expect("properties", all.properties, 3); // a2 is archived
      expect("contracts", all.leases, 4);
      expect("invoices", all.invoices, 4);
      expect("payments", all.payments, 4);
      expect("maintenance", all.maintenance, 4);
      expect("compounds", all.compounds, 2);

      console.log("\n== D. A narrowed employee sees only their buildings ==");
      const mine = await countFor(narrowed);
      expect("properties", mine.properties, 1);
      expect("contracts", mine.leases, 1);
      expect("invoices", mine.invoices, 1);
      expect("payments", mine.payments, 1);
      expect("maintenance", mine.maintenance, 1);
      // Reachable through a building they hold, not through the assignment
      // list — the two differ the moment someone is given a building directly.
      expect("compounds", mine.compounds, 1);

      console.log("\n== E. The archive, every category ==");
      // Listing and count are written separately and have diverged before, so
      // they are compared against each other as well as against the fixture.
      for (const category of ARCHIVE_CATEGORIES) {
        const rows = await listArchived(category, { actor: narrowed });
        const counts = await archiveCounts(narrowed);
        const badge =
          counts.find((entry) => entry.category === category)?.count ?? -1;
        if (rows.length === badge) {
          ok(`${category}: badge agrees with the listing (${badge})`);
        } else {
          fail(
            `${category}: badge agrees with the listing`,
            `badge ${badge}, listing ${rows.length}`,
          );
        }
      }

      const archivedWide = await listArchived("management_agreements", {
        actor: staff,
      });
      const archivedMine = await listArchived("management_agreements", {
        actor: narrowed,
      });
      expect("unrestricted sees every archived agreement", archivedWide.length, 5);
      // One attached to their building, one attached to their compound. The
      // compound-level one is the case that was once dropped entirely. The
      // archive does not list a blanket agreement for a narrowed reader.
      expect("narrowed sees their building's and their compound's", archivedMine.length, 2);
      // a2 sits in the assigned compound and is archived, and the resolver
      // excludes soft-deleted buildings — so it is out of reach. That is the
      // fail-closed direction and is asserted deliberately: if this ever
      // returns 1, someone has made deleted rows widen a scope.
      expect(
        "an archived building is out of a narrowed reader's reach",
        (await listArchived("buildings", { actor: narrowed })).length,
        0,
      );

      console.log("\n== F. Services answer for the caller ==");
      expect(
        "leasing register",
        (await getLeaseReport("active", { actor: narrowed })).summary.contractCount,
        1,
      );
      expect(
        "occupancy register",
        (await getOccupancyReport({ actor: narrowed })).summary.totalUnits,
        1,
      );
      expect(
        "maintenance register",
        (
          await getMaintenanceReport({
            actor: narrowed,
            startDate: new Date(Date.now() - 7 * 86_400_000),
            endDate: new Date(Date.now() + 86_400_000),
          })
        ).summary.totalRequests,
        1,
      );
      expect(
        "revenue",
        (await revenueService.getRevenueSummary(narrowed)).totalCollected,
        1000,
      );
      expect(
        "revenue, unrestricted",
        (await revenueService.getRevenueSummary(staff)).totalCollected,
        4000,
      );
      // An owner's portfolio is counted over what the reader can see, so the
      // same owner is a different size to different readers.
      const portfolio = async (actor: ScopeActor) =>
        (await listOwners({ actor })).reduce(
          (total, entry) => total + entry.propertyCount,
          0,
        );
      expect("owner portfolio, narrowed", await portfolio(narrowed), 1);
      expect("owner portfolio, unrestricted", await portfolio(staff), 3);

      console.log("\n== G. A requested building narrows the scope ==");
      // Every query below names a building. `held` is the one these readers
      // hold and `other` is one they do not; asking for `other` has to come
      // back empty, and asking for `held` has to come back with `held` alone
      // — not with nothing, which a broken filter would also "pass", and not
      // with the reader's whole scope.
      //
      // Both used to fail. A scope spread into the same literal as the
      // requested id replaced it, or was replaced by it, whenever the two
      // were keyed on one column: `id` for a building, `propertyId` for
      // everything that hangs off one.
      const held = a1.id;
      const other = b1.id;
      const from = new Date(Date.now() - 7 * 86_400_000);
      const to = new Date(Date.now() + 86_400_000);

      const asked = async (actor: ScopeActor, propertyId: string) => ({
        "building by id": await db.property.count({
          where: withScope({ id: propertyId }, propertyScope(actor)),
        }),
        "buildings by id list": await db.property.count({
          where: withScope(
            { id: { in: [propertyId, b2.id] } },
            propertyScope(actor),
          ),
        }),
        "leasing register": (
          await getLeaseReport("active", { actor, propertyId })
        ).summary.contractCount,
        "occupancy register": (await getOccupancyReport({ actor, propertyId }))
          .summary.totalUnits,
        "maintenance register": (
          await getMaintenanceReport({
            actor,
            startDate: from,
            endDate: to,
            propertyId,
          })
        ).summary.totalRequests,
        "due-rent register": (
          await getOutstandingReport({
            actor,
            propertyId,
            dueFrom: from,
            dueTo: to,
          })
        ).summary.invoiceCount,
        "payments received": (
          await getCollectionsReport({
            actor,
            startDate: from,
            endDate: to,
            propertyId,
          })
        ).summary.paymentCount,
        "payments by building": (
          await getCollectionsByBuildingReport({
            actor,
            startDate: from,
            endDate: to,
            propertyId,
          })
        ).summary.buildingCount,
        "expenses by building": (
          await getExpensesByBuildingReport({
            actor,
            startDate: from,
            endDate: to,
            propertyId,
          })
        ).summary.expenseCount,
        "collection by contract": (
          await getCollectionReport({
            actor,
            scope: "by-contract",
            propertyId,
          })
        ).summary.invoiceCount,
        "revenue summary": (
          await revenueService.getRevenueSummary(actor, propertyId)
        ).count,
        "revenue by month": (
          await revenueService.getMonthlyRevenue(actor, 12, propertyId)
        ).length,
        "building statement": (await getEntityStatement("property", propertyId, {
          actor,
          startDate: from,
          endDate: to,
        }))
          ? 1
          : 0,
      });

      for (const [who, actor] of [
        ["a narrowed employee", narrowed],
        ["an owner", landlord],
      ] as Array<[string, ScopeActor]>) {
        const outside = await asked(actor, other);
        for (const [what, value] of Object.entries(outside)) {
          expect(`${who} asking for another building: ${what}`, value, 0);
        }
        const inside = await asked(actor, held);
        for (const [what, value] of Object.entries(inside)) {
          expect(`${who} asking for their own: ${what}`, value, 1);
        }
      }

      // The two by-building reports took the actor and never read it, and the
      // revenue breakdowns took none: with no building named, each listed
      // the whole organization.
      const window = { startDate: from, endDate: to };
      expect(
        "payments by building, narrowed",
        (await getCollectionsByBuildingReport({ actor: narrowed, ...window }))
          .summary.buildingCount,
        1,
      );
      expect(
        "payments by building, unrestricted",
        (await getCollectionsByBuildingReport({ actor: staff, ...window }))
          .summary.buildingCount,
        3, // a2 is archived
      );
      const narrowedExpenses = await getExpensesByBuildingReport({
        actor: narrowed,
        ...window,
      });
      expect("expenses by building, narrowed", narrowedExpenses.summary.expenseCount, 1);
      // Office overhead carries no building, so it is nobody's but the
      // office's.
      expect(
        "office overhead, narrowed",
        narrowedExpenses.summary.unassignedTotal,
        0,
      );
      const allExpenses = await getExpensesByBuildingReport({
        actor: staff,
        ...window,
      });
      expect("expenses by building, unrestricted", allExpenses.summary.expenseCount, 5);
      expect("office overhead, unrestricted", allExpenses.summary.unassignedTotal, 100);
      expect(
        "revenue by building, narrowed",
        (await revenueService.getRevenueByProperty(narrowed)).length,
        1,
      );
      expect(
        "revenue by building, unrestricted",
        (await revenueService.getRevenueByProperty(staff)).length,
        4,
      );
      expect(
        "revenue by category, narrowed",
        (await revenueService.getRevenueByCategory(narrowed)).reduce(
          (total, entry) => total + entry.amount,
          0,
        ),
        1000,
      );

      // A compound none of whose buildings the reader holds is not theirs to
      // run a statement for — it used to come back as zeros under its own
      // name, owner and address.
      expect(
        "another compound's statement",
        (await getEntityStatement("compound", compoundB.id, {
          actor: narrowed,
          ...window,
        })) === null,
        true,
      );
      expect(
        "their own compound's statement covers their building alone",
        (
          await getEntityStatement("compound", compoundA.id, {
            actor: narrowed,
            ...window,
          })
        )?.propertyCount,
        1,
      );

      // The bank ledger narrowed itself for a tenant and for nobody else,
      // and asks for no permission. Its three branches — payments, invoices,
      // expenses — each take a rule as SQL.
      const ledger = async (
        actor: ScopeActor,
        options: { propertyId?: string; bankOnly?: boolean } = {},
      ) =>
        (
          await transactionService.getUnifiedTransactions({
            actor,
            page: 1,
            limit: 50,
            ...options,
          })
        ).summary.transactionCount;
      // One payment, one invoice and one expense on their building; not the
      // office's own expense.
      expect("ledger, narrowed", await ledger(narrowed), 3);
      expect("ledger, an owner", await ledger(landlord), 3);
      expect(
        "ledger, narrowed, another building",
        await ledger(narrowed, { propertyId: other }),
        0,
      );
      // Four of each, and the office's own expense.
      expect("ledger, unrestricted", await ledger(staff), 13);
      // As the screen asks for it: settled money only, so no invoices.
      expect("bank ledger, narrowed", await ledger(narrowed, { bankOnly: true }), 2);
      expect("bank ledger, unrestricted", await ledger(staff, { bankOnly: true }), 9);

      // Agreements had no scope at all. Read: the one on their building, the
      // one on their compound, and their building's owner's blanket one —
      // which the archive above leaves out.
      const agreements = (actor: ScopeActor) =>
        db.agreement.count({
          where: withScope({ deletedAt: { not: null } }, agreementScope(actor)),
        });
      expect("agreements, narrowed", await agreements(narrowed), 3);
      expect("agreements, unrestricted", await agreements(staff), 5);

      // Changing one is a narrower right than reading it: every building the
      // agreement names has to be one the caller holds.
      const ownedBy = { ownerId: owner.id };
      expect(
        "may write the agreement on their building",
        await mayWriteAgreement(narrowed, { ...ownedBy, propertyId: a1.id }),
        true,
      );
      expect(
        "may not write one on another building",
        await mayWriteAgreement(narrowed, { ...ownedBy, propertyId: b1.id }),
        false,
      );
      expect(
        "may not write one on a compound they cannot reach",
        await mayWriteAgreement(narrowed, { ...ownedBy, compoundId: compoundB.id }),
        false,
      );
      // It reads as theirs — it governs their building — but it governs b1
      // and b2 as well.
      expect(
        "may not write the owner's blanket agreement",
        await mayWriteAgreement(narrowed, ownedBy),
        false,
      );
      expect(
        "an unrestricted employee may",
        await mayWriteAgreement(staff, ownedBy),
        true,
      );

      return true;
    },
  );

  // ---- cleanup, and proof that it worked ----------------------------------
  // A cleanup that reports success while removing nothing is how six fake
  // agreements once survived in a demo database: `deleteMany` goes through
  // the soft-delete filter, and rows created with `deletedAt` already set are
  // invisible to it. The raw transaction registered at the top skips that
  // filter; this confirms it rather than assuming.
  try {
    for (const step of cleanup.splice(0)) await step();
  } finally {
    const leftover = await bypassOrgScope(() =>
      authDb.organization.count({ where: { id: org.id, deletedAt: undefined } }),
    );
    expect("fixture removed", leftover, 0);
    await basePrisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0 || !result) process.exit(1);
}

main().catch(async (error) => {
  console.error("verify-staff-scope crashed:", error);
  // Whatever was written before the crash still has to go.
  for (const step of cleanup.splice(0)) {
    await step().catch((cleanupError) =>
      console.error("and its fixture could not be removed:", cleanupError),
    );
  }
  process.exit(1);
});
