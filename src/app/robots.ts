import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Authenticated surfaces. /api is already sent with X-Robots-Tag:
        // noindex (see next.config.ts) — this keeps well-behaved crawlers from
        // spending the request at all.
        disallow: ["/dashboard/", "/admin/", "/auth/", "/api/", "/calendar/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
