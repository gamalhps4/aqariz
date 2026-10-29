import "server-only";

import { deleteFromR2 } from "@/lib/r2-server";
import { extractObjectKey, isR2Url } from "@/lib/r2";

/**
 * PropertyPro - Removing a record's stored files
 *
 * Deleting a record moves it to the archive, where it can be restored — so its
 * files must still be there when it is. Deleting a tenant, a unit or a lease
 * document used to destroy the photo, the images or the document straight
 * away, and a restore brought back a record pointing at files that no longer
 * existed. Files now go when the record does: at the archive's permanent
 * delete, which calls this after the row is gone.
 *
 * Best effort by design. The row is already destroyed when this runs, and a
 * file that cannot be removed — already gone, or not ours — must not turn a
 * completed deletion into an error. Only objects under this organization's
 * own prefix are ever touched (deleteFromR2 refuses the rest).
 */

/** The storage key behind a stored reference, or null when it is not ours. */
export function storedObjectKey(reference: string): string | null {
  const value = reference.trim();
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return isR2Url(value) ? extractObjectKey(value) : null;
  }
  // A bare key, as some rows store it.
  return value;
}

export async function deleteStoredFiles(
  references: Iterable<string | null | undefined>,
): Promise<void> {
  const keys = new Set<string>();
  for (const reference of references) {
    if (typeof reference !== "string") continue;
    const key = storedObjectKey(reference);
    if (key) keys.add(key);
  }
  if (keys.size === 0) return;

  const results = await Promise.allSettled(
    [...keys].map((key) => deleteFromR2(key)),
  );
  const failed = results.filter(
    (result) => result.status === "rejected" || result.value === false,
  ).length;
  if (failed > 0) {
    console.warn(
      `Archive purge: ${failed} of ${keys.size} stored file(s) could not be removed`,
    );
  }
}

/** The file URLs an attachments list carries, whatever shape it was saved in. */
export function attachmentUrls(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  const urls: string[] = [];
  for (const entry of attachments) {
    if (typeof entry === "string") {
      urls.push(entry);
    } else if (entry && typeof entry === "object") {
      const url = (entry as { url?: unknown; fileUrl?: unknown }).url ??
        (entry as { fileUrl?: unknown }).fileUrl;
      if (typeof url === "string") urls.push(url);
    }
  }
  return urls;
}
