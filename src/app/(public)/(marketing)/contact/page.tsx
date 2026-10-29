import type { Metadata } from "next";
import {
  MarketingContactPage,
  contactMetadata,
} from "@/components/marketing/pages/contact";

// The Arabic twin is /ar/contact, drawn by the same component.
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  return contactMetadata("en");
}

export default function ContactPage() {
  return <MarketingContactPage lang="en" />;
}
