/**
 * PropertyPro - Posting a document once its write has committed
 *
 * The write paths of the app (docs/ledger-posting-hooks.md lists them) call
 * `postAfterCommit` once their own transaction has committed. The posting
 * runs after the response has gone out (Next's `after`), so the person who
 * recorded a payment never waits on the books, and a posting that fails is
 * only logged: the nightly sweep posts whatever a hook missed, because
 * posting a document is idempotent (an unchanged document writes nothing).
 *
 * Outside a request — a script, the demo seeder — there is no response to
 * wait for, and the posting simply runs on its own.
 *
 * Nothing happens for an office that has not set accounting up (one cheap
 * read), so the hooks can sit on every write path from day one.
 */

import { after } from "next/server";
import type { DocumentKind } from "./documents.service";

type Ids = string | null | undefined | ReadonlyArray<string | null | undefined>;

function idList(ids: Ids): string[] {
  const list = Array.isArray(ids) ? ids : [ids];
  return [...new Set(list.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/**
 * Bring the books in step with these documents after the response. Safe to
 * call too often; never throws.
 */
export function postAfterCommit(
  kind: DocumentKind,
  ids: Ids,
  options: { userId?: string | null } = {},
): void {
  const list = idList(ids);
  if (list.length === 0) return;
  const run = async () => {
    try {
      // Loaded when needed: the services that call this sit underneath the
      // ledger's own imports.
      const { postDocumentSafely } = await import("./ledger.service");
      // One at a time: each posting takes the office's ledger lock briefly.
      for (const id of list) await postDocumentSafely(kind, id, options);
    } catch (error) {
      console.error(`[ledger] posting ${kind} after a write failed; the sweep will retry`, error);
    }
  };
  try {
    after(run);
  } catch {
    // Not inside a request (a script): nothing to wait for.
    void run();
  }
}
