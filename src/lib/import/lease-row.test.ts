/**
 * One contract row of an import file.
 *
 * A row becomes the body the contract form posts to POST /api/leases, so it
 * is held to the route's own `leaseSchema`; and the file's rows are replayed
 * against each other, because a check of the file sees none of them in the
 * database while the real run creates them one after another.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalizeHeader } from "@/lib/import/csv";
import {
  LeaseFilePlan,
  leaseRequestBody,
  readFrequency,
  readLeaseRow,
  readLeaseStatus,
} from "@/lib/import/lease-row";
import { leaseSchema, validateSchema } from "@/lib/validations";

/** A row as the CSV and Excel readers hand it over: headings normalized. */
function row(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [normalizeHeader(key), value]),
  );
}

const complete = {
  contractNumber: "20123456789",
  tenantIdNumber: "1012345678",
  buildingName: "شقق الواحة",
  unitNumber: "B201",
  startDate: "2026-03-01",
  endDate: "2027-02-28",
  paymentFrequency: "monthly",
  contractAmount: "18000",
  securityDeposit: "1500",
  status: "active",
};

describe("a contract row", () => {
  test("reads what the template asks for", () => {
    const read = readLeaseRow(row(complete));
    assert.equal(read.ok, true);
    assert.deepEqual(read.ok && read.value, {
      contractNumber: "20123456789",
      tenant: { idNumber: "1012345678", email: "", phone: "" },
      unit: { building: "شقق الواحة", unitNumber: "B201" },
      startDate: "2026-03-01",
      endDate: "2027-02-28",
      frequency: "monthly",
      rentAmount: null,
      contractAmount: 18000,
      securityDeposit: 1500,
      status: "active",
      notes: undefined,
    });
  });

  test("defaults as the form does: monthly, active, no deposit", () => {
    const read = readLeaseRow(
      row({
        tenantPhone: "0501230110",
        building: "Maple Court",
        unit: "1A",
        startDate: "01/03/2026",
        endDate: "28/02/2027",
        rentAmount: "1,450",
      }),
    );
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value.frequency, "monthly");
    assert.equal(read.value.status, "active");
    assert.equal(read.value.securityDeposit, 0);
    assert.equal(read.value.rentAmount, 1450);
    assert.equal(read.value.contractAmount, null);
    assert.equal(read.value.startDate, "2026-03-01");
  });

  test("with both a rent and a total uses the total, and says so", () => {
    const read = readLeaseRow(row({ ...complete, rentAmount: "1500" }));
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value.contractAmount, 18000);
    assert.equal(read.value.rentAmount, null);
    assert.deepEqual(read.warnings.map((warning) => warning.code), ["contractTotalUsed"]);
  });

  test("is refused, with the reason, for each missing or unreadable cell", () => {
    const code = (fields: Record<string, string>) => {
      const read = readLeaseRow(row(fields));
      return read.ok ? null : read.issue.code;
    };
    assert.equal(code({ ...complete, tenantIdNumber: "" }), "tenantKeyMissing");
    assert.equal(code({ ...complete, unitNumber: "" }), "unitKeyMissing");
    assert.equal(code({ ...complete, startDate: "" }), "dateMissing");
    assert.equal(code({ ...complete, endDate: "31/02/2027" }), "dateInvalid");
    assert.equal(code({ ...complete, endDate: "2026-03-01" }), "endBeforeStart");
    assert.equal(code({ ...complete, paymentFrequency: "weekly" }), "frequencyInvalid");
    assert.equal(code({ ...complete, contractAmount: "" }), "rentMissing");
    assert.equal(code({ ...complete, contractAmount: "lots" }), "amountInvalid");
    assert.equal(code({ ...complete, securityDeposit: "-1" }), "amountInvalid");
    assert.equal(code({ ...complete, status: "renewed" }), "leaseStatusInvalid");
  });

  test("names the column and the value it could not read", () => {
    const read = readLeaseRow(row({ ...complete, startDate: "March 1st" }));
    assert.deepEqual(!read.ok && read.issue.values, {
      column: "startDate",
      value: "March 1st",
    });
  });
});

