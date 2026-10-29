"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  Bold,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ContentLang } from "../../_components/language-tabs";
import { BlogContent } from "@/lib/blog/markdown-render";
import {
  applyMarkdownFormat,
  imageMarkdown,
  insertBlock,
  type MarkdownFormat,
  type TextEdit,
} from "@/lib/blog/markdown-toolbar";

/** Words the buttons put into the post: in the post's language, not the
 * console's — an Arabic post gets an Arabic placeholder to type over. */
const CONTENT_PLACEHOLDERS: Record<
  ContentLang,
  { text: string; linkText: string; url: string; imageAlt: string }
> = {
  en: { text: "text", linkText: "link text", url: "https://", imageAlt: "Image description" },
  ar: { text: "نص", linkText: "نص الرابط", url: "https://", imageAlt: "وصف الصورة" },
};

const TOOLS: Array<{ format: MarkdownFormat; icon: LucideIcon; label: string; fallback: string }> = [
  { format: "heading2", icon: Heading2, label: "platform.blog.editor.heading", fallback: "Heading" },
  { format: "heading3", icon: Heading3, label: "platform.blog.editor.subheading", fallback: "Subheading" },
  { format: "bold", icon: Bold, label: "platform.blog.editor.bold", fallback: "Bold" },
  { format: "italic", icon: Italic, label: "platform.blog.editor.italic", fallback: "Italic" },
  { format: "link", icon: Link2, label: "platform.blog.editor.link", fallback: "Link" },
  { format: "bulletList", icon: List, label: "platform.blog.editor.bulletList", fallback: "Bulleted list" },
  { format: "numberedList", icon: ListOrdered, label: "platform.blog.editor.numberedList", fallback: "Numbered list" },
  { format: "quote", icon: Quote, label: "platform.blog.editor.quote", fallback: "Quote" },
];

/**
 * The post body: a plain text box with formatting buttons, and beside it (or
 * below it, when the card is narrow) a live preview drawn by the same
 * renderer as the public page, in the post's own language and direction.
 *
 * The text box is the source of truth — the buttons only insert the marks
 * the renderer reads (lib/blog/markdown-toolbar.ts), so what is stored is
 * always text the operator can see and edit. "Insert image" uploads through
 * the console's blog upload route and places the image on its own line.
 */
