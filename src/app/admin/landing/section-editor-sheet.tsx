"use client";

import { createContext, useContext, useId, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUpload } from "@/components/ui/image-upload";
import {
  CTA_CARD_ICON_KEYS,
  CUSTOM_SECTION_BACKGROUNDS,
  CUSTOM_SECTION_IMAGE_POSITIONS,
  LANDING_HEADER_META,
  LANDING_SECTION_META,
  isCustomSectionKey,
  type CtaCard,
  type CtaCardIconKey,
  type CtaLink,
  type FooterColumn,
  type FooterLink,
  type HowItWorksStep,
  type TestimonialSlide,
  type LandingEditorKey,
} from "@/lib/marketing/landing-types";
import {
  arabicView,
  overlayFromView,
  pruneOverlay,
} from "@/lib/marketing/landing-i18n";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  LanguageTabs,
  languagePanelId,
  languageTabId,
  type ContentLang,
} from "../_components/language-tabs";

/** Platform admins have no organization context, so landing imagery goes to the
 * console's own upload route rather than the org-scoped default. */
const LANDING_UPLOAD_ENDPOINT = "/api/admin/landing/upload";

type AnyContent = Record<string, unknown>;

/** Where a list sits in a block: ["slides"], ["columns", 1, "links"]. */
type ListPath = (string | number)[];
type ListOp =
  | { kind: "remove"; index: number }
  | { kind: "move"; from: number; to: number };

interface SectionEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionKey: LandingEditorKey | null;
  /** Current English content for the section being edited (a block, or a
   * custom section). */
  value: AnyContent | null;
  /** Its Arabic overlay, as the page holds it (text only). */
  arabic: AnyContent | null;
  /** Apply the edited content back to the parent draft (persisted on page
   * Save): the English block and its Arabic overlay, pruned to text that
   * exists in the English. */
  onApply: (key: LandingEditorKey, english: AnyContent, arabic: AnyContent) => void;
}

/**
 * Whether the fields below are editing the Arabic overlay. In Arabic a text
 * input is right to left and shows its English as the placeholder; images,
 * links, icons, ratings and anything that adds, removes or reorders items are
 * not shown — they are shared with the English page and edited there.
 */
const ArabicMode = createContext(false);

function useArabicMode(): boolean {
  return useContext(ArabicMode);
}

/** The direction and language of a text input: the tab's, not the console's
 * (an Arabic console still edits English copy left to right). */
function languageInput(ar: boolean) {
  return ar ? ({ dir: "rtl", lang: "ar" } as const) : ({ dir: "ltr", lang: "en" } as const);
}

// ---------------------------------------------------------------------------
// Small reusable fields
// ---------------------------------------------------------------------------

/** A text input that knows the editing language: in Arabic its placeholder is
 * the English it translates. */
function TextInput({
  value,
  onChange,
  placeholder,
  english,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  english?: string;
  className?: string;
}) {
  const ar = useArabicMode();
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={ar ? english : placeholder}
      className={className}
      {...languageInput(ar)}
    />
  );
}

/** The textarea counterpart of `TextInput`. */
function TextArea({
  value,
  onChange,
  placeholder,
  english,
  rows,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  english?: string;
  rows?: number;
}) {
  const ar = useArabicMode();
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={ar ? english : placeholder}
      rows={rows}
      {...languageInput(ar)}
    />
  );
}

function TextField({
  label,
  value,
  onChange,
  textarea = false,
  placeholder,
  english,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  placeholder?: string;
  /** The English text, shown as the placeholder in Arabic. */
  english?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {textarea ? (
        <TextArea
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          english={english}
          rows={3}
        />
      ) : (
        <TextInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          english={english}
        />
      )}
    </div>
  );
}

function LinkField({
  label,
  value,
  onChange,
  english,
}: {
  label: string;
  value: CtaLink;
  onChange: (value: CtaLink) => void;
  english?: CtaLink;
}) {
  const { t } = useLocalizationContext();
  const ar = useArabicMode();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {ar ? (
        // The link is shared with the English page; only its words differ.
        <TextInput
          value={value.label}
          onChange={(text) => onChange({ ...value, label: text })}
          english={english?.label}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={value.label}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
            placeholder={t("platform.sectionEditor.placeholder.label", { defaultValue: "Label" })}
          />
          <Input
            value={value.href}
            onChange={(e) => onChange({ ...value, href: e.target.value })}
            placeholder="/auth/signup"
          />
        </div>
      )}
    </div>
  );
}

/**
 * One image slot, backed by the shared `<ImageUpload>` — the same drag & drop,
 * validation, progress and preview the tenant dashboard uses, pointed at the
 * platform-admin upload route. The plain URL box beside it stays: some slots
 * ship with a bundled `/images/...` asset, and an admin needs to be able to
 * restore one without re-uploading it.
 *
 * `<ImageUpload>` seeds its gallery from `existingImages` on mount only, so the
 * key ties its identity to the current value — an upload, a clear or a typed
 * URL all remount it against the value the field actually holds.
 *
 * Images are shared by both languages, so the Arabic tab does not show them.
 */
function ImageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const ar = useArabicMode();
  if (ar) return null;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      <ImageUpload
        key={value}
        compact
        maxFiles={1}
        endpoint={LANDING_UPLOAD_ENDPOINT}
        folder="PropertyPro/landing"
        existingImages={value ? [{ url: value, publicId: value }] : []}
        onImagesUploaded={(images) => {
          const url = images[0]?.url;
          if (url) onChange(url);
        }}
        onImagesRemoved={() => onChange("")}
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/images/... or https://..."
        className="text-xs"
      />
    </div>
  );
}

