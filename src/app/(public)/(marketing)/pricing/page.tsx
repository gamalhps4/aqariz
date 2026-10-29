import type { Metadata } from "next";
import {
  MarketingPricingPage,
  pricingMetadata,
} from "@/components/marketing/pages/pricing";

// Plans are DB-driven (/admin/plans); revalidate on the same cadence as the
// home page so a price change goes live without a redeploy. The Arabic twin
// is /ar/pricing, drawn by the same component.
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  return pricingMetadata("en");
}

export default function PricingPage() {
  return <MarketingPricingPage lang="en" />;
}
