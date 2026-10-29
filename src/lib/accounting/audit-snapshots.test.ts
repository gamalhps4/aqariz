/**
 * What the books' activity entries say: names a reader recognises, account
 * numbers cut to their last four digits, money in riyals, a period lock that
 * weighs more when it is lifted than when it is set.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  accountMapLines,
  accountingSettingsSnapshot,
  ACCOUNTING_SETTINGS_KEYS,
  bankAccountLabel,
  bankAccountSnapshot,
  dayText,
  journalNumberLabel,
  journalSnapshot,
  ledgerAccountName,
  ledgerAccountSnapshot,
  maskTail,
  payoutSnapshot,
  periodChange,
  personName,
  reversalValues,
  riyals,
  settlementSnapshot,
  setupSnapshot,
  supplierSnapshot,
  sweepSnapshot,
  transferName,
  transferSnapshot,
  withoutEmpty,
} from "./audit-snapshots";
import { diffSettings, diffSnapshot } from "@/lib/audit/diff";
import { catalogTranslator } from "@/lib/audit/catalog";
import { formatAuditValue } from "@/lib/audit/render";
import {
  AUDIT_RECORD_TYPES,
  AuditAction,
  AuditSeverity,
  categoryFor,
  severityFor,
} from "@/lib/audit/vocabulary";

const en = catalogTranslator("en");
const ar = catalogTranslator("ar");

describe("account numbers", () => {
  test("a long IBAN keeps its last four digits and nothing else", () => {
    assert.equal(maskTail("SA03 8000 0000 6080 1016 7519"), "••••7519");
    assert.ok(!maskTail("SA0380000000608010167519")!.includes("8000"));
  });

  test("a short number says only that one is set", () => {
    assert.equal(maskTail("12345678"), "••••");
    assert.equal(maskTail("1234"), "••••");
  });

  test("nothing set is nothing", () => {
    assert.equal(maskTail(null), null);
    assert.equal(maskTail("  "), null);
  });

  test("a bank account entry never carries the whole number", () => {
    const snapshot = bankAccountSnapshot(
      {
        name: "Main account",
        kind: "bank",
        bankName: "Al Rajhi",
        iban: "SA0380000000608010167519",
        accountNumber: "608010167519",
        currency: "SAR",
      },
      "110201 - Main account",
    );
    assert.equal(snapshot.iban, "••••7519");
    assert.equal(snapshot.accountNumber, "••••7519");
    assert.ok(!JSON.stringify(snapshot).includes("SA0380000000"));
    assert.ok(!JSON.stringify(snapshot).includes("608010167519"));
  });

  test("a supplier entry never carries the whole IBAN either", () => {
    const snapshot = supplierSnapshot({
      id: "x",
      name: "Gulf Supplies",
      iban: "SA0380000000608010167519",
      vatNumber: "300000000000003",
      isActive: true,
    });
    assert.deepEqual(snapshot, {
      name: "Gulf Supplies",
      vatNumber: "300000000000003",
      iban: "••••7519",
      isActive: true,
    });
  });

  test("a change of IBAN shows as masked on both sides", () => {
    const diff = diffSnapshot(
      supplierSnapshot({ iban: "SA0380000000608010167519" }),
      supplierSnapshot({ iban: "SA4420000001234567891234" }),
    );
    assert.deepEqual(diff.before, { iban: "••••7519" });
    assert.deepEqual(diff.after, { iban: "••••1234" });
  });
});

describe("names", () => {
  test("a chart account is its code and its name, Arabic first", () => {
    assert.equal(
      ledgerAccountName({ code: "1101", nameAr: "النقدية", nameEn: "Cash" }),
      "1101 - النقدية",
    );
    assert.equal(ledgerAccountName({ code: "1101", nameAr: " ", nameEn: "Cash" }), "1101 - Cash");
    assert.equal(ledgerAccountName({ code: "1101", nameAr: "", nameEn: "" }), "1101");
  });

  test("a standard bank account has no name of its own: its ledger account's stands in", () => {
    assert.equal(
      bankAccountLabel({ name: "", ledgerAccount: { nameAr: "الصندوق", nameEn: "Cash on hand" } }),
      "الصندوق",
    );
    assert.equal(bankAccountLabel({ name: "Petty cash", ledgerAccount: { nameAr: "x" } }), "Petty cash");
    assert.equal(bankAccountLabel({ name: "", ledgerAccount: null }), null);
  });

  test("a transfer is named by its two accounts, with no arrow to mislead right-to-left readers", () => {
    assert.equal(transferName("الصندوق", "البنك الأهلي"), "الصندوق - البنك الأهلي");
    assert.equal(transferName("Cash", null), "Cash");
    assert.equal(transferName(null, ""), null);
  });

  test("a journal is its number as the screens print it", () => {
    assert.equal(journalNumberLabel(12), "#12");
    assert.equal(journalNumberLabel(null), null);
  });

  test("a person is their first and last name", () => {
    assert.equal(personName({ firstName: "Sara", lastName: " Al-Otaibi " }), "Sara Al-Otaibi");
    assert.equal(personName({ firstName: null, lastName: null }), null);
    assert.equal(personName(null), null);
  });
});

describe("a chart account", () => {
  const account = {
    code: "5101",
    nameAr: "صيانة",
    nameEn: "Maintenance",
    type: "expense",
    normalSide: "debit",
    postable: true,
    active: true,
  };

  test("holds the code, both names, the type, the side and where it sits", () => {
    const snapshot = ledgerAccountSnapshot(account, "5100 - مصروفات");
    assert.equal(snapshot.code, "5101");
    assert.equal(snapshot.accountType, "expense");
    assert.equal(snapshot.parentAccount, "5100 - مصروفات");
    assert.equal(snapshot.isActive, true);
  });

  test("a rename shows only the name that moved", () => {
    const diff = diffSnapshot(
      ledgerAccountSnapshot(account, null),
      ledgerAccountSnapshot({ ...account, nameEn: "Repairs" }, null),
    );
    assert.deepEqual(diff.changed, ["nameEn"]);
  });

  test("the type and the side read in the reader's language", () => {
    assert.equal(formatAuditValue("accountType", "expense", { t: ar }), "مصروفات");
    assert.equal(formatAuditValue("accountType", "asset", { t: en }), "Asset");
    assert.equal(formatAuditValue("normalSide", "credit", { t: ar }), "دائن");
    assert.equal(formatAuditValue("bankKind", "pos", { t: en }), "POS (mada)");
  });
});

describe("journals", () => {
  test("a journal is its date, total, lines, memo and reference", () => {
    const snapshot = journalSnapshot({
      date: new Date("2026-09-30T00:00:00.000Z"),
      totalHalalas: 150_075,
      lines: 3,
      memo: " Accrual ",
      reference: "",
    });
    assert.deepEqual(snapshot, {
      date: "2026-09-30",
      totalAmount: 1500.75,
      lines: 3,
      memo: "Accrual",
      reference: null,
    });
  });

  test("the total reads as money with two decimals", () => {
    assert.equal(formatAuditValue("totalAmount", 1500, { t: en }), "1,500.00");
    assert.equal(formatAuditValue("vatAmount", 15, { t: en }), "15.00");
    assert.equal(formatAuditValue("netDue", 2500.5, { t: en }), "2,500.50");
  });

  test("a reversal says what was reversed and by which entry", () => {
    const values = reversalValues({
      entryDate: new Date("2026-09-01T00:00:00.000Z"),
      totalAmount: "250.00",
      reversalNumber: 31,
      reversalDate: new Date("2026-10-02T00:00:00.000Z"),
      memo: null,
    });
    assert.deepEqual(values.before, { status: "posted", date: "2026-09-01", totalAmount: 250 });
    assert.deepEqual(values.after, {
      status: "reversed",
      reversalNumber: "#31",
      reversalDate: "2026-10-02",
      memo: null,
    });
  });

  test("the status words read in the reader's language once the catalogue has them", () => {
    // `admin.audit.values.posted` / `.reversed` come with the activity-log keys;
    // until then the generic wording of the key stands in.
    assert.equal(formatAuditValue("status", "reversed", { t: en, recordType: "journal_entry" }), "Reversed");
    assert.equal(formatAuditValue("status", "posted", { t: en, recordType: "owner_payout" }), "Posted");
  });
});

describe("owners and transfers", () => {
  test("a payout is its amount, day, account and notes", () => {
    const snapshot = payoutSnapshot({
      amount: "4200.00",
      date: new Date("2026-10-01T00:00:00.000Z"),
      bankAccount: "الراجحي",
      reference: "TR-9",
      notes: "",
      journalNumber: 18,
    });
    assert.deepEqual(snapshot, {
      amount: 4200,
      date: "2026-10-01",
      bankAccount: "الراجحي",
      reference: "TR-9",
      notes: null,
      journalNumber: "#18",
    });
  });

  test("a transfer is its two accounts, amount and day", () => {
    const snapshot = transferSnapshot({
      amount: 700,
      date: "2026-10-03",
      fromAccount: "الصندوق",
      toAccount: "الراجحي",
      status: "posted",
    });
    assert.equal(snapshot.fromAccount, "الصندوق");
    assert.equal(snapshot.toAccount, "الراجحي");
    assert.equal(snapshot.amount, 700);
    assert.equal(snapshot.status, "posted");
    assert.ok(!("journalNumber" in snapshot));
  });

  test("a settlement is its period and figures", () => {
    const snapshot = settlementSnapshot({
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-30T00:00:00.000Z"),
      collected: "10000.00",
      expenses: 1200,
      commission: 800,
      commissionVat: 120,
      investmentRent: 0,
      netDue: 7880,
      status: "settled",
    });
    assert.equal(snapshot.periodStart, "2026-09-01");
    assert.equal(snapshot.periodEnd, "2026-09-30");
    assert.equal(snapshot.collected, 10000);
    assert.equal(snapshot.expenseAmount, 1200);
    assert.equal(snapshot.netDue, 7880);
    assert.equal(snapshot.status, "settled");
  });
});

describe("the period lock", () => {
  test("closing a period is a medium event", () => {
    const change = periodChange(null, new Date("2026-09-30T00:00:00.000Z"));
    assert.equal(change.move, "closed");
    assert.equal(change.messageKey, "admin.audit.msg.period_closed");
    assert.equal(change.date, "2026-09-30");
    assert.equal(change.severity, AuditSeverity.MEDIUM);
  });

  test("closing further is closing", () => {
    const change = periodChange("2026-08-31", "2026-09-30");
    assert.equal(change.move, "closed");
    assert.equal(change.severity, AuditSeverity.MEDIUM);
  });

  test("reopening everything is a high event and names the day that was lifted", () => {
    const change = periodChange("2026-09-30", null);
    assert.equal(change.move, "reopened");
    assert.equal(change.messageKey, "admin.audit.msg.period_reopened");
    assert.equal(change.date, "2026-09-30");
    assert.equal(change.severity, AuditSeverity.HIGH);
  });

  test("moving the lock back is a high event and names the new day", () => {
    const change = periodChange("2026-09-30", "2026-07-31");
    assert.equal(change.move, "moved_back");
    assert.equal(change.messageKey, "admin.audit.msg.period_moved_back");
    assert.equal(change.date, "2026-07-31");
    assert.equal(change.severity, AuditSeverity.HIGH);
  });

  test("the same day again is not a move", () => {
    const change = periodChange("2026-09-30", new Date("2026-09-30T00:00:00.000Z"));
    assert.equal(change.move, "unchanged");
    assert.equal(change.messageKey, null);
  });
});

describe("accounting settings", () => {
  const chart = [
    { id: "a1", code: "110201", nameAr: "الراجحي", nameEn: "Al Rajhi" },
    { id: "a2", code: "2201", nameAr: "", nameEn: "Owners payable" },
  ];

  test("the posting accounts the office chose are one line each, in the order of the jobs", () => {
    assert.deepEqual(accountMapLines({ owner_payable: "a2", bank: "a1" }, chart), [
      "bank: 110201 - الراجحي",
      "owner_payable: 2201 - Owners payable",
    ]);
    assert.deepEqual(accountMapLines({}, chart), []);
    assert.deepEqual(accountMapLines(null, chart), []);
  });

  test("a save that changes nothing records nothing", () => {
    const row = {
      cutOverDate: new Date("2026-01-01T00:00:00.000Z"),
      vatRegistered: true,
      vatNumber: "300000000000003",
      depositHolder: "owner",
    };
    const diff = diffSettings(
      accountingSettingsSnapshot(row, ["bank: 110201 - الراجحي"]),
      accountingSettingsSnapshot({ ...row }, ["bank: 110201 - الراجحي"]),
      ACCOUNTING_SETTINGS_KEYS,
    );
    assert.deepEqual(diff.changed, []);
  });

  test("only the setting that moved is recorded", () => {
    const row = {
      cutOverDate: new Date("2026-01-01T00:00:00.000Z"),
      vatRegistered: false,
      vatNumber: null,
      depositHolder: "owner",
    };
    const diff = diffSettings(
      accountingSettingsSnapshot(row, []),
      accountingSettingsSnapshot({ ...row, vatRegistered: true, depositHolder: "office" }, []),
      ACCOUNTING_SETTINGS_KEYS,
    );
    assert.deepEqual(diff.changed.sort(), ["depositHolder", "vatRegistered"]);
    assert.deepEqual(diff.after, { vatRegistered: true, depositHolder: "office" });
  });

  test("a changed posting account shows both lists", () => {
    const row = { cutOverDate: null, vatRegistered: false, vatNumber: null, depositHolder: "owner" };
    const diff = diffSettings(
      accountingSettingsSnapshot(row, []),
      accountingSettingsSnapshot(row, accountMapLines({ bank: "a1" }, chart)),
      ACCOUNTING_SETTINGS_KEYS,
    );
    assert.deepEqual(diff.changed, ["accountMap"]);
    assert.deepEqual(diff.after.accountMap, ["bank: 110201 - الراجحي"]);
  });

  test("who holds the deposits reads in the reader's language", () => {
    assert.equal(formatAuditValue("depositHolder", "owner", { t: en }), "Owner");
  });

  test("setting accounting up again, with nothing to add, is no event", () => {
    assert.equal(
      setupSnapshot({ createdSettings: false, accountsCreated: 0, bankAccountsCreated: 0 }),
      null,
    );
  });

  test("the first set-up records its counts and the starting settings", () => {
    assert.deepEqual(
      setupSnapshot({
        createdSettings: true,
        accountsCreated: 142,
        bankAccountsCreated: 4,
        cutOverDate: new Date("2026-10-01T00:00:00.000Z"),
        vatRegistered: true,
        vatNumber: "300000000000003",
      }),
      {
        accountsCreated: 142,
        bankAccountsCreated: 4,
        cutOverDate: "2026-10-01",
        vatRegistered: true,
        vatNumber: "300000000000003",
      },
    );
  });

  test("a later set-up that added accounts records the counts only", () => {
    assert.deepEqual(
      setupSnapshot({ createdSettings: false, accountsCreated: 2, bankAccountsCreated: 0 }),
      { accountsCreated: 2, bankAccountsCreated: 0 },
    );
  });
});

describe("the catch-up sweep", () => {
  test("a run that found nothing is no event", () => {
    assert.equal(
      sweepSnapshot({ created: 0, replaced: 0, reversed: 0, failed: 0, remaining: 0 }),
      null,
    );
  });

  test("a run records what it posted, replaced, reversed, failed and left", () => {
    assert.deepEqual(
      sweepSnapshot({ created: 12, replaced: 1, reversed: 2, failed: 0, remaining: 40 }),
      {
        entriesCreated: 12,
        entriesReplaced: 1,
        entriesReversed: 2,
        entriesFailed: 0,
        documentsRemaining: 40,
      },
    );
  });
});

describe("small helpers", () => {
  test("a snapshot drops the fields nothing was written to", () => {
    assert.deepEqual(withoutEmpty({ a: 1, b: null, c: "", d: undefined, e: false, f: 0 }), {
      a: 1,
      e: false,
      f: 0,
    });
  });

  test("a day and an amount", () => {
    assert.equal(dayText(new Date("2026-10-04T00:00:00.000Z")), "2026-10-04");
    assert.equal(dayText("2026-10-04T10:00:00.000Z"), "2026-10-04");
    assert.equal(dayText(null), null);
    assert.equal(dayText("not a date"), null);
    assert.equal(riyals("1234.5"), 1234.5);
    assert.equal(riyals("abc"), 0);
  });
});

describe("the vocabulary these entries rely on", () => {
  const types = [
    "ledger_account",
    "bank_account",
    "journal_entry",
    "opening_balance",
    "owner_payout",
    "owner_settlement",
    "bank_transfer",
    "accounting_period",
  ];

  test("each record type is offered by the filter and filed under payments", () => {
    for (const type of types) {
      assert.ok((AUDIT_RECORD_TYPES as readonly string[]).includes(type), `${type} is a filter option`);
      assert.equal(categoryFor(AuditAction.CREATE, type), "payment_management", type);
    }
  });

  test("a reversal weighs as much as a deletion", () => {
    assert.equal(severityFor(AuditAction.REVERSE), AuditSeverity.MEDIUM);
    assert.equal(severityFor(AuditAction.DELETE), AuditSeverity.MEDIUM);
  });
});
