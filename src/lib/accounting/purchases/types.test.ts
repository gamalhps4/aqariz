/**
 * The names a bank or cash account is shown by: its own, or — on the accounts
 * accounting set-up opened, which have none — its ledger account's, in the
 * reader's language.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { bankDisplayName } from "./types";

const ledgerAccount = { nameAr: "البنك - الحساب الجاري", nameEn: "Bank - current account" };

describe("a bank account's name", () => {
  test("is its own when it has one", () => {
    assert.equal(bankDisplayName({ name: "  Al Rajhi main  ", ledgerAccount }, "ar"), "Al Rajhi main");
    assert.equal(bankDisplayName({ name: "Al Rajhi main", ledgerAccount }, "en"), "Al Rajhi main");
  });

  test("is its ledger account's in the reader's language when it has none", () => {
    assert.equal(bankDisplayName({ name: "", ledgerAccount }, "ar"), "البنك - الحساب الجاري");
    assert.equal(bankDisplayName({ name: "", ledgerAccount }, "en"), "Bank - current account");
    assert.equal(bankDisplayName({ name: "   ", ledgerAccount }, "de"), "Bank - current account");
  });

  test("falls back to the other language when one name is missing", () => {
    assert.equal(bankDisplayName({ name: "", ledgerAccount: { nameAr: "", nameEn: "Cash" } }, "ar"), "Cash");
    assert.equal(bankDisplayName({ name: "", ledgerAccount: { nameAr: "الصندوق", nameEn: "" } }, "fr"), "الصندوق");
  });

  test("nothing in, nothing out", () => {
    assert.equal(bankDisplayName(null, "ar"), "");
    assert.equal(bankDisplayName(undefined, "en"), "");
  });
});
