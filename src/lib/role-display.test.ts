/**
 * A role is printed by its name, never by the key it is stored under.
 *
 * The key of a group named in Arabic is "group" or "group_2", and that is
 * what the user pages, the profile badge, invitations and the platform
 * console printed. These pin the name the screen shows instead, in the
 * reader's language.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { groupDisplayName, roleDisplayName } from "@/lib/role-display";

const accountants = { label: "Accountants", labelAr: "المحاسبون" };

describe("a permission group", () => {
  test("is called by its Arabic name on an Arabic screen", () => {
    assert.equal(groupDisplayName(accountants, "ar"), "المحاسبون");
    assert.equal(groupDisplayName(accountants, "ar-SA"), "المحاسبون");
  });

  test("and by its label everywhere else", () => {
    assert.equal(groupDisplayName(accountants, "en"), "Accountants");
    assert.equal(groupDisplayName(accountants, undefined), "Accountants");
  });

  test("without an Arabic name it is its label in every language", () => {
    const group = { label: "مشرفو المباني", labelAr: null };
    assert.equal(groupDisplayName(group, "ar"), "مشرفو المباني");
    assert.equal(groupDisplayName(group, "en"), "مشرفو المباني");
  });

  test("its stored key is never what is printed", () => {
    assert.equal(
      roleDisplayName("group_2", { group: accountants, language: "ar" }),
      "المحاسبون",
    );
  });

  test("a group stored under an alias is still the group", () => {
    assert.equal(
      roleDisplayName("administrator", { group: accountants, language: "en" }),
      "Accountants",
    );
  });
});

describe("a built-in role", () => {
  test("is named by the catalogue, in the reader's language", () => {
    const t = (key: string, options?: { defaultValue?: string }) =>
      key === "admin.roles.defaultRoles.manager.label"
        ? "مدير العقارات"
        : (options?.defaultValue ?? key);
    assert.equal(roleDisplayName("manager", { t }), "مدير العقارات");
    assert.equal(roleDisplayName("admin"), "Property Administrator");
  });

  test("an alias with no group behind it reads as its role", () => {
    assert.equal(roleDisplayName("landlord"), "Property Owner");
  });
});

describe("a name nothing is known about", () => {
  test("is shown as words rather than a key", () => {
    assert.equal(roleDisplayName("sales_marketing"), "Sales Marketing");
    assert.equal(roleDisplayName(""), "Unknown role");
  });
});
