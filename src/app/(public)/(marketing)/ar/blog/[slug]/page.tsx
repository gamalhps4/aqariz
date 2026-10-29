import type { Metadata } from "next";
import {
  MarketingBlogPostPage,
  blogPostMetadata,
} from "@/components/marketing/pages/blog";
import { publishedSlugs } from "@/lib/blog/posts";

// One post in Arabic; a post with no Arabic is a 404 here. See
// ../../../blog/[slug]/page.tsx.
export const revalidate = 300;

export async function generateStaticParams() {
  return (await publishedSlugs("ar")).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  return blogPostMetadata((await params).slug, "ar");
}

export default async function ArabicBlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <MarketingBlogPostPage slug={(await params).slug} lang="ar" />;
}
