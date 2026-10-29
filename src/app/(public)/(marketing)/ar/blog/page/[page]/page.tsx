import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  MarketingBlogIndexPage,
  blogIndexMetadata,
} from "@/components/marketing/pages/blog";
import { blogIndexPath, parseBlogPageParam } from "@/lib/blog/paths";
import { publishedPageCount } from "@/lib/blog/posts";

// /ar/blog/page/2 onwards; see ../../../../blog/page/[page]/page.tsx.
export const revalidate = 300;

export async function generateStaticParams() {
  const count = await publishedPageCount("ar");
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
  return page ? blogIndexMetadata("ar", page) : {};
}

export default async function ArabicBlogIndexPage({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const raw = (await params).page;
  if (raw === "1") permanentRedirect(blogIndexPath("ar"));
  const page = parseBlogPageParam(raw);
  if (!page) notFound();
  return <MarketingBlogIndexPage lang="ar" page={page} />;
}
