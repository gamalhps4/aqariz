/**
 * A filter on a report narrows what the reader may see. It never replaces it.
 *
 * Every register takes a building, an owner or a tenant from the query
 * string. Each used to spread the reader's scope into its `where` and then
 * the filter after it; both name `propertyId`, so the filter won, and an
 * owner — or an employee assigned one building — read any other by putting
 * its id in the URL. The "asked for a building they do not hold" test under
 * each register below is that request.
 *
 * Rows are counted against one small portfolio rather than the `where`
 * compared by shape. The scopes are written out in the shapes
 * lib/db/scopes.ts makes them (it cannot be imported here — see
 * lib/db/scope-where.test.ts).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildingExpensesWhere,
  buildingsWhere,
  collectionInvoicesWhere,
  collectionsWhere,
  coveringLeaseWhere,
  leaseReportWhere,
  maintenanceReportWhere,
  occupancyDay,
  paymentRegisterWhere,
  receivablesWhere,
} from "@/lib/reports/report-where";
import { businessDayEnd } from "@/lib/dates/business-day";
import { rowsMatching } from "@/lib/testing/where-matcher";
import { PaymentStatus } from "@/types";
import type { LeaseReportType } from "@/types/lease-report";

// ---------------------------------------------------------------------------
// The portfolio: compound A holds a1 and a2 (owner-1), compound B holds b1
// (owner-2). Tenant-1 rents in A, tenant-2 in B.
// ---------------------------------------------------------------------------

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const buildings = [
  { id: "a1", compoundId: "A", ownerId: "owner-1", deletedAt: null },
  { id: "a2", compoundId: "A", ownerId: "owner-1", deletedAt: null },
  { id: "a3", compoundId: "A", ownerId: "owner-1", deletedAt: day("2026-08-01") },
  { id: "b1", compoundId: "B", ownerId: "owner-2", deletedAt: null },
];

const owns = { a1: "owner-1", a2: "owner-1", b1: "owner-2" } as const;
const sits = { a1: "A", a2: "A", b1: "B" } as const;
const rents = { a1: "tenant-1", a2: "tenant-1", b1: "tenant-2" } as const;
type BuildingId = keyof typeof owns;

/** The columns every row that hangs off a building shares. */
function on(propertyId: BuildingId) {
  return {
    propertyId,
    tenantId: rents[propertyId],
    deletedAt: null,
    property: { ownerId: owns[propertyId], compoundId: sits[propertyId] },
  };
}

// The readers, as the scope each has on a model keyed by building…
const staff = {};
const holdsA = { propertyId: { in: ["a1", "a2"] } };
const holdsNothing = { propertyId: { in: [] } };
const tenantOne = { tenantId: { in: ["tenant-1"] } };
// …and on the building itself, which is keyed on its own id.
const holdsABuildings = { id: { in: ["a1", "a2"] } };

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

// ---------------------------------------------------------------------------
// Buildings — occupancy, and the by-building collections report
// ---------------------------------------------------------------------------

describe("the buildings a report is read over", () => {
  const listed = (...args: Parameters<typeof buildingsWhere>) =>
    ids(rowsMatching(buildings, buildingsWhere(...args)));

  test("asked for a building they do not hold, a reader gets nothing", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, holdsABuildings), []);
  });

  test("asked for one they do hold, they get that one alone", () => {
    assert.deepEqual(listed({ propertyId: "a1" }, holdsABuildings), ["a1"]);
  });

  test("asked for nothing in particular, they get what they hold", () => {
    assert.deepEqual(listed({}, holdsABuildings), ["a1", "a2"]);
  });

  test("a compound or an owner outside their reach is empty too", () => {
    assert.deepEqual(listed({ compoundId: "B" }, holdsABuildings), []);
    assert.deepEqual(listed({ ownerId: "owner-2" }, holdsABuildings), []);
    assert.deepEqual(listed({ compoundId: "A" }, holdsABuildings), ["a1", "a2"]);
  });

  test("office staff get the building they asked for", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, staff), ["b1"]);
    assert.deepEqual(listed({}, staff), ["a1", "a2", "b1"]);
  });

  test("an archived building is never listed", () => {
    assert.deepEqual(listed({ propertyId: "a3" }, staff), []);
  });
});

