import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  MarketingBlogIndexPage,
  blogIndexMetadata,
} from "@/components/marketing/pages/blog";
import { blogIndexPath, parseBlogPageParam } from "@/lib/blog/paths";
import { publishedPageCount } from "@/lib/blog/posts";

// /blog/page/2 onwards. A path segment rather than `?page=`, because the
// marketing tree is force-static and a static page is never handed a query
// string (lib/blog/paths.ts). Pages that appear later render on first visit.
export const revalidate = 300;

export async function generateStaticParams() {
  const count = await publishedPageCount("en");
  return Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
    page: String(index + 2),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string }>;
}): Promise<Metadata> {
  const page = parseBlogPageParam((await params).page);
  return page ? blogIndexMetadata("en", page) : {};
}

export default async function BlogIndexPage({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const raw = (await params).page;
  // The first page has one address, /blog.
  if (raw === "1") permanentRedirect(blogIndexPath("en"));
  const page = parseBlogPageParam(raw);
  if (!page) notFound();
  return <MarketingBlogIndexPage lang="en" page={page} />;
}
