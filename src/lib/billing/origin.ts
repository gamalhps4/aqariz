// Framework-free on purpose (see the domain-layer lint boundary in
// eslint.config.mjs): the standard `Request` type carries everything needed.
export function resolveApplicationOrigin(request: Request): string {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL is required for billing redirects");
  }
  return new URL(request.url).origin;
}
