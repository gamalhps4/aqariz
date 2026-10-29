/**
 * How an import row finds its tenant and its unit, and reads its cells.
 *
 * A spreadsheet knows people and flats by what the contract prints — an ID
 * or iqama, an email, a mobile number, a building's name and a unit number.
 * Where money and contracts are concerned the matching is strict: the
 * strongest identifier decides, an identifier naming two people is not
 * guessed between, and a row whose identifiers name two different people is
 * refused rather than given to either.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  addBuilding,
  matchTenant,
  matchUnit,
  readTenantKeys,
  tenantDirectory,
  unitDirectory,
} from "@/lib/import/match";
import { nameKey, readAmount, readDay, westernDigits } from "@/lib/import/cells";

const people = tenantDirectory([
  { id: "sara", idNumber: "1012345678", email: "Sara@Example.com", phone: "+966501230110" },
  { id: "fahd", idNumber: null, email: "fahd@example.com", phone: "+966501230112" },
  // Two tenants sharing a family phone.
  { id: "noura", idNumber: "1098765432", email: null, phone: "+966500000000" },
  { id: "omar", idNumber: null, email: "omar@example.com", phone: "+966500000000" },
]);

const keys = (fields: Partial<{ idNumber: string; email: string; phone: string }>) => ({
  idNumber: "",
  email: "",
  phone: "",
  ...fields,
});

describe("a row's tenant", () => {
  test("is found by national ID / iqama first", () => {
    assert.deepEqual(matchTenant(people, keys({ idNumber: "1012345678" })), {
      ok: true,
      tenantId: "sara",
    });
  });

  test("falls back to email when the ID is not on file", () => {
    // Fahd was imported from a list of names: no ID yet.
    assert.deepEqual(
      matchTenant(people, keys({ idNumber: "1111111111", email: "FAHD@example.com " })),
      { ok: true, tenantId: "fahd" },
    );
  });

  test("is found by a phone typed the way it is dialled at home", () => {
    assert.deepEqual(matchTenant(people, keys({ phone: "050 123 0110" })), {
      ok: true,
      tenantId: "sara",
    });
    assert.deepEqual(matchTenant(people, keys({ phone: "00966501230112" })), {
      ok: true,
      tenantId: "fahd",
    });
    // Arabic-Indic digits, as an Arabic keyboard types them.
    assert.deepEqual(matchTenant(people, keys({ phone: "٠٥٠١٢٣٠١١٠" })), {
      ok: true,
      tenantId: "sara",
    });
  });

  test("is not guessed when a phone belongs to two tenants", () => {
    const match = matchTenant(people, keys({ phone: "0500000000" }));
    assert.equal(match.ok, false);
    assert.equal(!match.ok && match.issue.code, "tenantAmbiguous");
  });

  test("is settled by a stronger identifier even when the phone is shared", () => {
    assert.deepEqual(
      matchTenant(people, keys({ idNumber: "1098765432", phone: "0500000000" })),
      { ok: true, tenantId: "noura" },
    );
  });

  test("is refused when the identifiers name two different people", () => {
    const match = matchTenant(
      people,
      keys({ idNumber: "1012345678", email: "fahd@example.com" }),
    );
    assert.equal(match.ok, false);
    assert.equal(!match.ok && match.issue.code, "tenantConflict");
  });

  test("names what was looked for when nobody matches", () => {
    const match = matchTenant(people, keys({ email: "nobody@example.com" }));
    assert.equal(match.ok, false);
    assert.deepEqual(!match.ok && match.issue.values, { value: "nobody@example.com" });
  });

  test("is asked for when the row gives no identifier at all", () => {
    const match = matchTenant(people, keys({}));
    assert.equal(!match.ok && match.issue.code, "tenantKeyMissing");
  });

  test("is read from any of the template's spellings", () => {
    assert.deepEqual(
      readTenantKeys({ iqama: "2345678901", tenantemail: "a@b.c", mobile: "0501" }),
      { idNumber: "2345678901", email: "a@b.c", phone: "0501" },
    );
  });
});

describe("a row's unit", () => {
  const places = unitDirectory([
    { id: "b201", unitNumber: "B201", status: "available", propertyId: "oasis", propertyName: "شقق الواحة" },
    { id: "a101", unitNumber: "A-101", status: "occupied", propertyId: "oasis", propertyName: "شقق الواحة" },
    { id: "t1", unitNumber: "T1", status: "available", propertyId: "palm-1", propertyName: "Palm Villas" },
    { id: "t1b", unitNumber: "T1", status: "available", propertyId: "palm-2", propertyName: "palm villas" },
  ]);
  addBuilding(places, { id: "empty", name: "New Tower" });

  test("is its building's name and its number", () => {
    const match = matchUnit(places, { building: "شقق الواحة", unitNumber: "B201" });
    assert.equal(match.ok && match.unit.id, "b201");
  });

  test("survives the spellings people type", () => {
    // ة written as ه, extra spaces; the unit number without its dash, lower case.
    const match = matchUnit(places, { building: "  شقق   الواحه ", unitNumber: "a101" });
    assert.equal(match.ok && match.unit.id, "a101");
  });

  test("is not chosen between two buildings with the same name", () => {
    const match = matchUnit(places, { building: "Palm Villas", unitNumber: "T1" });
    assert.equal(!match.ok && match.issue.code, "buildingAmbiguous");
  });

  test("says whether the building or the unit is missing", () => {
    const noBuilding = matchUnit(places, { building: "Nowhere", unitNumber: "1" });
    assert.equal(!noBuilding.ok && noBuilding.issue.code, "buildingNotFound");
    const noUnit = matchUnit(places, { building: "New Tower", unitNumber: "1" });
    assert.equal(!noUnit.ok && noUnit.issue.code, "unitNotFound");
    assert.deepEqual(!noUnit.ok && noUnit.issue.values, { building: "New Tower", unit: "1" });
  });
});

describe("a cell", () => {
  test("date is a calendar day, day first when slashed", () => {
    assert.deepEqual(readDay("2026-03-01"), { ok: true, value: "2026-03-01" });
    assert.deepEqual(readDay("2026/3/1"), { ok: true, value: "2026-03-01" });
    assert.deepEqual(readDay("2026-03-01T10:30:00Z"), { ok: true, value: "2026-03-01" });
    // The 4th of October to a Saudi reader, not the 10th of April.
    assert.deepEqual(readDay("04/10/2026"), { ok: true, value: "2026-10-04" });
    assert.deepEqual(readDay("4.10.2026"), { ok: true, value: "2026-10-04" });
    assert.deepEqual(readDay("٠٤/١٠/٢٠٢٦"), { ok: true, value: "2026-10-04" });
    assert.deepEqual(readDay(""), { ok: true, value: null });
  });

  test("date that is not one is refused, not guessed", () => {
    // Month first fails on a day past twelve rather than importing wrongly.
    assert.deepEqual(readDay("10/31/2026"), { ok: false });
    assert.deepEqual(readDay("2026-02-30"), { ok: false });
    assert.deepEqual(readDay("next March"), { ok: false });
  });

  test("amount reads what spreadsheets write, to the halala", () => {
    assert.deepEqual(readAmount("1,200.50"), { ok: true, value: 1200.5 });
    assert.deepEqual(readAmount("SAR 18000"), { ok: true, value: 18000 });
    assert.deepEqual(readAmount("ر.س 1200"), { ok: true, value: 1200 });
    assert.deepEqual(readAmount("١٢٬٥٠٠٫٥٠"), { ok: true, value: 12500.5 });
    assert.deepEqual(readAmount(" "), { ok: true, value: null });
  });

  test("amount that is negative, fractional past the halala or not a number is refused", () => {
    assert.deepEqual(readAmount("-500"), { ok: false });
    assert.deepEqual(readAmount("10.005"), { ok: false });
    assert.deepEqual(readAmount("twelve"), { ok: false });
    assert.deepEqual(readAmount("1.2.3"), { ok: false });
  });

  test("digits typed on an Arabic keyboard are digits", () => {
    assert.equal(westernDigits("١٢٣ ۴۵۶"), "123 456");
  });

  test("names compare without case, spacing or the letters written either way", () => {
    assert.equal(nameKey("شقق  الواحة"), nameKey("شقق الواحه"));
    assert.equal(nameKey("إسكان"), nameKey("اسكان"));
    assert.equal(nameKey("Maple  Court"), nameKey("maple court"));
  });
});