/**
 * Copy that may carry `**bold**` runs — the marketing headlines mix weights
 * mid-sentence and the renderer honours exactly that one marker plus line
 * breaks. Nothing here is parsed as HTML.
 */
function RichTextField({
  label,
  value,
  onChange,
  rows = 3,
  hint = "Wrap words in **double asterisks** to set them bold. Enter starts a new line.",
  english,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
  english?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      <TextArea value={value} onChange={onChange} english={english} rows={rows} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** An editable list of label/href pairs (nav links, footer links). */
function LinkListField({
  label,
  values,
  onChange,
  max,
  english,
  onRemove,
}: {
  label: string;
  values: CtaLink[];
  onChange: (values: CtaLink[]) => void;
  max: number;
  english?: CtaLink[];
  /** Told which item went, so the Arabic list can drop the same one. */
  onRemove?: (index: number) => void;
}) {
  const { t } = useLocalizationContext();
  const ar = useArabicMode();
  const patch = (index: number, next: CtaLink) =>
    onChange(values.map((link, i) => (i === index ? next : link)));

  return (
    <div className="space-y-2">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {values.map((link, index) => (
        <div key={index} className="flex items-center gap-2">
          <TextInput
            value={link.label}
            onChange={(text) => patch(index, { ...link, label: text })}
            placeholder={t("platform.sectionEditor.placeholder.label", { defaultValue: "Label" })}
            english={english?.[index]?.label}
            className="flex-1"
          />
          {!ar && (
            <>
              <Input
                value={link.href}
                onChange={(e) => patch(index, { ...link, href: e.target.value })}
                placeholder="/pricing"
                className="max-w-[160px]"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onRemove?.(index);
                  onChange(values.filter((_, i) => i !== index));
                }}
                aria-label={t("platform.sectionEditor.removeLink", { defaultValue: "Remove link" })}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      ))}
      {!ar && values.length < max && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...values, { label: "", href: "/" }])}
        >
          <Plus className="me-1.5 h-3.5 w-3.5" /> {t("platform.sectionEditor.addLink", { defaultValue: "Add link" })}
        </Button>
      )}
    </div>
  );
}

function StringListField({
  label,
  values,
  onChange,
  placeholder,
  english,
  onRemove,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  english?: string[];
  onRemove?: (index: number) => void;
}) {
  const { t } = useLocalizationContext();
  const ar = useArabicMode();
  return (
    <div className="space-y-2">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {values.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <TextInput
            value={entry}
            onChange={(text) => {
              const next = [...values];
              next[index] = text;
              onChange(next);
            }}
            placeholder={placeholder}
            english={english?.[index]}
            className="flex-1"
          />
          {!ar && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                onRemove?.(index);
                onChange(values.filter((_, i) => i !== index));
              }}
              aria-label={t("platform.sectionEditor.remove", { defaultValue: "Remove" })}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {!ar && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...values, ""])}>
          <Plus className="me-1.5 h-3.5 w-3.5" /> {t("platform.sectionEditor.add", { defaultValue: "Add" })}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-section field groups
// ---------------------------------------------------------------------------

