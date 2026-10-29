import "server-only";

/**
 * PropertyPro - The display locale of the request being rendered
 *
 * Read by the root layout, so `<html lang dir>` and the providers' starting
 * language come from the office's choice (the `pp-*` cookies, see
 * `locale-cookie.ts`) instead of being corrected in the browser after the
 * page has painted.
 *
 * Reading cookies in the root layout makes a route render per request. The
 * public marketing pages keep being prerendered: their route group sets
 * `dynamic = "force-static"`, under which Next hands this function an empty
 * cookie jar and an empty header list. A real request always carries a Host
 * header, so its absence is how a static render is told apart, and those
 * pages get `STATIC_PAGE_LOCALE`.
 */

import { cookies, headers } from "next/headers";
import { resolveDisplayLocale, type DisplayLocale } from "./locale-cookie";

export async function resolveRequestLocale(): Promise<DisplayLocale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveDisplayLocale({
    isRequest: Boolean(headerList.get("host")),
    readCookie: (name) => cookieStore.get(name)?.value,
  });
}
