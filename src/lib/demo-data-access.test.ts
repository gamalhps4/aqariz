/**
 * The demo-data tooling is off in production, and destroying records through
 * it answers to the archive purge's rule.
 *
 * DELETE /api/demo-data hard-deletes everything an organization holds, and
 * DELETE /api/seed/invoices every invoice numbered INV-2024-…; the POSTs
 * beside them write made-up records. All of it was open to anyone holding
 * `system_settings` on every deployment. None of it can be called to see what
 * it does, so the decision is tested here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_DATA_API_FLAG,
  DEMO_DATA_DISABLED_MESSAGE,
  DEMO_DATA_PURGE_DENIED_MESSAGE,
  DEMO_DATA_SCOPED_MESSAGE,
  demoDataApiEnabled,
  demoDataPurgeRefusal,
  demoDataReadRefusal,
  demoDataWriteRefusal,
} from "@/lib/demo-data-access";
import { createAccessProfile } from "@/lib/permissions-manager";

const admin = createAccessProfile("admin").permissions;

const owner = {
  isOrganizationOwner: true,
  isPlatformAdmin: false,
  permissions: admin,
};
const administrator = { ...owner, isOrganizationOwner: false };
const ownerWithoutPermanentDelete = {
  ...owner,
  permissions: createAccessProfile("admin", [], {
    denials: ["permanent_delete"],
  }).permissions,
};

const development = { NODE_ENV: "development" };
const production = { NODE_ENV: "production" };
const productionOptedIn = {
  NODE_ENV: "production",
  ALLOW_PRODUCTION_DEMO_DATA_API: "true",
};

describe("the switch", () => {
  test("is on while developing and testing", () => {
    assert.equal(demoDataApiEnabled(development), true);
    assert.equal(demoDataApiEnabled({ NODE_ENV: "test" }), true);
  });

  test("is off in production", () => {
    assert.equal(demoDataApiEnabled(production), false);
  });

  test("is off when the environment is unset or unfamiliar", () => {
    assert.equal(demoDataApiEnabled({}), false);
    assert.equal(demoDataApiEnabled({ NODE_ENV: "" }), false);
    assert.equal(demoDataApiEnabled({ NODE_ENV: "staging" }), false);
  });

  test("is turned on in production only by the flag reading exactly true", () => {
    assert.equal(demoDataApiEnabled(productionOptedIn), true);
    for (const value of ["TRUE", "True", "1", "yes", "on", "", " true"]) {
      assert.equal(
        demoDataApiEnabled({
          NODE_ENV: "production",
          ALLOW_PRODUCTION_DEMO_DATA_API: value,
        }),
        false,
        `"${value}" must not switch it on`,
      );
    }
  });

  test("is named in the refusal, so whoever runs the deployment can find it", () => {
    assert.equal(DEMO_DATA_API_FLAG, "ALLOW_PRODUCTION_DEMO_DATA_API");
    assert.ok(DEMO_DATA_DISABLED_MESSAGE.includes(`${DEMO_DATA_API_FLAG}=true`));
  });
});

describe("installing sample records", () => {
  test("is refused in production", () => {
    assert.deepEqual(demoDataWriteRefusal(production), {
      status: 403,
      message: DEMO_DATA_DISABLED_MESSAGE,
    });
  });

  test("goes ahead in development, and in production once opted in", () => {
    assert.equal(demoDataWriteRefusal(development), null);
    assert.equal(demoDataWriteRefusal(productionOptedIn), null);
  });
});

describe("destroying records", () => {
  test("is refused in production, the account owner included", () => {
    assert.deepEqual(demoDataPurgeRefusal(owner, production), {
      status: 403,
      message: DEMO_DATA_DISABLED_MESSAGE,
    });
    assert.deepEqual(demoDataPurgeRefusal(administrator, production), {
      status: 403,
      message: DEMO_DATA_DISABLED_MESSAGE,
    });
  });

  test("with the flag set, still takes the owner holding permanent_delete", () => {
    assert.equal(demoDataPurgeRefusal(owner, productionOptedIn), null);
    assert.equal(
      demoDataPurgeRefusal(
        { ...administrator, isPlatformAdmin: true },
        productionOptedIn,
      ),
      null,
    );
  });

  test("with the flag set, is refused to an administrator who is not the owner", () => {
    assert.deepEqual(demoDataPurgeRefusal(administrator, productionOptedIn), {
      status: 403,
      message: DEMO_DATA_PURGE_DENIED_MESSAGE,
    });
  });

  test("with the flag set, is refused to an owner without permanent_delete", () => {
    assert.deepEqual(
      demoDataPurgeRefusal(ownerWithoutPermanentDelete, productionOptedIn),
      { status: 403, message: DEMO_DATA_PURGE_DENIED_MESSAGE },
    );
  });

  test("keeps the owner rule in development too", () => {
    assert.equal(demoDataPurgeRefusal(owner, development), null);
    assert.deepEqual(demoDataPurgeRefusal(administrator, development), {
      status: 403,
      message: DEMO_DATA_PURGE_DENIED_MESSAGE,
    });
  });
});

describe("reading what the tool installed", () => {
  test("is off in production, as the writes are", () => {
    assert.deepEqual(demoDataReadRefusal({}, production), {
      status: 403,
      message: DEMO_DATA_DISABLED_MESSAGE,
    });
    assert.equal(demoDataReadRefusal({}, productionOptedIn), null);
    assert.equal(demoDataReadRefusal({}, development), null);
  });

  test("is refused to someone limited to some buildings", () => {
    assert.deepEqual(
      demoDataReadRefusal({ scopedPropertyIds: ["b1"] }, development),
      { status: 403, message: DEMO_DATA_SCOPED_MESSAGE },
    );
    assert.equal(
      demoDataReadRefusal({ scopedPropertyIds: [] }, development)?.status,
      403,
    );
  });
});