// ---------------------------------------------------------------------------
// Maintenance register
// ---------------------------------------------------------------------------

describe("the maintenance register", () => {
  const requests = [
    { id: "fix-a1", ...on("a1"), createdAt: day("2026-09-10") },
    { id: "fix-a2", ...on("a2"), createdAt: day("2026-09-12") },
    { id: "fix-a1-old", ...on("a1"), createdAt: day("2025-01-05") },
    { id: "fix-b1", ...on("b1"), createdAt: day("2026-09-11") },
  ];
  const september = { startDate: day("2026-09-01"), endDate: day("2026-09-30") };

  const listed = (
    filters: Partial<Parameters<typeof maintenanceReportWhere>[0]>,
    scope: Parameters<typeof maintenanceReportWhere>[1],
  ) =>
    ids(
      rowsMatching(
        requests,
        maintenanceReportWhere({ ...september, ...filters }, scope),
      ),
    );

  test("asked for a building they do not hold, a reader gets nothing", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, holdsA), []);
  });

  test("asked for one they do hold, they get that building's requests", () => {
    assert.deepEqual(listed({ propertyId: "a1" }, holdsA), ["fix-a1"]);
  });

  test("asked for nothing in particular, they get their own buildings'", () => {
    assert.deepEqual(listed({}, holdsA), ["fix-a1", "fix-a2"]);
  });

  test("a compound or an owner outside their reach is empty too", () => {
    assert.deepEqual(listed({ compoundId: "B" }, holdsA), []);
    assert.deepEqual(listed({ ownerId: "owner-2" }, holdsA), []);
  });

  test("office staff get the building they asked for", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, staff), ["fix-b1"]);
  });

  test("someone assigned nothing gets nothing", () => {
    assert.deepEqual(listed({}, holdsNothing), []);
  });
});

// ---------------------------------------------------------------------------
// Leasing registers
// ---------------------------------------------------------------------------

