/**
 * PropertyPro - Image Upload Component
 * Reusable component for uploading images with drag & drop support
 */

"use client";

import React, { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  Image as ImageIcon,
  Loader2,
  CheckCircle,
  X,
  Eye,
} from "lucide-react";
import { showSimpleError, showSimpleSuccess } from "@/lib/toast-notifications";
import Image from "@/components/ui/app-image";
import { useLocalization } from "@/hooks/use-localization";
import { useUiText } from "@/components/ui/use-ui-text";

export interface UploadedImage {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}

interface ImageUploadProps {
  onImagesUploaded: (images: UploadedImage[]) => void;
  onImagesRemoved?: (images: UploadedImage[]) => void;
  existingImages?: UploadedImage[];
  maxFiles?: number;
  folder?: string;
  quality?: string;
  maxWidth?: number;
  maxHeight?: number;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  label?: string;
  /**
   * Upload endpoint. Defaults to the org-scoped route, which is guarded by
   * `withPermissionAndDB` and therefore rejects platform super-admins (they
   * carry no organization context). Console screens that upload as a platform
   * admin point this at their own `withPlatformAdminAndDB` route instead; any
   * endpoint used here must answer with the same `{ success, images }` shape.
   */
  endpoint?: string;
}

export function ImageUpload({
  onImagesUploaded,
  onImagesRemoved,
  existingImages = [],
  maxFiles = 10,
  folder = "PropertyPro/properties",
  quality = "auto",
  maxWidth,
  maxHeight,
  disabled = false,
  className = "",
  compact = false,
  label,
  endpoint = "/api/upload/images",
}: ImageUploadProps) {
  const { t } = useLocalization();
  const [images, setImages] = useState<UploadedImage[]>(existingImages);
  const { text } = useUiText();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || disabled) return;

      const fileArray = Array.from(files);
      const remainingSlots = maxFiles - images.length;

      if (fileArray.length > remainingSlots) {
        showSimpleError("Upload Limit", `You can only upload ${remainingSlots} more image(s)`);
        return;
      }

      // Validate files
      const validFiles = fileArray.filter((file) => {
        if (!file.type.startsWith("image/")) {
          showSimpleError("Invalid File", `${file.name} is not an image file`);
          return false;
        }
        if (file.size > 10 * 1024 * 1024) {
          showSimpleError("File Too Large", `${file.name} is too large (max 10MB)`);
          return false;
        }
        return true;
      });

      if (validFiles.length === 0) return;

      setUploading(true);
      setUploadProgress(0);

      try {
        const formData = new FormData();
        validFiles.forEach((file) => formData.append("files", file));
        formData.append("folder", folder);
        formData.append("quality", quality);
        if (maxWidth) formData.append("maxWidth", maxWidth.toString());
        if (maxHeight) formData.append("maxHeight", maxHeight.toString());

        const response = await fetch(endpoint, {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Upload failed");
        }

        const newImages = result.images as UploadedImage[];
        const updatedImages = [...images, ...newImages];

        setImages(updatedImages);
        onImagesUploaded(newImages);

        showSimpleSuccess(
          text("ui.images.done", "Upload complete"),
          text("ui.images.doneBody", "{count} pictures uploaded").replace(
            "{count}",
            String(newImages.length),
          ),
        );
      } catch (error) {
        console.error("Upload error:", error);
        showSimpleError(
          text("ui.images.failed", "Upload failed"),
          error instanceof Error ? error.message : undefined,
        );
      } finally {
        setUploading(false);
        setUploadProgress(0);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [
      images,
      maxFiles,
      folder,
      quality,
      maxWidth,
      maxHeight,
      disabled,
      onImagesUploaded,
      endpoint,
      text,
    ]
  );

  const removeImage = useCallback(
    (index: number) => {
      const newImages = images.filter((_, i) => i !== index);
      const removedImage = images[index];

      setImages(newImages);
      if (onImagesRemoved) {
        onImagesRemoved([removedImage]);
      }
    },
    [images, onImagesRemoved]
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (disabled) return;

      const files = e.dataTransfer.files;
      handleFiles(files);
    },
    [handleFiles, disabled]
  );

  const openFileDialog = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Upload Area */}
      <div className="relative">
        <div
          className={`border-2 border-dashed rounded-xl text-center transition-all duration-200 cursor-pointer ${
            compact ? "p-4" : "p-8"
          } ${
            dragActive
              ? "border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30 scale-[1.02]"
              : disabled
              ? "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800 cursor-not-allowed"
              : "border-gray-300 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-blue-950/20"
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={openFileDialog}
        >
          {uploading ? (
            <div className={compact ? "space-y-2" : "space-y-4"}>
              <div className="relative">
                <div
                  className={`mx-auto bg-blue-100 dark:bg-blue-950/30 rounded-full flex items-center justify-center ${
                    compact ? "w-10 h-10" : "w-16 h-16"
                  }`}
                >
                  <Loader2
                    className={`text-blue-600 dark:text-blue-400 animate-spin ${
                      compact ? "h-5 w-5" : "h-8 w-8"
                    }`}
                  />
                </div>
              </div>
              <div className={compact ? "space-y-1" : "space-y-2"}>
                <p
                  className={`font-semibold text-gray-900 dark:text-white ${
                    compact ? "text-sm" : "text-lg"
                  }`}
                >
                  {t("common.upload.uploading")}
                </p>
                {!compact && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t("common.upload.uploadingDescription")}
                  </p>
                )}
              </div>
              <div className="w-full max-w-sm mx-auto">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("common.upload.progress", {
                    values: { progress: uploadProgress },
                  })}
                </p>
              </div>
            </div>
          ) : (
            <div className={compact ? "space-y-2" : "space-y-4"}>
              <div className="relative">
                <div
                  className={`mx-auto bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-950/30 dark:to-blue-900/30 rounded-full flex items-center justify-center ${
                    compact ? "w-10 h-10" : "w-16 h-16"
                  }`}
                >
                  <Upload
                    className={`text-blue-600 dark:text-blue-400 ${
                      compact ? "h-5 w-5" : "h-8 w-8"
                    }`}
                  />
                </div>
                {dragActive && (
                  <div
                    className={`absolute inset-0 mx-auto bg-blue-200 dark:bg-blue-900 rounded-full animate-ping opacity-75 ${
                      compact ? "w-10 h-10" : "w-16 h-16"
                    }`}
                  ></div>
                )}
              </div>
              <div className={compact ? "space-y-1" : "space-y-2"}>
                <p
                  className={`font-semibold text-gray-900 dark:text-white ${
                    compact ? "text-sm" : "text-lg"
                  }`}
                >
                  {disabled
                    ? t("common.upload.titleDisabled")
                    : dragActive
                    ? t("common.upload.titleDragActive")
                    : label || t("common.upload.title")}
                </p>
                {!compact && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {disabled
                      ? t("common.upload.descriptionDisabled")
                      : t("common.upload.description")}
                  </p>
                )}
              </div>
              <div
                className={`flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 ${
                  compact ? "space-x-3" : "space-x-4"
                }`}
              >
                <span className="flex items-center">
                  <CheckCircle className="h-3 w-3 me-1 text-green-500" />
                  {t("common.upload.formats")}
                </span>
                <span className="flex items-center">
                  <CheckCircle className="h-3 w-3 me-1 text-green-500" />
                  {t("common.upload.maxSize")}
                </span>
                <span className="flex items-center">
                  <CheckCircle className="h-3 w-3 me-1 text-green-500" />
                  {t("common.upload.uploaded", {
                    values: { current: images.length, max: maxFiles },
                  })}
                </span>
              </div>
              {!disabled && (
                <Button
                  type="button"
                  variant="outline"
                  size={compact ? "sm" : "default"}
                  className="bg-white dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:border-blue-300 dark:hover:border-blue-600"
                >
                  <ImageIcon className="h-4 w-4 me-2" />
                  {t("common.upload.chooseFiles")}
                </Button>
              )}
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
          disabled={disabled}
        />
      </div>

      {/* Image Preview Grid */}
      {images.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center">
              <ImageIcon className="h-4 w-4 me-2 text-blue-600" />
              {t("common.upload.uploadedImages", {
                values: { count: images.length },
              })}
            </h4>
            {!disabled && images.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setImages([])}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
              >
                <X className="h-3 w-3 me-1" />
                {t("common.upload.clearAll")}
              </Button>
            )}
          </div>

          <div
            className={`grid ${
              compact
                ? "gap-1.5 grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
                : "gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
            }`}
          >
            {images.map((image, index) => (
              <div key={image.publicId || index} className="relative group">
                <div
                  className={`relative overflow-hidden rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-500 transition-colors ${
                    compact ? "aspect-[4/3] h-20" : "aspect-[4/3] h-32"
                  }`}
                >
                  <Image
                    src={image.url}
                    alt={`Upload ${index + 1}`}
                    fill
                    className="object-cover transition-transform duration-200 group-hover:scale-105"
                    sizes={
                      compact
                        ? "(max-width: 768px) 33vw, 16vw"
                        : "(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    }
                  />

                  {/* Success indicator */}
                  <div className={`absolute ${compact ? "top-1 start-1" : "top-2 start-2"}`}>
                    <div
                      className={`bg-green-500 rounded-full flex items-center justify-center shadow-lg ${
                        compact ? "w-4 h-4" : "w-6 h-6"
                      }`}
                    >
                      <CheckCircle className={compact ? "h-3 w-3 text-white" : "h-4 w-4 text-white"} />
                    </div>
                  </div>

                  {/* Overlay with actions */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center space-x-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="bg-white/90 hover:bg-white text-gray-900 shadow-lg"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(image.url, "_blank");
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {!disabled && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="bg-red-500/90 hover:bg-red-600 text-white shadow-lg"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImage(index);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Image info - hide in compact mode */}
                {!compact && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-400 font-medium">
                        {t("common.upload.imageNumber", {
                          values: { number: index + 1 },
                        })}
                      </span>
                      {image.bytes && (
                        <span className="text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                          {(image.bytes / 1024 / 1024).toFixed(1)} MB
                        </span>
                      )}
                    </div>
                    {image.width && image.height && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {image.width} × {image.height} px
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Upload Summary */}
          <div
            className={`bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg ${
              compact ? "p-2" : "p-3"
            }`}
          >
            <div
              className={`flex items-center text-green-800 dark:text-green-400 ${
                compact ? "text-xs" : "text-sm"
              }`}
            >
              <CheckCircle className={`me-2 text-green-600 ${compact ? "h-3 w-3" : "h-4 w-4"}`} />
              <span className="font-medium">
                {t("common.upload.readyToUpload", {
                  values: {
                    count: images.length,
                    plural: images.length > 1 ? "s" : "",
                  },
                })}
              </span>
            </div>
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              {t("common.upload.reviewDescription")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
