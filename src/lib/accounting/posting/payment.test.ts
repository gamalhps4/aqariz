/**
 * Money received from a tenant: who received it and whose it is.
 *
 * The office's receipt goes to the account its method moves (cash box, POS
 * clearing, bank, gateway clearing) and an owner's part becomes what the
 * office owes them; money the owner received directly clears the tenant's
 * debt without touching the office's cash. A refund is the receipt turned
 * around.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planPaymentReceipt, planPaymentRefund, type PaymentDoc } from "./payment";
import { totals, totalsByAccount } from "./common";

const DAY = new Date("2026-10-03T00:00:00.000Z");

function payment(overrides: Partial<PaymentDoc> = {}): PaymentDoc {
  return {
    id: "pay-1",
    number: "RCP-000001",
    date: DAY,
    amount: 5_000,
    method: "bank_transfer",
    tenantId: "tenant-1",
    ownerId: "owner-1",
    propertyId: "prop-1",
    unitId: "unit-1",
    leaseId: "lease-1",
    ownership: "owner",
    ownerPortion: 500_000,
    ...overrides,
  };
}

function amounts(plan: ReturnType<typeof planPaymentReceipt>) {
  assert.ok(plan, "expected a plan");
  const sums = totals(plan.lines);
  assert.equal(sums.debit, sums.credit, "the entry balances");
  return totalsByAccount(plan.lines);
}

describe("received by the office", () => {
  test("a transfer lands in the bank and the owner's part becomes their payable", () => {
    const byAccount = amounts(planPaymentReceipt(payment()));
    assert.deepEqual(byAccount.get("k:bank"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 0, credit: 500_000 });
    assert.deepEqual(byAccount.get("k:owner_uncollected_rent"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 0, credit: 500_000 });
  });

  test("each method moves its own account", () => {
    const cases: Array<[string, boolean, string]> = [
      ["cash", false, "k:cash_on_hand"],
      ["pos", false, "k:pos_clearing"],
      ["bank_transfer", false, "k:bank"],
      ["check", false, "k:bank"],
      ["credit_card", true, "k:gateway_clearing"],
      ["credit_card", false, "k:pos_clearing"],
      ["paypal", true, "k:gateway_clearing"],
    ];
    for (const [method, online, account] of cases) {
      const byAccount = amounts(planPaymentReceipt(payment({ method, online })));
      assert.deepEqual(byAccount.get(account), { debit: 500_000, credit: 0 }, method);
    }
  });

  test("on the office's own building nothing goes to an owner", () => {
    const byAccount = amounts(
      planPaymentReceipt(payment({ ownership: "office", ownerPortion: 0 })),
    );
    assert.deepEqual(byAccount.get("k:bank"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 0, credit: 500_000 });
    assert.equal(byAccount.has("k:owner_payable"), false);
    assert.equal(byAccount.has("k:owner_uncollected_rent"), false);
  });

  test("a payment partly the owner's moves only that part to them", () => {
    const byAccount = amounts(planPaymentReceipt(payment({ ownerPortion: 300_000 })));
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 0, credit: 300_000 });
    assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 0, credit: 500_000 });
  });

  test("the owner's lines carry the owner, the receivable the tenant", () => {
    const plan = planPaymentReceipt(payment())!;
    const payable = plan.lines.find(
      (line) => "key" in line.account && line.account.key === "owner_payable",
    )!;
    const receivable = plan.lines.find(
      (line) => "key" in line.account && line.account.key === "tenant_receivables",
    )!;
    assert.equal(payable.partyType, "owner");
    assert.equal(payable.partyId, "owner-1");
    assert.equal(receivable.partyType, "tenant");
    assert.equal(receivable.partyId, "tenant-1");
  });
});

describe("received by the owner directly", () => {
  for (const method of ["owner_cash", "owner_account", "ejari"]) {
    test(`${method}: clears the debt against the owner's uncollected rent, no cash`, () => {
      const byAccount = amounts(planPaymentReceipt(payment({ method })));
      assert.deepEqual(byAccount.get("k:owner_uncollected_rent"), { debit: 500_000, credit: 0 });
      assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 0, credit: 500_000 });
      assert.equal(byAccount.has("k:bank"), false);
      assert.equal(byAccount.has("k:cash_on_hand"), false);
      assert.equal(byAccount.has("k:owner_payable"), false);
    });
  }

  test("money of the office's that the owner received is owed to the office", () => {
    // A building held under investment: its rent is the office's.
    const byAccount = amounts(
      planPaymentReceipt(payment({ method: "owner_account", ownership: "investment", ownerPortion: 0 })),
    );
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 0, credit: 500_000 });
  });

  test("on the office's own building, money 'paid to the owner' is the office's", () => {
    const byAccount = amounts(
      planPaymentReceipt(payment({ method: "owner_cash", ownership: "office", ownerPortion: 0 })),
    );
    assert.deepEqual(byAccount.get("k:cash_on_hand"), { debit: 500_000, credit: 0 });
  });
});

describe("a payment applied to no installment", () => {
  test("an owner's rent goes straight to their payable", () => {
    const byAccount = amounts(
      planPaymentReceipt(
        payment({ ownerPortion: null, unbilled: { kind: "rent", depositHolder: "owner", vatRate: 0 } }),
      ),
    );
    assert.deepEqual(byAccount.get("k:bank"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 0, credit: 500_000 });
    assert.equal(byAccount.has("k:tenant_receivables"), false);
  });

  test("the office's rent is income with the contract's VAT taken out", () => {
    const byAccount = amounts(
      planPaymentReceipt(
        payment({
          amount: 1_150,
          ownership: "office",
          ownerPortion: null,
          unbilled: { kind: "rent", depositHolder: "owner", vatRate: 15 },
        }),
      ),
    );
    assert.deepEqual(byAccount.get("k:rent_income"), { debit: 0, credit: 100_000 });
    assert.deepEqual(byAccount.get("k:output_vat"), { debit: 0, credit: 15_000 });
  });

  test("a deposit the office holds is a liability", () => {
    const byAccount = amounts(
      planPaymentReceipt(
        payment({
          ownership: "office",
          ownerPortion: null,
          unbilled: { kind: "deposit", depositHolder: "owner", vatRate: 0 },
        }),
      ),
    );
    assert.deepEqual(byAccount.get("k:security_deposits"), { debit: 0, credit: 500_000 });
  });

  test("an owner paid their own unbilled rent: nothing for the office's books", () => {
    assert.equal(
      planPaymentReceipt(
        payment({
          method: "owner_cash",
          ownerPortion: null,
          unbilled: { kind: "rent", depositHolder: "owner", vatRate: 0 },
        }),
      ),
      null,
    );
  });
});

describe("a refund", () => {
  test("turns the receipt around on the day of the refund", () => {
    const receipt = planPaymentReceipt(payment())!;
    const refundDay = new Date("2026-10-20T00:00:00.000Z");
    const refund = planPaymentRefund(receipt, { date: refundDay })!;
    assert.equal(refund.sourceType, "payment_refund");
    assert.equal(refund.sourceId, "pay-1");
    assert.equal(refund.date.getTime(), refundDay.getTime());
    const byAccount = totalsByAccount(refund.lines);
    assert.deepEqual(byAccount.get("k:bank"), { debit: 0, credit: 500_000 });
    assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:owner_uncollected_rent"), { debit: 0, credit: 500_000 });
  });
});

describe("money held as the tenant's credit", () => {
  // 3,000 paid at the desk, then 3,000 more through the gateway's page the
  // tenant had left open: the second 3,000 is the tenant's, not income.
  test("is received against the tenant's account, nothing to the owner or income", () => {
    const plan = planPaymentReceipt(
      payment({ amount: 3_000, method: "credit_card", online: true, credit: true, ownerPortion: null }),
    );
    const byAccount = amounts(plan);
    assert.deepEqual(byAccount.get("k:gateway_clearing"), { debit: 300_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 0, credit: 300_000 });
    assert.equal(byAccount.get("k:owner_payable"), undefined);
    assert.equal(byAccount.get("k:other_income"), undefined);
    assert.equal(byAccount.get("k:rent_income"), undefined);
    const receivable = plan!.lines.find((line) => "key" in line.account && line.account.key === "tenant_receivables");
    assert.equal(receivable?.partyId, "tenant-1");
  });

  test("its refund gives the gateway its money back and clears the credit", () => {
    const receipt = planPaymentReceipt(
      payment({ amount: 3_000, method: "credit_card", online: true, credit: true, ownerPortion: null }),
    )!;
    const byAccount = totalsByAccount(planPaymentRefund(receipt, { date: DAY })!.lines);
    assert.deepEqual(byAccount.get("k:gateway_clearing"), { debit: 0, credit: 300_000 });
    assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 300_000, credit: 0 });
  });
});

describe("a desk card payment on a row that once opened a checkout", () => {
  // The row keeps the abandoned checkout's reference; the person who recorded
  // it decides: the office's terminal, not the gateway.
  test("lands in POS clearing", async () => {
    const { isOnlinePayment } = await import("@/lib/payments/recorder");
    const online = isOnlinePayment({ gatewayPaymentId: "cs_abandoned", recordedById: "staff-1" });
    assert.equal(online, false);
    const byAccount = amounts(planPaymentReceipt(payment({ method: "credit_card", online })));
    assert.deepEqual(byAccount.get("k:pos_clearing"), { debit: 500_000, credit: 0 });
    assert.equal(byAccount.get("k:gateway_clearing"), undefined);
  });

  test("taken by the gateway itself, it stays in gateway clearing", async () => {
    const { isOnlinePayment } = await import("@/lib/payments/recorder");
    const online = isOnlinePayment({ gatewayPaymentId: "pi_paid", recordedById: null });
    assert.equal(online, true);
    const byAccount = amounts(planPaymentReceipt(payment({ method: "credit_card", online })));
    assert.deepEqual(byAccount.get("k:gateway_clearing"), { debit: 500_000, credit: 0 });
  });
});

test("nothing received posts nothing", () => {
  assert.equal(planPaymentReceipt(payment({ amount: 0 })), null);
});