describe("the leasing registers", () => {
  // Read on 1 October 2026, on the office's calendar. Every date below is days
  // clear of a boundary.
  const endOfToday = businessDayEnd("2026-10-01");

  /** One contract of every kind in a building. */
  const contractsIn = (propertyId: BuildingId) => [
    {
      id: `${propertyId}-running`,
      ...on(propertyId),
      status: "active",
      startDate: day("2026-01-01"),
      endDate: day("2027-06-30"),
      terminatedDate: null,
    },
    {
      id: `${propertyId}-ends-soon`,
      ...on(propertyId),
      status: "active",
      startDate: day("2025-10-16"),
      endDate: day("2026-10-15"),
      terminatedDate: null,
    },
    {
      id: `${propertyId}-ends-later`,
      ...on(propertyId),
      status: "active",
      startDate: day("2025-12-02"),
      endDate: day("2026-12-01"),
      terminatedDate: null,
    },
    {
      id: `${propertyId}-lapsed`,
      ...on(propertyId),
      status: "active",
      startDate: day("2025-09-16"),
      endDate: day("2026-09-15"),
      terminatedDate: null,
    },
    {
      id: `${propertyId}-expired`,
      ...on(propertyId),
      status: "expired",
      startDate: day("2025-09-01"),
      endDate: day("2026-08-31"),
      terminatedDate: null,
    },
    {
      id: `${propertyId}-renewed`,
      ...on(propertyId),
      status: "renewed",
      startDate: day("2025-09-01"),
      endDate: day("2026-08-31"),
      terminatedDate: null,
    },
    {
      id: `${propertyId}-cancelled`,
      ...on(propertyId),
      status: "terminated",
      startDate: day("2026-02-01"),
      endDate: day("2027-01-31"),
      terminatedDate: day("2026-07-15"),
    },
  ];
  const contracts = [...contractsIn("a1"), ...contractsIn("b1")];

  /** What each register lists, by the suffix of the contracts above. */
  const REGISTERS: Record<LeaseReportType, string[]> = {
    active: ["running", "ends-soon", "ends-later"],
    "expiring-soon": ["ends-soon"],
    expiring: ["ends-later"],
    expired: ["lapsed", "expired"],
    renewed: ["renewed"],
    terminated: ["cancelled"],
  };
  const types = Object.keys(REGISTERS) as LeaseReportType[];

  const listed = (
    type: LeaseReportType,
    filters: { propertyId?: string; ownerId?: string; from?: Date; to?: Date },
    scope: Parameters<typeof leaseReportWhere>[2],
  ) =>
    ids(
      rowsMatching(
        contracts,
        leaseReportWhere(type, { ...filters, endOfToday }, scope),
      ),
    );

  for (const type of types) {
    const inA1 = REGISTERS[type].map((suffix) => `a1-${suffix}`);
    const inB1 = REGISTERS[type].map((suffix) => `b1-${suffix}`);

    describe(type, () => {
      test("asked for a building they do not hold, a reader gets nothing", () => {
        assert.deepEqual(listed(type, { propertyId: "b1" }, holdsA), []);
      });

      test("asked for one they do hold, they get that building's contracts", () => {
        assert.deepEqual(listed(type, { propertyId: "a1" }, holdsA), inA1);
      });

      test("asked for nothing in particular, they get their own buildings'", () => {
        assert.deepEqual(listed(type, {}, holdsA), inA1);
      });

      test("an owner outside their reach is empty too", () => {
        assert.deepEqual(listed(type, { ownerId: "owner-2" }, holdsA), []);
      });

      test("office staff get the whole register, or the building asked for", () => {
        assert.deepEqual(listed(type, {}, staff), [...inA1, ...inB1]);
        assert.deepEqual(listed(type, { propertyId: "b1" }, staff), inB1);
      });

      test("a tenant gets their own contracts and no building's", () => {
        assert.deepEqual(listed(type, {}, tenantOne), inA1);
        assert.deepEqual(listed(type, { propertyId: "b1" }, tenantOne), []);
      });
    });
  }

  test("the date filter still narrows a register a scope is on", () => {
    // The expiry registers carry an AND of their own; the scope is added to
    // it, and neither drops the other.
    const october = { from: day("2026-10-01"), to: day("2026-10-31") };
    assert.deepEqual(listed("expiring", october, holdsA), ["a1-ends-soon"]);
    assert.deepEqual(
      listed("expiring", { ...october, propertyId: "b1" }, holdsA),
      [],
    );

    const july = { from: day("2026-07-01"), to: day("2026-07-31") };
    assert.deepEqual(listed("terminated", july, holdsA), ["a1-cancelled"]);
    assert.deepEqual(
      listed(
        "terminated",
        { from: day("2026-08-01"), to: day("2026-08-31") },
        holdsA,
      ),
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// Payment registers
// ---------------------------------------------------------------------------

describe("the overdue and due-rent registers", () => {
  const installments = [
    {
      id: "due-a1",
      ...on("a1"),
      status: "issued",
      balanceRemaining: 500,
      dueDate: day("2026-09-10"),
    },
    {
      id: "due-a2",
      ...on("a2"),
      status: "partial",
      balanceRemaining: 200,
      dueDate: day("2026-10-20"),
    },
    {
      id: "paid-a1",
      ...on("a1"),
      status: "paid",
      balanceRemaining: 0,
      dueDate: day("2026-08-10"),
    },
    {
      id: "due-b1",
      ...on("b1"),
      status: "overdue",
      balanceRemaining: 900,
      dueDate: day("2026-09-05"),
    },
  ];
  const overdueBefore = day("2026-10-01");

  const listed = (
    filters: Partial<Parameters<typeof receivablesWhere>[0]>,
    scope: Parameters<typeof receivablesWhere>[1],
  ) =>
    ids(
      rowsMatching(
        installments,
        receivablesWhere(
          { overdueOnly: false, overdueBefore, ...filters },
          scope,
        ),
      ),
    );

  test("asked for a building they do not hold, a reader gets nothing", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, holdsA), []);
    assert.deepEqual(listed({ propertyId: "b1", overdueOnly: true }, holdsA), []);
  });

  test("asked for one they do hold, they get that building's arrears", () => {
    assert.deepEqual(listed({ propertyId: "a1" }, holdsA), ["due-a1"]);
  });

  test("asked for nothing in particular, they get their own buildings'", () => {
    assert.deepEqual(listed({}, holdsA), ["due-a1", "due-a2"]);
    assert.deepEqual(listed({ overdueOnly: true }, holdsA), ["due-a1"]);
  });

  test("an owner or a tenant outside their reach is empty too", () => {
    assert.deepEqual(listed({ ownerId: "owner-2" }, holdsA), []);
    assert.deepEqual(listed({ tenantId: "tenant-2" }, holdsA), []);
  });

  test("a tenant cannot name another tenant, or another building", () => {
    assert.deepEqual(listed({ tenantId: "tenant-2" }, tenantOne), []);
    assert.deepEqual(listed({ propertyId: "b1" }, tenantOne), []);
    assert.deepEqual(listed({}, tenantOne), ["due-a1", "due-a2"]);
  });

  test("office staff get the building they asked for", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, staff), ["due-b1"]);
  });

  test("the due window still narrows a register a scope is on", () => {
    const october = { dueFrom: day("2026-10-01"), dueTo: day("2026-10-31") };
    assert.deepEqual(listed(october, holdsA), ["due-a2"]);
    assert.deepEqual(listed({ ...october, propertyId: "b1" }, holdsA), []);
  });
});

