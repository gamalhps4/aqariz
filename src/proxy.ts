import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const ORG_SLUG_HEADER = "x-propertypro-org-slug";
const RESERVED_SUBDOMAINS = new Set(["www", "admin", "api"]);

function organizationSlugForHost(hostHeader: string | null): string | null {
  const rootDomain = process.env.SAAS_ROOT_DOMAIN?.toLowerCase().trim();
  if (!rootDomain || !hostHeader) return null;

  const host = hostHeader.split(":")[0]?.toLowerCase();
  if (!host || host === rootDomain || host === `www.${rootDomain}`) return null;
  if (!host.endsWith(`.${rootDomain}`)) return null;

  const slug = host.slice(0, -(rootDomain.length + 1));
  if (
    !slug ||
    slug.includes(".") ||
    RESERVED_SUBDOMAINS.has(slug) ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)
  ) {
    return null;
  }
  return slug;
}

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Never trust this header from the public request. Proxy owns it.
  headers.delete(ORG_SLUG_HEADER);
  const slug = organizationSlugForHost(request.headers.get("host"));
  if (slug) headers.set(ORG_SLUG_HEADER, slug);

  // Optimistic dashboard gate: no session cookie at all means the redirect to
  // sign-in can happen at the edge instead of after a client render. Cookie
  // *presence* only — real validation stays with `auth()` server-side, and
  // deliberately no bounce away from /auth/signin for cookie-holders (a stale
  // cookie would loop; the sign-in page does its own real session check).
  const { pathname, search } = request.nextUrl;

  if (
    (pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) &&
    !getSessionCookie(request)
  ) {
    const signIn = new URL("/auth/signin", request.url);
    signIn.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/).*)"],
};
