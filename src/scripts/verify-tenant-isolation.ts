/**
 * PropertyPro SaaS - Tenant isolation verification (PostgreSQL / RLS edition)
 *
 * Usage: pnpm verify:isolation      (exits non-zero on any failure)
 *
 * This is the executable spec of the isolation contract, ported from the
 * Mongoose org-scope-plugin era. It proves, against the REAL database and the
 * REAL client (src/lib/db/prisma.ts), that:
 *
 *   1. Touching tenant data with no organization context fails loudly.
 *   2. Reads under org A's context see only org A's rows — even when the query
 *      itself forgets every where-clause.
 *   3. Raw SQL through the org context is still policy-filtered (RLS, not the
 *      client, is the enforcement).
 *   4. Writes cannot cross tenants: inserting a row stamped with org B's id
 *      from org A's context is rejected by the database.
 *   5. updateMany/deleteMany with an over-broad filter touch only the caller's
 *      organization.
 *   6. bypassOrgScope (platform admin) sees every organization.
 *   7. Soft-deleted rows are excluded from list reads by default.
 *   8. The organizations table itself only exposes the caller's own org.
 */

import "../lib/env/load-dotenv";
import { randomUUID } from "crypto";
import { basePrisma, db, authDb, runWithOrgTransaction } from "@/lib/db/prisma";
import {
  runWithOrgContext,
  bypassOrgScope,
  MissingOrganizationContextError,
} from "@/lib/tenancy/context";

let passed = 0;
let failed = 0;

function ok(name: string) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function fail(name: string, detail?: unknown) {
  failed += 1;
  console.error(`  ✗ ${name}`);
  if (detail) console.error(`    ${String(detail)}`);
}

async function expectRejects(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    fail(name, "expected rejection, call succeeded");
  } catch {
    ok(name);
  }
}

