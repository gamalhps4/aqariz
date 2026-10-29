/**
 * The words the books' activity entries are read in: every field they carry,
 * the record types, the sentences and the status words have a text in all five
 * languages. The fields are collected from the builders themselves, so a field
 * added to one without a label fails here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { translations } from "@/locales";
import { AUDIT_RECORD_TYPES, AuditAction } from "@/lib/audit/vocabulary";
import {
  accountingSettingsSnapshot,
  bankAccountSnapshot,
  journalSnapshot,
  ledgerAccountSnapshot,
  payoutSnapshot,
  reversalValues,
  settlementSnapshot,
  setupSnapshot,
  SUPPLIER_AUDIT_KEYS,
  supplierSnapshot,
  sweepSnapshot,
  transferSnapshot,
} from "./audit-snapshots";

const LOCALES = ["en", "ar"] as const;

function missing(key: string): string[] {
  const entry = translations[key] as Record<string, string> | undefined;
  return LOCALES.filter((locale) => !entry?.[locale]?.trim()).map((locale) => `${locale}:${key}`);
}

function fieldsOfTheBuilders(): Set<string> {
  const seen = new Set<string>();
  const collect = (values: Record<string, unknown> | null | undefined) => {
    for (const key of Object.keys(values ?? {})) seen.add(key);
  };
  collect(
    ledgerAccountSnapshot(
      { code: "1", nameAr: "ا", nameEn: "a", type: "asset", normalSide: "debit", postable: true, active: true, description: "d" },
      "parent",
    ),
  );
  collect(
    bankAccountSnapshot(
      { name: "n", kind: "bank", bankName: "b", iban: "SA0380000000608010167519", accountNumber: "608010167519", currency: "SAR", notes: "x", active: true },
      "ledger",
    ),
  );
  collect(journalSnapshot({ date: "2026-10-01", totalHalalas: 100, lines: 2, memo: "m", reference: "r" }));
  const reversal = reversalValues({
    entryDate: "2026-10-01",
    totalAmount: 1,
    reversalNumber: 2,
    reversalDate: "2026-10-02",
    memo: "m",
  });
  collect(reversal.before);
  collect(reversal.after);
  collect(
    payoutSnapshot({ amount: 1, date: "2026-10-01", bankAccount: "b", reference: "r", notes: "n", journalNumber: 1, status: "posted" }),
  );
  collect(
    transferSnapshot({
      amount: 1,
      date: "2026-10-01",
      fromAccount: "a",
      toAccount: "b",
      reference: "r",
      memo: "m",
      journalNumber: 1,
      status: "posted",
    }),
  );
  collect(
    settlementSnapshot({
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      collected: 1,
      expenses: 1,
      commission: 1,
      commissionVat: 1,
      investmentRent: 1,
      netDue: 1,
      notes: "n",
      journalNumber: 1,
      status: "settled",
    }),
  );
  collect(accountingSettingsSnapshot({ cutOverDate: "2026-01-01", vatRegistered: true, vatNumber: "3", depositHolder: "owner" }, []));
  collect(
    setupSnapshot({
      createdSettings: true,
      accountsCreated: 1,
      bankAccountsCreated: 1,
      cutOverDate: "2026-01-01",
      vatRegistered: true,
      vatNumber: "3",
    }),
  );
  collect(sweepSnapshot({ created: 1, replaced: 1, reversed: 1, failed: 1, remaining: 1 }));
  collect(supplierSnapshot(Object.fromEntries(SUPPLIER_AUDIT_KEYS.map((key) => [key, "x"]))));
  // Written inline by the services (bills, vouchers, reconciliation, the period lock).
  for (const key of [
    "supplier",
    "supplierInvoiceNumber",
    "billDate",
    "dueDate",
    "totalAmount",
    "vatAmount",
    "lines",
    "status",
    "reason",
    "amount",
    "account",
    "voucherDate",
    "bills",
    "appliedToBills",
    "reconciledOn",
    "closedThrough",
  ]) {
    seen.add(key);
  }
  return seen;
}

describe("the words of the books' activity entries", () => {
  test("every field has a label in all five languages", () => {
    const problems = [...fieldsOfTheBuilders()].flatMap((field) => missing(`admin.audit.fields.${field}`));
    assert.deepEqual(problems, []);
  });

  test("every record type of the books has a name in all five languages", () => {
    const types = [
      "ledger_account",
      "bank_account",
      "journal_entry",
      "opening_balance",
      "owner_payout",
      "owner_settlement",
      "bank_transfer",
      "accounting_period",
      "supplier",
      "purchase_bill",
      "payment_voucher",
      "bank_reconciliation",
    ];
    for (const type of types) {
      assert.ok((AUDIT_RECORD_TYPES as readonly string[]).includes(type), `${type} is a filter option`);
    }
    assert.deepEqual(types.flatMap((type) => missing(`admin.audit.types.${type}`)), []);
  });

  test("the reversal action and its sentence are worded", () => {
    assert.deepEqual(missing(`admin.audit.actions.${AuditAction.REVERSE}`), []);
    assert.deepEqual(missing(`admin.audit.msg.${AuditAction.REVERSE}`), []);
  });

  test("the sentences are worded, and each keeps the token it is given", () => {
    const sentences: Array<[string, string]> = [
      ["admin.audit.msg.record_activated", "{type}"],
      ["admin.audit.msg.record_deactivated", "{type}"],
      ["admin.audit.msg.period_closed", "{date}"],
      ["admin.audit.msg.period_reopened", "{date}"],
      ["admin.audit.msg.period_moved_back", "{date}"],
      ["admin.audit.msg.accounting_setup", ""],
      ["admin.audit.msg.ledger_sweep", ""],
      ["admin.audit.msg.reverse", "{type}"],
      // The screen's own sentences, reused for the reconciliation entry.
      ["purchases.reconcile.reconciledToast", "{count}"],
      ["purchases.reconcile.unreconciledToast", "{count}"],
    ];
    const problems: string[] = [];
    for (const [key, token] of sentences) {
      problems.push(...missing(key));
      const entry = translations[key] as Record<string, string> | undefined;
      for (const locale of LOCALES) {
        if (token && entry?.[locale] && !entry[locale].includes(token)) {
          problems.push(`${locale}:${key} lacks ${token}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  test("the status and value words are worded", () => {
    const problems = ["posted", "reversed", "settled", "owner", "office"].flatMap((value) =>
      missing(`admin.audit.values.${value}`),
    );
    assert.deepEqual(problems, []);
  });
});
