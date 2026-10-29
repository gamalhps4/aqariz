/**
 * PropertyPro - Rate Limiting Utility
 * Implements rate limiting for API endpoints
 *
 * Counters live in Redis when REDIS_URL is set, so the limits hold across
 * server instances and survive deploys. Without Redis (single-instance dev)
 * — or if Redis errors mid-request — an in-memory fixed window keeps the
 * limits enforced per instance instead of failing open.
 */

import { NextRequest } from "next/server";
import Redis from "ioredis";

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (req: NextRequest) => string; // Custom key generator
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
}

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

// In-memory fallback store (dev without Redis, or Redis outage)
const store: RateLimitStore = {};

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach((key) => {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  });
}, 5 * 60 * 1000);

// One shared connection, cached on globalThis so dev HMR does not leak
// clients (same pattern as src/lib/realtime/bus.ts).
const redisKeySymbol = Symbol.for("propertypro.rate-limit.redis");
type GlobalWithRedis = typeof globalThis & {
  [redisKeySymbol]?: Redis | null;
};

function getRedis(): Redis | null {
  const g = globalThis as GlobalWithRedis;
  if (g[redisKeySymbol] !== undefined) return g[redisKeySymbol];

  const url = process.env.REDIS_URL;
  if (!url) {
    g[redisKeySymbol] = null;
    return null;
  }

  const client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });
  client.on("error", (error) => {
    console.error("rate-limit redis error:", error.message);
  });
  g[redisKeySymbol] = client;
  return client;
}

function checkInMemory(
  key: string,
  windowMs: number,
  maxRequests: number,
): RateLimitResult {
  const now = Date.now();

  // Initialize or reset if window expired
  if (!store[key] || store[key].resetTime < now) {
    store[key] = { count: 0, resetTime: now + windowMs };
  }

  const current = store[key];

  if (current.count >= maxRequests) {
    return {
      success: false,
      limit: maxRequests,
      remaining: 0,
      resetTime: current.resetTime,
    };
  }

  current.count++;

  return {
    success: true,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - current.count),
    resetTime: current.resetTime,
  };
}

async function checkInRedis(
  client: Redis,
  key: string,
  windowMs: number,
  maxRequests: number,
): Promise<RateLimitResult> {
  // Fixed window: INCR the window's counter, stamp its TTL on first hit.
  const redisKey = `ratelimit:{${key}}:${windowMs}`;
  const results = await client.multi().incr(redisKey).pttl(redisKey).exec();
  const count = Number(results?.[0]?.[1] ?? 1);
  let ttl = Number(results?.[1]?.[1] ?? -1);

  if (ttl < 0) {
    // First request of the window (or a counter that lost its expiry).
    await client.pexpire(redisKey, windowMs);
    ttl = windowMs;
  }

  const resetTime = Date.now() + ttl;

  if (count > maxRequests) {
    return { success: false, limit: maxRequests, remaining: 0, resetTime };
  }

  return {
    success: true,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - count),
    resetTime,
  };
}

/**
 * Rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = defaultKeyGenerator,
  } = config;

  return {
    check: async (req: NextRequest): Promise<RateLimitResult> => {
      const key = keyGenerator(req);

      const client = getRedis();
      if (client) {
        try {
          return await checkInRedis(client, key, windowMs, maxRequests);
        } catch {
          // Redis unavailable — enforce per-instance rather than fail open.
        }
      }

      return checkInMemory(key, windowMs, maxRequests);
    },

    reset: async (req: NextRequest): Promise<void> => {
      const key = keyGenerator(req);
      delete store[key];

      const client = getRedis();
      if (client) {
        try {
          await client.del(`ratelimit:{${key}}:${windowMs}`);
        } catch {
          // Already removed from the in-memory fallback above.
        }
      }
    },

    decrement: async (req: NextRequest): Promise<void> => {
      const key = keyGenerator(req);
      const entry = store[key];
      if (entry && entry.count > 0) entry.count -= 1;

      const client = getRedis();
      if (client) {
        try {
          const redisKey = `ratelimit:{${key}}:${windowMs}`;
          const value = await client.decr(redisKey);
          if (value < 0) await client.del(redisKey);
        } catch {
          // In-memory fallback already adjusted above.
        }
      }
    },
  };
}

/**
 * Resolve the client IP from proxy headers. `NextRequest` exposes no `ip`
 * property on self-hosted Node, so headers are the only source; "unknown"
 * (which buckets all callers together) is the last resort, not the norm.
 */
