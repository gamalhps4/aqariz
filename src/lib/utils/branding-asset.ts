/**
 * PropertyPro - Reading a branding image on the server
 *
 * Branding holds a logo as a path under /public (the defaults) or a URL on
 * R2. Two things read those bytes on the server: the same-origin logo proxy
 * the browser goes through (R2 sends no CORS headers), and the PDFs the server
 * draws itself. Both accept exactly the same sources — a file under /public,
 * or an R2 host — so a branding value cannot point either of them at an
 * arbitrary address, such as an internal service or a cloud metadata
 * endpoint, and have the server fetch it.
 */

import { readFile } from "fs/promises";
import path from "path";

export interface LoadedImage {
  buffer: Buffer;
  contentType: string;
}

/** Whether the server may fetch this URL: R2 only. */
export function isAllowedRemoteUrl(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const r2PublicUrl =
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL;
  if (r2PublicUrl) {
    try {
      const r2Url = new URL(r2PublicUrl);
      if (url.hostname === r2Url.hostname) return true;
    } catch {
      // Fall through to the suffix checks below.
    }
  }

  return (
    url.hostname.endsWith(".r2.dev") ||
    url.hostname.endsWith(".r2.cloudflarestorage.com")
  );
}

export function contentTypeFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "svg":
      return "image/svg+xml";
    case "ico":
      return "image/x-icon";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

/** A file under /public, by its site path ("/images/logo-light.png"). */
export async function readPublicAsset(assetUrl: string): Promise<LoadedImage> {
  const publicDir = path.resolve(process.cwd(), "public");
  const pathname = new URL(assetUrl, "https://propertypro.local").pathname;
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const assetPath = path.resolve(publicDir, relativePath);

  if (!assetPath.startsWith(`${publicDir}${path.sep}`)) {
    throw new Error("Invalid public asset path");
  }

  return {
    buffer: await readFile(assetPath),
    contentType: contentTypeFromPath(relativePath),
  };
}

/**
 * An image on R2. The caller checks `isAllowedRemoteUrl` first.
 *
 * `timeoutMs` and `maxBytes` bound a fetch made while a document is being
 * drawn: a slow or enormous logo must not hold up the download it decorates.
 */
export async function fetchRemoteAsset(
  url: URL,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<LoadedImage> {
  const response = await fetch(url, {
    cache: "no-store",
    ...(options.timeoutMs
      ? { signal: AbortSignal.timeout(options.timeoutMs) }
      : {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch logo: ${response.status}`);
  }

  const declared = Number(response.headers.get("content-length"));
  if (options.maxBytes && declared > options.maxBytes) {
    throw new Error(`Logo is larger than ${options.maxBytes} bytes`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (options.maxBytes && buffer.length > options.maxBytes) {
    throw new Error(`Logo is larger than ${options.maxBytes} bytes`);
  }

  return {
    buffer,
    contentType: response.headers.get("content-type") || "image/png",
  };
}
