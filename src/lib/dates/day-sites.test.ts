/**
 * The places that ask "which day is it?" all answer with Riyadh's.
 *
 * Riyadh is UTC+3, so 21:00–23:59 UTC is already the NEXT day there. Each of
 * these used the server's clock (`toISOString().slice(0, 10)`, `setHours`,
 * `new Date()`), and for those three hours every night they were a day
 * behind: a late-night invoice carried the day before on its QR code, rent
 * stayed "due" until 03:00, a contract-date edit looked like a change. Each
 * test puts the clock on both sides of Riyadh's midnight and says what day it
 * is — the machine this runs on is irrelevant.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { formatDay, ledgerDay } from "@/lib/accounting/dates";
import {
  computeEffectiveInvoiceStatus,
} from "@/lib/invoice/invoice-shared";
import { zatcaIssueMoment } from "@/lib/invoice/zatca-qr";
import { changedTerms } from "@/lib/lease-term-edits";
import {
  classifyInstallment,
  isOverdue,
  isPastDueDate,
} from "@/lib/lease-installment-state";
import { dayOf, riyadhDay } from "@/lib/listings/dates";
import { statementDay } from "@/lib/statements/document";
import { formatDateFor } from "@/lib/i18n/translate";
import { InvoiceStatus } from "@/types";

/** The 3rd's last Riyadh minute, and the 4th's first. */
const LAST_OF_THE_3RD = new Date("2026-10-03T20:59:59.999Z");
const FIRST_OF_THE_4TH = new Date("2026-10-03T21:00:00.000Z");
/** 01:30 on the 4th in Riyadh; still the 3rd on a UTC clock. */
const EARLY_ON_THE_4TH = new Date("2026-10-03T22:30:00.000Z");

const stored = (day: string) => new Date(`${day}T00:00:00.000Z`);

describe("an invoice's status follows Riyadh's day", () => {
  const base = {
    status: InvoiceStatus.ISSUED as string,
    totalAmount: 1000,
    amountPaid: 0,
    balanceRemaining: 1000,
    issueDate: stored("2026-09-01"),
    dueDate: stored("2026-10-03"),
  };

  test("is not overdue on its due day, to the last millisecond", () => {
    assert.equal(
      computeEffectiveInvoiceStatus(base, LAST_OF_THE_3RD),
      InvoiceStatus.ISSUED,
    );
  });

  test("is overdue from Riyadh's midnight, not three hours later", () => {
    assert.equal(
      computeEffectiveInvoiceStatus(base, FIRST_OF_THE_4TH),
      InvoiceStatus.OVERDUE,
    );
    assert.equal(
      computeEffectiveInvoiceStatus(base, EARLY_ON_THE_4TH),
      InvoiceStatus.OVERDUE,
    );
  });

  test("a scheduled invoice is issued from the start of its issue day", () => {
    const scheduled = {
      ...base,
      status: InvoiceStatus.SCHEDULED as string,
      issueDate: stored("2026-10-04"),
      dueDate: stored("2026-11-04"),
    };
    assert.equal(
      computeEffectiveInvoiceStatus(scheduled, LAST_OF_THE_3RD),
      InvoiceStatus.SCHEDULED,
    );
    assert.equal(
      computeEffectiveInvoiceStatus(scheduled, FIRST_OF_THE_4TH),
      InvoiceStatus.ISSUED,
    );
  });

  test("an invoice written the instant it is dated is issued at once", () => {
    const written = {
      ...base,
      status: InvoiceStatus.SCHEDULED as string,
      issueDate: EARLY_ON_THE_4TH,
      dueDate: stored("2026-11-04"),
    };
    assert.equal(
      computeEffectiveInvoiceStatus(written, EARLY_ON_THE_4TH),
      InvoiceStatus.ISSUED,
    );
  });
});

