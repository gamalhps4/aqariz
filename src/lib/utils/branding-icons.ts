export const PWA_ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512] as const;

export function getBrandingIconVersion(faviconUrl = "/favicon.ico"): string {
  let hash = 5381;

  for (let index = 0; index < faviconUrl.length; index += 1) {
    hash = (hash * 33) ^ faviconUrl.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

export function getPwaIconUrl(size: number, faviconUrl?: string): string {
  return `/api/branding/pwa-icon/${size}?v=${getBrandingIconVersion(
    faviconUrl
  )}`;
}