describe("the payments-received register", () => {
  const payments = [
    { id: "paid-a1", ...on("a1"), status: "paid", paidDate: day("2026-09-05") },
    { id: "part-a2", ...on("a2"), status: "partial", paidDate: day("2026-09-20") },
    { id: "august-a1", ...on("a1"), status: "paid", paidDate: day("2026-08-05") },
    { id: "pending-a1", ...on("a1"), status: "pending", paidDate: null },
    { id: "paid-b1", ...on("b1"), status: "paid", paidDate: day("2026-09-07") },
  ];
  const september = { startDate: day("2026-09-01"), endDate: day("2026-09-30") };

  const listed = (
    filters: Partial<Parameters<typeof collectionsWhere>[0]>,
    scope: Parameters<typeof collectionsWhere>[1],
  ) =>
    ids(
      rowsMatching(payments, collectionsWhere({ ...september, ...filters }, scope)),
    );

  test("asked for a building they do not hold, a reader gets nothing", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, holdsA), []);
  });

  test("asked for one they do hold, they get that building's payments", () => {
    assert.deepEqual(listed({ propertyId: "a1" }, holdsA), ["paid-a1"]);
  });

  test("asked for nothing in particular, they get their own buildings'", () => {
    assert.deepEqual(listed({}, holdsA), ["paid-a1", "part-a2"]);
  });

  test("an owner or a tenant outside their reach is empty too", () => {
    assert.deepEqual(listed({ ownerId: "owner-2" }, holdsA), []);
    assert.deepEqual(listed({ tenantId: "tenant-2" }, holdsA), []);
  });

  test("a tenant cannot name another tenant, or another building", () => {
    assert.deepEqual(listed({ tenantId: "tenant-2" }, tenantOne), []);
    assert.deepEqual(listed({ propertyId: "b1" }, tenantOne), []);
  });

  test("office staff get the building they asked for", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, staff), ["paid-b1"]);
  });
});