describe("an installment's state follows Riyadh's day", () => {
  const installment = (due: string) => ({
    status: InvoiceStatus.ISSUED as string,
    dueDate: stored(due),
    amountPaid: 0,
    balanceRemaining: 1000,
  });

  test("due on the 3rd: due to the last millisecond, overdue after", () => {
    assert.equal(classifyInstallment(installment("2026-10-03"), LAST_OF_THE_3RD), "due");
    assert.equal(classifyInstallment(installment("2026-10-03"), FIRST_OF_THE_4TH), "overdue");
    assert.equal(isPastDueDate("2026-10-03", LAST_OF_THE_3RD), false);
    assert.equal(isPastDueDate("2026-10-03", FIRST_OF_THE_4TH), true);
  });

  test("the week-ahead window counts from Riyadh's today", () => {
    // From the 4th, the 11th is the last day of the week ahead; the 12th is not.
    assert.equal(classifyInstallment(installment("2026-10-11"), FIRST_OF_THE_4TH), "due");
    assert.equal(classifyInstallment(installment("2026-10-12"), FIRST_OF_THE_4TH), "upcoming");
    // Still the 3rd a minute earlier: the 10th is the last day.
    assert.equal(classifyInstallment(installment("2026-10-11"), LAST_OF_THE_3RD), "upcoming");
  });

  test("the overdue figure turns over with the badge", () => {
    const row = {
      dueDate: stored("2026-10-03"),
      balanceRemaining: 400,
      state: "partial" as const,
    };
    assert.equal(isOverdue(row, LAST_OF_THE_3RD), false);
    assert.equal(isOverdue(row, FIRST_OF_THE_4TH), true);
  });
});

describe("the day an invoice is issued on", () => {
  test("an invoice written at 01:30 on the 4th is the 4th's, so it keeps its time", () => {
    // Dated the 4th (stored at midnight UTC), written 22:30 UTC on the 3rd —
    // the same day in Riyadh. Read in UTC they differ, and the QR code
    // stamped the start of the day instead of the moment it was written.
    assert.equal(
      zatcaIssueMoment(stored("2026-10-04"), EARLY_ON_THE_4TH),
      EARLY_ON_THE_4TH,
    );
  });

  test("written the evening before is another day", () => {
    const evening = new Date("2026-10-03T19:00:00.000Z"); // 22:00 on the 3rd, Riyadh
    const day = stored("2026-10-04");
    assert.equal(zatcaIssueMoment(day, evening), day);
  });
});

describe("a contract date is the same day however it was stored", () => {
  const contract = {
    startDate: stored("2026-10-04"),
    endDate: stored("2027-10-03"),
    propertyId: "p",
    unitId: "u",
    tenantId: "t",
  };

  test("a row stored at Riyadh's midnight is the day the form sends", () => {
    // 21:00 UTC on the 3rd is 00:00 on the 4th in Riyadh: the same day.
    const older = { ...contract, startDate: FIRST_OF_THE_4TH };
    assert.deepEqual(changedTerms(older, { startDate: stored("2026-10-04") }), []);
  });

  test("another day is a change", () => {
    assert.deepEqual(changedTerms(contract, { startDate: stored("2026-10-05") }), [
      "startDate",
    ]);
    assert.deepEqual(changedTerms(contract, { endDate: stored("2027-10-04") }), [
      "endDate",
    ]);
  });
});

describe("the days other screens print", () => {
  test("a statement row is dated the day it happened in Riyadh", () => {
    assert.equal(statementDay("2026-10-03T21:30:00.000Z"), "2026-10-04");
    assert.equal(statementDay("2026-10-03T20:30:00.000Z"), "2026-10-03");
    assert.equal(statementDay("2026-10-04T00:00:00.000Z"), "2026-10-04");
  });

  test("a listing's today turns over at Riyadh's midnight", () => {
    assert.equal(riyadhDay(LAST_OF_THE_3RD), "2026-10-03");
    assert.equal(riyadhDay(FIRST_OF_THE_4TH), "2026-10-04");
  });

  test("a stored licence expiry is the day it names", () => {
    assert.equal(dayOf(stored("2026-10-03")), "2026-10-03");
    assert.equal(dayOf("2026-10-03"), "2026-10-03");
    assert.equal(dayOf(null), null);
  });

  test("a journal entry is dated the Riyadh day, stored at midnight UTC", () => {
    const entry = ledgerDay(EARLY_ON_THE_4TH);
    assert.equal(entry.toISOString(), "2026-10-04T00:00:00.000Z");
    assert.equal(formatDay(entry), "2026-10-04");
    // A day already stored stays itself.
    assert.equal(formatDay(stored("2026-10-03")), "2026-10-03");
  });

  test("a fallback date, when the locale cannot format one, is the same day", () => {
    // An unknown zone makes Intl throw; the fallback must still be a day.
    assert.equal(
      formatDateFor("en", EARLY_ON_THE_4TH, { timeZone: "Not/AZone" }),
      "2026-10-04",
    );
  });
});
