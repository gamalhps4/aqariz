import type { Metadata } from "next";
import {
  MarketingHomePage,
  homeMetadata,
} from "@/components/marketing/pages/home";

// The homepage in Arabic: the same content as /, with the console's Arabic
// overlay (or the shipped translation) in place of the English text. Same
// cadence as /; landing and plan saves revalidate it too.
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  return homeMetadata("ar");
}

export default function ArabicHomePage() {
  return <MarketingHomePage lang="ar" />;
}
