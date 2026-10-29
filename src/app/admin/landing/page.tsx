"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import Link from "next/link";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DeleteConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import {
  CUSTOM_SECTION_ID_PATTERN,
  LANDING_HEADER_META,
  LANDING_SECTION_META,
  MAX_CUSTOM_SECTIONS,
  customSectionIdOf,
  customSectionKey,
  emptyCustomSection,
  isCustomSectionKey,
  type CustomSection,
  type LandingData,
  type LandingEditorKey,
  type LandingOverlay,
  type LandingSlotKey,
} from "@/lib/marketing/landing-types";
import { SectionEditorSheet } from "./section-editor-sheet";
import {
  LanguageTabs,
  languagePanelId,
  languageTabId,
  type ContentLang,
} from "../_components/language-tabs";

type AnyContent = Record<string, unknown>;

/** A fresh id for a custom section: short, lowercase, not already taken. */
function newSectionId(taken: Set<string>): string {
  for (;;) {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    if (CUSTOM_SECTION_ID_PATTERN.test(id) && !taken.has(id)) return id;
  }
}

export default function PlatformLandingPage() {
  const { t } = useLocalizationContext();
  const seoTabsId = useId();
  const [data, setData] = useState<LandingData | null>(null);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<LandingEditorKey | null>(null);
  const [seoLang, setSeoLang] = useState<ContentLang>("en");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/landing");
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load landing content");
      }
      setData(payload.data.landing as LandingData);
      setDirty(false);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("platform.landing.loadError", { defaultValue: "Unable to load landing content" }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = data
    ? [...data.sections].sort((a, b) => a.order - b.order)
    : [];
  const customById = new Map(
    (data?.customSections ?? []).map((section) => [section.id, section]),
  );
  const arabic: LandingOverlay = data?.translations?.ar ?? {};

  function toggleEnabled(key: LandingSlotKey, enabled: boolean) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            sections: prev.sections.map((s) =>
              s.key === key ? { ...s, enabled } : s,
            ),
          }
        : prev,
    );
    setDirty(true);
  }

  function move(key: LandingSlotKey, direction: "up" | "down") {
    const ordered = sections;
    const index = ordered.findIndex((s) => s.key === key);
    const neighbor = ordered[index + (direction === "up" ? -1 : 1)];
    if (!neighbor) return;
    const current = ordered[index];
    setData((prev) =>
      prev
        ? {
            ...prev,
            sections: prev.sections.map((s) => {
              if (s.key === current.key) return { ...s, order: neighbor.order };
              if (s.key === neighbor.key) return { ...s, order: current.order };
              return s;
            }),
          }
        : prev,
    );
    setDirty(true);
  }

  /**
   * A new, empty section, placed just above the footer (or last, with the
   * footer gone) and opened in the editor. It is drawn once it has a heading,
   * some text or an image.
   */
  function addSection() {
    if (!data || data.customSections.length >= MAX_CUSTOM_SECTIONS) return;
    const id = newSectionId(new Set(data.customSections.map((s) => s.id)));
    const key = customSectionKey(id);
    const ordered = [...data.sections].sort((a, b) => a.order - b.order);
    const footerAt = ordered.findIndex((s) => s.key === "footer");
    const at = footerAt === -1 ? ordered.length : footerAt;
    ordered.splice(at, 0, { key, enabled: true, order: 0 });
    setData({
      ...data,
      sections: ordered.map((s, index) => ({ ...s, order: index })),
      customSections: [...data.customSections, emptyCustomSection(id)],
    });
    setDirty(true);
    setEditing(key);
  }

  /** Remove a custom section: its slot, its content and its Arabic. */
  function deleteSection(key: LandingSlotKey) {
    if (!isCustomSectionKey(key)) return;
    const id = customSectionIdOf(key);
    setData((prev) => {
      if (!prev) return prev;
      const custom = { ...(prev.translations.ar?.custom ?? {}) };
      delete custom[id];
      return {
        ...prev,
        sections: prev.sections
          .filter((s) => s.key !== key)
          .sort((a, b) => a.order - b.order)
          .map((s, index) => ({ ...s, order: index })),
        customSections: prev.customSections.filter((s) => s.id !== id),
        translations: {
          ...prev.translations,
          ar: { ...(prev.translations.ar ?? {}), custom },
        },
      };
    });
    setDirty(true);
  }

  function applySection(
    key: LandingEditorKey,
    content: AnyContent,
    overlay: AnyContent,
  ) {
    setData((prev) => {
      if (!prev) return prev;
      const ar = { ...(prev.translations.ar ?? {}) } as Record<string, unknown>;
      if (isCustomSectionKey(key)) {
        const id = customSectionIdOf(key);
        return {
          ...prev,
          customSections: prev.customSections.map((section) =>
            section.id === id ? { ...(content as unknown as CustomSection), id } : section,
          ),
          translations: {
            ...prev.translations,
            ar: {
              ...ar,
              custom: { ...(prev.translations.ar?.custom ?? {}), [id]: overlay },
            } as LandingOverlay,
          },
        };
      }
      return {
        ...prev,
        [key]: content,
        translations: {
          ...prev.translations,
          ar: { ...ar, [key]: overlay } as LandingOverlay,
        },
      };
    });
    setDirty(true);
  }

  function setSeo(field: "title" | "description", value: string) {
    setData((prev) =>
      prev ? { ...prev, seo: { ...prev.seo, [field]: value } } : prev,
    );
    setDirty(true);
  }

  function setArabicSeo(field: "title" | "description", value: string) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            translations: {
              ...prev.translations,
              ar: {
                ...(prev.translations.ar ?? {}),
                seo: { ...(prev.translations.ar?.seo ?? {}), [field]: value },
              },
            },
          }
        : prev,
    );
    setDirty(true);
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/landing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to save");
      }
      setData(result.data.landing as LandingData);
      setDirty(false);
      toast.success(t("platform.landing.saved", { defaultValue: "Landing page updated" }));
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : t("platform.landing.saveFailed", { defaultValue: "Failed to save" }));
    } finally {
      setSaving(false);
    }
  }

  // What the editor opens: a built-in block (or the header) and its Arabic,
  // or a custom section and its Arabic by id.
  const editingCustom =
    editing && isCustomSectionKey(editing)
      ? customById.get(customSectionIdOf(editing)) ?? null
      : null;
  const editorValue: AnyContent | null =
    !editing || !data
      ? null
      : isCustomSectionKey(editing)
        ? (editingCustom as unknown as AnyContent | null)
        : (data[editing] as unknown as AnyContent);
  const editorArabic: AnyContent | null =
    !editing || !data
      ? null
      : isCustomSectionKey(editing)
        ? ((arabic.custom?.[customSectionIdOf(editing)] as AnyContent | undefined) ?? null)
        : ((arabic[editing] as AnyContent | undefined) ?? null);

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("platform.landing.title", { defaultValue: "Landing page" })}</h1>
          <p className="text-muted-foreground">
            {t("platform.landing.subtitle", { defaultValue: "Reorder, show/hide, and edit the content of the public homepage." })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/" target="_blank">
              <ExternalLink className="me-1.5 h-4 w-4" /> {t("platform.landing.preview", { defaultValue: "Preview" })}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/ar" target="_blank" hrefLang="ar">
              <ExternalLink className="me-1.5 h-4 w-4" /> {t("platform.landing.previewArabic", { defaultValue: "Arabic page" })}
            </Link>
          </Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {dirty ? t("platform.landing.saveChanges", { defaultValue: "Save changes" }) : t("platform.landing.allSaved", { defaultValue: "All changes saved" })}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {data && (
        <>
          {/* The header is landing content but not a body section: it renders on
              every public route, so it gets a card of its own rather than a row
              in a list whose whole purpose is reordering and hiding. */}
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{LANDING_HEADER_META.label}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {LANDING_HEADER_META.description}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing("header")}>
                <Pencil className="me-1.5 h-3.5 w-3.5" /> {t("platform.common.edit", { defaultValue: "Edit" })}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="divide-y p-0">
              {sections.map((section, index) => {
                const custom = isCustomSectionKey(section.key)
                  ? customById.get(customSectionIdOf(section.key))
                  : undefined;
                const label = isCustomSectionKey(section.key)
                  ? custom?.heading.trim() ||
                    t("platform.landing.customSectionUntitled", { defaultValue: "Untitled section" })
                  : LANDING_SECTION_META[section.key].label;
                const description = isCustomSectionKey(section.key)
                  ? t("platform.landing.customSectionDescription", { defaultValue: "Your own heading, text, image and button" })
                  : LANDING_SECTION_META[section.key].description;
                return (
                  <div key={section.key} className="flex items-center gap-3 p-4">
                    <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${section.enabled ? "bg-emerald-500" : "bg-gray-300"}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium">
                        <span className="truncate">{label}</span>
                        {custom && (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                            {t("platform.landing.customSection", { defaultValue: "Custom section" })}
                          </span>
                        )}
                        {!section.enabled && (
                          <span className="text-xs font-normal text-muted-foreground">
                            (hidden)
                          </span>
                        )}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {description}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setEditing(section.key)}>
                      <Pencil className="me-1.5 h-3.5 w-3.5" /> {t("platform.common.edit", { defaultValue: "Edit" })}
                    </Button>
                    {custom && (
                      <DeleteConfirmationDialog
                        itemName={label}
                        description={t("platform.landing.deleteSectionDescription", {
                          defaultValue: "It is removed from the homepage, with its Arabic text, when you save.",
                        })}
                        onConfirm={() => deleteSection(section.key)}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("platform.landing.deleteSection", { defaultValue: "Delete section" })}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </DeleteConfirmationDialog>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleEnabled(section.key, !section.enabled)}
                      aria-label={section.enabled ? t("platform.landing.hideSection", { defaultValue: "Hide section" }) : t("platform.landing.showSection", { defaultValue: "Show section" })}
                    >
                      {section.enabled ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => move(section.key, "up")}
                      aria-label={t("platform.common.moveUp", { defaultValue: "Move up" })}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={index === sections.length - 1}
                      onClick={() => move(section.key, "down")}
                      aria-label={t("platform.common.moveDown", { defaultValue: "Move down" })}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm text-muted-foreground">
                  {t("platform.landing.maxCustomSections", {
                    defaultValue: "You can add up to {count} sections.",
                    values: { count: MAX_CUSTOM_SECTIONS },
                  })}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addSection}
                  disabled={data.customSections.length >= MAX_CUSTOM_SECTIONS}
                >
                  <Plus className="me-1.5 h-3.5 w-3.5" /> {t("platform.landing.addSection", { defaultValue: "Add section" })}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{t("platform.landing.seoTitle", { defaultValue: "SEO &amp; metadata" })}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t("platform.landing.seoSubtitle", { defaultValue: "Page title and description used by search engines and social previews." })}
                  </p>
                </div>
                <LanguageTabs
                  value={seoLang}
                  onChange={setSeoLang}
                  idBase={seoTabsId}
                  label={t("platform.sectionEditor.contentLanguage", { defaultValue: "Content language" })}
                />
              </div>
              <div
                role="tabpanel"
                id={languagePanelId(seoTabsId)}
                aria-labelledby={languageTabId(seoTabsId, seoLang)}
                className="space-y-4"
              >
                {seoLang === "ar" && (
                  <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    {t("platform.landing.seoArabicHint", {
                      defaultValue:
                        "Used by /ar. Leave a field empty to use the built-in Arabic, or the English if the English has been changed.",
                    })}
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs font-normal text-muted-foreground">{t("platform.landing.pageTitle", { defaultValue: "Page title" })}</Label>
                  {seoLang === "en" ? (
                    <Input
                      dir="ltr"
                      lang="en"
                      value={data.seo.title}
                      onChange={(e) => setSeo("title", e.target.value)}
                      placeholder={t("platform.landing.pageTitlePlaceholder", { defaultValue: "All-in-one Property Management Software" })}
                    />
                  ) : (
                    <Input
                      dir="rtl"
                      lang="ar"
                      value={arabic.seo?.title ?? ""}
                      onChange={(e) => setArabicSeo("title", e.target.value)}
                      placeholder={data.seo.title}
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-normal text-muted-foreground">
                    {t("platform.landing.metaDescription", { defaultValue: "Meta description" })}
                  </Label>
                  {seoLang === "en" ? (
                    <Textarea
                      dir="ltr"
                      lang="en"
                      value={data.seo.description}
                      onChange={(e) => setSeo("description", e.target.value)}
                      rows={2}
                    />
                  ) : (
                    <Textarea
                      dir="rtl"
                      lang="ar"
                      value={arabic.seo?.description ?? ""}
                      onChange={(e) => setArabicSeo("description", e.target.value)}
                      placeholder={data.seo.description}
                      rows={2}
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <SectionEditorSheet
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        sectionKey={editing}
        value={editorValue}
        arabic={editorArabic}
        onApply={applySection}
      />
    </ResponsiveLayout>
  );
}
