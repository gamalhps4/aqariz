/**
 * PropertyPro - The office's logo, ready for a PDF the server draws
 *
 * Report PDFs, emailed invoices and receipts are drawn on the server with
 * jsPDF, which can only place PNG and JPEG. An office's logo can be anything
 * the branding upload accepts — PNG, JPEG, WebP, SVG — so it is decoded here
 * and re-encoded as a PNG no larger than it needs to be on paper.
 *
 * Every step is allowed to fail: a logo that cannot be fetched or read in
 * time returns null, and the document prints without it. An export that
 * works is worth more than a picture at the top of it.
 *
 * Deliberately not marked `server-only`, so the test suite can load it; it
 * reads the disk and runs sharp, so a browser bundle cannot import it anyway.
 */

import sharp from "sharp";
import { isPlaceholderLogo } from "@/lib/invoice/logo-utils";
import {
  fetchRemoteAsset,
  isAllowedRemoteUrl,
  readPublicAsset,
} from "@/lib/utils/branding-asset";

export interface ServerLogo {
  /** PNG bytes as a data URL, which `addImage` takes directly. */
  dataUrl: string;
  format: "PNG";
  /** Pixel size, for drawing it in proportion. */
  width: number;
  height: number;
}

/** Longest side, in pixels: sharp at letterhead size, small in the file. */
const RASTER_MAX = 600;
const FETCH_TIMEOUT_MS = 4000;
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * A logo that loaded is kept for the life of the process. Its address never
 * changes content — every branding upload is stored under a new, timestamped
 * key — so there is nothing to refresh, and re-fetching it only gave a flaky
 * connection the chance to drop the logo from a statement it had printed on
 * ten minutes earlier.
 */
const HIT_TTL_MS = Number.POSITIVE_INFINITY;
/** A failure is retried soon, so a fixed upload shows up without a restart. */
const MISS_TTL_MS = 60 * 1000;
/** Offices whose logo stays in memory; the least recently used goes first. */
const CACHE_LIMIT = 50;

const cached = new Map<
  string,
  { expires: number; logo: Promise<ServerLogo | null> }
>();

/** One more try after a dropped connection; an HTTP error is not retried. */
async function fetchWithRetry(url: URL) {
  const options = { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_BYTES };
  try {
    return await fetchRemoteAsset(url, options);
  } catch (error) {
    // `fetch` rejects with a TypeError ("fetch failed") when the connection
    // itself fails; a refused status or a timeout is not worth repeating.
    if (!(error instanceof TypeError)) throw error;
    return fetchRemoteAsset(url, options);
  }
}

function decodeDataUrl(source: string): Buffer {
  const comma = source.indexOf(",");
  if (comma < 0) throw new Error("Malformed data URL");
  const meta = source.slice(5, comma);
  const payload = source.slice(comma + 1);
  return meta.endsWith(";base64")
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
}

async function readLogoBytes(source: string): Promise<Buffer> {
  if (source.startsWith("data:")) return decodeDataUrl(source);
  if (source.startsWith("/")) return (await readPublicAsset(source)).buffer;

  const url = new URL(source);
  if (!isAllowedRemoteUrl(url)) {
    throw new Error(`Logo host is not allowed: ${url.hostname}`);
  }
  return (await fetchWithRetry(url)).buffer;
}

/** Any image sharp reads, as a PNG that fits in RASTER_MAX. */
export async function toPngLogo(bytes: Buffer): Promise<ServerLogo> {
  const { data, info } = await sharp(bytes, { density: 144 })
    .resize({
      width: RASTER_MAX,
      height: RASTER_MAX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    dataUrl: `data:image/png;base64,${data.toString("base64")}`,
    format: "PNG",
    width: info.width,
    height: info.height,
  };
}

/**
 * The logo at `source` — a branding URL on R2, a path under /public, or a data
 * URL — ready to draw, or null. Placeholders ("/images/logo-light.png") are
 * the app's own artwork and count as no logo.
 */
export function loadServerLogo(
  source: string | null | undefined,
): Promise<ServerLogo | null> {
  const key = (source ?? "").trim();
  if (!key || isPlaceholderLogo(key)) return Promise.resolve(null);

  const now = Date.now();
  const hit = cached.get(key);
  if (hit && hit.expires > now) {
    // Re-inserted, so the most recently used logo is the last to be evicted.
    cached.delete(key);
    cached.set(key, hit);
    return hit.logo;
  }
  cached.delete(key);

  const logo = readLogoBytes(key)
    .then(toPngLogo)
    .catch((error: unknown) => {
      console.warn(
        "Document logo could not be loaded; printing without it:",
        error instanceof Error ? error.message : error,
      );
      return null;
    });

  if (cached.size >= CACHE_LIMIT) {
    const oldest = cached.keys().next().value;
    if (oldest !== undefined) cached.delete(oldest);
  }
  cached.set(key, { expires: now + HIT_TTL_MS, logo });
  void logo.then((result) => {
    if (!result) cached.set(key, { expires: Date.now() + MISS_TTL_MS, logo });
  });

  return logo;
}

/**
 * A logo as a PNG data URL for the invoice and receipt renderers, which take
 * a URL in `companyInfo.logo`. Undefined when there is none to draw.
 */
export async function serverLogoDataUrl(
  source: string | null | undefined,
): Promise<string | undefined> {
  return (await loadServerLogo(source))?.dataUrl;
}