function SectionFields({
  sectionKey,
  draft,
  english,
  set,
  listOp,
}: {
  sectionKey: LandingEditorKey;
  /** What the inputs show: the English block, or in Arabic its overlay laid
   * over the English structure (`arabicView`). */
  draft: AnyContent;
  /** The English block, for the Arabic tab's placeholders. */
  english: AnyContent;
  set: (key: string, value: unknown) => void;
  /** Mirror a removal or a move in a list onto its Arabic counterpart. */
  listOp: (path: ListPath, op: ListOp) => void;
}) {
  const { t } = useLocalizationContext();
  const ar = useArabicMode();
  const str = (key: string) => (draft[key] as string) ?? "";
  const en = (key: string) => (english[key] as string) ?? "";

  if (isCustomSectionKey(sectionKey)) {
    return (
      <>
        <TextField
          label={t("platform.sectionEditor.heading", { defaultValue: "Heading" })}
          value={str("heading")}
          english={en("heading")}
          onChange={(v) => set("heading", v)}
        />
        <RichTextField
          label={t("platform.sectionEditor.body", { defaultValue: "Body" })}
          value={str("body")}
          english={en("body")}
          onChange={(v) => set("body", v)}
          rows={6}
          hint={t("platform.sectionEditor.bodyHint", {
            defaultValue:
              "Leave a blank line between paragraphs. Wrap words in **double asterisks** to set them bold.",
          })}
        />
        {!ar && (
          <div className="space-y-1.5">
            <Label className="text-xs font-normal text-muted-foreground">
              {t("platform.sectionEditor.imagePosition", { defaultValue: "Image position" })}
            </Label>
            <Select value={str("imagePosition") || "end"} onValueChange={(v) => set("imagePosition", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_SECTION_IMAGE_POSITIONS.map((position) => (
                  <SelectItem key={position} value={position}>
                    {t(`platform.sectionEditor.imagePosition.${position}`, { defaultValue: position })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("platform.sectionEditor.imagePositionHint", {
                defaultValue:
                  "Before and after follow the reading direction, so the Arabic page mirrors the layout.",
              })}
            </p>
          </div>
        )}
        {str("imagePosition") !== "none" && (
          <>
            <ImageField
              label={t("platform.sectionEditor.image", { defaultValue: "Image" })}
              value={str("image")}
              onChange={(v) => set("image", v)}
            />
            <TextField
              label={t("platform.sectionEditor.imageAlt", { defaultValue: "Image alt text" })}
              value={str("imageAlt")}
              english={en("imageAlt")}
              onChange={(v) => set("imageAlt", v)}
            />
          </>
        )}
        <LinkField
          label={t("platform.sectionEditor.button", { defaultValue: "Button (leave the label empty to hide it)" })}
          value={{ label: str("ctaLabel"), href: str("ctaHref") }}
          english={{ label: en("ctaLabel"), href: en("ctaHref") }}
          onChange={(v) => {
            set("ctaLabel", v.label);
            if (!ar) set("ctaHref", v.href);
          }}
        />
        {!ar && (
          <div className="space-y-1.5">
            <Label className="text-xs font-normal text-muted-foreground">
              {t("platform.sectionEditor.background", { defaultValue: "Background" })}
            </Label>
            <Select value={str("background") || "white"} onValueChange={(v) => set("background", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_SECTION_BACKGROUNDS.map((background) => (
                  <SelectItem key={background} value={background}>
                    {t(`platform.sectionEditor.background.${background}`, { defaultValue: background })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </>
    );
  }

  switch (sectionKey) {
    case "header":
      return (
        <>
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            The navigation renders on every public page, so it cannot be hidden
            or reordered. The logo and platform name come from{" "}
            <span className="font-medium">{t("platform.sectionEditor.brandingHint", { defaultValue: "Settings → General &amp; branding" })}</span>.
          </p>
          <LinkListField
            label={t("platform.sectionEditor.navLinks", { defaultValue: "Navigation links" })}
            values={(draft.navLinks as CtaLink[]) ?? []}
            english={english.navLinks as CtaLink[]}
            onChange={(v) => set("navLinks", v)}
            onRemove={(index) => listOp(["navLinks"], { kind: "remove", index })}
            max={6}
          />
          <LinkField
            label={t("platform.sectionEditor.signInLink", { defaultValue: "Sign-in link (leave the label empty to hide it)" })}
            value={(draft.signIn as CtaLink) ?? { label: "", href: "" }}
            english={english.signIn as CtaLink}
            onChange={(v) => set("signIn", v)}
          />
          <LinkField
            label={t("platform.sectionEditor.getStartedButton", { defaultValue: "Get-started button (leave the label empty to hide it)" })}
            value={(draft.cta as CtaLink) ?? { label: "", href: "" }}
            english={english.cta as CtaLink}
            onChange={(v) => set("cta", v)}
          />
        </>
      );
    case "hero":
      return (
        <>
          <TextField label={t("platform.sectionEditor.eyebrow", { defaultValue: "Eyebrow" })} value={str("eyebrow")} english={en("eyebrow")} onChange={(v) => set("eyebrow", v)} />
          <TextField label={t("platform.sectionEditor.headingTop", { defaultValue: "Heading — top line" })} value={str("headingTop")} english={en("headingTop")} onChange={(v) => set("headingTop", v)} />
          <TextField label={t("platform.sectionEditor.headingHighlight", { defaultValue: "Heading — highlighted line" })} value={str("headingHighlight")} english={en("headingHighlight")} onChange={(v) => set("headingHighlight", v)} />
          <TextField label={t("platform.sectionEditor.headingBottom", { defaultValue: "Heading — bottom line" })} value={str("headingBottom")} english={en("headingBottom")} onChange={(v) => set("headingBottom", v)} />
          <TextField label={t("platform.sectionEditor.subText", { defaultValue: "Sub-text" })} value={str("subtext")} english={en("subtext")} onChange={(v) => set("subtext", v)} textarea />
          <LinkField label={t("platform.sectionEditor.primaryButton", { defaultValue: "Primary button" })} value={(draft.primaryCta as CtaLink) ?? { label: "", href: "" }} english={english.primaryCta as CtaLink} onChange={(v) => set("primaryCta", v)} />
          <LinkField label={t("platform.sectionEditor.secondaryButton", { defaultValue: "Secondary button" })} value={(draft.secondaryCta as CtaLink) ?? { label: "", href: "" }} english={english.secondaryCta as CtaLink} onChange={(v) => set("secondaryCta", v)} />
          <StringListField
            label={t("platform.sectionEditor.trustBullets", { defaultValue: "Trust bullets" })}
            values={(draft.bullets as string[]) ?? []}
            english={english.bullets as string[]}
            onChange={(v) => set("bullets", v)}
            onRemove={(index) => listOp(["bullets"], { kind: "remove", index })}
            placeholder={t("platform.sectionEditor.trustPlaceholder", { defaultValue: "No credit card required" })}
          />
          <ImageField label={t("platform.sectionEditor.heroImage", { defaultValue: "Hero image" })} value={str("image")} onChange={(v) => set("image", v)} />
          <TextField label={t("platform.sectionEditor.heroImageAlt", { defaultValue: "Hero image alt text" })} value={str("imageAlt")} english={en("imageAlt")} onChange={(v) => set("imageAlt", v)} />
        </>
      );
    case "product": {
      const tabs = (draft.tabs as { label: string; image?: string }[]) ?? [];
      const englishTabs = (english.tabs as { label: string }[]) ?? [];
      const updateTab = (
        index: number,
        patch: Partial<{ label: string; image: string }>,
      ) => {
        const next = tabs.map((tab, i) => (i === index ? { ...tab, ...patch } : tab));
        set("tabs", next);
      };
      return (
        <>
          <TextField label={t("platform.sectionEditor.headingLine1", { defaultValue: "Heading — line 1" })} value={str("headingLine1")} english={en("headingLine1")} onChange={(v) => set("headingLine1", v)} />
          <TextField label={t("platform.sectionEditor.headingLine2", { defaultValue: "Heading — line 2" })} value={str("headingLine2")} english={en("headingLine2")} onChange={(v) => set("headingLine2", v)} />
          <ImageField
            label={t("platform.sectionEditor.panelBackgroundLong", { defaultValue: "Panel background (the gradient plate behind the heading and preview)" })}
            value={str("panelImage")}
            onChange={(v) => set("panelImage", v)}
          />
          <div className="space-y-4">
            <Label className="text-xs font-normal text-muted-foreground">
              Tabs — rename a tab and upload its screenshot (leave the image empty
              to show the built-in mockup)
            </Label>
            {tabs.map((tab, index) => (
              <div key={index} className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground">Tab {index + 1}</p>
                <TextInput
                  value={tab.label}
                  onChange={(label) => updateTab(index, { label })}
                  placeholder={t("platform.sectionEditor.tabNamePlaceholder", { defaultValue: "Tab name" })}
                  english={englishTabs[index]?.label}
                />
                <ImageField
                  label={t("platform.sectionEditor.screenshotOptionalMockup", { defaultValue: "Screenshot (optional — leave empty for built-in mockup)" })}
                  value={tab.image ?? ""}
                  onChange={(v) => updateTab(index, { image: v })}
                />
              </div>
            ))}
          </div>
        </>
      );
    }
    case "features": {
      const cards =
        (draft.cards as { title: string; description: string; image?: string }[]) ?? [];
      const englishCards =
        (english.cards as { title: string; description: string }[]) ?? [];
      const updateCard = (
        index: number,
        patch: Partial<{ title: string; description: string; image: string }>,
      ) => {
        const next = cards.map((card, i) => (i === index ? { ...card, ...patch } : card));
        set("cards", next);
      };
      const moreCard =
        (draft.moreCard as { label: string; href: string; caption: string }) ?? {
          label: "",
          href: "",
          caption: "",
        };
      const englishMoreCard =
        (english.moreCard as { label: string; href: string; caption: string }) ?? undefined;
      const integrations =
        (draft.integrations as { text: string; image: string; imageAlt: string }) ?? {
          text: "",
          image: "",
          imageAlt: "",
        };
      const englishIntegrations =
        (english.integrations as { text: string; imageAlt: string }) ?? undefined;
      return (
        <>
          <TextField label={t("platform.sectionEditor.eyebrow", { defaultValue: "Eyebrow" })} value={str("eyebrow")} english={en("eyebrow")} onChange={(v) => set("eyebrow", v)} />
          <RichTextField
            label={t("platform.sectionEditor.heading", { defaultValue: "Heading" })}
            value={str("heading")}
            english={en("heading")}
            onChange={(v) => set("heading", v)}
            rows={2}
          />
          <div className="space-y-4">
            <Label className="text-xs font-normal text-muted-foreground">
              {t("platform.sectionEditor.featureCards", { defaultValue: "Feature cards — upload an image to replace the built-in artwork" })}
            </Label>
            {cards.map((card, index) => (
              <div key={index} className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground">Card {index + 1}</p>
                <TextInput
                  value={card.title}
                  onChange={(title) => updateCard(index, { title })}
                  placeholder={t("platform.sectionEditor.titlePlaceholder", { defaultValue: "Title" })}
                  english={englishCards[index]?.title}
                />
                <TextArea
                  value={card.description}
                  onChange={(description) => updateCard(index, { description })}
                  placeholder={t("platform.sectionEditor.descriptionPlaceholder", { defaultValue: "Description" })}
                  english={englishCards[index]?.description}
                  rows={2}
                />
                <ImageField
                  label={t("platform.sectionEditor.cardImage", { defaultValue: "Card image (optional — leave empty for built-in artwork)" })}
                  value={card.image ?? ""}
                  onChange={(v) => updateCard(index, { image: v })}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {t("platform.sectionEditor.closingTile", { defaultValue: "Closing tile (the blue &ldquo;See all features&rdquo; link)" })}
            </p>
            <LinkField
              label={t("platform.sectionEditor.tileLink", { defaultValue: "Tile link" })}
              value={{ label: moreCard.label, href: moreCard.href }}
              english={englishMoreCard}
              onChange={(v) => set("moreCard", { ...moreCard, label: v.label, href: v.href })}
            />
            <RichTextField
              label={t("platform.sectionEditor.tileCaption", { defaultValue: "Caption under the tile" })}
              value={moreCard.caption}
              english={englishMoreCard?.caption}
              onChange={(v) => set("moreCard", { ...moreCard, caption: v })}
              rows={2}
            />
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {t("platform.sectionEditor.integrationsStrip", { defaultValue: "Integrations strip" })}
            </p>
            <RichTextField
              label={t("platform.sectionEditor.copy", { defaultValue: "Copy" })}
              value={integrations.text}
              english={englishIntegrations?.text}
              onChange={(v) => set("integrations", { ...integrations, text: v })}
            />
            <ImageField
              label={t("platform.sectionEditor.logoStrip", { defaultValue: "Logo strip image" })}
              value={integrations.image}
              onChange={(v) => set("integrations", { ...integrations, image: v })}
            />
            <TextField
              label={t("platform.sectionEditor.logoStripAlt", { defaultValue: "Logo strip alt text" })}
              value={integrations.imageAlt}
              english={englishIntegrations?.imageAlt}
              onChange={(v) => set("integrations", { ...integrations, imageAlt: v })}
            />
          </div>
        </>
      );
    }
    case "howItWorks": {
      const steps = (draft.steps as HowItWorksStep[]) ?? [];
      const englishSteps = (english.steps as HowItWorksStep[]) ?? [];
      const updateStep = (index: number, patch: Partial<HowItWorksStep>) =>
        set(
          "steps",
          steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
        );
      return (
        <>
          <TextField label={t("platform.sectionEditor.eyebrow", { defaultValue: "Eyebrow" })} value={str("eyebrow")} english={en("eyebrow")} onChange={(v) => set("eyebrow", v)} />
          <TextField label={t("platform.sectionEditor.heading", { defaultValue: "Heading" })} value={str("heading")} english={en("heading")} onChange={(v) => set("heading", v)} />
          <div className="space-y-4">
            <Label className="text-xs font-normal text-muted-foreground">
              {t("platform.sectionEditor.threeSteps", { defaultValue: "The three steps, in the order they play as the visitor scrolls" })}
            </Label>
            {steps.map((step, index) => (
              <div key={index} className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground">Step {index + 1}</p>
                <TextInput
                  value={step.title}
                  onChange={(title) => updateStep(index, { title })}
                  placeholder={t("platform.announcements.field.title", { defaultValue: "Title" })}
                  english={englishSteps[index]?.title}
                />
                <TextArea
                  value={step.description}
                  onChange={(description) => updateStep(index, { description })}
                  placeholder={t("platform.planForm.description", { defaultValue: "Description" })}
                  english={englishSteps[index]?.description}
                  rows={3}
                />
                <ImageField
                  label={t("platform.sectionEditor.screenshotOptionalBuiltIn", { defaultValue: "Screenshot (optional — leave empty for the built-in mockup)" })}
                  value={step.image ?? ""}
                  onChange={(v) => updateStep(index, { image: v })}
                />
              </div>
            ))}
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {t("platform.sectionEditor.closingPanel", { defaultValue: "Closing panel (shown once all three steps have played)" })}
            </p>
            <RichTextField
              label={t("platform.sectionEditor.heading", { defaultValue: "Heading" })}
              value={str("finalHeading")}
              english={en("finalHeading")}
              onChange={(v) => set("finalHeading", v)}
              rows={2}
            />
            <RichTextField
              label={t("platform.sectionEditor.body", { defaultValue: "Body" })}
              value={str("finalBody")}
              english={en("finalBody")}
              onChange={(v) => set("finalBody", v)}
              rows={4}
            />
          </div>
        </>
      );
    }
    case "testimonial": {
      const slides = (draft.slides as TestimonialSlide[]) ?? [];
      const englishSlides = (english.slides as TestimonialSlide[]) ?? [];
      const writeSlides = (next: TestimonialSlide[]) => set("slides", next);
      const updateSlide = (index: number, patch: Partial<TestimonialSlide>) =>
        writeSlides(
          slides.map((slide, i) => (i === index ? { ...slide, ...patch } : slide)),
        );
      const moveSlide = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= slides.length) return;
        const next = [...slides];
        [next[index], next[target]] = [next[target], next[index]];
        listOp(["slides"], { kind: "move", from: index, to: target });
        writeSlides(next);
      };
      const autoplay = (draft.autoplaySeconds as number) ?? 0;

      return (
        <>
          <TextField label={t("platform.sectionEditor.quoteBefore", { defaultValue: "Quote — before highlight" })} value={str("quoteBefore")} english={en("quoteBefore")} onChange={(v) => set("quoteBefore", v)} textarea />
          <TextField label={t("platform.sectionEditor.quoteHighlight", { defaultValue: "Quote — highlighted phrase" })} value={str("quoteHighlight")} english={en("quoteHighlight")} onChange={(v) => set("quoteHighlight", v)} />
          <TextField label={t("platform.sectionEditor.quoteAfter", { defaultValue: "Quote — after highlight" })} value={str("quoteAfter")} english={en("quoteAfter")} onChange={(v) => set("quoteAfter", v)} />

          {!ar && (
            <div className="space-y-1.5">
              <Label className="text-xs font-normal text-muted-foreground">
                {t("platform.sectionEditor.autoplay", { defaultValue: "Autoplay — seconds between slides" })}
              </Label>
              <Input
                type="number"
                min={0}
                max={60}
                value={autoplay}
                onChange={(e) => set("autoplaySeconds", Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                0 turns autoplay off. Visitors who use the arrows or dots stop it for
                their session, and it never runs for anyone who has asked their system
                to reduce motion.
              </p>
            </div>
          )}

          <div className="space-y-4">
            <Label className="text-xs font-normal text-muted-foreground">
              {t("platform.sectionEditor.reviewsHint", { defaultValue: "Reviews — the arrows and dots only appear from two slides up" })}
            </Label>
            {slides.map((slide, index) => (
              <div key={index} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-xs font-semibold text-muted-foreground">
                    Review {index + 1}
                  </p>
                  {!ar && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={index === 0}
                        onClick={() => moveSlide(index, -1)}
                        aria-label={t("platform.sectionEditor.moveReviewUp", { defaultValue: "Move review up" })}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={index === slides.length - 1}
                        onClick={() => moveSlide(index, 1)}
                        aria-label={t("platform.sectionEditor.moveReviewDown", { defaultValue: "Move review down" })}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={slides.length < 2}
                        onClick={() => {
                          listOp(["slides"], { kind: "remove", index });
                          writeSlides(slides.filter((_, i) => i !== index));
                        }}
                        aria-label={t("platform.sectionEditor.removeReview", { defaultValue: "Remove review" })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
                <ImageField
                  label={t("platform.sectionEditor.backgroundPhoto", { defaultValue: "Background photo" })}
                  value={slide.image}
                  onChange={(v) => updateSlide(index, { image: v })}
                />
                <TextInput
                  value={slide.imageAlt}
                  onChange={(imageAlt) => updateSlide(index, { imageAlt })}
                  placeholder={t("platform.sectionEditor.photoAltPlaceholder", { defaultValue: "Photo alt text" })}
                  english={englishSlides[index]?.imageAlt}
                />
                <TextArea
                  value={slide.cardQuote}
                  onChange={(cardQuote) => updateSlide(index, { cardQuote })}
                  placeholder={t("platform.sectionEditor.quotePlaceholder", { defaultValue: "Quote" })}
                  english={englishSlides[index]?.cardQuote}
                  rows={3}
                />
                <div className="flex items-center gap-2">
                  <TextInput
                    value={slide.authorName}
                    onChange={(authorName) => updateSlide(index, { authorName })}
                    placeholder={t("platform.sectionEditor.authorNamePlaceholder", { defaultValue: "Author name" })}
                    english={englishSlides[index]?.authorName}
                  />
                  <TextInput
                    value={slide.authorTitle}
                    onChange={(authorTitle) => updateSlide(index, { authorTitle })}
                    placeholder={t("platform.sectionEditor.authorTitlePlaceholder", { defaultValue: "Author title" })}
                    english={englishSlides[index]?.authorTitle}
                  />
                  {!ar && (
                    <Select
                      value={String(slide.rating)}
                      onValueChange={(value) => updateSlide(index, { rating: Number(value) })}
                    >
                      <SelectTrigger className="max-w-[110px]">
                        <SelectValue placeholder={t("platform.sectionEditor.starsPlaceholder", { defaultValue: "Stars" })} />
                      </SelectTrigger>
                      <SelectContent>
                        {[5, 4, 3, 2, 1, 0].map((rating) => (
                          <SelectItem key={rating} value={String(rating)}>
                            {rating} ★
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ))}
            {!ar && slides.length < 12 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  writeSlides([
                    ...slides,
                    {
                      image: "",
                      imageAlt: "",
                      cardQuote: "",
                      authorName: "",
                      authorTitle: "",
                      rating: 5,
                    },
                  ])
                }
              >
                <Plus className="me-1.5 h-3.5 w-3.5" /> {t("platform.sectionEditor.addReview", { defaultValue: "Add review" })}
              </Button>
            )}
          </div>
        </>
      );
    }
    case "pricing":
      return (
        <>
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {t("platform.sectionEditor.planCardsHint", { defaultValue: "The plan cards themselves are managed under" })} <span className="font-medium">{t("platform.sectionEditor.plans", { defaultValue: "Plans" })}</span>.
            This only edits the heading above them.
          </p>
          <TextField label={t("platform.sectionEditor.eyebrow", { defaultValue: "Eyebrow" })} value={str("eyebrow")} english={en("eyebrow")} onChange={(v) => set("eyebrow", v)} />
          <TextField label={t("platform.sectionEditor.headingLine1", { defaultValue: "Heading — line 1" })} value={str("headingLine1")} english={en("headingLine1")} onChange={(v) => set("headingLine1", v)} />
          <TextField label={t("platform.sectionEditor.headingLine2", { defaultValue: "Heading — line 2" })} value={str("headingLine2")} english={en("headingLine2")} onChange={(v) => set("headingLine2", v)} />
          <TextField label={t("platform.sectionEditor.subText", { defaultValue: "Sub-text" })} value={str("subtext")} english={en("subtext")} onChange={(v) => set("subtext", v)} textarea />
        </>
      );
    case "cta": {
      const cards = (draft.cards as CtaCard[]) ?? [];
      const englishCards = (english.cards as CtaCard[]) ?? [];
      const updateCard = (index: number, patch: Partial<CtaCard>) =>
        set(
          "cards",
          cards.map((card, i) => (i === index ? { ...card, ...patch } : card)),
        );
      return (
        <>
          <TextField label={t("platform.sectionEditor.heading", { defaultValue: "Heading" })} value={str("heading")} english={en("heading")} onChange={(v) => set("heading", v)} />
          <TextField label={t("platform.sectionEditor.subHeading", { defaultValue: "Sub-heading" })} value={str("subheading")} english={en("subheading")} onChange={(v) => set("subheading", v)} />
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs font-semibold text-muted-foreground">{t("platform.sectionEditor.panel", { defaultValue: "Panel" })}</p>
            <TextField label={t("platform.sectionEditor.cardEyebrow", { defaultValue: "Card eyebrow" })} value={str("cardEyebrow")} english={en("cardEyebrow")} onChange={(v) => set("cardEyebrow", v)} />
            <TextField label={t("platform.sectionEditor.cardTitle", { defaultValue: "Card title" })} value={str("cardTitle")} english={en("cardTitle")} onChange={(v) => set("cardTitle", v)} />
            <LinkField
              label={t("platform.sectionEditor.underlinedPrice", { defaultValue: "Underlined price line" })}
              value={(draft.priceLink as CtaLink) ?? { label: "", href: "" }}
              english={english.priceLink as CtaLink}
              onChange={(v) => set("priceLink", v)}
            />
            <LinkField label={t("platform.sectionEditor.cardButton", { defaultValue: "Card button" })} value={(draft.cardCta as CtaLink) ?? { label: "", href: "" }} english={english.cardCta as CtaLink} onChange={(v) => set("cardCta", v)} />
            <ImageField
              label={t("platform.sectionEditor.panelBackground", { defaultValue: "Panel background" })}
              value={str("panelImage")}
              onChange={(v) => set("panelImage", v)}
            />
            <ImageField
              label={t("platform.sectionEditor.dashboardScreenshot", { defaultValue: "Dashboard screenshot" })}
              value={str("dashboardImage")}
              onChange={(v) => set("dashboardImage", v)}
            />
            <TextField
              label={t("platform.sectionEditor.dashboardScreenshotAlt", { defaultValue: "Dashboard screenshot alt text" })}
              value={str("dashboardImageAlt")}
              english={en("dashboardImageAlt")}
              onChange={(v) => set("dashboardImageAlt", v)}
            />
          </div>
          <TextField
            label={t("platform.sectionEditor.learnMorePill", { defaultValue: "“Learn more” pill label (shared by all four tiles)" })}
            value={str("learnMoreLabel")}
            english={en("learnMoreLabel")}
            onChange={(v) => set("learnMoreLabel", v)}
          />
          <div className="space-y-4">
            <Label className="text-xs font-normal text-muted-foreground">
              {t("platform.sectionEditor.fourTiles", { defaultValue: "The four tiles beside the panel" })}
            </Label>
            {cards.map((card, index) => (
              <div key={index} className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground">Tile {index + 1}</p>
                <TextInput
                  value={card.title}
                  onChange={(title) => updateCard(index, { title })}
                  placeholder={t("platform.announcements.field.title", { defaultValue: "Title" })}
                  english={englishCards[index]?.title}
                />
                {!ar && (
                  <div className="flex items-center gap-2">
                    <Select
                      value={card.icon}
                      onValueChange={(value) =>
                        updateCard(index, { icon: value as CtaCardIconKey })
                      }
                    >
                      <SelectTrigger className="max-w-[160px]">
                        <SelectValue placeholder={t("platform.sectionEditor.iconPlaceholder", { defaultValue: "Icon" })} />
                      </SelectTrigger>
                      <SelectContent>
                        {CTA_CARD_ICON_KEYS.map((key) => (
                          <SelectItem key={key} value={key}>
                            {key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={card.href}
                      onChange={(e) => updateCard(index, { href: e.target.value })}
                      placeholder="/auth/signup"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      );
    }
    case "footer": {
      const columns = (draft.columns as FooterColumn[]) ?? [];
      const englishColumns = (english.columns as FooterColumn[]) ?? [];
      const patchColumn = (colIndex: number, patch: Partial<FooterColumn>) => {
        const next = columns.map((col, i) => (i === colIndex ? { ...col, ...patch } : col));
        set("columns", next);
      };
      const setColumn = (colIndex: number, links: FooterLink[]) =>
        patchColumn(colIndex, { links });
      return (
        <>
          <TextField
            label={t("platform.sectionEditor.tagline", { defaultValue: "Tagline (under the brand)" })}
            value={str("tagline")}
            english={en("tagline")}
            onChange={(v) => set("tagline", v)}
            textarea
          />
          <LinkField
            label={t("platform.sectionEditor.footerButton", { defaultValue: "Footer button" })}
            value={{ label: str("ctaLabel"), href: str("ctaHref") }}
            english={{ label: en("ctaLabel"), href: en("ctaHref") }}
            onChange={(v) => {
              set("ctaLabel", v.label);
              if (!ar) set("ctaHref", v.href);
            }}
          />
          {columns.map(({ title, links }, colIndex) => (
            <div key={colIndex} className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-semibold text-muted-foreground">Link column {colIndex + 1}</p>
              <TextInput
                value={title}
                onChange={(text) => patchColumn(colIndex, { title: text })}
                placeholder={t("platform.sectionEditor.columnHeadingPlaceholder", { defaultValue: "Column heading" })}
                english={englishColumns[colIndex]?.title}
              />
              {links.map((link, linkIndex) => (
                <div key={linkIndex} className="flex items-center gap-2">
                  <TextInput
                    value={link.label}
                    onChange={(text) => {
                      const next = [...links];
                      next[linkIndex] = { ...link, label: text };
                      setColumn(colIndex, next);
                    }}
                    placeholder={t("platform.sectionEditor.placeholder.label", { defaultValue: "Label" })}
                    english={englishColumns[colIndex]?.links?.[linkIndex]?.label}
                  />
                  {!ar && (
                    <>
                      <Input
                        value={link.href}
                        onChange={(e) => {
                          const next = [...links];
                          next[linkIndex] = { ...link, href: e.target.value };
                          setColumn(colIndex, next);
                        }}
                        placeholder="#"
                        className="max-w-[120px]"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          listOp(["columns", colIndex, "links"], {
                            kind: "remove",
                            index: linkIndex,
                          });
                          setColumn(colIndex, links.filter((_, i) => i !== linkIndex));
                        }}
                        aria-label={t("platform.sectionEditor.removeLink", { defaultValue: "Remove link" })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
              {!ar && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setColumn(colIndex, [...links, { label: "", href: "#" }])}
                >
                  <Plus className="me-1.5 h-3.5 w-3.5" /> {t("platform.sectionEditor.addLink", { defaultValue: "Add link" })}
                </Button>
              )}
            </div>
          ))}
          <TextField label={t("platform.sectionEditor.copyright", { defaultValue: "Copyright line" })} value={str("copyright")} english={en("copyright")} onChange={(v) => set("copyright", v)} />
        </>
      );
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

/**
 * `overlay` with the same removal or move applied to the list at `path`, so an
 * English review deleted or moved up takes its Arabic with it — overlay lists
 * line up with the English ones by position.
 */
function applyListOp(overlay: AnyContent, path: ListPath, op: ListOp): AnyContent {
  const root = structuredClone(overlay) as AnyContent;
  let parent: unknown = root;
  for (const step of path.slice(0, -1)) {
    parent = (parent as Record<string | number, unknown> | undefined)?.[step];
    if (!parent || typeof parent !== "object") return overlay;
  }
  const last = path[path.length - 1];
  const holder = parent as Record<string | number, unknown>;
  const list = holder[last];
  if (!Array.isArray(list)) return overlay;
  const next = [...list];
  if (op.kind === "remove") {
    next.splice(op.index, 1);
  } else {
    const [moved] = next.splice(op.from, 1);
    next.splice(op.to, 0, moved);
  }
  holder[last] = next;
  return root;
}

/**
 * The open editor. Mounted each time the sheet opens (and per section, by its
 * key), so its working copies start from what the page holds now without an
 * effect copying props into state.
 */
function EditorBody({
  sectionKey,
  label,
  description,
  value,
  arabic,
  onApply,
  onCancel,
}: {
  sectionKey: LandingEditorKey;
  label: string;
  description: string;
  value: AnyContent;
  arabic: AnyContent | null;
  onApply: SectionEditorSheetProps["onApply"];
  onCancel: () => void;
}) {
  const { t } = useLocalizationContext();
  const tabsId = useId();
  const [lang, setLang] = useState<ContentLang>("en");
  const [draft, setDraft] = useState<AnyContent>(
    () => structuredClone(value) as AnyContent,
  );
  // The Arabic working copy, laid out like the English block so every input
  // has a slot; strings stay exactly as typed until Apply prunes them.
  const [arDraft, setArDraft] = useState<AnyContent>(
    () => overlayFromView(value, arabicView(value, arabic ?? {})) as AnyContent,
  );
  const ar = lang === "ar";

  const set = (key: string, val: unknown) => {
    if (ar) {
      setArDraft((prev) => ({ ...prev, [key]: overlayFromView(draft[key], val) }));
    } else {
      setDraft((prev) => ({ ...prev, [key]: val }));
    }
  };
  const listOp = (path: ListPath, op: ListOp) =>
    setArDraft((prev) => applyListOp(prev, path, op));

  return (
    <>
      <SheetHeader>
        <SheetTitle>Edit {label}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>

      <div className="space-y-4 px-4 py-2">
        <LanguageTabs
          value={lang}
          onChange={setLang}
          idBase={tabsId}
          label={t("platform.sectionEditor.contentLanguage", { defaultValue: "Content language" })}
        />
        <div
          role="tabpanel"
          id={languagePanelId(tabsId)}
          aria-labelledby={languageTabId(tabsId, lang)}
          className="space-y-4"
        >
          {ar && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t("platform.sectionEditor.arabicNote", {
                defaultValue:
                  "Arabic text for /ar. Each field shows its English as a placeholder; leave one empty to use the built-in translation, or the English if there is none. Images and links are shared with the English page and are edited on the English tab.",
              })}
            </p>
          )}
          <ArabicMode.Provider value={ar}>
            <SectionFields
              sectionKey={sectionKey}
              draft={ar ? arabicView(draft, arDraft) : draft}
              english={draft}
              set={set}
              listOp={listOp}
            />
          </ArabicMode.Provider>
        </div>
      </div>

      <SheetFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("platform.common.cancel", { defaultValue: "Cancel" })}
        </Button>
        <Button
          onClick={() =>
            onApply(
              sectionKey,
              draft,
              (pruneOverlay(draft, arDraft) as AnyContent | undefined) ?? {},
            )
          }
        >
          {t("platform.sectionEditor.apply", { defaultValue: "Apply" })}
        </Button>
      </SheetFooter>
    </>
  );
}

export function SectionEditorSheet({
  open,
  onOpenChange,
  sectionKey,
  value,
  arabic,
  onApply,
}: SectionEditorSheetProps) {
  const { t } = useLocalizationContext();
  if (!sectionKey) return null;
  const meta = isCustomSectionKey(sectionKey)
    ? {
        label: t("platform.landing.customSection", { defaultValue: "Custom section" }),
        description: t("platform.landing.customSectionDescription", {
          defaultValue: "Your own heading, text, image and button",
        }),
      }
    : sectionKey === "header"
      ? LANDING_HEADER_META
      : LANDING_SECTION_META[sectionKey];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {value && (
          <EditorBody
            key={sectionKey}
            sectionKey={sectionKey}
            label={meta.label}
            description={meta.description}
            value={value}
            arabic={arabic}
            onApply={(key, english, overlay) => {
              onApply(key, english, overlay);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