describe("the payment report", () => {
  const gateway = {
    stripePaymentIntentId: null,
    stripeCheckoutSessionId: null,
    paypalCaptureId: null,
    razorpayPaymentId: null,
    paystackReference: null,
  };
  /** A payment on a building, with every column the report's filters read. */
  function received(
    id: string,
    propertyId: BuildingId,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id,
      ...on(propertyId),
      status: "paid",
      type: "rent",
      paymentMethod: "bank_transfer",
      recordedById: "clerk-1",
      leaseId: `lease-${propertyId}`,
      lease: { unitId: `unit-${propertyId}` },
      ...gateway,
      ...overrides,
    };
  }
  const payments = [
    received("transfer-a1", "a1"),
    received("owner-cash-a1", "a1", { paymentMethod: "owner_cash", recordedById: "clerk-2" }),
    received("ejar-a2", "a2", { paymentMethod: "ejari", type: "security_deposit" }),
    received("no-method-a2", "a2", { paymentMethod: null, status: "partial" }),
    received("online-a1", "a1", {
      paymentMethod: "credit_card",
      recordedById: null,
      stripePaymentIntentId: "pi_1",
    }),
    received("refunded-a1", "a1", { status: "refunded", paymentMethod: "cash" }),
    received("pending-a1", "a1", { status: "pending", paymentMethod: null }),
    received("archived-a1", "a1", { deletedAt: day("2026-09-30") }),
    received("transfer-b1", "b1"),
  ];

  const listed = (
    filters: Parameters<typeof paymentRegisterWhere>[0],
    scope: Parameters<typeof paymentRegisterWhere>[1] = staff,
  ) => ids(rowsMatching(payments, paymentRegisterWhere(filters, scope)));

  test("money received, refunded since or not — never a charge nobody paid, never an archived payment", () => {
    assert.deepEqual(listed({}), [
      "transfer-a1",
      "owner-cash-a1",
      "ejar-a2",
      "no-method-a2",
      "online-a1",
      "refunded-a1",
      "transfer-b1",
    ]);
  });

  test("by status", () => {
    assert.deepEqual(listed({ status: PaymentStatus.REFUNDED }), ["refunded-a1"]);
    assert.deepEqual(listed({ status: PaymentStatus.PARTIAL }), ["no-method-a2"]);
  });

  test("by method, a payment with none recorded under 'unspecified'", () => {
    assert.deepEqual(listed({ method: "owner_cash" }), ["owner-cash-a1"]);
    assert.deepEqual(listed({ method: "unspecified" }), ["no-method-a2"]);
  });

  test("by who received it: the owner's methods, and everything else the office's", () => {
    assert.deepEqual(listed({ receiver: "owner" }), ["owner-cash-a1", "ejar-a2"]);
    assert.deepEqual(listed({ receiver: "office" }), [
      "transfer-a1",
      "no-method-a2",
      "online-a1",
      "refunded-a1",
      "transfer-b1",
    ]);
  });

  test("a method and who received it narrow together, neither replacing the other", () => {
    assert.deepEqual(listed({ method: "owner_cash", receiver: "office" }), []);
    assert.deepEqual(listed({ method: "owner_cash", receiver: "owner" }), ["owner-cash-a1"]);
  });

  test("by who recorded it, or taken online", () => {
    assert.deepEqual(listed({ recordedBy: "clerk-2" }), ["owner-cash-a1"]);
    assert.deepEqual(listed({ recordedBy: "online" }), ["online-a1"]);
  });

  test("taken online through any gateway, once the database has the generic reference", () => {
    const withMoyasar = [
      ...payments.map((payment) => ({ ...payment, gatewayPaymentId: null })),
      received("moyasar-a1", "a1", {
        paymentMethod: "credit_card",
        recordedById: null,
        gatewayPaymentId: "8f6d-moyasar",
      }),
    ];
    const online = (gatewayColumns: boolean) =>
      ids(
        rowsMatching(
          withMoyasar,
          paymentRegisterWhere({ recordedBy: "online" }, staff, { gatewayColumns }),
        ),
      );
    assert.deepEqual(online(true), ["online-a1", "moyasar-a1"]);
    // Before the migration the column cannot be asked about at all.
    assert.deepEqual(online(false), ["online-a1"]);
  });

  test("by kind of payment, contract, unit, compound and owner", () => {
    assert.deepEqual(listed({ paymentType: "security_deposit" }), ["ejar-a2"]);
    assert.deepEqual(listed({ leaseId: "lease-b1" }), ["transfer-b1"]);
    assert.deepEqual(listed({ unitId: "unit-a2" }), ["ejar-a2", "no-method-a2"]);
    assert.deepEqual(listed({ compoundId: "B" }), ["transfer-b1"]);
    assert.deepEqual(listed({ ownerId: "owner-2", compoundId: "A" }), []);
  });

  test("asked for a building, unit or contract they do not hold, a reader gets nothing", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, holdsA), []);
    assert.deepEqual(listed({ unitId: "unit-b1" }, holdsA), []);
    assert.deepEqual(listed({ leaseId: "lease-b1" }, holdsA), []);
    assert.deepEqual(listed({ tenantId: "tenant-2" }, tenantOne), []);
  });

  test("asked for nothing in particular, they get their own buildings'", () => {
    assert.deepEqual(listed({}, holdsA), [
      "transfer-a1",
      "owner-cash-a1",
      "ejar-a2",
      "no-method-a2",
      "online-a1",
      "refunded-a1",
    ]);
    assert.deepEqual(listed({}, holdsNothing), []);
  });
});

