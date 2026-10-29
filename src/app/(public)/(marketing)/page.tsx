import type { Metadata } from "next";
import {
  MarketingHomePage,
  homeMetadata,
} from "@/components/marketing/pages/home";

// Landing content is managed in the Platform Console (/admin/landing) and rendered
// from the database. Revalidate periodically; content mutations also
// revalidatePath("/"). Pricing cards come from /admin/plans. The Arabic twin
// of this page is /ar (`./ar/page.tsx`), drawn by the same component.
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  return homeMetadata("en");
}

export default function HomePage() {
  return <MarketingHomePage lang="en" />;
}
