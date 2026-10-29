/**
 * What a report page writes into its address, and what it reads back — the
 * rule that makes a reload, or a link sent to someone, keep the filters, and
 * Reset a matter of removing them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  addressPatch,
  applyPatch,
  readAddress,
  type FilterValues,
} from "@/lib/report-filters/address";

const defaults: FilterValues = {
  startDate: "2026-01-01",
  endDate: "2026-10-03",
  ownerId: "",
  propertyId: "",
  status: "",
};

describe("reading the address", () => {
  test("an empty address is the defaults, the opening period included", () => {
    assert.deepEqual(readAddress("", defaults), defaults);
  });

  test("what the address names replaces the default", () => {
    assert.deepEqual(
      readAddress("ownerId=owner-abc123&startDate=2026-03-01", defaults),
      { ...defaults, ownerId: "owner-abc123", startDate: "2026-03-01" },
    );
  });

  test("a parameter that is not a filter is not read as one", () => {
    assert.deepEqual(readAddress("tab=rent-roll&type=expired", defaults), defaults);
  });

  test("an empty value in the address is a filter set to nothing", () => {
    // `?startDate=` is the lease registers' "no period" made explicit.
    assert.equal(readAddress("startDate=", defaults).startDate, "");
  });

  describe("an older link", () => {
    // The dashboard's `?range=this-month` link, turned into a period.
    const legacy = (params: URLSearchParams) =>
      params.get("range") === "this-month"
        ? { startDate: "2026-10-01", endDate: "2026-10-03" }
        : null;

    test("is read when the address names no filter of its own", () => {
      assert.deepEqual(readAddress("range=this-month", defaults, legacy), {
        ...defaults,
        startDate: "2026-10-01",
        endDate: "2026-10-03",
      });
    });

    test("loses to a filter the address does name", () => {
      assert.deepEqual(
        readAddress("range=this-month&startDate=2026-02-01", defaults, legacy),
        { ...defaults, startDate: "2026-02-01" },
      );
    });

    test("that says nothing leaves the defaults", () => {
      assert.deepEqual(readAddress("range=forever", defaults, legacy), defaults);
    });
  });
});

describe("writing the address", () => {
  test("only what differs from its default is written", () => {
    assert.deepEqual(
      addressPatch(
        { ...defaults, ownerId: "owner-abc123", startDate: "2026-03-01" },
        defaults,
      ),
      {
        startDate: "2026-03-01",
        endDate: null,
        ownerId: "owner-abc123",
        propertyId: null,
        status: null,
      },
    );
  });

  test("the defaults write nothing: an unfiltered report keeps a clean address", () => {
    assert.ok(
      Object.values(addressPatch(defaults, defaults)).every((v) => v === null),
    );
  });

  test("a period emptied on purpose is written, so it can be read back empty", () => {
    // Where the default is a period, clearing it is a choice the address keeps.
    const patch = addressPatch({ ...defaults, startDate: "" }, defaults);
    assert.equal(patch.startDate, null);
    // …and where the default is none, nothing differs and nothing is written.
    const none = { ...defaults, startDate: "", endDate: "" };
    assert.equal(addressPatch(none, none).startDate, null);
  });

  test("an older link's parameters are always removed", () => {
    assert.equal(addressPatch(defaults, defaults, ["range"]).range, null);
  });

  test("applying a patch leaves the parameters the filters do not own", () => {
    const patch = addressPatch(
      { ...defaults, propertyId: "prop-abc12345" },
      defaults,
      ["range"],
    );
    assert.equal(
      applyPatch("tab=collections&range=this-month&ownerId=owner-abc123", patch),
      "tab=collections&propertyId=prop-abc12345",
    );
  });

  test("Reset: applying the defaults removes every filter and keeps the rest", () => {
    const filtered = applyPatch(
      "tab=rent-roll&ownerId=owner-abc123&startDate=2026-03-01",
      addressPatch({ ...defaults, ownerId: "owner-abc123", startDate: "2026-03-01" }, defaults),
    );
    assert.equal(filtered, "tab=rent-roll&ownerId=owner-abc123&startDate=2026-03-01");
    assert.equal(applyPatch(filtered, addressPatch(defaults, defaults)), "tab=rent-roll");
  });

  test("what is written reads back as what was applied", () => {
    const applied = { ...defaults, ownerId: "owner-abc123", status: "paid", endDate: "2026-06-30" };
    const query = applyPatch("", addressPatch(applied, defaults));
    assert.deepEqual(readAddress(query, defaults), applied);
  });
});

describe("patching a query string", () => {
  test("sets, replaces and removes", () => {
    assert.equal(applyPatch("a=1&b=2", { b: "3", c: "4", a: null }), "b=3&c=4");
  });

  test("an empty value removes the parameter", () => {
    assert.equal(applyPatch("a=1", { a: "" }), "");
  });

  test("values are encoded", () => {
    assert.equal(applyPatch("", { q: "a b&c" }), "q=a+b%26c");
  });
});
