import { readFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import {
  DEFAULT_PUBLIC_BRANDING,
  getPublicBranding,
} from "@/lib/utils/public-branding";
import { PWA_ICON_SIZES } from "@/lib/utils/branding-icons";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const ALLOWED_ICON_SIZES = new Set<number>(PWA_ICON_SIZES);

function isAllowedRemoteUrl(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const r2PublicUrl =
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL;
  if (r2PublicUrl) {
    const r2Url = new URL(r2PublicUrl);
    return url.hostname === r2Url.hostname;
  }

  return (
    url.hostname.endsWith(".r2.dev") ||
    url.hostname.endsWith(".r2.cloudflarestorage.com")
  );
}

async function readPublicAsset(assetUrl: string): Promise<Buffer> {
  const publicDir = path.resolve(process.cwd(), "public");
  const pathname = new URL(assetUrl, "https://propertypro.local").pathname;
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const assetPath = path.resolve(publicDir, relativePath);

  if (!assetPath.startsWith(`${publicDir}${path.sep}`)) {
    throw new Error("Invalid public asset path");
  }

  return readFile(assetPath);
}

async function loadFaviconBuffer(faviconUrl: string): Promise<Buffer> {
  if (!faviconUrl || faviconUrl.startsWith("/")) {
    return readPublicAsset(faviconUrl || DEFAULT_PUBLIC_BRANDING.favicon);
  }

  const url = new URL(faviconUrl);
  if (!isAllowedRemoteUrl(url)) {
    throw new Error("Unsupported favicon host");
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch favicon: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function renderPngIcon(size: number, faviconUrl: string): Promise<Buffer> {
  const buffer = await loadFaviconBuffer(faviconUrl);

  return sharp(buffer)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/**
 * The default branding favicon is an .ico, a format libvips cannot decode, so
 * the pre-rendered PNGs in public/icons are the source for the default icons
 * — and the fallback whenever a custom favicon fails to rasterise. The file
 * names line up with PWA_ICON_SIZES, which is what GET has already validated.
 */
async function readBundledIcon(size: number): Promise<Buffer> {
  return readPublicAsset(`/icons/icon-${size}x${size}.png`);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size: rawSize } = await params;
  const size = Number(rawSize);

  if (!Number.isInteger(size) || !ALLOWED_ICON_SIZES.has(size)) {
    return new Response("Unsupported icon size", { status: 400 });
  }

  const branding = await getPublicBranding();
  const usingDefaultFavicon =
    branding.favicon === DEFAULT_PUBLIC_BRANDING.favicon;

  try {
    const icon = usingDefaultFavicon
      ? await readBundledIcon(size)
      : await renderPngIcon(size, branding.favicon);

    return new Response(new Uint8Array(icon), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("PWA branding icon error:", error);

    if (!usingDefaultFavicon) {
      try {
        const fallbackIcon = await readBundledIcon(size);

        return new Response(new Uint8Array(fallbackIcon), {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=60",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (fallbackError) {
        console.error("Default PWA icon fallback error:", fallbackError);
      }
    }

    return new Response("Unable to render icon", { status: 500 });
  }
}