async function main() {
  const runId = randomUUID().slice(0, 8);
  const slugA = `iso-probe-a-${runId}`;
  const slugB = `iso-probe-b-${runId}`;

  console.log("\nTenant isolation verification (Postgres RLS)\n");

  // ---- fixtures (created with platform bypass) ------------------------------
  const [orgA, orgB] = await bypassOrgScope(async () => {
    const a = await authDb.organization.create({
      data: { name: "Isolation Probe A", slug: slugA, ownerId: "probe", status: "active" },
    });
    const b = await authDb.organization.create({
      data: { name: "Isolation Probe B", slug: slugB, ownerId: "probe", status: "active" },
    });
    return [a, b];
  });

  const [userA, userB] = await bypassOrgScope(async () => {
    const a = await authDb.user.create({
      data: {
        email: `probe-a-${runId}@isolation.test`,
        firstName: "Probe",
        lastName: "A",
        organizationId: orgA.id,
      },
    });
    const b = await authDb.user.create({
      data: {
        email: `probe-b-${runId}@isolation.test`,
        firstName: "Probe",
        lastName: "B",
        organizationId: orgB.id,
      },
    });
    return [a, b];
  });

  const seed = async (orgId: string, userId: string, marker: string) =>
    authDb.notification.create({
      data: { organizationId: orgId, userId, title: marker, message: marker },
    });

  await bypassOrgScope(async () => {
    await seed(orgA.id, userA.id, `A1-${runId}`);
    await seed(orgA.id, userA.id, `A2-${runId}`);
    await seed(orgB.id, userB.id, `B1-${runId}`);
  });

  try {
    // 1. No context → loud failure
    await expectRejects("scoped read with no org context is rejected", () =>
      db.notification.findMany(),
    );
    await expectRejects("scoped write with no org context is rejected", () =>
      db.notification.create({
        data: { organizationId: orgA.id, userId: userA.id, title: "x", message: "x" },
      }),
    );

    // 2. Org A sees only org A — with NO where clause at all
    await runWithOrgContext(
      { organizationId: orgA.id, isPlatformAdmin: false },
      async () => {
        const rows = await db.notification.findMany();
        const markers = rows.map((r) => r.title);
        if (
          rows.length === 2 &&
          markers.every((m) => m.startsWith("A")) &&
          !markers.some((m) => m.startsWith("B"))
        ) {
          ok("unfiltered findMany under org A returns only org A rows");
        } else {
          fail("unfiltered findMany under org A returns only org A rows", markers.join(","));
        }

        const count = await db.notification.count();
        count === 2
          ? ok("count is org-scoped")
          : fail("count is org-scoped", count);

        // 3. Raw SQL under the same context is still RLS-filtered
        const raw = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*)::bigint AS count FROM notifications`;
        Number(raw[0]?.count) === 2
          ? ok("raw SQL is filtered by RLS, not just the client")
          : fail("raw SQL is filtered by RLS", raw[0]?.count);

        // 4. Cross-tenant write stamped with org B is rejected by the DB
        await expectRejects(
          "insert stamped with a foreign organizationId is rejected",
          () =>
            db.notification.create({
              data: {
                organizationId: orgB.id,
                userId: userB.id,
                title: `X-${runId}`,
                message: "x",
              },
            }),
        );

        // 5. Over-broad bulk ops stay inside the org
        const upd = await db.notification.updateMany({
          data: { priority: "high" },
        });
        upd.count === 2
          ? ok("updateMany with empty filter touches only org A rows")
          : fail("updateMany scoped", upd.count);

        // 8. organizations table exposes only the caller's own org
        const orgs = await db.organization.findMany({
          where: { slug: { in: [slugA, slugB] } },
        });
        orgs.length === 1 && orgs[0].id === orgA.id
          ? ok("organizations table only exposes the caller's own org")
          : fail("organizations self-visibility", orgs.map((o) => o.slug).join(","));
      },
    );

    // Org B cross-check
    await runWithOrgContext(
      { organizationId: orgB.id, isPlatformAdmin: false },
      async () => {
        const rows = await db.notification.findMany();
        rows.length === 1 && rows[0].title === `B1-${runId}`
          ? ok("org B sees exactly its own single row")
          : fail("org B visibility", rows.map((r) => r.title).join(","));

        // 5b. deleteMany from B must not touch A
        const del = await db.notification.deleteMany({});
        del.count === 1
          ? ok("deleteMany with empty filter deletes only org B rows")
          : fail("deleteMany scoped", del.count);
      },
    );

    // 6. Bypass sees everything that remains (A's two rows)
    await bypassOrgScope(async () => {
      const rows = await authDb.notification.findMany({
        where: { title: { contains: runId } },
      });
      rows.length === 2
        ? ok("bypassOrgScope sees across organizations")
        : fail("bypass visibility", rows.length);
    });

    // 7. Soft-delete default filtering (uses Property, a soft-delete model)
    await runWithOrgContext(
      { organizationId: orgA.id, isPlatformAdmin: false },
      async () => {
        const base = {
          organizationId: orgA.id,
          name: `probe-${runId}`,
          type: "apartment",
          addressStreet: "1 Test St",
          addressCity: "Testville",
          addressState: "TS",
          addressZipCode: "00000",
          ownerId: userA.id,
        };
        await db.property.create({ data: { ...base, name: `live-${runId}` } });
        await db.property.create({
          data: { ...base, name: `dead-${runId}`, deletedAt: new Date() },
        });

        const listed = await db.property.findMany({
          where: { name: { contains: runId } },
        });
        listed.length === 1 && listed[0].name === `live-${runId}`
          ? ok("soft-deleted rows are excluded from list reads by default")
          : fail("soft-delete filter", listed.map((p) => p.name).join(","));

        const withDeleted = await db.property.findMany({
          where: { name: { contains: runId }, deletedAt: { not: null } },
        });
        withDeleted.length === 1
          ? ok("naming deletedAt in the where clause opts out of the filter")
          : fail("soft-delete opt-out", withDeleted.length);
      },
    );

    await expectRejects(
      "MissingOrganizationContextError is the thrown type",
      async () => {
        try {
          await db.notification.findMany();
        } catch (error) {
          if (error instanceof MissingOrganizationContextError) throw error;
          fail("missing-context error type", error);
          return; // swallow: wrong type already recorded as failure
        }
      },
    );
  } finally {
    // ---- cleanup (raw transaction: no soft-delete injection) -----------------
    await runWithOrgTransaction(
      async (tx) => {
        const orgIds = [orgA.id, orgB.id];
        await tx.notification.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.property.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      },
      { bypass: true },
    );
    await basePrisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-tenant-isolation crashed:", error);
  process.exit(1);
});
