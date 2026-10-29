import type { NextConfig } from "next";

const r2PublicUrl =
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL;
const r2Hostname = r2PublicUrl ? new URL(r2PublicUrl).hostname : null;
const rawBuildId =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_APP_BUILD_ID ||
  Date.now().toString();
const appBuildId = rawBuildId.replace(/[^a-zA-Z0-9-_]/g, "") || "dev";

/**
 * Content Security Policy.
 *
 * Third parties that must stay reachable: Stripe Elements/Checkout, the
 * PayPal / Razorpay / Paystack drop-in scripts, and R2 for uploaded media.
 * PostHog is same-origin thanks to the /ingest rewrite below.
 *
 * `script-src` still carries 'unsafe-inline'/'unsafe-eval': Next.js inlines
 * bootstrap scripts and React's dev build evals. Moving to a per-request nonce
 * (generated in proxy.ts) is the follow-up that lets both be dropped — the
 * directives that do the heavy lifting today are frame-ancestors, object-src,
 * base-uri and form-action.
 */
const PAYMENT_SCRIPT_HOSTS = [
  "https://js.stripe.com",
  "https://checkout.razorpay.com",
  "https://js.paystack.co",
  "https://www.paypal.com",
  "https://www.paypalobjects.com",
];

const PAYMENT_FRAME_HOSTS = [
  "https://js.stripe.com",
  "https://hooks.stripe.com",
  "https://checkout.stripe.com",
  "https://api.razorpay.com",
  "https://checkout.razorpay.com",
  "https://checkout.paystack.com",
  "https://www.paypal.com",
];

const PAYMENT_CONNECT_HOSTS = [
  "https://api.stripe.com",
  "https://lumberjack.razorpay.com",
  "https://api.razorpay.com",
  "https://api.paystack.co",
  "https://www.paypal.com",
];

function contentSecurityPolicy(): string {
  const imageHosts = ["'self'", "data:", "blob:", "https://*.r2.dev"];
  if (r2Hostname) imageHosts.push(`https://${r2Hostname}`);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-eval' is only needed by the dev bundle; production drops it.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
      ...PAYMENT_SCRIPT_HOSTS,
    ],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "img-src": imageHosts,
    "media-src": ["'self'", "blob:", "https://*.r2.dev"],
    // 'self' covers the /ingest PostHog proxy and every same-origin API call.
    "connect-src": ["'self'", ...PAYMENT_CONNECT_HOSTS],
    "frame-src": ["'self'", ...PAYMENT_FRAME_HOSTS],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");

  return process.env.NODE_ENV === "production"
    ? `${policy}; upgrade-insecure-requests`
    : policy;
}

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), payment=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_APP_BUILD_ID: appBuildId,
  },

  /**
   * Report PDFs embed an Arabic-capable font read from disk at request time
   * (src/lib/reports/pdf-font.ts). The tracer cannot see a runtime
   * readFileSync, so without this the file is left out of the deployment and
   * every PDF export fails in production while working locally.
   */
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/assets/fonts/**"],
  },

  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      ...(r2Hostname
        ? [
            {
              protocol: "https" as const,
              hostname: r2Hostname,
              pathname: "/**",
            },
          ]
        : []),
      {
        protocol: "https",
        hostname: "*.r2.dev",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
        pathname: "/**",
      }
    ],
  },
  transpilePackages: [
    "@radix-ui/react-label",
    "@radix-ui/react-primitive",
    "@propertypro/contracts",
  ],

  async headers() {
    return [
      {
        // Every document and API response carries the baseline headers; the
        // API responses also opt out of any shared caching.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
    ];
  },

  async rewrites() {
    return [
      // Versioned API alias. External clients (the mobile app, integrations)
      // MUST call /api/v1/*; the un-versioned paths are the web app's own
      // internal surface and carry no compatibility promise. Today v1 is an
      // alias of the live handlers — when a breaking change ships, v1 splits
      // into real files and this alias narrows.
      {
        source: "/api/v1/:path*",
        destination: "/api/:path*",
      },
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },

  generateBuildId: async () => appBuildId,
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
