/**
 * A hidden or unknown public listing page answers with a real 404 only while
 * nothing streams before the page's own lookup. A loading boundary on the way
 * to /o/** sends its fallback first, and once the body is streaming the
 * status is already 200 and cannot change (Next 16, loading.js "Status
 * Codes") — the page would still say "not available", as a soft 404.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP = join(process.cwd(), "src", "app");
const LOADING = /^loading\.(tsx|ts|jsx|js)$/;

function loadingFiles(dir: string, deep: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (deep) out.push(...loadingFiles(full, true));
    } else if (LOADING.test(entry)) {
      out.push(relative(process.cwd(), full));
    }
  }
  return out;
}

test("no loading boundary streams the public pages before their lookup", () => {
  assert.deepEqual(
    [...loadingFiles(APP, false), ...loadingFiles(join(APP, "o"), true)],
    [],
  );
});