describe("expenses by building", () => {
  const expenses = [
    {
      id: "paint-a1",
      propertyId: "a1",
      status: "paid",
      date: day("2026-09-08"),
      deletedAt: null,
    },
    {
      id: "void-a1",
      propertyId: "a1",
      status: "cancelled",
      date: day("2026-09-09"),
      deletedAt: null,
    },
    {
      id: "lift-b1",
      propertyId: "b1",
      status: "approved",
      date: day("2026-09-10"),
      deletedAt: null,
    },
    {
      // No building: the office's own cost.
      id: "office-rent",
      propertyId: null,
      status: "paid",
      date: day("2026-09-01"),
      deletedAt: null,
    },
  ];
  const september = { startDate: day("2026-09-01"), endDate: day("2026-09-30") };

  const listed = (
    filters: { propertyId?: string },
    scope: Parameters<typeof buildingExpensesWhere>[1],
  ) =>
    ids(
      rowsMatching(
        expenses,
        buildingExpensesWhere({ ...september, ...filters }, scope),
      ),
    );

  test("asked for a building they do not hold, a reader gets nothing", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, holdsA), []);
  });

  test("asked for nothing in particular, they get their own buildings'", () => {
    // Not the office's own costs: those belong to no building they hold.
    assert.deepEqual(listed({}, holdsA), ["paint-a1"]);
  });

  test("office staff see every building, and the office's own costs", () => {
    assert.deepEqual(listed({}, staff), ["paint-a1", "lift-b1", "office-rent"]);
    assert.deepEqual(listed({ propertyId: "b1" }, staff), ["lift-b1"]);
  });

  test("someone assigned nothing gets nothing", () => {
    assert.deepEqual(listed({}, holdsNothing), []);
    assert.deepEqual(listed({ propertyId: "a1" }, holdsNothing), []);
  });
});

// ---------------------------------------------------------------------------
// A contract on its last day
// ---------------------------------------------------------------------------

describe("a contract on its last day", () => {
  // Read on 1 October 2026. End dates are stored at the midnight that starts
  // the last day — midnight UTC, which is 03:00 that morning in Riyadh.
  const endOfToday = businessDayEnd("2026-10-01");
  const contracts = [
    {
      id: "last-day",
      ...on("a1"),
      status: "active",
      startDate: day("2025-10-02"),
      endDate: day("2026-10-01"),
      terminatedDate: null,
    },
    {
      id: "ended-yesterday",
      ...on("a1"),
      status: "active",
      startDate: day("2025-10-01"),
      endDate: day("2026-09-30"),
      terminatedDate: null,
    },
  ];
  const listed = (type: LeaseReportType) =>
    ids(rowsMatching(contracts, leaseReportWhere(type, { endOfToday }, staff)));

  test("is still active, and still expiring soon", () => {
    assert.deepEqual(listed("active"), ["last-day"]);
    assert.deepEqual(listed("expiring-soon"), ["last-day"]);
  });

  test("is not expired until the day is over", () => {
    assert.deepEqual(listed("expired"), ["ended-yesterday"]);
  });
});

describe("the renewed register's date", () => {
  test("is not the old contract's end date", () => {
    // The day the renewal was made lives on the successor; the service
    // applies it (lib/reports/renewals.ts). The where lists every renewed
    // contract in reach, whatever window is asked for.
    const renewed = [
      {
        id: "renewed-early",
        ...on("a1"),
        status: "renewed",
        startDate: day("2026-01-01"),
        endDate: day("2026-12-31"),
        terminatedDate: null,
      },
    ];
    const where = leaseReportWhere(
      "renewed",
      {
        from: day("2026-09-01"),
        to: day("2026-09-30"),
        endOfToday: businessDayEnd("2026-10-01"),
      },
      holdsA,
    );
    assert.deepEqual(ids(rowsMatching(renewed, where)), ["renewed-early"]);
  });
});

// ---------------------------------------------------------------------------
// The arrears registers as at a past date, and by charge
// ---------------------------------------------------------------------------

