/**
 * PropertyPro SaaS - Blog posts (platform console)
 *
 * GET lists posts for /admin/blog — search, status filter, sorting and
 * paging, without their content. POST creates one, as a draft or published
 * at once. Every write is validated (lib/blog/validation.ts), audited in the
 * platform trail, and refreshes the public blog (lib/blog/revalidate.ts).
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { recordPlatformAudit } from "@/lib/platform/audit";
import {
  BLOG_TABLE_MISSING_MESSAGE,
  auditName,
  consolePost,
  isSlugClash,
  listBlogPostsForConsole,
  slugClashMessage,
  slugTaken,
  slugsLike,
} from "@/lib/blog/admin";
import { blogImageHosts } from "@/lib/blog/image-hosts";
import { postLanguages } from "@/lib/blog/languages";
import { isBlogTableMissing } from "@/lib/blog/posts";
import { revalidateBlog } from "@/lib/blog/revalidate";
import { suggestBlogSlug, uniqueBlogSlug } from "@/lib/blog/slug";
import {
  EMPTY_BLOG_POST,
  blogPostCreateSchema,
  blogPostProblem,
  firstIssue,
  mergeBlogPost,
} from "@/lib/blog/validation";

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const list = await listBlogPostsForConsole(request.nextUrl.searchParams);
      return createSuccessResponse(list);
    } catch (error) {
      if (isBlogTableMissing(error)) {
        return createErrorResponse(BLOG_TABLE_MISSING_MESSAGE, 503);
      }
      return handleApiError(error, "Failed to load blog posts");
    }
  },
);

export const POST = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await parseRequestBody(request);
      if (!body.success) return createErrorResponse("Invalid JSON body", 400);

      const parsed = blogPostCreateSchema.safeParse(body.data);
      if (!parsed.success) return createErrorResponse(firstIssue(parsed.error), 400);

      const post = mergeBlogPost(EMPTY_BLOG_POST, parsed.data);
      // The console always sends a slug. Anything else that creates a post
      // without one gets one made from the English title, kept unique.
      if (!post.slug) {
        const base = suggestBlogSlug(post.titleEn);
        post.slug = uniqueBlogSlug(base, await slugsLike(base));
      }

      const problem = blogPostProblem(post, { imageHosts: blogImageHosts() });
      if (problem) return createErrorResponse(problem, 400);

      if (await slugTaken(post.slug)) {
        return createErrorResponse(slugClashMessage(post.slug), 409, undefined, "CONFLICT");
      }

      const published = post.status === "published";
      let created;
      try {
        created = await db.blogPost.create({
          data: {
            ...post,
            publishedAt: published ? new Date() : null,
            createdById: user.id,
          },
        });
      } catch (error) {
        if (isSlugClash(error)) {
          return createErrorResponse(slugClashMessage(post.slug), 409, undefined, "CONFLICT");
        }
        throw error;
      }

      const name = auditName(created);
      const metadata = {
        slug: created.slug,
        status: created.status,
        languages: postLanguages(created),
      };
      await recordPlatformAudit({
        actor: user,
        action: "blog.created",
        targetType: "blog_post",
        targetId: created.id,
        targetName: name,
        summary: `Created blog post "${name}"`,
        metadata,
      });
      if (published) {
        await recordPlatformAudit({
          actor: user,
          action: "blog.published",
          targetType: "blog_post",
          targetId: created.id,
          targetName: name,
          summary: `Published blog post "${name}"`,
          metadata,
        });
      }

      revalidateBlog([created.slug]);

      return createSuccessResponse(
        consolePost(created),
        published ? "Post published" : "Draft saved",
      );
    } catch (error) {
      if (isBlogTableMissing(error)) {
        return createErrorResponse(BLOG_TABLE_MISSING_MESSAGE, 503);
      }
      return handleApiError(error, "Failed to create the blog post");
    }
  },
);
