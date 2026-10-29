import type { Metadata } from "next";
import {
  MarketingPricingPage,
  pricingMetadata,
} from "@/components/marketing/pages/pricing";

// /pricing in Arabic; plan saves revalidate both.
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  return pricingMetadata("ar");
}

export default function ArabicPricingPage() {
  return <MarketingPricingPage lang="ar" />;
}
