/**
 * A charge stays on the contract, tenant, building and installment it names,
 * and they have to agree.
 *
 * "Add payment" wrote whatever ids it was sent — a contract of another
 * tenant, an installment of another contract — and an untouched contract
 * select sent "", which failed as "Related record does not exist". Edit could
 * then move the payment onto a different contract.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  chargeLinkProblem,
  movesToAnotherContract,
} from "@/lib/payments/charge-links";
import { paymentCreateSchema } from "@/lib/validations";
import { InvoiceStatus } from "@/types";

const charge = {
  tenantId: "tenant-sara",
  propertyId: "building-a",
  leaseId: "lease-a101",
};
const lease = { tenantId: "tenant-sara", propertyId: "building-a" };
const installment = {
  tenantId: "tenant-sara",
  propertyId: "building-a",
  leaseId: "lease-a101",
  status: InvoiceStatus.ISSUED,
};

describe("a charge's links", () => {
  test("pass when the contract and installment are the tenant's, in that building", () => {
    assert.equal(chargeLinkProblem(charge, lease, null), null);
    assert.equal(
      chargeLinkProblem({ ...charge, invoiceId: "inv-3" }, lease, installment),
      null,
    );
    // No contract at all is allowed: nothing to check against.
    assert.equal(
      chargeLinkProblem({ tenantId: "tenant-sara", propertyId: "building-a" }, null, null),
      null,
    );
  });

  test("refuse a contract of another tenant or another building", () => {
    assert.equal(
      chargeLinkProblem(charge, { ...lease, tenantId: "tenant-omar" }, null)?.status,
      400,
    );
    assert.equal(
      chargeLinkProblem(charge, { ...lease, propertyId: "building-b" }, null)?.status,
      400,
    );
  });

  test("refuse a contract or installment the caller cannot see", () => {
    assert.equal(chargeLinkProblem(charge, null, null)?.status, 404);
    assert.equal(
      chargeLinkProblem({ ...charge, invoiceId: "inv-3" }, lease, null)?.status,
      404,
    );
  });

  test("refuse an installment of another contract, or with no contract named", () => {
    assert.match(
      chargeLinkProblem(
        { ...charge, invoiceId: "inv-3" },
        lease,
        { ...installment, leaseId: "lease-b202" },
      )?.message ?? "",
      /different contract/,
    );
    assert.match(
      chargeLinkProblem(
        { tenantId: "tenant-sara", propertyId: "building-a", invoiceId: "inv-3" },
        null,
        installment,
      )?.message ?? "",
      /different contract/,
    );
  });

  test("refuse a cancelled installment", () => {
    assert.match(
      chargeLinkProblem(
        { ...charge, invoiceId: "inv-3" },
        lease,
        { ...installment, status: InvoiceStatus.CANCELLED },
      )?.message ?? "",
      /cancelled/,
    );
  });
});

describe("an untouched select", () => {
  test("sends no contract rather than an empty id", () => {
    const parsed = paymentCreateSchema.parse({
      tenantId: "tenant-sara",
      propertyId: "building-a",
      leaseId: "",
      invoiceId: "  ",
      amount: 500,
      type: "maintenance",
      dueDate: "2026-10-01",
    });
    assert.equal(parsed.leaseId, undefined);
    assert.equal(parsed.invoiceId, undefined);
  });
});

describe("editing a payment", () => {
  test("leaves its contract alone when none is sent", () => {
    assert.equal(movesToAnotherContract("lease-a101", undefined), false);
    assert.equal(movesToAnotherContract("lease-a101", "lease-a101"), false);
    assert.equal(movesToAnotherContract(null, ""), false);
    assert.equal(movesToAnotherContract(null, null), false);
  });

  test("cannot move it to another contract, or off its contract", () => {
    assert.equal(movesToAnotherContract("lease-a101", "lease-b202"), true);
    assert.equal(movesToAnotherContract("lease-a101", ""), true);
    assert.equal(movesToAnotherContract(null, "lease-b202"), true);
  });
});
