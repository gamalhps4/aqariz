/**
 * PropertyPro SaaS - Where a blog image may be hosted
 *
 * The hosts the site's Content-Security-Policy lets an image load from
 * (next.config.ts: img-src 'self', *.r2.dev and the R2 public host), read from
 * the same environment variables. The console uploads to R2, so an uploaded
 * image always qualifies; this site's own address does too.
 */

import { appBaseUrl } from "@/lib/listings/urls";

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function blogImageHosts(): string[] {
  const hosts = new Set<string>(["*.r2.dev"]);
  for (const url of [
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL,
    process.env.R2_PUBLIC_URL,
    appBaseUrl(),
  ]) {
    const host = hostOf(url);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

/**
 * Whether next/image may optimise `src`: a path on this site, or a host in
 * next.config.ts `images.remotePatterns` (the R2 public host and *.r2.dev).
 * next/image throws for any other host, so a cover on this site's own absolute
 * address — allowed above, but not a remote pattern — is drawn as a plain
 * image instead of taking the page down.
 */
export function isOptimizableImage(src: string): boolean {
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  let host: string;
  try {
    const url = new URL(src);
    if (url.protocol !== "https:") return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  const r2 = hostOf(process.env.NEXT_PUBLIC_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL);
  return host === r2 || host.endsWith(".r2.dev");
}
