/**
 * PropertyPro SaaS - Refreshing the blog after a console change
 *
 * The blog's pages are prerendered and kept (ISR). A change to one post can
 * move every index page (a new post pushes the others down, an unpublished
 * one pulls them up), change the post's own pages in both languages, and
 * change the sitemap. So every change marks all of the blog stale in both
 * languages — the next visit to each page draws it afresh — rather than
 * guessing which pages a post appeared on.
 *
 * `revalidatePath` with a route-group path and "layout" invalidates every
 * page beneath that folder: the index, its numbered pages and every post.
 * The literal paths are named as well, for the record of what changed.
 */

import { revalidatePath } from "next/cache";

export function revalidateBlog(slugs: Array<string | null | undefined>): void {
  revalidatePath("/(public)/(marketing)/blog", "layout");
  revalidatePath("/(public)/(marketing)/ar/blog", "layout");
  revalidatePath("/blog");
  revalidatePath("/ar/blog");
  for (const slug of new Set(slugs.filter((slug): slug is string => Boolean(slug)))) {
    revalidatePath(`/blog/${slug}`);
    revalidatePath(`/ar/blog/${slug}`);
  }
  revalidatePath("/sitemap.xml");
}