/**
 * How many reverse proxies sit in front of the app.
 *
 * This is a security setting, not a tuning knob. `X-Forwarded-For` grows
 * left-to-right as a request passes through proxies, and a proxy *appends* —
 * it does not replace. So when a client sends its own
 * `X-Forwarded-For: 9.9.9.9`, Traefik (Dokploy's ingress) turns it into
 * `9.9.9.9, <real client ip>`. Reading the leftmost entry therefore reads a
 * value the caller chose, which lets anyone defeat the per-IP limits on
 * signup, password reset and error reporting simply by rotating a fake header.
 *
 * With N trusted proxies the real client is N entries from the right.
 *
 *   0 (default) — no reverse proxy, or a platform that strips client-supplied
 *                 XFF before forwarding (Vercel). Leftmost is correct.
 *   1           — one proxy: Dokploy/Traefik, nginx, Caddy, Cloudflare alone.
 *   2           — e.g. Cloudflare in front of Traefik.
 */
const TRUSTED_PROXY_COUNT = Math.max(
  0,
  Number.parseInt(process.env.TRUSTED_PROXY_COUNT ?? "0", 10) || 0,
);

/** Pure resolution, separated from the request so it can be tested directly. */
export function resolveClientIp(
  forwardedFor: string | null,
  realIp: string | null,
  trustedProxies: number,
): string {
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (hops.length > 0) {
      // Count back from the right past the entries our own proxies appended.
      // Clamped, so a shorter header than expected (a direct hit on the app
      // port, say) still yields an entry rather than undefined.
      const index = Math.max(0, hops.length - trustedProxies);
      const candidate = trustedProxies > 0 ? hops[index] : hops[0];
      if (candidate) return candidate;
    }
  }
  // Traefik and nginx set this themselves, overwriting anything the client
  // sent, so it is the safer fallback when XFF is absent.
  return realIp?.trim() || "unknown";
}

export function getClientIp(req: NextRequest): string {
  return resolveClientIp(
    req.headers.get("x-forwarded-for"),
    req.headers.get("x-real-ip"),
    TRUSTED_PROXY_COUNT,
  );
}

/**
 * Default key generator - uses IP address and user agent
 */
function defaultKeyGenerator(req: NextRequest): string {
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";

  // Create a simple hash of IP + User Agent
  return `${ip}:${userAgent}`;
}

/**
 * User-based key generator - uses user ID from session
 */
export function userBasedKeyGenerator(userId: string): string {
  return `user:${userId}`;
}

/**
 * IP-based key generator - uses only IP address
 */
export function ipBasedKeyGenerator(req: NextRequest): string {
  return `ip:${getClientIp(req)}`;
}

/**
 * Predefined rate limit configurations
 */
export const rateLimitConfigs = {
  // Settings updates - 10 requests per minute
  settingsUpdate: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10,
    keyGenerator: userBasedKeyGenerator,
  },

  // Authentication - 5 attempts per 15 minutes. Keyed by IP alone: the
  // default IP+User-Agent key handed a brute-forcer a fresh bucket per UA
  // string from the same address.
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    keyGenerator: ipBasedKeyGenerator,
  },

  // General API - 100 requests per minute
  general: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
  },

  // File uploads - 5 uploads per minute
  upload: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 5,
    keyGenerator: userBasedKeyGenerator,
  },

  // Password reset - 3 attempts per hour (IP-keyed — see auth above)
  passwordReset: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 3,
    keyGenerator: ipBasedKeyGenerator,
  },

  // Email sending - 10 emails per hour
  email: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    keyGenerator: userBasedKeyGenerator,
  },
};

/**
 * Check a limit against a caller-supplied key instead of deriving one from the
 * request. This is what the authenticated API wrappers use: by the time they
 * run, the session is resolved, so the user id is a far better bucket than
 * IP + user-agent (which lumps an office behind one NAT into a single bucket
 * and lets a single user spread load by rotating user-agents).
 */
