/**
 * PropertyPro SaaS - Support impersonation hint
 *
 * The grant itself (`pp_impersonate`, see ./impersonation) is httpOnly, so the
 * browser cannot tell that a "View as" session is open. This companion cookie
 * carries no authority — the server never reads it — and only tells the
 * browser that asking the server who it is viewing as is worth a request.
 * Without it, every console page load would pay that round trip.
 *
 * Shared by the server routes that set and clear it and the browser auth
 * client that reads it, so it lives outside the server-only module.
 */

export const IMPERSONATION_HINT_COOKIE = "pp_impersonating";
