/**
 * The Marketing words: every one the code reads is written, in all five
 * languages.
 *
 * `verify:i18n` compares the catalogues with each other; it never reads the
 * code, so a key a screen asks for and nobody wrote would pass it and show up
 * on the page as `marketing.listings.something`. This reads the code. It is
 * deliberately about this module's namespace only.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  INQUIRY_STATUSES,
  LISTING_STATUSES,
  LISTING_TYPES,
  PRICE_PERIODS,
  RENT_PRICE_PERIODS,
  UNIT_AMENITY_FLAGS,
} from "@/lib/listings/constants";
import { isModuleKey } from "@/lib/billing/modules";
import { PUBLISH_PROBLEM_TEXT } from "@/lib/listings/publish-rules";
import { LISTING_ACTIONS } from "@/lib/listings/schemas";
import { SYSTEM_PERMISSIONS } from "@/lib/permission-catalog";

const ROOT = process.cwd();
const LANGUAGES = ["ar", "en"] as const;

const catalogs = Object.fromEntries(
  LANGUAGES.map((language) => [
    language,
    JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "src", "locales", language, "marketing.json"),
        "utf8",
      ),
    ) as Record<string, string>,
  ]),
) as Record<(typeof LANGUAGES)[number], Record<string, string>>;

function sourceFiles(directory: string, found: string[] = []): string[] {
  const absolute = path.join(ROOT, directory);
  if (!fs.existsSync(absolute)) return found;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(relative, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(relative);
    }
  }
  return found;
}

const SOURCES = [
  "src/lib/listings",
  "src/app/api/marketing",
  "src/app/api/public/listings",
  "src/app/dashboard/marketing",
  "src/app/o",
  "src/components/listings",
].flatMap((directory) => sourceFiles(directory));

const placeholders = (text: string) => [...text.matchAll(/\{[A-Za-z]+\}/g)].map((m) => m[0]).sort();

describe("the five catalogues", () => {
  test("hold the same keys", () => {
    const english = Object.keys(catalogs.en).sort();
    for (const language of LANGUAGES) {
      assert.deepEqual(Object.keys(catalogs[language]).sort(), english, language);
    }
  });

  test("have no empty line, and carry the same {placeholders} in every language", () => {
    for (const [key, text] of Object.entries(catalogs.en)) {
      assert.ok(text.trim(), `en ${key} is empty`);
      for (const language of LANGUAGES) {
        const other = catalogs[language][key];
        assert.ok(other?.trim(), `${language} ${key} is empty`);
        assert.deepEqual(placeholders(other), placeholders(text), `${language} ${key}`);
      }
    }
  });

  test("the Arabic catalogue is Arabic where it is meant to be", () => {
    // The public pages lead in Arabic: a line left in English there is the
    // visible bug. A few lines are the same word in both (WhatsApp, a name).
    const sameInBoth = new Set([
      "marketing.public.whatsapp",
      "marketing.form.unit.area",
      "marketing.public.switchLanguage",
      "marketing.public.form.phoneHint",
    ]);
    for (const [key, text] of Object.entries(catalogs.ar)) {
      if (sameInBoth.has(key) || key.startsWith("exports.")) continue;
      if (key.startsWith("marketing.public.") || key.startsWith("marketing.form.")) {
        assert.match(text, /[؀-ۿ]/, `${key} should be in Arabic: ${text}`);
      }
    }
  });
});

describe("every key the code reads is written", () => {
  const has = (key: string) =>
    LANGUAGES.every((language) => typeof catalogs[language][key] === "string");

  test("the literal keys in the screens, routes and pages", () => {
    const missing: string[] = [];
    const pattern = /["'`]((?:marketing|nav\.marketing|nav\.section\.marketing)\.[A-Za-z0-9_.]*[A-Za-z0-9_])["'`]/g;
    for (const file of SOURCES) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const match of text.matchAll(pattern)) {
        const key = match[1];
        // A file name in a comment, not a key.
        if (key === "marketing.json") continue;
        // A module key (lib/navigation/menu-config.ts), not a translation.
        if (isModuleKey(key)) continue;
        if (!has(key)) missing.push(`${key}  (${file})`);
      }
    }
    assert.deepEqual([...new Set(missing)].sort(), []);
  });

  test("the families built from a code, a type or a status", () => {
    const families: Array<[string, readonly string[]]> = [
      ["marketing.type.", LISTING_TYPES],
      ["marketing.status.", LISTING_STATUSES],
      ["marketing.inquiryStatus.", INQUIRY_STATUSES],
      ["marketing.period.", PRICE_PERIODS],
      ["marketing.period.per.", RENT_PRICE_PERIODS],
      ["marketing.problem.", Object.keys(PUBLISH_PROBLEM_TEXT)],
      ["marketing.amenity.", [...UNIT_AMENITY_FLAGS, "parking"]],
      ["marketing.public.offer.", LISTING_TYPES],
      ["marketing.public.defaultTitle.", LISTING_TYPES],
      ["marketing.form.defaultTitle.", LISTING_TYPES],
      ["marketing.listings.done.", LISTING_ACTIONS],
      [
        "marketing.public.form.error.",
        ["name_required", "name_too_long", "phone_invalid", "email_invalid", "message_too_long"],
      ],
    ];
    const missing: string[] = [];
    for (const [prefix, names] of families) {
      for (const name of names) if (!has(prefix + name)) missing.push(prefix + name);
    }
    assert.deepEqual(missing, []);
  });

  test("every refusal the services throw has a sentence", () => {
    const codes = new Set<string>(["not_found"]);
    for (const file of SOURCES.filter((entry) => entry.includes("lib/listings"))) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const match of text.matchAll(/new ListingError\(\s*\d+,\s*"([a-z_]+)"/g)) {
        codes.add(match[1]);
      }
    }
    const missing = [...codes].filter((code) => !has(`marketing.error.${code}`));
    assert.deepEqual(missing, []);
    assert.ok(codes.size >= 6, "found the codes the services throw");
  });

  test("every unit type a new office starts with has a public name", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "src", "lib", "property-categories.ts"),
      "utf8",
    );
    const block = source.slice(
      source.indexOf("DEFAULT_UNIT_CATEGORIES"),
      source.indexOf("export function defaultsFor"),
    );
    const slugs = [...block.matchAll(/slug:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(slugs.length >= 10, "read the default unit types");
    assert.deepEqual(
      slugs.filter((slug) => !has(`marketing.unitType.${slug}`)),
      [],
    );
  });

  test("the permission page names every listing right and the module", () => {
    const rights = SYSTEM_PERMISSIONS.filter((permission) => permission.startsWith("listing_"));
    assert.equal(rights.length, 8);
    const missing: string[] = [];
    for (const right of rights) {
      for (const part of ["name", "description", "category"]) {
        if (!has(`admin.roles.permissions.${right}.${part}`)) {
          missing.push(`admin.roles.permissions.${right}.${part}`);
        }
      }
    }
    if (!has("admin.roles.matrix.modules.listings")) {
      missing.push("admin.roles.matrix.modules.listings");
    }
    assert.deepEqual(missing, []);
  });

  test("the menu names the section and its two screens", () => {
    for (const key of [
      "nav.section.marketing",
      "nav.marketing.listings",
      "nav.marketing.inquiries",
    ]) {
      assert.ok(has(key), key);
    }
  });
});
