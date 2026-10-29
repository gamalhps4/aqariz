"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Send,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ImageUpload } from "@/components/ui/image-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { cn } from "@/lib/utils";
import { canPublish, displayTitle, languageState } from "@/lib/blog/languages";
import { blogPostPath } from "@/lib/blog/paths";
import { fallbackBlogSlug, slugify, suggestBlogSlug } from "@/lib/blog/slug";
import { BLOG_LIMITS, normalizeTags } from "@/lib/blog/validation";
import {
  LanguageTabs,
  languagePanelId,
  languageTabId,
  type ContentLang,
} from "../../_components/language-tabs";
import { MarkdownEditor } from "./markdown-editor";

/** Platform admins have no organization, so blog images go to the console's
 * own upload route (the org-scoped one refuses them). */
const BLOG_UPLOAD_ENDPOINT = "/api/admin/blog/upload";

/** A post as GET /api/admin/blog/[id] returns it. */
export interface AdminBlogPost {
  id: string;
  slug: string;
  status: "draft" | "published";
  titleEn: string;
  titleAr: string;
  excerptEn: string;
  excerptAr: string;
  contentEn: string;
  contentAr: string;
  seoTitleEn: string | null;
  seoTitleAr: string | null;
  seoDescriptionEn: string | null;
  seoDescriptionAr: string | null;
  coverImage: string | null;
  coverImageAlt: string | null;
  coverImageAltAr: string | null;
  authorName: string | null;
  tags: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  languages: ContentLang[];
}

/** What the form edits: every field as text (blank is "not set"). */
interface PostForm {
  slug: string;
  titleEn: string;
  titleAr: string;
  excerptEn: string;
  excerptAr: string;
  contentEn: string;
  contentAr: string;
  seoTitleEn: string;
  seoTitleAr: string;
  seoDescriptionEn: string;
  seoDescriptionAr: string;
  coverImage: string;
  coverImageAlt: string;
  coverImageAltAr: string;
  authorName: string;
  tags: string[];
}

function formOf(post: AdminBlogPost | null): PostForm {
  return {
    slug: post?.slug ?? "",
    titleEn: post?.titleEn ?? "",
    titleAr: post?.titleAr ?? "",
    excerptEn: post?.excerptEn ?? "",
    excerptAr: post?.excerptAr ?? "",
    contentEn: post?.contentEn ?? "",
    contentAr: post?.contentAr ?? "",
    seoTitleEn: post?.seoTitleEn ?? "",
    seoTitleAr: post?.seoTitleAr ?? "",
    seoDescriptionEn: post?.seoDescriptionEn ?? "",
    seoDescriptionAr: post?.seoDescriptionAr ?? "",
    coverImage: post?.coverImage ?? "",
    coverImageAlt: post?.coverImageAlt ?? "",
    coverImageAltAr: post?.coverImageAltAr ?? "",
    authorName: post?.authorName ?? "",
    tags: post?.tags ?? [],
  };
}

/** The per-language fields, by the tab that edits them. */
const LANGUAGE_FIELDS = {
  en: { title: "titleEn", excerpt: "excerptEn", content: "contentEn", seoTitle: "seoTitleEn", seoDescription: "seoDescriptionEn" },
  ar: { title: "titleAr", excerpt: "excerptAr", content: "contentAr", seoTitle: "seoTitleAr", seoDescription: "seoDescriptionAr" },
} as const satisfies Record<ContentLang, Record<string, keyof PostForm>>;

type SaveAction = "save" | "publish" | "unpublish";

/** A text field's character count against its limit. */
function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span
      className={cn("text-xs tabular-nums", value.length > max * 0.9 ? "text-warning" : "text-muted-foreground")}
      dir="ltr"
    >
      {value.length}/{max}
    </span>
  );
}

