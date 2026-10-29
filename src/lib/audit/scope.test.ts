/**
 * One entry per action — never none, never two.
 *
 * The API wrapper records a basic entry for a write only when the handler
 * recorded nothing of its own, and a service and the route that called it
 * may not both record the same record. Both rules live in the request's
 * audit scope; these tests are the request as the wrapper runs it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  backstopKind,
  claimAuditRecord,
  dispositionFileName,
  fullName,
  getAuditScope,
  noteAuditEntry,
  requestIpAddress,
  runWithAuditScope,
  scopeForRequest,
  type AuditScope,
} from "@/lib/audit/scope";
import { exportFilters, noteReportExport } from "@/lib/audit/export-note";

function request(method: string, path: string, headers: Record<string, string> = {}) {
  return {
    method,
    url: `http://localhost:3000${path}`,
    headers: new Headers(headers),
  };
}

const manager = {
  id: "user_1",
  email: "ahmed@office.sa",
  firstName: "Ahmed",
  lastName: "Ali",
  role: "manager",
  isCustomRole: false,
  isPlatformAdmin: false,
  organizationId: "org_1",
  sessionId: "session_1",
  impersonatedBy: null,
};

function scope(method = "POST", path = "/api/leases/cabc123def456ghi789jkl012/terminate"): AuditScope {
  return scopeForRequest(manager, request(method, path));
}

describe("the actor snapshot", () => {
  test("names the actor as they are now: name, email, role, organization", () => {
    const value = scopeForRequest(
      manager,
      request("PATCH", "/api/payments/x?tab=1", {
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
        "user-agent": "Mozilla/5.0",
      }),
    );
    assert.deepEqual(value.actor, {
      id: "user_1",
      name: "Ahmed Ali",
      email: "ahmed@office.sa",
      role: "manager",
      roleIsGroup: false,
      isPlatformAdmin: false,
    });
    assert.equal(value.organizationId, "org_1");
    assert.equal(value.ipAddress, "203.0.113.9");
    assert.equal(value.userAgent, "Mozilla/5.0");
    assert.equal(value.method, "PATCH");
    assert.equal(value.pathname, "/api/payments/x");
    assert.equal(value.search, "?tab=1");
    assert.equal(value.entries, 0);
  });

  test("carries the support operator viewing as the actor", () => {
    const value = scopeForRequest(
      { ...manager, impersonatedBy: { id: "op_1", email: "ops@propertypro.sa" } },
      request("GET", "/api/payments"),
    );
    assert.deepEqual(value.impersonator, { id: "op_1", email: "ops@propertypro.sa" });
  });

  test("a name with only one part, or none, is still a name or nothing", () => {
    assert.equal(fullName("Ahmed", ""), "Ahmed");
    assert.equal(fullName("  ", null), null);
    assert.equal(fullName(undefined, "Ali"), "Ali");
  });

  test("the address is the first forwarded hop, else X-Real-IP", () => {
    assert.equal(requestIpAddress(new Headers({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
    assert.equal(requestIpAddress(new Headers()), null);
  });
});

describe("the basic entry the wrapper adds", () => {
  test("a write that recorded nothing gets one", () => {
    assert.equal(backstopKind(scope(), 200), "write");
    assert.equal(backstopKind(scope("DELETE"), 204), "write");
  });

  test("a write that recorded its own entry gets none", async () => {
    const value = scope();
    await runWithAuditScope(value, async () => {
      noteAuditEntry();
    });
    assert.equal(backstopKind(value, 200), null);
  });

  test("an audit call the handler did not await still counts", async () => {
    const value = scope();
    await runWithAuditScope(value, async () => {
      // Fire and forget, as the routes call it.
      void (async () => {
        noteAuditEntry();
        await new Promise((resolve) => setTimeout(resolve, 5));
      })();
    });
    assert.equal(value.entries, 1);
    assert.equal(backstopKind(value, 200), null);
  });

  test("a refused or failed write changed nothing and gets none", () => {
    assert.equal(backstopKind(scope(), 403), null);
    assert.equal(backstopKind(scope(), 409), null);
    assert.equal(backstopKind(scope(), 500), null);
  });

  test("a read is a page view, not logged — unless it handed over a file", () => {
    assert.equal(backstopKind(scope("GET", "/api/leases"), 200), null);
    assert.equal(
      backstopKind(scope("GET", "/api/tenant/documents/x/download"), 200, 'attachment; filename="lease.pdf"'),
      "download",
    );
    // A report export records itself; the wrapper adds nothing.
    const exported = scope("GET", "/api/payments/reports");
    noteAuditEntry(exported);
    assert.equal(backstopKind(exported, 200, 'attachment; filename="r.xlsx"'), null);
  });

  test("the scope is the request's own and gone after it", async () => {
    const value = scope();
    await runWithAuditScope(value, async () => {
      assert.equal(getAuditScope(), value);
    });
    assert.equal(getAuditScope(), undefined);
  });
});

describe("one entry per record per request", () => {
  test("the first writer claims the record; the second writes nothing", () => {
    const value = scope();
    assert.equal(claimAuditRecord(value, "payment", "pay_1"), true);
    assert.equal(claimAuditRecord(value, "payment", "pay_1"), false);
    // Another record in the same request is its own action.
    assert.equal(claimAuditRecord(value, "payment", "pay_2"), true);
    assert.equal(claimAuditRecord(value, "invoice", "pay_1"), true);
  });

  test("entries that name no record are never claimed", () => {
    const value = scope();
    assert.equal(claimAuditRecord(value, "report", null), true);
    assert.equal(claimAuditRecord(value, "report", null), true);
    assert.equal(claimAuditRecord(undefined, "payment", "pay_1"), true);
  });
});

describe("the file a download handed over", () => {
  test("reads RFC 6266's encoded name first, so an Arabic name survives", () => {
    assert.equal(
      dispositionFileName(
        `attachment; filename="report.pdf"; filename*=UTF-8''%D8%B9%D9%82%D8%AF.pdf`,
      ),
      "عقد.pdf",
    );
    assert.equal(dispositionFileName('attachment; filename="receipt-12.pdf"'), "receipt-12.pdf");
    assert.equal(dispositionFileName(null), null);
  });
});

describe("report exports", () => {
  test("record the filters, not how the file was laid out", () => {
    assert.equal(
      exportFilters("?format=xlsx&lang=ar&rtl=1&status=overdue&from=2026-09-01&page=2"),
      "status=overdue&from=2026-09-01",
    );
  });

  test("count against the request at once, before the writer has loaded", async () => {
    const value = scope("GET", "/api/payments/reports?status=overdue&format=xlsx");
    const written: Array<Record<string, unknown>> = [];
    await runWithAuditScope(value, async () => {
      noteReportExport(
        { report: "Payments Report", format: "xlsx", rows: 12 },
        async (entry) => {
          written.push(entry as unknown as Record<string, unknown>);
        },
      );
      assert.equal(value.entries, 1);
    });
    assert.equal(written.length, 1);
    assert.equal(written[0].action, "bulk_export");
    assert.equal(written[0].recordName, "Payments Report");
    assert.deepEqual(written[0].messageParams, { report: "Payments Report", format: "xlsx" });
    assert.equal((written[0].details as { filters?: string }).filters, "status=overdue");
  });

  test("outside a request there is nobody to attribute it to", () => {
    assert.doesNotThrow(() =>
      noteReportExport({ report: "Payments Report", format: "csv", rows: 1 }),
    );
  });
});
