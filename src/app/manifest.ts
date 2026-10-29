import type { MetadataRoute } from "next";
import { getPublicBranding } from "@/lib/utils/public-branding";
import { getPwaIconUrl, PWA_ICON_SIZES } from "@/lib/utils/branding-icons";

// Always reflect the current branding (company name / icon / colors) rather
// than baking in defaults at build time.
export const dynamic = "force-dynamic";

type ManifestIcon = NonNullable<MetadataRoute.Manifest["icons"]>[number];

function buildIcons(favicon: string): ManifestIcon[] {
  const icons = PWA_ICON_SIZES.map((size) => ({
    src: getPwaIconUrl(size, favicon),
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose: "any" as const,
  }));

  return [
    ...icons,
    {
      src: getPwaIconUrl(192, favicon),
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: getPwaIconUrl(512, favicon),
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ];
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getPublicBranding();
  const companyName = branding.companyName || "PropertyPro";

  // Shortcuts reuse the dynamic, DB-backed app icon (resolved from the current
  // branding favicon) instead of static /icons/shortcut-*.png files that are
  // never shipped — keeping the whole manifest sourced from branding.
  const shortcutIcons: ManifestIcon[] = [
    {
      src: getPwaIconUrl(96, branding.favicon),
      sizes: "96x96",
      type: "image/png",
    },
  ];

  return {
    id: "/",
    name: `${companyName} - Property Management System`,
    short_name: companyName,
    description:
      "Comprehensive property management solution for landlords, property managers, and tenants",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#ffffff",
    theme_color: branding.primaryColor || "#2563eb",
    orientation: "portrait-primary",
    lang: "en-US",
    categories: ["business", "productivity", "finance"],
    icons: buildIcons(branding.favicon),
    shortcuts: [
      {
        name: "Dashboard",
        short_name: "Dashboard",
        description: "View property management dashboard",
        url: "/dashboard",
        icons: shortcutIcons,
      },
      {
        name: "Properties",
        short_name: "Properties",
        description: "Manage properties",
        url: "/dashboard/properties",
        icons: shortcutIcons,
      },
      {
        name: "Tenants",
        short_name: "Tenants",
        description: "Manage tenants",
        url: "/dashboard/tenants",
        icons: shortcutIcons,
      },
      {
        name: "Payments",
        short_name: "Payments",
        description: "Track payments",
        url: "/dashboard/payments",
        icons: shortcutIcons,
      },
    ],
    prefer_related_applications: false,
  };
}
