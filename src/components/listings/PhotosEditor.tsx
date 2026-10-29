"use client";

/**
 * PropertyPro - A listing's photos
 *
 * With none of its own, a listing shows its unit's photos and then its
 * building's (lib/listings/photos.ts), and this says so — "using the unit's
 * photos" — with a preview of exactly what will be shown, so an office that
 * has photographed the building once has an ad with pictures on its first
 * save. "Customize" copies those into the listing's own list, where photos
 * can be added, removed and put first. A listing for a property not in the
 * system has nothing to fall back on (`fallback={false}`): it has its own
 * photos or none, and is asked for them as such.
 *
 * Uploading goes to the same image route the property forms use. The
 * thumbnails go through the image optimiser, which only loads the hosts
 * next.config.ts lists; an address on any other host is shown as a link
 * instead of breaking the page.
 */

import { useRef, useState } from "react";
import Image from "@/components/ui/app-image";
import { ImagePlus, ImageOff, Loader2, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { LISTING_LIMITS } from "@/lib/listings/constants";
import { isRenderablePhotoUrl } from "@/lib/listings/photos";

interface PhotosEditorProps {
  /** The listing's own photos. */
  photos: string[];
  onChange: (photos: string[]) => void;
  /** What is shown while `photos` is empty: the unit's, then the building's. */
  defaults: string[];
  /** False when there is no unit or building to fall back on. */
  fallback?: boolean;
  disabled?: boolean;
}

function Thumb({ url, label }: { url: string; label: string }) {
  const drawable = isRenderablePhotoUrl(url, process.env.NEXT_PUBLIC_R2_PUBLIC_URL);
  return drawable ? (
    <Image
      src={url}
      alt={label}
      fill
      className="object-cover"
      sizes="(max-width: 768px) 33vw, 16vw"
    />
  ) : (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted p-2 text-center"
      title={url}
    >
      <ImageOff className="h-5 w-5 text-muted-foreground" />
      <span className="line-clamp-2 break-all text-[10px] text-muted-foreground" dir="ltr">
        {url}
      </span>
    </div>
  );
}

export function PhotosEditor({
  photos,
  onChange,
  defaults,
  fallback = true,
  disabled = false,
}: PhotosEditorProps) {
  const { t } = useLocalizationContext();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0 || disabled) return;
    const room = LISTING_LIMITS.photos - photos.length;
    const chosen = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (chosen.length === 0) {
      toast.error(
        t("marketing.photos.notImages", { defaultValue: "Choose image files" }),
      );
      return;
    }
    if (chosen.length > room) {
      toast.error(
        t("marketing.photos.tooMany", {
          defaultValue: "A listing can have at most {max} photos",
          values: { max: LISTING_LIMITS.photos },
        }),
      );
      return;
    }
    if (chosen.some((file) => file.size > 10 * 1024 * 1024)) {
      toast.error(
        t("marketing.photos.tooLarge", {
          defaultValue: "Each photo must be 10 MB or smaller",
        }),
      );
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      chosen.forEach((file) => body.append("files", file));
      body.append("folder", "PropertyPro/listings");
      body.append("quality", "auto");
      const response = await fetch("/api/upload/images", {
        method: "POST",
        body,
        credentials: "include",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "Upload failed");
      }
      const urls = ((result?.images ?? []) as Array<{ url?: string }>)
        .map((image) => image.url)
        .filter((url): url is string => Boolean(url));
      onChange([...photos, ...urls]);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("marketing.photos.uploadFailed", { defaultValue: "The upload failed" }),
      );
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  const usingDefaults = photos.length === 0;
  const shown = usingDefaults ? defaults : photos;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {usingDefaults
            ? defaults.length > 0
              ? t("marketing.photos.usingDefaults", {
                  defaultValue:
                    "This listing uses the unit's photos, or the building's when the unit has none.",
                })
              : fallback
                ? t("marketing.photos.none", {
                    defaultValue:
                      "No photos yet. Upload some, or add photos to the unit or the building.",
                  })
                : t("marketing.photos.noneStandalone", {
                    defaultValue:
                      "No photos yet. Upload the property's photos; the first one is the cover.",
                  })
            : t("marketing.photos.own", {
                defaultValue: "{count} photos. The first one is the cover.",
                values: { count: photos.length },
              })}
        </p>
        {!disabled && (
          <div className="flex flex-wrap gap-2">
            {usingDefaults && defaults.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange(defaults.slice(0, LISTING_LIMITS.photos))}
              >
                {t("marketing.photos.customize", { defaultValue: "Customize" })}
              </Button>
            )}
            {!usingDefaults && fallback && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange([])}
              >
                {t("marketing.photos.useDefaults", {
                  defaultValue: "Use the unit's photos",
                })}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => input.current?.click()}
              disabled={uploading || photos.length >= LISTING_LIMITS.photos}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {t("marketing.photos.upload", { defaultValue: "Upload photos" })}
            </Button>
          </div>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => upload(event.target.files)}
        disabled={disabled}
      />

      {shown.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {shown.map((url, index) => (
            <div
              key={`${url}-${index}`}
              className="group relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted"
            >
              <Thumb
                url={url}
                label={t("marketing.photos.alt", {
                  defaultValue: "Photo {number}",
                  values: { number: index + 1 },
                })}
              />
              {index === 0 && (
                <span className="absolute start-1 top-1 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  <Star className="h-3 w-3" />
                  {t("marketing.photos.cover", { defaultValue: "Cover" })}
                </span>
              )}
              {!usingDefaults && !disabled && (
                <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {index > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2"
                      onClick={() =>
                        onChange([url, ...photos.filter((_, i) => i !== index)])
                      }
                      aria-label={t("marketing.photos.makeCover", {
                        defaultValue: "Make this the cover",
                      })}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2"
                    onClick={() => onChange(photos.filter((_, i) => i !== index))}
                    aria-label={t("marketing.photos.remove", {
                      defaultValue: "Remove this photo",
                    })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
