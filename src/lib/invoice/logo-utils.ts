export type SupportedLogoFormat = "PNG" | "JPEG";

/**
 * The app's own artwork, which branding holds until an office uploads its
 * own: "/images/logo-light.png", "/images/logo-dark.png" and "/favicon.ico".
 * Printed on a document it would put PropertyPro's mark where the office's
 * belongs, so it counts as no logo at all.
 */
const PLACEHOLDER_LOGO =
  /^\/(?:images\/logo-[^/?#]+\.png|favicon\.ico)(?:[?#].*)?$/i;

export function isPlaceholderLogo(source: string | null | undefined): boolean {
  return PLACEHOLDER_LOGO.test((source ?? "").trim());
}

/**
 * The office's logo for a printed document — the light logo, then the dark
 * one, then a favicon the office uploaded itself — or undefined when branding
 * holds only placeholders.
 *
 * Every printout picks it here. Invoices used to take the favicon first, and
 * every office's branding carries the default "/favicon.ico", so an invoice
 * showed PropertyPro's icon (or, drawn by jsPDF, which cannot read .ico, the
 * office's initials) even after the office had uploaded a logo.
 */
export function pickDocumentLogo(
  branding: Record<string, unknown> | null | undefined,
): string | undefined {
  for (const key of ["logoLight", "logoDark", "favicon"]) {
    const value = branding?.[key];
    if (typeof value === "string" && value.trim() && !isPlaceholderLogo(value)) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * The size to draw an image at inside a box, keeping its proportions.
 *
 * A wide logo drawn into a square box came out squashed; this scales it until
 * it touches the box on one side and no further.
 */
export function fitLogo(
  width: number,
  height: number,
  box: { width: number; height: number },
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(box.width / width, box.height / height);
  return { width: width * scale, height: height * scale };
}

/** A logo ready for `addImage`: PNG or JPEG bytes as a data URL. */
export interface DocumentLogo {
  dataUrl: string;
  format: SupportedLogoFormat;
}

/** Longest side a logo is rasterised at — sharp on paper, small in the file. */
const LOGO_RASTER_MAX = 600;

/**
 * Where the browser can read a logo from. R2 sends no CORS headers, so an
 * absolute URL goes through the app's same-origin proxy.
 */
function browserLogoUrl(source: string): string {
  if (source.startsWith("data:")) return source;
  if (/^https?:\/\//i.test(source)) {
    try {
      if (new URL(source).origin === window.location.origin) return source;
    } catch {
      return source;
    }
    return `/api/branding/logo?src=${encodeURIComponent(source)}`;
  }
  return source;
}

/**
 * Decode any image the browser can show — SVG, WebP and .ico included — and
 * re-encode it as PNG, which jsPDF can always draw.
 */
function rasteriseInBrowser(url: string): Promise<DocumentLogo | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!width || !height) return resolve(null);
        const scale = Math.min(1, LOGO_RASTER_MAX / Math.max(width, height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL("image/png"), format: "PNG" });
      } catch {
        // A tainted canvas (a cross-origin image without CORS) cannot be read.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * The branding logo, ready to draw on a PDF, or null when there is none or it
 * cannot be read — the document then prints without it rather than failing.
 *
 * In the browser any format is converted to PNG. On the server only a PNG or
 * JPEG data URL is used: the server's document services load and convert the
 * logo beforehand (lib/reports/logo-image.ts), where the hosts it may come
 * from are checked. A bare URL is never fetched from here on the server.
 */
export async function loadDocumentLogo(
  logo?: string | null,
): Promise<DocumentLogo | null> {
  const source = typeof logo === "string" ? logo.trim() : "";
  if (!source || isPlaceholderLogo(source)) return null;

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return rasteriseInBrowser(browserLogoUrl(source));
  }

  // jsPDF reads PNG and JPEG; anything else would only throw when drawn.
  const drawable = /^data:image\/(png|jpe?g)[;,]/i.exec(source);
  if (!drawable) return null;
  return {
    dataUrl: source,
    format: drawable[1].toLowerCase() === "png" ? "PNG" : "JPEG",
  };
}

function sanitizeFallback(fallback?: string): string {
  return typeof fallback === "string" && fallback.trim().length > 0
    ? fallback.trim().slice(0, 2).toUpperCase()
    : "PP";
}

export function deriveCompanyInitials(
  name?: string,
  fallback = "PP"
): string {
  if (typeof name !== "string") {
    return sanitizeFallback(fallback);
  }

  const cleaned = name.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return sanitizeFallback(fallback);
  }

  const segments = cleaned
    .split(/[\s\-_,.]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase());

  if (segments.length >= 2) {
    return `${segments[0]}${segments[1]}`.slice(0, 2);
  }

  if (segments.length === 1) {
    const alphanumeric = cleaned.replace(/[^a-zA-Z0-9]/g, "");
    const second = alphanumeric.charAt(1).toUpperCase();
    return `${segments[0]}${second}`.slice(0, 2) || segments[0];
  }

  return sanitizeFallback(fallback);
}