/**
 * The blog post editor: /admin/blog/new and /admin/blog/[id].
 *
 * The words are edited per language behind "English | العربية" tabs (title,
 * excerpt, content, search fields); the address, cover, tags and author are
 * shared and sit beside them. Arabic inputs are right to left. The language
 * line under the tabs says whether that language will be on the site — a
 * title and content make it — and Publish stays off until one language is
 * complete, the same rule the API enforces.
 *
 * Mounted with the post it edits (or none, for a new one), so the form starts
 * from props without an effect copying them into state.
 */
export function PostEditor({ post: initial }: { post: AdminBlogPost | null }) {
  const { t, formatDate } = useLocalizationContext();
  const router = useRouter();
  const ids = useId();
  const [post, setPost] = useState<AdminBlogPost | null>(initial);
  const [form, setForm] = useState<PostForm>(() => formOf(initial));
  const [saved, setSaved] = useState<PostForm>(() => formOf(initial));
  const [lang, setLang] = useState<ContentLang>(() =>
    initial && !initial.titleEn && initial.titleAr ? "ar" : "en",
  );
  // A new post's slug follows its English title until the operator edits it.
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));
  const [tagDraft, setTagDraft] = useState("");
  const [saving, setSaving] = useState<SaveAction | "delete" | null>(null);
  const [error, setError] = useState("");
  const [slugError, setSlugError] = useState("");

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const fields = LANGUAGE_FIELDS[lang];
  const ar = lang === "ar";
  const textDir = { dir: ar ? "rtl" : "ltr", lang } as const;
  const published = post?.status === "published";
  const publishable = canPublish(form);

  // Leaving with unsaved edits asks first. Only a listener: no state here.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof PostForm>(key: K, value: PostForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const setEnglishTitle = (value: string) =>
    setForm((current) => {
      const next = { ...current, titleEn: value };
      if (!slugTouched && slugify(value)) next.slug = suggestBlogSlug(value);
      return next;
    });

  const addTags = (raw: string) => {
    const pieces = raw.split(",").map((piece) => piece.trim()).filter(Boolean);
    if (pieces.length === 0) return;
    setForm((current) => ({
      ...current,
      tags: normalizeTags([...current.tags, ...pieces]).slice(0, BLOG_LIMITS.tags),
    }));
    setTagDraft("");
  };

  const onTagKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTags(tagDraft);
    } else if (event.key === "Backspace" && tagDraft === "" && form.tags.length > 0) {
      set("tags", form.tags.slice(0, -1));
    }
  };

  const submit = async (action: SaveAction) => {
    setSaving(action);
    setError("");
    setSlugError("");
    // An Arabic-only post has no English title to make a slug from.
    const slug = form.slug.trim() || (post ? post.slug : fallbackBlogSlug());
    const status =
      action === "publish" ? "published" : action === "unpublish" ? "draft" : (post?.status ?? "draft");
    const body = { ...form, tags: normalizeTags([...form.tags, ...(tagDraft.trim() ? [tagDraft] : [])]), slug, status };
    try {
      const response = await fetch(post ? `/api/admin/blog/${post.id}` : "/api/admin/blog", {
        method: post ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        const message: string = payload?.error || payload?.message || "Request failed";
        if (response.status === 409) setSlugError(message);
        else setError(message);
        toast.error(message);
        return;
      }
      const next = payload.data as AdminBlogPost;
      const nextForm = formOf(next);
      setPost(next);
      setForm(nextForm);
      setSaved(nextForm);
      setTagDraft("");
      setSlugTouched(true);
      toast.success(
        action === "publish"
          ? t("platform.blog.toast.published", { defaultValue: "Post published" })
          : action === "unpublish"
            ? t("platform.blog.toast.unpublished", { defaultValue: "Post unpublished — it is off the site" })
            : t("platform.blog.toast.saved", { defaultValue: "Saved" }),
      );
      if (!post) router.replace(`/admin/blog/${next.id}`);
    } catch {
      const message = t("platform.blog.saveError", { defaultValue: "Could not save the post." });
      setError(message);
      toast.error(message);
    } finally {
      setSaving(null);
    }
  };

  const remove = async () => {
    if (!post) return;
    setSaving("delete");
    try {
      const response = await fetch(`/api/admin/blog/${post.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload?.error || "Request failed");
      toast.success(t("platform.blog.deleted", { defaultValue: "Post deleted" }));
      // Nothing left to lose; skip the unsaved-changes prompt.
      setSaved(form);
      router.push("/admin/blog");
    } catch {
      toast.error(t("platform.blog.deleteError", { defaultValue: "Could not delete the post." }));
      setSaving(null);
    }
  };

  const busy = saving !== null;
  const heading = post
    ? displayTitle(post).title || t("platform.blog.untitled", { defaultValue: "Untitled" })
    : t("platform.blog.newPost", { defaultValue: "New post" });
  const state = languageState(form, lang);
  // A left-to-right mark keeps the path's leading "/" before it when the
  // sentence around it is Arabic ("/blog", not "blog/").
  const blogPath = `\u200e${ar ? "/ar/blog" : "/blog"}`;
  const slugPreview = form.slug || t("platform.blog.slug.generated", { defaultValue: "generated-on-save" });
  const slugChangedOnLivePost = Boolean(published && post && form.slug !== post.slug);

  const spinner = (action: SaveAction | "delete") =>
    saving === action ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null;

  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        {/* Header: where you are, what state the post is in, what you can do. */}
        <div className="space-y-3">
          <Button asChild variant="ghost" size="sm" className="-ms-2">
            <Link href="/admin/blog">
              <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
              {t("platform.nav.blog", { defaultValue: "Blog" })}
            </Link>
          </Button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  className="min-w-0 break-words text-2xl font-semibold"
                  {...(post && displayTitle(post).lang === "ar" ? { dir: "rtl", lang: "ar" } : {})}
                >
                  {heading}
                </h1>
                {post &&
                  (published ? (
                    <Badge variant="success">{t("platform.blog.status.published", { defaultValue: "Published" })}</Badge>
                  ) : (
                    <Badge variant="secondary">{t("platform.blog.status.draft", { defaultValue: "Draft" })}</Badge>
                  ))}
                {dirty && (
                  <Badge variant="warning">{t("platform.blog.unsaved", { defaultValue: "Unsaved changes" })}</Badge>
                )}
              </div>
              {post && (
                <p className="text-sm text-muted-foreground">
                  {post.publishedAt &&
                    `${t("platform.blog.publishedOn", { defaultValue: "First published {date}", values: { date: formatDate(post.publishedAt) } })} · `}
                  {t("platform.blog.updatedOn", { defaultValue: "Updated {date}", values: { date: formatDate(post.updatedAt) } })}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {post && (
                <DeleteConfirmationDialog
                  itemName={heading}
                  description={t("platform.blog.deleteDescription", {
                    defaultValue: "The post is removed from the site in both languages. This cannot be undone.",
                  })}
                  onConfirm={remove}
                  loading={saving === "delete"}
                >
                  <Button variant="outline" disabled={busy} className="text-destructive hover:text-destructive">
                    {spinner("delete") ?? <Trash2 className="me-2 h-4 w-4" />}
                    {t("platform.blog.delete", { defaultValue: "Delete" })}
                  </Button>
                </DeleteConfirmationDialog>
              )}
              {published && (
                <Button variant="outline" disabled={busy} onClick={() => submit("unpublish")}>
                  {spinner("unpublish") ?? <EyeOff className="me-2 h-4 w-4" />}
                  {t("platform.blog.unpublish", { defaultValue: "Unpublish" })}
                </Button>
              )}
              <Button
                variant={published ? "default" : "outline"}
                disabled={busy || (Boolean(post) && !dirty)}
                onClick={() => submit("save")}
              >
                {spinner("save") ?? <Save className="me-2 h-4 w-4" />}
                {published
                  ? t("platform.blog.saveChanges", { defaultValue: "Save changes" })
                  : t("platform.blog.saveDraft", { defaultValue: "Save draft" })}
              </Button>
              {!published && (
                <Button
                  disabled={busy || !publishable}
                  onClick={() => submit("publish")}
                  title={
                    publishable
                      ? undefined
                      : t("platform.blog.publishNeeds", {
                          defaultValue: "Add a title and content in at least one language to publish.",
                        })
                  }
                >
                  {spinner("publish") ?? <Send className="me-2 h-4 w-4 rtl:-scale-x-100" />}
                  {t("platform.blog.publish", { defaultValue: "Publish" })}
                </Button>
              )}
            </div>
          </div>
          {!publishable && !published && (
            <p className="text-sm text-muted-foreground">
              {t("platform.blog.publishNeeds", {
                defaultValue: "Add a title and content in at least one language to publish.",
              })}
            </p>
          )}
          {published && post && post.languages.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {post.languages.map((language) => (
                <a
                  key={language}
                  href={blogPostPath(post.slug, language)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <Eye className="h-4 w-4" />
                  {language === "ar"
                    ? t("platform.blog.viewArabic", { defaultValue: "View the Arabic page" })
                    : t("platform.blog.viewEnglish", { defaultValue: "View the English page" })}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
          {/* The words, per language. */}
          <Card className="min-w-0">
            <CardHeader className="space-y-3">
              <LanguageTabs
                value={lang}
                onChange={setLang}
                idBase={ids}
                label={t("platform.blog.contentLanguage", { defaultValue: "Content language" })}
              />
              <p
                className={cn(
                  "flex items-center gap-2 text-sm",
                  state === "complete" ? "text-success" : "text-muted-foreground",
                )}
              >
                {state === "complete" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <CircleDashed className="h-4 w-4 shrink-0" />
                )}
                <span>
                  {state === "complete"
                    ? published
                      ? t("platform.blog.langLive", {
                          defaultValue: "This language is live on {path}.",
                          values: { path: blogPath },
                        })
                      : t("platform.blog.langReady", {
                          defaultValue: "This language is ready: it appears on {path} once the post is published.",
                          values: { path: blogPath },
                        })
                    : t("platform.blog.langMissing", {
                        defaultValue: "Not on {path} until this language has a title and content.",
                        values: { path: blogPath },
                      })}
                </span>
              </p>
            </CardHeader>
            <CardContent
              role="tabpanel"
              id={languagePanelId(ids)}
              aria-labelledby={languageTabId(ids, lang)}
              className="space-y-5"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`${ids}-title`}>{t("platform.blog.field.title", { defaultValue: "Title" })}</Label>
                  <Counter value={form[fields.title]} max={BLOG_LIMITS.title} />
                </div>
                <Input
                  id={`${ids}-title`}
                  value={form[fields.title]}
                  onChange={(event) =>
                    ar ? set("titleAr", event.target.value) : setEnglishTitle(event.target.value)
                  }
                  maxLength={BLOG_LIMITS.title}
                  placeholder={ar ? form.titleEn : undefined}
                  className="text-base"
                  {...textDir}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`${ids}-excerpt`}>{t("platform.blog.field.excerpt", { defaultValue: "Excerpt" })}</Label>
                  <Counter value={form[fields.excerpt]} max={BLOG_LIMITS.excerpt} />
                </div>
                <Textarea
                  id={`${ids}-excerpt`}
                  rows={3}
                  value={form[fields.excerpt]}
                  onChange={(event) => set(fields.excerpt, event.target.value)}
                  maxLength={BLOG_LIMITS.excerpt}
                  placeholder={ar ? form.excerptEn : undefined}
                  {...textDir}
                />
                <p className="text-xs text-muted-foreground">
                  {t("platform.blog.field.excerptHint", {
                    defaultValue: "One or two sentences for the blog's cards and search results.",
                  })}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label id={`${ids}-content-label`} htmlFor={`${ids}-content`}>
                  {t("platform.blog.field.content", { defaultValue: "Content" })}
                </Label>
                {/* Keyed by language: each tab is its own text box, with its
                    own caret and undo history. */}
                <MarkdownEditor
                  key={lang}
                  id={`${ids}-content`}
                  labelledBy={`${ids}-content-label`}
                  value={form[fields.content]}
                  onChange={(value) => set(fields.content, value)}
                  lang={lang}
                  maxLength={BLOG_LIMITS.content}
                  uploadEndpoint={BLOG_UPLOAD_ENDPOINT}
                />
              </div>

              <fieldset className="space-y-4 rounded-lg border p-4">
                <legend className="px-1 text-sm font-medium">
                  {t("platform.blog.seo.title", { defaultValue: "Search engines" })}
                </legend>
                <p className="text-xs text-muted-foreground">
                  {t("platform.blog.seo.hint", {
                    defaultValue: "Optional. Left empty, the title and excerpt are used.",
                  })}
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`${ids}-seo-title`}>{t("platform.blog.seo.searchTitle", { defaultValue: "Search title" })}</Label>
                    <Counter value={form[fields.seoTitle]} max={BLOG_LIMITS.seoTitle} />
                  </div>
                  <Input
                    id={`${ids}-seo-title`}
                    value={form[fields.seoTitle]}
                    onChange={(event) => set(fields.seoTitle, event.target.value)}
                    maxLength={BLOG_LIMITS.seoTitle}
                    placeholder={form[fields.title]}
                    {...textDir}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`${ids}-seo-description`}>
                      {t("platform.blog.seo.searchDescription", { defaultValue: "Search description" })}
                    </Label>
                    <Counter value={form[fields.seoDescription]} max={BLOG_LIMITS.seoDescription} />
                  </div>
                  <Textarea
                    id={`${ids}-seo-description`}
                    rows={2}
                    value={form[fields.seoDescription]}
                    onChange={(event) => set(fields.seoDescription, event.target.value)}
                    maxLength={BLOG_LIMITS.seoDescription}
                    placeholder={form[fields.excerpt]}
                    {...textDir}
                  />
                </div>
              </fieldset>
            </CardContent>
          </Card>

          {/* What both languages share. */}
          <div className="grid content-start gap-6 md:grid-cols-2 2xl:grid-cols-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("platform.blog.address.title", { defaultValue: "Address" })}</CardTitle>
                <CardDescription>
                  {t("platform.blog.address.description", {
                    defaultValue: "One slug for both languages: lowercase letters, digits and hyphens.",
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${ids}-slug`}>{t("platform.blog.slug.label", { defaultValue: "Slug" })}</Label>
                  {/* The shared Input sits in its own wrapper, so the wrapper
                      is what has to grow. */}
                  <div className="flex gap-2 [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1" dir="ltr">
                    <Input
                      id={`${ids}-slug`}
                      value={form.slug}
                      onChange={(event) => {
                        setSlugTouched(true);
                        setSlugError("");
                        set("slug", event.target.value.toLowerCase().replace(/\s+/g, "-"));
                      }}
                      maxLength={96}
                      placeholder={t("platform.blog.slug.generated", { defaultValue: "generated-on-save" })}
                      aria-invalid={Boolean(slugError)}
                      className={cn("font-mono text-sm", slugError && "border-destructive")}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      title={t("platform.blog.slug.generate", { defaultValue: "Make from the English title" })}
                      aria-label={t("platform.blog.slug.generate", { defaultValue: "Make from the English title" })}
                      onClick={() => {
                        setSlugTouched(true);
                        setSlugError("");
                        set("slug", suggestBlogSlug(form.titleEn));
                      }}
                    >
                      <Wand2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {slugError && <p className="text-sm text-destructive">{slugError}</p>}
                  {slugChangedOnLivePost && (
                    <p className="text-xs text-warning">
                      {t("platform.blog.slug.liveWarning", {
                        defaultValue: "This post is live: links to its old address will stop working.",
                      })}
                    </p>
                  )}
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground" dir="ltr">
                  <li className="truncate">/blog/{slugPreview}</li>
                  <li className="truncate">/ar/blog/{slugPreview}</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("platform.blog.cover.title", { defaultValue: "Cover image" })}</CardTitle>
                <CardDescription>
                  {t("platform.blog.cover.description", {
                    defaultValue: "Shown on the blog's cards, at the top of the post and when it is shared. 16:9 works best.",
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ImageUpload
                  key={form.coverImage}
                  compact
                  maxFiles={1}
                  endpoint={BLOG_UPLOAD_ENDPOINT}
                  folder="PropertyPro/blog"
                  existingImages={form.coverImage ? [{ url: form.coverImage, publicId: form.coverImage }] : []}
                  onImagesUploaded={(images) => {
                    const url = images[0]?.url;
                    if (url) set("coverImage", url);
                  }}
                  onImagesRemoved={() => set("coverImage", "")}
                />
                <Input
                  value={form.coverImage}
                  onChange={(event) => set("coverImage", event.target.value.trim())}
                  placeholder="https://… or /images/…"
                  className="text-xs"
                  dir="ltr"
                  aria-label={t("platform.blog.cover.url", { defaultValue: "Image address" })}
                />
                <div className="space-y-1.5">
                  <Label htmlFor={`${ids}-alt-en`}>
                    {t("platform.blog.cover.altEn", { defaultValue: "Description (English)" })}
                  </Label>
                  <Input
                    id={`${ids}-alt-en`}
                    value={form.coverImageAlt}
                    onChange={(event) => set("coverImageAlt", event.target.value)}
                    maxLength={BLOG_LIMITS.coverImageAlt}
                    dir="ltr"
                    lang="en"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${ids}-alt-ar`}>
                    {t("platform.blog.cover.altAr", { defaultValue: "Description (Arabic)" })}
                  </Label>
                  <Input
                    id={`${ids}-alt-ar`}
                    value={form.coverImageAltAr}
                    onChange={(event) => set("coverImageAltAr", event.target.value)}
                    maxLength={BLOG_LIMITS.coverImageAlt}
                    placeholder={form.coverImageAlt}
                    dir="rtl"
                    lang="ar"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("platform.blog.cover.altHint", {
                    defaultValue: "What the picture shows, for readers who cannot see it. Leave empty if it is decoration.",
                  })}
                </p>
              </CardContent>
            </Card>

            <Card className="md:col-span-2 2xl:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">{t("platform.blog.details.title", { defaultValue: "Details" })}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor={`${ids}-author`}>{t("platform.blog.field.author", { defaultValue: "Author" })}</Label>
                  <Input
                    id={`${ids}-author`}
                    value={form.authorName}
                    onChange={(event) => set("authorName", event.target.value)}
                    maxLength={BLOG_LIMITS.authorName}
                    placeholder={t("platform.blog.field.authorHint", { defaultValue: "Shown under the title; optional" })}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`${ids}-tags`}>{t("platform.blog.field.tags", { defaultValue: "Tags" })}</Label>
                    <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                      {form.tags.length}/{BLOG_LIMITS.tags}
                    </span>
                  </div>
                  {form.tags.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5">
                      {form.tags.map((tag) => (
                        <li key={tag}>
                          <Badge variant="outline" className="gap-1 pe-1 font-normal">
                            <span dir="auto">{tag}</span>
                            <button
                              type="button"
                              className="rounded-sm p-0.5 hover:bg-muted"
                              aria-label={t("platform.blog.field.removeTag", {
                                defaultValue: "Remove {tag}",
                                values: { tag },
                              })}
                              onClick={() => set("tags", form.tags.filter((item) => item !== tag))}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Input
                    id={`${ids}-tags`}
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={onTagKey}
                    onBlur={() => addTags(tagDraft)}
                    maxLength={BLOG_LIMITS.tag}
                    disabled={form.tags.length >= BLOG_LIMITS.tags}
                    dir="auto"
                    placeholder={t("platform.blog.field.tagsHint", { defaultValue: "Type a tag and press Enter" })}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ResponsiveLayout>
  );
}
