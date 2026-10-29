/**
 * PropertyPro SaaS - One blog post (platform console)
 *
 * GET reads it for the editor. PATCH saves any subset of its fields and/or
 * its status: `status: "published"` publishes (stamping `publishedAt` the
 * first time only, so a republished post keeps its place in the blog),
 * `status: "draft"` takes it off the site without losing anything. DELETE
 * removes it for good.
 *
 * Edits and status changes are audited as separate entries — a save that also
 * publishes records both — and every change refreshes the public blog in both
 * languages, under the old slug and the new one.
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
import { noteAuditEntry } from "@/lib/audit/scope";
import {
  BLOG_TABLE_MISSING_MESSAGE,
  auditName,
  changedFields,
  consolePost,
  draftOf,
  isSlugClash,
  slugClashMessage,
  slugTaken,
} from "@/lib/blog/admin";
import { blogImageHosts } from "@/lib/blog/image-hosts";
import { postLanguages } from "@/lib/blog/languages";
import { isBlogTableMissing } from "@/lib/blog/posts";
import { revalidateBlog } from "@/lib/blog/revalidate";
import {
  blogPostPatchSchema,
  blogPostProblem,
  firstIssue,
  mergeBlogPost,
} from "@/lib/blog/validation";

type Context = { params: Promise<{ id: string }> };

function failure(error: unknown, fallback: string) {
  if (isBlogTableMissing(error)) {
    return createErrorResponse(BLOG_TABLE_MISSING_MESSAGE, 503);
  }
  return handleApiError(error, fallback);
}

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, _request: NextRequest, context: Context) => {
    try {
      const { id } = await context.params;
      const post = await db.blogPost.findFirst({ where: { id } });
      if (!post) return createErrorResponse("Blog post not found", 404);
      return createSuccessResponse(consolePost(post));
    } catch (error) {
      return failure(error, "Failed to load the blog post");
    }
  },
);

export const PATCH = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: Context) => {
    try {
      const { id } = await context.params;
      const body = await parseRequestBody(request);
      if (!body.success) return createErrorResponse("Invalid JSON body", 400);

      const parsed = blogPostPatchSchema.safeParse(body.data);
      if (!parsed.success) return createErrorResponse(firstIssue(parsed.error), 400);

      const existing = await db.blogPost.findFirst({ where: { id } });
      if (!existing) return createErrorResponse("Blog post not found", 404);

      const before = draftOf(existing);
      const after = mergeBlogPost(before, parsed.data);
      const problem = blogPostProblem(after, { imageHosts: blogImageHosts() });
      if (problem) return createErrorResponse(problem, 400);

      if (after.slug !== before.slug && (await slugTaken(after.slug, id))) {
        return createErrorResponse(slugClashMessage(after.slug), 409, undefined, "CONFLICT");
      }

      const fields = changedFields(before, after);
      const statusChanged = after.status !== before.status;
      if (fields.length === 0 && !statusChanged) {
        // Nothing to store, nothing to record — and the API wrapper is told
        // so, or it would log the request itself as an unnamed change.
        noteAuditEntry();
        return createSuccessResponse(consolePost(existing), "No changes");
      }

      const publishing = statusChanged && after.status === "published";
      let saved;
      try {
        saved = await db.blogPost.update({
          where: { id },
          data: {
            ...after,
            ...(publishing && !existing.publishedAt ? { publishedAt: new Date() } : {}),
          },
        });
      } catch (error) {
        if (isSlugClash(error)) {
          return createErrorResponse(slugClashMessage(after.slug), 409, undefined, "CONFLICT");
        }
        throw error;
      }

      const name = auditName(saved);
      const metadata = {
        slug: saved.slug,
        status: saved.status,
        languages: postLanguages(saved),
      };
      if (fields.length > 0) {
        await recordPlatformAudit({
          actor: user,
          action: "blog.updated",
          targetType: "blog_post",
          targetId: saved.id,
          targetName: name,
          summary: `Edited blog post "${name}" (${fields.join(", ")})`,
          metadata: {
            ...metadata,
            fields,
            ...(before.slug !== saved.slug ? { previousSlug: before.slug } : {}),
          },
        });
      }
      if (statusChanged) {
        await recordPlatformAudit({
          actor: user,
          action: publishing ? "blog.published" : "blog.unpublished",
          targetType: "blog_post",
          targetId: saved.id,
          targetName: name,
          summary: publishing
            ? `Published blog post "${name}"`
            : `Unpublished blog post "${name}"`,
          metadata,
        });
      }

      revalidateBlog([before.slug, saved.slug]);

      return createSuccessResponse(
        consolePost(saved),
        statusChanged ? (publishing ? "Post published" : "Post unpublished") : "Post saved",
      );
    } catch (error) {
      return failure(error, "Failed to save the blog post");
    }
  },
);

export const DELETE = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, _request: NextRequest, context: Context) => {
    try {
      const { id } = await context.params;
      const existing = await db.blogPost.findFirst({
        where: { id },
        select: { id: true, slug: true, status: true, titleEn: true, titleAr: true },
      });
      if (!existing) return createErrorResponse("Blog post not found", 404);

      await db.blogPost.delete({ where: { id } });

      const name = auditName(existing);
      await recordPlatformAudit({
        actor: user,
        action: "blog.deleted",
        targetType: "blog_post",
        targetId: existing.id,
        targetName: name,
        summary: `Deleted blog post "${name}"`,
        metadata: { slug: existing.slug, status: existing.status },
      });

      revalidateBlog([existing.slug]);

      return createSuccessResponse({ id }, "Post deleted");
    } catch (error) {
      return failure(error, "Failed to delete the blog post");
    }
  },
);
