import type { Metadata } from "next";
import {
  MarketingContactPage,
  contactMetadata,
} from "@/components/marketing/pages/contact";

// /contact in Arabic.
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  return contactMetadata("ar");
}

export default function ArabicContactPage() {
  return <MarketingContactPage lang="ar" />;
}
