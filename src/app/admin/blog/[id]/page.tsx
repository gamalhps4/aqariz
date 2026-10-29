"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { PostEditor, type AdminBlogPost } from "../_components/post-editor";

/**
 * /admin/blog/[id]: the post, loaded once, handed to the editor. The editor
 * is keyed by the post so a different post starts a fresh form.
 */
export default function EditBlogPostPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocalizationContext();
  const [result, setResult] = useState<
    { id: string; post: AdminBlogPost | null; error: string | null } | null
  >(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/admin/blog/${id}`);
        const payload = await response.json();
        if (!active) return;
        if (!response.ok || !payload.success) {
          setResult({
            id,
            post: null,
            error:
              response.status === 404
                ? t("platform.blog.notFound", { defaultValue: "This post does not exist. It may have been deleted." })
                : payload?.error || t("platform.blog.loadPostError", { defaultValue: "Could not load the post." }),
          });
          return;
        }
        setResult({ id, post: payload.data as AdminBlogPost, error: null });
      } catch {
        if (active) {
          setResult({
            id,
            post: null,
            error: t("platform.blog.loadPostError", { defaultValue: "Could not load the post." }),
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [id, t]);

  // A result for another id (the address changed) counts as still loading.
  const current = result && result.id === id ? result : null;

  if (current?.post) return <PostEditor key={current.post.id} post={current.post} />;

  return (
    <ResponsiveLayout>
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ms-2">
          <Link href="/admin/blog">
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            {t("platform.nav.blog", { defaultValue: "Blog" })}
          </Link>
        </Button>
        {current?.error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{current.error}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("platform.blog.loading", { defaultValue: "Loading the post…" })}
          </div>
        )}
      </div>
    </ResponsiveLayout>
  );
}
