import type { Metadata } from "next";
import {
  MarketingBlogPostPage,
  blogPostMetadata,
} from "@/components/marketing/pages/blog";
import { publishedSlugs } from "@/lib/blog/posts";

// One post in English. Posts published at build time are prerendered; later
// ones render on their first visit and are kept, and the console revalidates
// a post's pages whenever it changes. A post with no English is a 404 here
// and lives at /ar/blog/<slug> only.
export const revalidate = 300;

export async function generateStaticParams() {
  return (await publishedSlugs("en")).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  return blogPostMetadata((await params).slug, "en");
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <MarketingBlogPostPage slug={(await params).slug} lang="en" />;
}
