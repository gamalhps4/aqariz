/**
 * PropertyPro - Branding Logo Proxy
 *
 * Serves the branding logo (or a specific branding asset passed via `src`) from
 * the same origin. Branding logos live on R2, which does not send CORS headers,
 * so the browser cannot read them to draw them into an invoice or receipt PDF.
 * Proxying the bytes server-side (no CORS restriction) lets the client load the
 * logo (see loadDocumentLogo).
 */

import {
  DEFAULT_PUBLIC_BRANDING,
  getPublicBranding,
} from "@/lib/utils/public-branding";
import {
  fetchRemoteAsset,
  isAllowedRemoteUrl,
  readPublicAsset,
  type LoadedImage,
} from "@/lib/utils/branding-asset";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function imageResponse(image: LoadedImage, maxAge = 300): Response {
  return new Response(new Uint8Array(image.buffer), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const src = new URL(request.url).searchParams.get("src");

  try {
    // Explicit source: must be an allowed remote (R2) asset.
    if (src) {
      let url: URL;
      try {
        url = new URL(src);
      } catch {
        return new Response("Invalid src", { status: 400 });
      }
      if (!isAllowedRemoteUrl(url)) {
        return new Response("Unsupported logo host", { status: 403 });
      }
      return imageResponse(await fetchRemoteAsset(url));
    }

    // No source: serve the global branding icon (favicon, then logoLight).
    const branding = await getPublicBranding();
    const target = branding.favicon || branding.logoLight;
    const image = target.startsWith("/")
      ? await readPublicAsset(target)
      : await fetchRemoteAsset(new URL(target));
    return imageResponse(image);
  } catch (error) {
    console.error("Branding logo proxy error:", error);
    try {
      return imageResponse(
        await readPublicAsset(DEFAULT_PUBLIC_BRANDING.favicon),
        60
      );
    } catch {
      return new Response("Unable to load logo", { status: 500 });
    }
  }
}