describe("a contract's frequency and status", () => {
  test("are read as stored, as written in English, or as the Arabic screens say them", () => {
    assert.equal(readFrequency(""), "monthly");
    assert.equal(readFrequency("Semi-Annual"), "semi_annual");
    assert.equal(readFrequency("four monthly"), "four_monthly");
    assert.equal(readFrequency("Every 4 months"), "four_monthly");
    assert.equal(readFrequency("ربع سنوي"), "quarterly");
    assert.equal(readFrequency("سنوي"), "annual");
    assert.equal(readFrequency("yearly"), "annual");
    assert.equal(readFrequency("fortnightly"), null);

    assert.equal(readLeaseStatus(""), "active");
    assert.equal(readLeaseStatus("Expired"), "expired");
    assert.equal(readLeaseStatus("نشط"), "active");
    assert.equal(readLeaseStatus("مسودة"), "draft");
    // Renewal is a lifecycle step, not something a contract is created as.
    assert.equal(readLeaseStatus("renewed"), null);
  });
});

describe("the request a contract row becomes", () => {
  test("passes the contract route's own validation", () => {
    const read = readLeaseRow(row(complete));
    assert.equal(read.ok, true);
    if (!read.ok) return;
    const body = leaseRequestBody(read.value, {
      propertyId: "property-1",
      unitId: "unit-1",
      tenantId: "tenant-1",
    });
    const validation = validateSchema(leaseSchema as never, body);
    assert.equal(validation.success, true);
    assert.ok(validation.success);
    const data = validation.data as {
      contractAmount: number;
      paymentFrequency: string;
      status: string;
      startDate: Date;
      terms: { securityDeposit: number };
    };
    assert.equal(data.contractAmount, 18000);
    assert.equal(data.paymentFrequency, "monthly");
    assert.equal(data.status, "active");
    assert.equal(data.terms.securityDeposit, 1500);
    assert.deepEqual(data.startDate, new Date(Date.UTC(2026, 2, 1)));
  });

  test("never asks for invoice emails — an import must not message tenants", () => {
    const read = readLeaseRow(row(complete));
    assert.equal(read.ok, true);
    if (!read.ok) return;
    const body = leaseRequestBody(read.value, {
      propertyId: "p",
      unitId: "u",
      tenantId: "t",
    });
    assert.equal(body.terms.paymentConfig.autoEmailInvoices, false);
  });
});

describe("the rows of one file", () => {
  const lease = (fields: Partial<Parameters<LeaseFilePlan["conflict"]>[0]>) => ({
    row: 2,
    unitId: "unit-1",
    status: "active",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    contractNumber: null,
    ...fields,
  });

  test("cannot put a second contract on a unit an earlier active row occupies", () => {
    const plan = new LeaseFilePlan();
    plan.admit(lease({ row: 2 }));
    const conflict = plan.conflict(
      lease({ row: 3, startDate: "2027-01-01", endDate: "2027-12-31" }),
    );
    assert.deepEqual(conflict?.code, "unitTakenInFile");
    assert.deepEqual(conflict?.values, { row: 2 });
  });

  test("cannot overlap the dates a pending row holds", () => {
    const plan = new LeaseFilePlan();
    plan.admit(lease({ row: 2, status: "pending" }));
    // Touching on the last day overlaps, as findOverlappingLease compares.
    assert.equal(
      plan.conflict(lease({ row: 3, status: "draft", startDate: "2026-12-31", endDate: "2027-06-30" }))?.code,
      "leaseOverlapInFile",
    );
    assert.equal(
      plan.conflict(lease({ row: 3, status: "draft", startDate: "2027-01-01", endDate: "2027-06-30" })),
      null,
    );
  });

  test("lets an expired contract sit beside a later one", () => {
    const plan = new LeaseFilePlan();
    plan.admit(lease({ row: 2, status: "expired", startDate: "2024-01-01", endDate: "2024-12-31" }));
    assert.equal(plan.conflict(lease({ row: 3 })), null);
  });

  test("uses a contract number once", () => {
    const plan = new LeaseFilePlan();
    plan.admit(lease({ row: 2, contractNumber: "123" }));
    assert.equal(
      plan.conflict(lease({ row: 5, unitId: "unit-2", contractNumber: " 123 " }))?.code,
      "contractNumberDuplicateInFile",
    );
  });

  test("leaves other units alone", () => {
    const plan = new LeaseFilePlan();
    plan.admit(lease({ row: 2 }));
    assert.equal(plan.conflict(lease({ row: 3, unitId: "unit-2" })), null);
  });
});
