/**
 * Validate a user-supplied post-sign-in redirect target.
 *
 * The callbackUrl travels as a query parameter (?callbackUrl=/dashboard/x), so
 * anyone can mint a sign-in link carrying any value. Only a same-origin path
 * may come back out: an absolute or protocol-relative URL would turn the
 * sign-in page into an open redirector — a link that shows the real site's
 * login and then forwards the freshly signed-in user to a lookalike host.
 *
 * Resolving against a fixed origin is the load-bearing check. WHATWG URL
 * normalises the shapes a prefix test misses ("//evil.com", "/\\evil.com",
 * tab/newline padding), so anything that escapes the origin is caught by
 * comparing origins after resolution rather than by pattern-matching before.
 *
 * Shared by the proxy, the sign-in server page and the sign-in form — the
 * value must mean the same thing at every hop or the strictest reader wins
 * and the others become bypasses.
 */

const FALLBACK = "/dashboard";

export function safeCallbackUrl(
  raw: string | null | undefined,
  fallback: string = FALLBACK
): string {
  if (typeof raw !== "string") return fallback;
  const candidate = raw.trim();

  // A single leading slash is the only accepted shape: "//host" is
  // protocol-relative and a backslash is a slash to every browser.
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return fallback;
  }

  let resolved: URL;
  try {
    resolved = new URL(candidate, "https://internal.invalid");
  } catch {
    return fallback;
  }
  if (resolved.origin !== "https://internal.invalid") return fallback;

  // Never bounce back into the auth screens (a signin→signin loop) or onto an
  // API endpoint, which is not a page a person can land on.
  if (
    resolved.pathname.startsWith("/auth/") ||
    resolved.pathname.startsWith("/api/")
  ) {
    return fallback;
  }

  return resolved.pathname + resolved.search + resolved.hash;
}
