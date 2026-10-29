import type { Metadata } from "next";
import {
  MarketingBlogIndexPage,
  blogIndexMetadata,
} from "@/components/marketing/pages/blog";

// Posts are written in the Platform Console (/admin/blog); every change there
// revalidates the blog, and this cadence catches anything that slipped past
// (another server instance, a direct database edit). The Arabic twin is
// /ar/blog, drawn by the same component. Further pages: ./page/[page].
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  return blogIndexMetadata("en", 1);
}

export default function BlogPage() {
  return <MarketingBlogIndexPage lang="en" page={1} />;
}
