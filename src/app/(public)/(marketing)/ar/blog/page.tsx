import type { Metadata } from "next";
import {
  MarketingBlogIndexPage,
  blogIndexMetadata,
} from "@/components/marketing/pages/blog";

// /blog in Arabic: the posts written in Arabic. Console changes revalidate both.
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  return blogIndexMetadata("ar", 1);
}

export default function ArabicBlogPage() {
  return <MarketingBlogIndexPage lang="ar" page={1} />;
}
