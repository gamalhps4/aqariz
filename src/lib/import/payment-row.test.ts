/**
 * One payment row of an import file.
 *
 * Money already received against an installment, recorded by the service
 * behind the "Record payment" dialog. What is pinned here is what comes
 * before it: the row is read strictly (a payment date is required, only the
 * methods staff record with are accepted), the installment is picked without
 * guessing, and the service's refusals — cancelled, already paid, more than
 * is left — are asked of every row before the real run, with the rows above
 * it counted.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { PaymentMethod } from "@/types";
import { normalizeHeader } from "@/lib/import/csv";
import {
  PaymentFilePlan,
  installmentPaymentRefusal,
  pickInstallment,
  readPaymentMethod,
  readPaymentRow,
  type InstallmentRecord,
} from "@/lib/import/payment-row";

const TODAY = "2026-10-16";

function row(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [normalizeHeader(key), value]),
  );
}

const complete = {
  contractNumber: "20123456789",
  dueDate: "2026-03-01",
  amount: "1500",
  paidDate: "2026-03-03",
  paymentMethod: "bank_transfer",
  reference: "TRX-558812",
};

const code = (fields: Record<string, string>) => {
  const read = readPaymentRow(row(fields), TODAY);
  return read.ok ? null : read.issue.code;
};

describe("a payment row", () => {
  test("reads what the template asks for", () => {
    const read = readPaymentRow(row(complete), TODAY);
    assert.deepEqual(read, {
      ok: true,
      warnings: [],
      value: {
        contractNumber: "20123456789",
        tenant: { idNumber: "", email: "", phone: "" },
        unit: { building: "", unitNumber: "" },
        invoiceNumber: null,
        dueDate: "2026-03-01",
        amount: 1500,
        paidDate: "2026-03-03",
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        reference: "TRX-558812",
        notes: undefined,
      },
    });
  });

  test("may name the installment by invoice number alone", () => {
    assert.equal(
      code({ invoiceNumber: "INV-2026-0001", amount: "1500", paidDate: "03/03/2026", method: "cash" }),
      null,
    );
  });

  test("may name the contract by its tenant, building and unit", () => {
    assert.equal(
      code({
        tenantIdNumber: "1012345678",
        buildingName: "شقق الواحة",
        unitNumber: "B201",
        dueDate: "2026-03-01",
        amount: "1500",
        paidDate: "2026-03-03",
        paymentMethod: "pos",
      }),
      null,
    );
  });

  test("needs a payment date — today's would put past money in this week", () => {
    assert.equal(code({ ...complete, paidDate: "" }), "dateMissing");
    assert.equal(code({ ...complete, paidDate: "3rd March" }), "dateInvalid");
  });

  test("needs an amount above zero", () => {
    assert.equal(code({ ...complete, amount: "" }), "amountMissing");
    assert.equal(code({ ...complete, amount: "0" }), "amountMissing");
    assert.equal(code({ ...complete, amount: "1,500.005" }), "amountInvalid");
  });

  test("needs a method staff may record with, and refuses any other", () => {
    assert.equal(code({ ...complete, paymentMethod: "" }), "methodMissing");
    // A card or gateway method decides the owner statement wrongly if guessed.
    assert.equal(code({ ...complete, paymentMethod: "credit_card" }), "methodInvalid");
    assert.equal(code({ ...complete, paymentMethod: "cheque" }), "methodInvalid");
  });

  test("needs to say which installment, and whose", () => {
    assert.equal(code({ ...complete, dueDate: "" }), "installmentKeyMissing");
    assert.equal(code({ ...complete, contractNumber: "" }), "contractKeyMissing");
    // A tenant without the unit is not enough to find the contract.
    assert.equal(
      code({ ...complete, contractNumber: "", tenantIdNumber: "1012345678" }),
      "contractKeyMissing",
    );
  });

  test("dated in the future is read, with a warning about swapped day and month", () => {
    const read = readPaymentRow(row({ ...complete, paidDate: "2026-12-03" }), TODAY);
    assert.equal(read.ok, true);
    assert.deepEqual(read.ok && read.warnings.map((warning) => warning.code), [
      "paidDateFuture",
    ]);
  });
});

describe("a payment method", () => {
  test("is read as stored, in English, or as the record dialog says it in Arabic", () => {
    assert.equal(readPaymentMethod("cash"), PaymentMethod.CASH);
    assert.equal(readPaymentMethod("Bank Transfer"), PaymentMethod.BANK_TRANSFER);
    assert.equal(readPaymentMethod("bank-transfer"), PaymentMethod.BANK_TRANSFER);
    assert.equal(readPaymentMethod("Cash to Owner"), PaymentMethod.OWNER_CASH);
    assert.equal(readPaymentMethod("تحويل بنكي"), PaymentMethod.BANK_TRANSFER);
    assert.equal(readPaymentMethod("نقدًا للمالك"), PaymentMethod.OWNER_CASH);
    assert.equal(readPaymentMethod("Ejar"), PaymentMethod.EJARI);
    assert.equal(readPaymentMethod("منصة إيجار"), PaymentMethod.EJARI);
    assert.equal(readPaymentMethod("paypal"), null);
  });
});

const installment = (fields: Partial<InstallmentRecord>): InstallmentRecord => ({
  id: "inv-1",
  invoiceNumber: "INV-2026-0001",
  leaseId: "lease-1",
  dueDay: "2026-03-01",
  status: "issued",
  category: "rent",
  balanceRemaining: 1500,
  tenantId: "tenant-1",
  propertyId: "property-1",
  ...fields,
});

describe("the installment a row pays", () => {
  const rent = installment({});
  const deposit = installment({
    id: "inv-dep",
    invoiceNumber: "INV-2026-0002",
    category: "security_deposit",
    balanceRemaining: 3000,
  });
  const april = installment({ id: "inv-2", invoiceNumber: "INV-2026-0003", dueDay: "2026-04-01" });

  test("is found by invoice number, written any way", () => {
    const pick = pickInstallment([rent, deposit, april], {
      invoiceNumber: "inv 2026 0003",
      dueDate: null,
    });
    assert.equal(pick.ok && pick.installment.id, "inv-2");
  });

  test("by number, with a due date that disagrees, is refused", () => {
    const pick = pickInstallment([rent, april], {
      invoiceNumber: "INV-2026-0003",
      dueDate: "2026-03-01",
    });
    assert.equal(!pick.ok && pick.issue.code, "installmentDateMismatch");
  });

  test("by due date prefers the rent over a deposit due the same day", () => {
    const pick = pickInstallment([rent, deposit, april], {
      invoiceNumber: null,
      dueDate: "2026-03-01",
    });
    assert.equal(pick.ok && pick.installment.id, "inv-1");
  });

  test("by due date prefers the charge still owing", () => {
    const paidRent = installment({ balanceRemaining: 0, status: "paid" });
    const pick = pickInstallment([paidRent, deposit], {
      invoiceNumber: null,
      dueDate: "2026-03-01",
    });
    assert.equal(pick.ok && pick.installment.id, "inv-dep");
  });

  test("is not guessed between two contracts with an installment that day", () => {
    const other = installment({ id: "inv-9", invoiceNumber: "INV-9", leaseId: "lease-2" });
    const pick = pickInstallment([rent, other], { invoiceNumber: null, dueDate: "2026-03-01" });
    assert.equal(!pick.ok && pick.issue.code, "contractAmbiguous");
  });

  test("names the day when nothing is due on it", () => {
    const pick = pickInstallment([rent], { invoiceNumber: null, dueDate: "2026-05-01" });
    assert.deepEqual(!pick.ok && pick.issue.values, { date: "2026-05-01" });
  });
});

describe("a payment on an installment", () => {
  test("is refused when it is more than what is left, as the service refuses it", () => {
    assert.equal(installmentPaymentRefusal(installment({}), 1500), null);
    // The service's half-halala of slack.
    assert.equal(installmentPaymentRefusal(installment({}), 1500.004), null);
    const refusal = installmentPaymentRefusal(installment({}), 1600);
    assert.equal(refusal?.code, "overpayment");
    assert.deepEqual(refusal?.values, {
      amount: "1600.00",
      number: "INV-2026-0001",
      balance: "1500.00",
    });
  });

  test("is refused on a cancelled or settled installment, or one that is not a tenant's", () => {
    assert.equal(
      installmentPaymentRefusal(installment({ status: "cancelled" }), 10)?.code,
      "installmentCancelled",
    );
    assert.equal(
      installmentPaymentRefusal(installment({ balanceRemaining: 0, status: "paid" }), 10)?.code,
      "installmentPaid",
    );
    assert.equal(
      installmentPaymentRefusal(installment({ tenantId: null }), 10)?.code,
      "notTenantInstallment",
    );
  });

  test("counts what the rows above put on the same installment", () => {
    const plan = new PaymentFilePlan();
    const first = readPaymentRow(row({ ...complete, amount: "1000" }), TODAY);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    plan.admit("inv-1", first.value, 2);

    assert.equal(installmentPaymentRefusal(installment({}), 500, plan.plannedOn("inv-1")), null);
    assert.equal(
      installmentPaymentRefusal(installment({}), 600, plan.plannedOn("inv-1"))?.code,
      "overpaymentInFile",
    );

    plan.admit("inv-1", { ...first.value, amount: 500 }, 3);
    assert.equal(
      installmentPaymentRefusal(installment({}), 1, plan.plannedOn("inv-1"))?.code,
      "installmentPaidInFile",
    );
  });

  test("repeated further down the file is noticed", () => {
    const plan = new PaymentFilePlan();
    const read = readPaymentRow(row({ ...complete, amount: "500" }), TODAY);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    plan.admit("inv-1", read.value, 2);
    assert.equal(plan.repeats("inv-1", read.value), 2);
    assert.equal(plan.repeats("inv-1", { ...read.value, reference: "other" }), null);
    assert.equal(plan.repeats("inv-2", read.value), null);
  });
});
