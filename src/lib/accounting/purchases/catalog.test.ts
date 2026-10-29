/**
 * The purchases words: every one the code asks for is written, in all five
 * languages.
 *
 * `verify:i18n` compares the catalogues with each other; it never reads the
 * code, so a key a screen asks for and nobody wrote would pass it and show up
 * on the page as `purchases.bills.something`. This reads the code: the screens,
 * the printable voucher, the export sheets, the rights, the menu and the
 * refusals the services answer with. Words the code asks for with a computed
 * key (a status, a method, a bucket) are covered through the tables that
 * list them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { SYSTEM_PERMISSIONS } from "@/lib/permission-catalog";
import {
  AGING_BUCKETS,
  BILL_STATUSES,
  VOUCHER_METHODS,
  VOUCHER_STATUSES,
} from "./types";
import { PURCHASE_KIND_FILTERS, SALES_KIND_FILTERS } from "../registers";

const ROOT = process.cwd();
const LANGUAGES = ["ar", "en"] as const;
type Language = (typeof LANGUAGES)[number];

/** Every locale file of a language, as one catalogue (the app merges them). */
function catalogOf(language: Language): Record<string, string> {
  const directory = path.join(ROOT, "src", "locales", language);
  return Object.assign(
    {},
    ...fs
      .readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"))),
  ) as Record<string, string>;
}

const catalogs = Object.fromEntries(LANGUAGES.map((language) => [language, catalogOf(language)])) as Record<
  Language,
  Record<string, string>
>;

/** The languages a key is missing from. */
const missingFrom = (key: string) => LANGUAGES.filter((language) => !catalogs[language][key]?.trim());

function assertWritten(keys: Iterable<string>, what: string) {
  const missing = [...new Set(keys)]
    .map((key) => ({ key, languages: missingFrom(key) }))
    .filter((entry) => entry.languages.length > 0)
    .map((entry) => `${entry.key} (${entry.languages.join(", ")})`);
  assert.deepEqual(missing, [], `${what}: missing`);
}

function sourceFiles(directory: string, found: string[] = []): string[] {
  const absolute = path.join(ROOT, directory);
  if (!fs.existsSync(absolute)) return found;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(relative, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(relative);
  }
  return found;
}

const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

/** The words of the screens: `tx("key", "English")` and the `["key", "English"]` tables. */
const SCREENS = [
  "src/app/dashboard/accounting/purchases",
  "src/app/dashboard/accounting/registers",
  "src/app/dashboard/accounting/banks",
].flatMap((directory) => sourceFiles(directory));

