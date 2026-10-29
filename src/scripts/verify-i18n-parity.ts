/**
 * PropertyPro - Translation parity check
 *
 * `pnpm verify:i18n`
 *
 * Each locale × namespace drifts silently: a new key lands in `en`,
 * nobody adds it elsewhere, and the other languages render a raw key at
 * runtime. Nothing caught that, so this does.
 *
 * `en` is the reference. A key missing from another locale is an error; a key
 * present only in a translation (usually a rename left behind) is a warning,
 * since a stale extra key costs nothing but noise.
 *
 * **Baseline.** The repo starts with a real backlog of untranslated keys, and
 * machine-filling them would replace human-quality translations with worse
 * ones. So the check works the way the TypeScript error baseline does: known
 * gaps are recorded in `src/locales/.parity-baseline.json` and only *new*
 * drift fails. Run with `--update-baseline` after deliberately translating (or
 * deliberately deferring) a batch.
 *
 * Exits non-zero on any missing key that is not in the baseline, so it can
 * gate CI from day one without a red build.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const LOCALES_DIR = join(process.cwd(), "src", "locales");
const REFERENCE = "en";
const BASELINE_PATH = join(LOCALES_DIR, ".parity-baseline.json");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

type Baseline = Record<string, string[]>;

function readBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return {};
  }
}

/** `locale/namespace` — one bucket per file, so a key moving between
 * namespaces still shows up as new drift. */
const bucketKey = (locale: string, namespace: string) =>
  `${locale}/${namespace}`;

interface NamespaceReport {
  namespace: string;
  missing: string[];
  extra: string[];
}

function readNamespace(locale: string, namespace: string): Record<string, unknown> {
  const path = join(LOCALES_DIR, locale, `${namespace}.json`);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${locale}/${namespace}.json is not valid JSON: ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
}

/** Flatten nested objects so `a.b.c` compares equal across locales however the
 * file happens to be shaped. */
function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

function main(): void {
  if (!existsSync(LOCALES_DIR)) {
    console.error(`No locales directory at ${LOCALES_DIR}`);
    process.exit(1);
  }

  const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (!locales.includes(REFERENCE)) {
    console.error(`Reference locale "${REFERENCE}" is missing`);
    process.exit(1);
  }

  const namespaces = readdirSync(join(LOCALES_DIR, REFERENCE))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));

  const others = locales.filter((locale) => locale !== REFERENCE);
  const baseline = readBaseline();
  const nextBaseline: Baseline = {};
  let missingTotal = 0;
  let newMissingTotal = 0;
  let extraTotal = 0;

  console.log(
    `Comparing ${others.length} locales against "${REFERENCE}" across ${namespaces.length} namespaces\n`,
  );

  for (const locale of others) {
    const reports: NamespaceReport[] = [];

    for (const namespace of namespaces) {
      const reference = new Set(flatten(readNamespace(REFERENCE, namespace)));
      const target = new Set(flatten(readNamespace(locale, namespace)));

      const missing = [...reference].filter((key) => !target.has(key));
      const extra = [...target].filter((key) => !reference.has(key));

      if (missing.length) {
        nextBaseline[bucketKey(locale, namespace)] = missing.sort();
      }

      const known = new Set(baseline[bucketKey(locale, namespace)] ?? []);
      const newMissing = missing.filter((key) => !known.has(key));

      if (newMissing.length || extra.length) {
        reports.push({ namespace, missing: newMissing, extra });
      }
      missingTotal += missing.length;
      newMissingTotal += newMissing.length;
    }

    const localeMissing = reports.reduce((n, r) => n + r.missing.length, 0);
    const localeExtra = reports.reduce((n, r) => n + r.extra.length, 0);
    extraTotal += localeExtra;

    if (localeMissing === 0 && localeExtra === 0) {
      console.log(`  PASS ${locale} — no new drift`);
      continue;
    }

    console.log(
      `  ${localeMissing > 0 ? "FAIL" : "WARN"} ${locale} — ${localeMissing} NEW missing, ${localeExtra} extra`,
    );
    for (const report of reports) {
      if (report.missing.length) {
        const shown = report.missing.slice(0, 8);
        console.log(
          `      ${report.namespace}: missing ${shown.join(", ")}${
            report.missing.length > shown.length
              ? ` …+${report.missing.length - shown.length}`
              : ""
          }`,
        );
      }
      if (report.extra.length) {
        const shown = report.extra.slice(0, 4);
        console.log(
          `      ${report.namespace}: extra ${shown.join(", ")}${
            report.extra.length > shown.length
              ? ` …+${report.extra.length - shown.length}`
              : ""
          }`,
        );
      }
    }
  }

  console.log("");

  if (UPDATE_BASELINE) {
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(nextBaseline, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `📌 Baseline updated: ${missingTotal} known gap(s) recorded in src/locales/.parity-baseline.json`,
    );
    return;
  }

  if (newMissingTotal > 0) {
    console.log(
      `❌ ${newMissingTotal} NEW missing translation key(s). Translate them, or run` +
        ` \`pnpm verify:i18n --update-baseline\` to record them as a known gap.`,
    );
    process.exit(1);
  }

  const backlog = missingTotal - newMissingTotal;
  console.log(
    `✅ No new translation drift.` +
      (backlog > 0 ? ` (${backlog} key(s) still in the known backlog.)` : "") +
      (extraTotal > 0 ? ` ${extraTotal} stale extra key(s).` : ""),
  );
}

main();
