/**
 * PropertyPro - next/image that never fails on where a picture is hosted
 *
 * next/image only optimizes remote pictures from hosts listed in
 * next.config's `images.remotePatterns`, and the list is fixed when the app
 * is built. Any other host — or a stored path without its leading slash —
 * makes it THROW while rendering, so the whole page gives way to "Something
 * went wrong". Uploads land on the storage bucket's public URL, read from
 * the server's environment at run time (R2_PUBLIC_URL): a build that did not
 * see it, a bucket moved to its own domain, or a picture pasted from
 * elsewhere crashed the All Units page and the unit page for every unit
 * showing one — the client's report.
 *
 * Only the app's own files (a path from the site root, or a static import)
 * go through the optimizer; anything else is shown as it is. The browser's
 * content policy (next.config img-src) still decides which hosts load, so a
 * picture from elsewhere is a broken image rather than a broken page. Use
 * this in place of next/image wherever the picture can come from an upload
 * or a setting.
 */

import Image, { type ImageProps } from "next/image";

function optimizable(src: ImageProps["src"]): boolean {
  if (typeof src !== "string") return true;
  return src.startsWith("/") && !src.startsWith("//");
}

export default function AppImage({ alt, unoptimized, ...props }: ImageProps) {
  return (
    <Image
      alt={alt}
      {...props}
      unoptimized={unoptimized || !optimizable(props.src)}
    />
  );
}