export function MarkdownEditor({
  id,
  value,
  onChange,
  lang,
  maxLength,
  uploadEndpoint,
  labelledBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  lang: ContentLang;
  maxLength: number;
  uploadEndpoint: string;
  labelledBy?: string;
}) {
  const { t } = useLocalizationContext();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Where the caret was when the image picker opened. */
  const caretRef = useRef<{ start: number; end: number }>({ start: value.length, end: value.length });
  const [uploading, setUploading] = useState(false);
  const placeholders = CONTENT_PLACEHOLDERS[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";

  /** Apply an edit, then put the selection where the edit says once the new
   * value is on screen. */
  const commit = (edit: TextEdit) => {
    onChange(edit.value);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  };

  const format = (kind: MarkdownFormat) => {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    commit(applyMarkdownFormat(value, start, end, kind, placeholders));
  };

  const pickImage = () => {
    const element = textareaRef.current;
    caretRef.current = {
      start: element?.selectionStart ?? value.length,
      end: element?.selectionEnd ?? value.length,
    };
    fileRef.current?.click();
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("files", file);
      const response = await fetch(uploadEndpoint, { method: "POST", body, credentials: "include" });
      const payload = await response.json();
      const url: string | undefined = payload?.images?.[0]?.url;
      if (!response.ok || !url) throw new Error(payload?.error || "Upload failed");
      const { start, end } = caretRef.current;
      const block = imageMarkdown(url, placeholders.imageAlt);
      // The text as it is now, not as it was when the upload began: typing
      // carries on while the image travels.
      const current = textareaRef.current?.value ?? value;
      const edit = insertBlock(current, start, end, block);
      // Select the description so the next keystrokes replace it.
      const altStart = edit.selectionStart - block.length + 2;
      commit({ ...edit, selectionStart: altStart, selectionEnd: altStart + placeholders.imageAlt.length });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message !== "Upload failed"
          ? error.message
          : t("platform.blog.editor.uploadFailed", { defaultValue: "The image could not be uploaded." }),
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="@container space-y-2">
      <div
        role="toolbar"
        aria-label={t("platform.blog.editor.toolbar", { defaultValue: "Formatting" })}
        aria-controls={id}
        className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-1"
      >
        {TOOLS.map((tool) => {
          const label = t(tool.label, { defaultValue: tool.fallback });
          return (
            <Button
              key={tool.format}
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={label}
              aria-label={label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format(tool.format)}
            >
              <tool.icon className="h-4 w-4" />
            </Button>
          );
        })}
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2"
          onMouseDown={(event) => event.preventDefault()}
          onClick={pickImage}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {t("platform.blog.editor.image", { defaultValue: "Image" })}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={upload}
          tabIndex={-1}
          aria-hidden
        />
      </div>

      <div className="grid gap-4 @4xl:grid-cols-2">
        <div className="space-y-1.5">
          <Textarea
            ref={textareaRef}
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            dir={dir}
            lang={lang}
            maxLength={maxLength}
            aria-labelledby={labelledBy}
            spellCheck
            placeholder={t(
              lang === "ar" ? "platform.blog.editor.placeholderAr" : "platform.blog.editor.placeholderEn",
              { defaultValue: lang === "ar" ? "اكتب المقال هنا…" : "Write the article here…" },
            )}
            className="min-h-[420px] resize-y text-[15px] leading-7 @4xl:h-[560px]"
          />
          <p className="text-end text-xs text-muted-foreground tabular-nums" dir="ltr">
            {value.length.toLocaleString("en-US")} / {maxLength.toLocaleString("en-US")}
          </p>
        </div>

        <section
          aria-label={t("platform.blog.editor.preview", { defaultValue: "Preview" })}
          className="flex min-w-0 flex-col overflow-hidden rounded-md border"
        >
          <p className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            {t("platform.blog.editor.preview", { defaultValue: "Preview" })}
          </p>
          {/* The page's own colours whatever the console's theme: this is how
              the post will look on the site. */}
          <div
            dir={dir}
            lang={lang}
            className={cn(
              "min-h-[200px] flex-1 overflow-auto bg-white px-5 py-5 text-slate-700 @4xl:max-h-[530px]",
              lang === "ar" && "font-sans",
            )}
          >
            {value.trim() ? (
              <BlogContent source={value} />
            ) : (
              <p className="text-sm text-slate-400">
                {t("platform.blog.editor.previewEmpty", {
                  defaultValue: "The formatted article appears here as you write.",
                })}
              </p>
            )}
          </div>
        </section>
      </div>

      <details className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
        <summary className="cursor-pointer select-none text-muted-foreground">
          {t("platform.blog.editor.helpTitle", { defaultValue: "Formatting help" })}
        </summary>
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2" dir="ltr">
          {[
            ["## …", t("platform.blog.editor.help.heading", { defaultValue: "Heading (### for a smaller one)" })],
            ["**…**", t("platform.blog.editor.help.bold", { defaultValue: "Bold" })],
            ["*…*", t("platform.blog.editor.help.italic", { defaultValue: "Italic" })],
            ["[text](https://…)", t("platform.blog.editor.help.link", { defaultValue: "Link (or a path like /pricing)" })],
            ["- …", t("platform.blog.editor.help.bullets", { defaultValue: "Bulleted list (indent to nest)" })],
            ["1. …", t("platform.blog.editor.help.numbers", { defaultValue: "Numbered list" })],
            ["> …", t("platform.blog.editor.help.quote", { defaultValue: "Quote" })],
            ["![description](https://…)", t("platform.blog.editor.help.image", { defaultValue: "Image (use the Image button to upload)" })],
            ["---", t("platform.blog.editor.help.rule", { defaultValue: "Dividing line" })],
            ["\\*", t("platform.blog.editor.help.escape", { defaultValue: "A literal * (any mark)" })],
          ].map(([syntax, meaning]) => (
            <div key={syntax} className="flex items-baseline gap-3">
              <dt className="w-44 shrink-0 font-mono text-foreground">{syntax}</dt>
              <dd className="text-muted-foreground">{meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("platform.blog.editor.help.note", {
            defaultValue:
              "A blank line starts a new paragraph. HTML is shown as text, never run. Images must be uploaded here or be on this site.",
          })}
        </p>
      </details>
    </div>
  );
}
