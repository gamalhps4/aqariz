/**
 * PropertyPro - Request/session metadata helpers.
 *
 * What used to live here — createSessionRecord / validateAndTouchSession /
 * revokeSessionByToken — was bookkeeping kept alongside a JWT that stayed valid
 * whether or not its row survived, which is why "terminate session" did not
 * actually terminate anything. Better Auth owns the session lifecycle now and
 * resolves its token against the database on every request, so only the two
 * pure helpers below remain: they parse request metadata and are used when
 * stamping a new session and when recording audit entries.
 */

export interface ParsedUserAgent {
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  browser: string;
  os: string;
}

export function parseUserAgent(userAgent?: string | null): ParsedUserAgent {
  if (!userAgent) {
    return { deviceType: "unknown", browser: "Unknown", os: "Unknown" };
  }

  const ua = userAgent.toLowerCase();

  let deviceType: ParsedUserAgent["deviceType"] = "desktop";
  if (/ipad|tablet|kindle|silk/.test(ua)) {
    deviceType = "tablet";
  } else if (/mobi|iphone|ipod|android.*mobile/.test(ua)) {
    deviceType = "mobile";
  }

  let browser = "Unknown";
  const edgeMatch = userAgent.match(/Edg(?:e|A|iOS)?\/([\d.]+)/);
  const operaMatch = userAgent.match(/(?:Opera|OPR)\/([\d.]+)/);
  const chromeMatch = userAgent.match(/(?:Chrome|CriOS)\/([\d.]+)/);
  const firefoxMatch = userAgent.match(/(?:Firefox|FxiOS)\/([\d.]+)/);
  const safariMatch = userAgent.match(/Version\/([\d.]+).*Safari/);
  if (edgeMatch) browser = `Edge ${edgeMatch[1].split(".")[0]}`;
  else if (operaMatch) browser = `Opera ${operaMatch[1].split(".")[0]}`;
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1].split(".")[0]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1].split(".")[0]}`;
  else if (safariMatch) browser = `Safari ${safariMatch[1].split(".")[0]}`;

  let os = "Unknown";
  if (/windows nt 11/.test(ua)) os = "Windows 11";
  else if (/windows nt 10/.test(ua)) os = "Windows 10/11";
  else if (/windows/.test(ua)) os = "Windows";
  else if (/iphone|ipod/.test(ua)) os = "iOS";
  else if (/ipad/.test(ua)) os = "iPadOS";
  else if (/mac os x/.test(ua)) os = "macOS";
  else if (/android/.test(ua)) os = "Android";
  else if (/linux/.test(ua)) os = "Linux";

  return { deviceType, browser, os };
}

export function extractIpAddress(headers: Headers): string | undefined {
  // The consumers are audit writes, so the value must not be attacker-chosen.
  // Clients can send their own x-forwarded-for; proxies APPEND the address
  // they observed to the right. Taking the leftmost entry therefore records
  // whatever string the client typed — letting a brute-forcer stamp someone
  // else's IP into the security log. The rightmost entry was written by our
  // own nearest proxy; a single entry means that proxy set the whole header.
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return headers.get("x-real-ip") || undefined;
}