describe("the arrears registers as at a date already past", () => {
  const installments = [
    {
      id: "still-owed",
      ...on("a1"),
      category: "rent",
      status: "overdue",
      balanceRemaining: 500,
      lastPaymentDate: null,
      dueDate: day("2026-08-01"),
    },
    {
      id: "paid-in-september",
      ...on("a1"),
      category: "rent",
      status: "paid",
      balanceRemaining: 0,
      lastPaymentDate: day("2026-09-12"),
      dueDate: day("2026-08-01"),
    },
    {
      id: "paid-in-july",
      ...on("a1"),
      category: "rent",
      status: "paid",
      balanceRemaining: 0,
      lastPaymentDate: day("2026-07-20"),
      dueDate: day("2026-07-01"),
    },
    {
      id: "cancelled",
      ...on("a1"),
      category: "rent",
      status: "cancelled",
      balanceRemaining: 0,
      lastPaymentDate: day("2026-09-12"),
      dueDate: day("2026-08-01"),
    },
    {
      id: "deposit",
      ...on("a1"),
      category: "security_deposit",
      status: "overdue",
      balanceRemaining: 4000,
      lastPaymentDate: null,
      dueDate: day("2026-07-25"),
    },
  ];
  const asAtAugust = {
    overdueOnly: true,
    overdueBefore: day("2026-08-31"),
  };
  const listed = (filters: Partial<Parameters<typeof receivablesWhere>[0]>) =>
    ids(
      rowsMatching(
        installments,
        receivablesWhere({ ...asAtAugust, ...filters }, holdsA),
      ),
    );

  test("read for today, a paid-off installment is gone", () => {
    assert.deepEqual(listed({}), ["still-owed", "deposit"]);
  });

  test("as at a past date, one paid off since is read back in", () => {
    // What it owed then is decided row by row (installmentAsAt); one paid
    // before the date, or cancelled, never comes back.
    assert.deepEqual(listed({ paidAfter: day("2026-08-31") }), [
      "still-owed",
      "paid-in-september",
      "deposit",
    ]);
  });

  test("a deposit is not rent", () => {
    assert.deepEqual(listed({ category: "rent" }), ["still-owed"]);
    assert.deepEqual(listed({ category: "deposit" }), ["deposit"]);
    assert.deepEqual(listed({ category: "other" }), []);
  });

  test("a reader outside the building gets none of it", () => {
    assert.deepEqual(
      ids(
        rowsMatching(
          installments,
          receivablesWhere(
            { ...asAtAugust, paidAfter: day("2026-08-31"), propertyId: "a1" },
            { propertyId: { in: ["b1"] } },
          ),
        ),
      ),
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// Occupancy on a day
// ---------------------------------------------------------------------------

describe("the day occupancy is read for", () => {
  const now = new Date("2026-10-01T15:00:00.000Z");

  test("is today unless another day is asked for", () => {
    assert.deepEqual(occupancyDay(null, now), {
      start: new Date("2026-10-01T00:00:00.000Z"),
      end: new Date("2026-10-01T23:59:59.999Z"),
      today: true,
      past: false,
    });
    const september = occupancyDay("2026-09-30", now)!;
    assert.equal(september.today, false);
    assert.equal(september.past, true);
  });

  test("refuses what is not a date", () => {
    assert.equal(occupancyDay("next week", now), null);
    assert.equal(occupancyDay("2026-02-30", now), null);
  });
});

describe("the contracts that held a unit on a day", () => {
  const contract = (
    id: string,
    status: string,
    endDate: string,
    terminatedDate: string | null = null,
  ) => ({
    id,
    ...on("a1"),
    status,
    startDate: day("2026-01-01"),
    endDate: day(endDate),
    terminatedDate: terminatedDate ? day(terminatedDate) : null,
  });
  const contracts = [
    contract("running", "active", "2026-12-31"),
    contract("renewed", "renewed", "2026-12-31"),
    contract("expired-since", "expired", "2026-09-30"),
    contract("cancelled-in-august", "terminated", "2026-12-31", "2026-08-15"),
    contract("cancelled-undated", "terminated", "2026-12-31"),
    contract("draft", "draft", "2026-12-31"),
    contract("last-day", "active", "2026-10-01"),
  ];
  const held = (iso: string, now = new Date("2026-10-01T12:00:00.000Z")) => {
    const day = occupancyDay(iso, now)!;
    return ids(
      rowsMatching(contracts, coveringLeaseWhere(day, { past: day.past })),
    );
  };

  test("a contract that has expired since still held its unit then", () => {
    assert.ok(held("2026-07-01").includes("expired-since"));
  });

  test("a cancelled one held it until the day it was cancelled", () => {
    assert.ok(held("2026-08-15").includes("cancelled-in-august"));
    assert.ok(!held("2026-08-16").includes("cancelled-in-august"));
    assert.ok(!held("2026-07-01").includes("cancelled-undated"));
  });

  test("today, one on its last day still holds it; an expired one does not", () => {
    assert.deepEqual(held("2026-10-01"), ["running", "renewed", "last-day"]);
  });

  test("a draft never held one", () => {
    assert.ok(!held("2026-07-01").includes("draft"));
  });
});

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

describe("the collection page's installments", () => {
  const installments = [
    { id: "a1-sep", ...on("a1"), status: "paid", dueDate: day("2026-09-01") },
    { id: "a2-sep", ...on("a2"), status: "partial", dueDate: day("2026-09-01") },
    { id: "a1-oct", ...on("a1"), status: "issued", dueDate: day("2026-10-01") },
    { id: "a1-void", ...on("a1"), status: "cancelled", dueDate: day("2026-09-05") },
    { id: "b1-sep", ...on("b1"), status: "overdue", dueDate: day("2026-09-03") },
  ];
  const listed = (
    filters: Parameters<typeof collectionInvoicesWhere>[0],
    scope: Parameters<typeof collectionInvoicesWhere>[1],
  ) => ids(rowsMatching(installments, collectionInvoicesWhere(filters, scope)));

  test("never counts a cancelled installment as billed", () => {
    assert.deepEqual(listed({}, staff), ["a1-sep", "a2-sep", "a1-oct", "b1-sep"]);
  });

  test("filters by owner, compound, tenant and due date", () => {
    assert.deepEqual(listed({ ownerId: "owner-2" }, staff), ["b1-sep"]);
    assert.deepEqual(listed({ compoundId: "A" }, staff), ["a1-sep", "a2-sep", "a1-oct"]);
    assert.deepEqual(listed({ tenantId: "tenant-2" }, staff), ["b1-sep"]);
    assert.deepEqual(
      listed({ dueFrom: day("2026-09-01"), dueTo: day("2026-09-30") }, staff),
      ["a1-sep", "a2-sep", "b1-sep"],
    );
  });

  test("a filter outside the reader's buildings gives nothing", () => {
    assert.deepEqual(listed({ ownerId: "owner-2" }, holdsA), []);
    assert.deepEqual(listed({ compoundId: "B" }, holdsA), []);
    assert.deepEqual(listed({ tenantId: "tenant-2" }, holdsA), []);
  });
});

describe("expenses as every report counts them", () => {
  const expenses = [
    {
      id: "paid-a1",
      propertyId: "a1",
      property: { ownerId: "owner-1" },
      status: "paid",
      date: day("2026-09-08"),
      deletedAt: null,
    },
    {
      id: "approved-b1",
      propertyId: "b1",
      property: { ownerId: "owner-2" },
      status: "approved",
      date: day("2026-09-10"),
      deletedAt: null,
    },
    {
      id: "pending-a1",
      propertyId: "a1",
      property: { ownerId: "owner-1" },
      status: "pending",
      date: day("2026-09-11"),
      deletedAt: null,
    },
    {
      id: "office",
      propertyId: null,
      property: null,
      status: "paid",
      date: day("2026-09-01"),
      deletedAt: null,
    },
  ];
  const september = { startDate: day("2026-09-01"), endDate: day("2026-09-30") };
  const listed = (filters: { ownerId?: string }) =>
    ids(
      rowsMatching(
        expenses,
        buildingExpensesWhere({ ...september, ...filters }, staff),
      ),
    );

  test("are approved or paid — a pending one is not a cost yet", () => {
    assert.deepEqual(listed({}), ["paid-a1", "approved-b1", "office"]);
  });

  test("filtered to an owner, are that owner's buildings' alone", () => {
    assert.deepEqual(listed({ ownerId: "owner-1" }), ["paid-a1"]);
  });
});