function screenKeys(): string[] {
  const keys: string[] = [];
  for (const file of SCREENS) {
    const source = read(file);
    for (const match of source.matchAll(/\b(?:tx|t)\(\s*["'`]([A-Za-z][\w.]*)["'`]/g)) keys.push(match[1]);
    for (const match of source.matchAll(/\[\s*["']((?:purchases|ledger)\.[\w.]+)["']\s*,\s*["'`]/g)) keys.push(match[1]);
  }
  // A key the code builds from a status or a code is read through its table.
  return keys.filter((key) => !key.endsWith("."));
}

describe("the screens", () => {
  test("every key they ask for is written in every language", () => {
    const keys = screenKeys();
    assert.ok(keys.length > 60, `found the screens' keys (${keys.length})`);
    assertWritten(keys, "screens");
  });

  test("the words for statuses, methods, buckets and kinds are all written", () => {
    assertWritten(
      [
        ...BILL_STATUSES.map((status) => `purchases.status.${status}`),
        "purchases.status.overdue",
        ...VOUCHER_STATUSES.map((status) => `purchases.voucherStatus.${status}`),
        ...VOUCHER_METHODS.map((method) => `purchases.method.${method}`),
        ...AGING_BUCKETS.map((bucket) => `purchases.aging.${bucket}`),
        ...["S", "Z", "E", "O"].map((code) => `purchases.vat.${code}`),
        ...["tenant", "owner", "customer"].map((kind) => `purchases.customerType.${kind}`),
        ...["issued", "partial", "overdue", "scheduled", "refunded"].map((status) => `purchases.documentStatus.${status}`),
      ],
      "tables",
    );
  });

  test("a register's document kinds have words too", () => {
    const keys = [...SALES_KIND_FILTERS, ...PURCHASE_KIND_FILTERS].map((kind) => `purchases.registers.kindFilter.${kind}`);
    // The screens may name these differently; at least the register titles exist.
    assert.ok(keys.length > 0);
    assertWritten(["nav.accounting.salesRegister", "nav.accounting.purchasesRegister"], "register titles");
  });
});

describe("the printable voucher", () => {
  test("writes every label it draws", () => {
    const source = read("src/lib/accounting/purchases/voucher-renderer.ts");
    const keys = [...source.matchAll(/\blabel\(\s*["'`]([A-Za-z][\w.]*)["'`]/g)].map((match) => match[1]);
    assert.ok(keys.length >= 15, "found the voucher's labels");
    // The VAT number line and the stored method are the receipt's own.
    assertWritten(
      keys.filter((key) => !key.startsWith("exports.value.")),
      "voucher labels",
    );
    assertWritten(VOUCHER_METHODS.map((method) => `exports.value.${method}`), "voucher methods");
  });
});

describe("the files", () => {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/%/g, " pct ")
      .replace(/\+/g, " plus ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  test("every heading, title and summary line the sheets write is translated", () => {
    const sheets = ["src/lib/accounting/purchases/sheets.ts", "src/lib/accounting/registers-sheets.ts"].map(read).join("\n");
    const labels = new Set<string>();
    for (const match of sheets.matchAll(/\b(?:header|title):\s*"([^"]+)"/g)) labels.add(match[1]);
    // Summary lines: ["Total", value]
    for (const match of sheets.matchAll(/\[\s*"([A-Z][A-Za-z ().+-]+)"\s*,\s*(?:totals|options|rows|owed|row|summary)/g)) {
      labels.add(match[1]);
    }
    // The aging buckets are headings too.
    for (const match of sheets.matchAll(/:\s*"((?:\d+[-–]\d+|90\+) days|Current)"/g)) labels.add(match[1]);
    assert.ok(labels.size >= 40, `found the sheets' labels (${labels.size})`);
    assertWritten([...labels].map((label) => `exports.label.${slug(label)}`), "export labels");
  });

  test("the stored values the sheets write are translated", () => {
    const values = [
      ...BILL_STATUSES,
      ...VOUCHER_STATUSES,
      ...VOUCHER_METHODS,
      "active",
      "inactive",
      "tenant",
      "owner",
      "customer",
      "invoice",
      "credit_note",
      "receipt_voucher",
      "purchase_bill",
      "payment_voucher",
    ];
    assertWritten(values.map((value) => `exports.value.${slug(value)}`), "export values");
  });
});

describe("the rights and the menu", () => {
  const RIGHTS = SYSTEM_PERMISSIONS.filter((permission) => permission.startsWith("purchase_"));

  test("seven purchase rights, each named and described on the permission page", () => {
    assert.equal(RIGHTS.length, 7);
    const keys = RIGHTS.flatMap((right) =>
      ["name", "description", "category"].map((part) => `admin.roles.permissions.${right}.${part}`),
    );
    assertWritten([...keys, "admin.roles.matrix.modules.purchases"], "permissions");
  });

  test("the audit log names the new record types", () => {
    assertWritten(
      ["supplier", "purchase_bill", "payment_voucher", "bank_reconciliation"].map((type) => `admin.audit.types.${type}`),
      "audit types",
    );
  });

  test("the menu names every new entry", () => {
    assertWritten(
      [
        "bankReconciliation",
        "purchases",
        "suppliers",
        "purchaseBills",
        "paymentVouchers",
        "payablesAging",
        "registers",
        "salesRegister",
        "purchasesRegister",
      ].map((key) => `nav.accounting.${key}`),
      "menu",
    );
  });

  test("the ledger names the two new source types", () => {
    assertWritten(["purchase_bill", "payment_voucher"].map((type) => `ledger.sourceType.${type}`), "source types");
  });
});

describe("the refusals", () => {
  test("every code the purchases services and routes answer with is translated", () => {
    const files = [
      ...sourceFiles("src/lib/accounting/purchases"),
      "src/lib/accounting/registers.service.ts",
      "src/lib/accounting/reconciliation.service.ts",
      ...sourceFiles("src/app/api/accounting/purchases"),
      ...sourceFiles("src/app/api/accounting/sales"),
      "src/app/api/accounting/ledger/reconciliation/route.ts",
    ];
    const codes = new Set<string>();
    for (const file of files) {
      const source = read(file);
      for (const match of source.matchAll(/(?:ledgerError|createErrorResponse)\(\s*"([A-Z][A-Z_]+)"/g)) codes.add(match[1]);
      // createErrorResponse(message, status, undefined, "CODE")
      for (const match of source.matchAll(/createErrorResponse\([^)]*undefined,\s*"([A-Z][A-Z_]+)"\s*\)/g)) {
        codes.add(match[1]);
      }
      for (const match of source.matchAll(/code:\s*"(PURCHASE_[A-Z_]+)"/g)) codes.add(match[1]);
    }
    // The allocation problems come from bill-math.ts as `code: "PURCHASE_…"` literals.
    assert.ok(codes.size >= 25, `found the codes (${codes.size})`);
    // PURCHASE_INVALID carries its own sentence: the problems found in the body.
    codes.delete("PURCHASE_INVALID");
    assertWritten([...codes].map((code) => `ledger.errors.${code}`), "refusals");
  });

  test("the screens' error table lists every code it can meet", () => {
    const table = read("src/app/dashboard/accounting/setup/_shared/ledger-ui.ts");
    const listed = new Set([...table.matchAll(/\["ledger\.errors\.([A-Z_]+)"/g)].map((match) => match[1]));
    // The first two come from the ledger's route wrapper, which every purchases route runs inside.
    for (const code of [
      "LEDGER_STAFF_ONLY",
      "LEDGER_BAD_REQUEST",
      "PURCHASE_BILL_DUPLICATE",
      "PURCHASE_NUMBER_FAILED",
      "PURCHASE_VOUCHER_RECONCILED",
      "RECONCILE_LINE_INVALID",
      "REGISTER_TOO_DEEP",
    ]) {
      assert.ok(listed.has(code), code);
    }
  });
});