export async function checkRateLimitByKey(
  key: string,
  windowMs: number,
  maxRequests: number,
): Promise<RateLimitResult> {
  const client = getRedis();
  if (client) {
    try {
      return await checkInRedis(client, key, windowMs, maxRequests);
    } catch {
      // Redis unavailable — enforce per-instance rather than fail open.
    }
  }
  return checkInMemory(key, windowMs, maxRequests);
}

/**
 * Default ceilings for authenticated API traffic, applied by the wrappers in
 * api-utils. Deliberately generous — this is an abuse ceiling, not a quota;
 * a dashboard page fanning out a dozen parallel fetches must never trip it.
 * Routes with a real cost (uploads, outbound email, payments) still add their
 * own tighter `withRateLimit`.
 */
export const AUTHENTICATED_READ_LIMIT = {
  windowMs: 60 * 1000,
  maxRequests: 300,
};

export const AUTHENTICATED_WRITE_LIMIT = {
  windowMs: 60 * 1000,
  maxRequests: 60,
};

/**
 * Rate limit response helper
 */
export function createRateLimitResponse(
  message: string = "Too many requests",
  resetTime: number
) {
  const resetDate = new Date(resetTime);

  return new Response(
    JSON.stringify({
      success: false,
      error: message,
      code: "RATE_LIMITED",
      retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
      resetTime: resetDate.toISOString(),
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": Math.ceil((resetTime - Date.now()) / 1000).toString(),
        "X-RateLimit-Reset": resetDate.toISOString(),
      },
    }
  );
}

/**
 * Rate limit middleware for Next.js API routes. Extra arguments (e.g. the App
 * Router route context with `params`) are forwarded to the handler untouched.
 */
export function withRateLimit<Args extends unknown[]>(
  config: RateLimitConfig,
  handler: (req: NextRequest, ...args: Args) => Promise<Response>
) {
  const limiter = rateLimit(config);

  return async (req: NextRequest, ...args: Args): Promise<Response> => {
    const result = await limiter.check(req);

    // Add rate limit headers to response
    const addHeaders = (response: Response) => {
      response.headers.set("X-RateLimit-Limit", result.limit.toString());
      response.headers.set(
        "X-RateLimit-Remaining",
        result.remaining.toString()
      );
      response.headers.set(
        "X-RateLimit-Reset",
        new Date(result.resetTime).toISOString()
      );
      return response;
    };

    if (!result.success) {
      return createRateLimitResponse(
        "Too many requests. Please try again later.",
        result.resetTime
      );
    }

    try {
      const response = await handler(req, ...args);
      return addHeaders(response);
    } catch (error) {
      // Un-count just THIS failed request. Resetting the whole window here
      // let an attacker wipe the accumulated count by interleaving one
      // erroring request.
      if (config.skipFailedRequests) {
        await limiter.decrement(req);
      }
      throw error;
    }
  };
}

/**
 * CSRF Token utilities
 */
export class CSRFProtection {
  private static tokens = new Map<string, { token: string; expires: number }>();

  static generateToken(sessionId: string): string {
    const token = crypto.randomUUID();
    const expires = Date.now() + 60 * 60 * 1000; // 1 hour

    this.tokens.set(sessionId, { token, expires });

    // Cleanup expired tokens
    this.cleanup();

    return token;
  }

  static validateToken(sessionId: string, token: string): boolean {
    const stored = this.tokens.get(sessionId);

    if (!stored || stored.expires < Date.now()) {
      this.tokens.delete(sessionId);
      return false;
    }

    return stored.token === token;
  }

  static removeToken(sessionId: string): void {
    this.tokens.delete(sessionId);
  }

  private static cleanup(): void {
    const now = Date.now();
    for (const [sessionId, data] of this.tokens.entries()) {
      if (data.expires < now) {
        this.tokens.delete(sessionId);
      }
    }
  }
}

/**
 * Security headers utility
 */
export function addSecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
  );

  return response;
}

/**
 * Input sanitization utility
 */
export function sanitizeInput(input: any): any {
  if (typeof input === "string") {
    // Remove potentially dangerous characters
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/javascript:/gi, "")
      .replace(/on\w+\s*=/gi, "")
      .trim();
  }

  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }

  // Handle Date objects - return them as-is without processing
  if (input instanceof Date) {
    return input;
  }

  if (typeof input === "object" && input !== null) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }

  return input;
}
