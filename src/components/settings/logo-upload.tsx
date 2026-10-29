"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Upload,
  X,
  Image as ImageIcon,
  AlertCircle,
  Loader2,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { validateBrandingFile, BRANDING_VALIDATION } from "@/lib/r2";
import Image from "@/components/ui/app-image";
import { logClientError, logClientInfo, logClientWarn } from "@/utils/logger";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface LogoUploadProps {
  type: "logo" | "favicon";
  variant?: "light" | "dark" | "favicon";
  currentUrl?: string;
  onUpload: (result: {
    url: string;
    objectKey?: string;
    metadata?: any;
    optimizedUrls?: Record<string, string>;
  }) => void;
  onRemove: () => void;
  onError: (error: string) => void;
  disabled?: boolean;
  className?: string;
  openInDialog?: boolean;
  dialogTitle?: string;
  /**
   * Upload endpoint. Defaults to the org-scoped `/api/upload/branding`; the
   * platform console passes its super-admin endpoint instead. Both return the
   * same `{ data: { url, objectKey, ... } }` shape.
   */
  endpoint?: string;
}

export function LogoUpload({
  type,
  variant = "light",
  currentUrl,
  onUpload,
  onRemove,
  onError,
  disabled = false,
  className,
  openInDialog = false,
  dialogTitle,
  endpoint = "/api/upload/branding",
}: LogoUploadProps) {
  const { t } = useLocalizationContext();
  // What is being uploaded, in words: "logo (dark)", "icon".
  const subject =
    type === "favicon"
      ? t("settings.logo.favicon", { defaultValue: "browser icon" })
      : variant === "dark"
        ? t("settings.logo.logoDark", { defaultValue: "logo for dark backgrounds" })
        : t("settings.logo.logoLight", { defaultValue: "logo" });
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guard against a duplicate upload firing for the same selection (e.g. a
  // bubbled click re-triggering the file picker).
  const uploadInProgressRef = useRef(false);

  const validation = BRANDING_VALIDATION[type];

  // Handle file selection
  const [dialogOpen, setDialogOpen] = useState(false);

  // When the dialog opens, automatically trigger file picker once
  useEffect(() => {
    if (openInDialog && dialogOpen && fileInputRef.current && !isUploading) {
      const id = setTimeout(() => fileInputRef.current?.click(), 60);
      return () => clearTimeout(id);
    }
  }, [openInDialog, dialogOpen, isUploading]);
  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      logClientInfo("Logo file selection started", {
        fileCount: files?.length ?? 0,
      });

      if (!files || files.length === 0) {
        logClientWarn("Logo upload aborted: no files selected");
        return;
      }

      const file = files[0];
      logClientInfo("Logo upload file details", {
        name: file.name,
        size: file.size,
        type: file.type,
        uploadType: type,
        variant: variant,
      });

      setValidationErrors([]);
      setValidationWarnings([]);

      // Validate file
      const validationResult = validateBrandingFile(file, type);
      if (!validationResult.isValid) {
        logClientWarn("Logo validation failed:", validationResult.errors);
        // The checks' own wording is English; say the same thing in the
        // reader's language.
        const problems = validationResult.errors.map((error) =>
          error.startsWith("File size")
            ? t("settings.logo.tooLarge", { defaultValue: "The file is larger than {max} MB.", values: { max: BRANDING_VALIDATION[type].maxFileSize / 1024 / 1024 } })
            : error.startsWith("Unsupported file")
              ? t("settings.logo.badFormat", { defaultValue: "Use one of these formats: {formats}.", values: { formats: BRANDING_VALIDATION[type].allowedFormats.join(", ").toUpperCase() } })
              : error,
        );
        setValidationErrors(problems);
        onError(problems.join(" "));
        return;
      }

      if (validationResult.warnings.length > 0) {
        logClientWarn("Logo validation warnings:", validationResult.warnings);
        setValidationWarnings(validationResult.warnings);
      }

      logClientInfo("Logo validation passed, starting upload");
      // Upload file
      await uploadFile(file);
    },
    [type, variant, onError, t],
  );

  // Upload file to R2
  const uploadFile = async (file: File) => {
    // Ignore duplicate invocations while an upload is already running.
    if (uploadInProgressRef.current) {
      logClientWarn("Logo upload already in progress, ignoring duplicate call");
      return;
    }
    uploadInProgressRef.current = true;

    logClientInfo("Starting R2 logo upload");
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);
      if (variant) {
        formData.append("variant", variant);
      }

      logClientInfo("Sending logo upload request", {
        fileName: file.name,
        type: type,
        variant: variant,
        endpoint,
      });

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      logClientInfo("Logo upload response received", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      });

      if (!response.ok) {
        let errorMessage = t("settings.logo.failed", { defaultValue: "The upload failed" });
        try {
          const errorData = await response.json();
          logClientError("Logo upload failed with API error:", errorData);
          errorMessage = errorData?.error || errorMessage;
        } catch (e) {
          try {
            const text = await response.text();
            logClientError("Logo upload failed (non-JSON response):", text);
            errorMessage = text || errorMessage;
          } catch {}
        }

        throw new Error(errorMessage);
      }

      const result = await response.json();
      logClientInfo("Logo upload completed", result);

      const uploadData = result?.data ?? {};
      if (uploadData?.validation?.warnings) {
        logClientWarn("Logo upload warnings:", uploadData.validation.warnings);
        setValidationWarnings(uploadData.validation.warnings);
      }

      logClientInfo("Dispatching logo upload result", {
        url: uploadData?.url,
        objectKey: uploadData?.objectKey,
        metadata: uploadData?.metadata,
        optimizedUrls: uploadData?.optimizedUrls,
      });

      onUpload({
        url: uploadData?.url ?? "",
        objectKey: uploadData?.objectKey,
        metadata: uploadData?.metadata,
        optimizedUrls: uploadData?.optimizedUrls,
      });

      // Reset progress after a short delay
      setTimeout(() => {
        setUploadProgress(0);
      }, 1000);
    } catch (error) {
      logClientError("Logo upload error:", error);
      onError(error instanceof Error ? error.message : t("settings.logo.failed", { defaultValue: "The upload failed" }));
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
      uploadInProgressRef.current = false;
    }
  };

  // Handle drag events
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        setIsDragOver(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (!disabled) {
        handleFileSelect(e.dataTransfer.files);
      }
    },
    [disabled, handleFileSelect],
  );

  // Handle file input change
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      e.preventDefault();
      e.stopPropagation();
      handleFileSelect(e.target.files);
      // Reset the input value to allow selecting the same file again
      e.target.value = "";
    },
    [handleFileSelect],
  );

  // Open file dialog
  const openFileDialog = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      // Use click() on a hidden input for maximum compatibility
      fileInputRef.current.click();
    }
  }, [disabled]);

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const hasCurrentLogo =
    currentUrl &&
    currentUrl !== "/images/logo-light.png" &&
    currentUrl !== "/images/logo-dark.png" &&
    currentUrl !== "/favicon.ico";

  // Reusable upload area. When triggerMode=true, clicking the box opens the dialog (not file picker)
  const buildUploadArea = (triggerMode: boolean) => (
    <div
      className={cn(
        "border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200",
        isDragOver && !disabled
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
          : "border-gray-300 dark:border-gray-600",
        disabled && "opacity-50 cursor-not-allowed",
        !disabled &&
          "hover:border-gray-400 dark:hover:border-gray-500 cursor-pointer",
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (
          (e.key === "Enter" || e.key === " ") &&
          !disabled &&
          !isUploading &&
          !triggerMode
        ) {
          e.preventDefault();
          openFileDialog();
        }
      }}
      onDragOver={(e) => {
        if (triggerMode) return;
        handleDragOver(e);
      }}
      onDragLeave={(e) => {
        if (triggerMode) return;
        handleDragLeave(e);
      }}
      onDrop={(e) => {
        if (triggerMode) return;
        handleDrop(e);
      }}
      onClick={() => {
        if (triggerMode) return; // reserved for dialog mode (disabled)
        if (!disabled && !isUploading) {
          openFileDialog();
        }
      }}
    >
      {/* Current Logo Preview */}
      {hasCurrentLogo && (
        <div className="mb-4">
          <div className="relative inline-block">
            <Image
              src={currentUrl!}
              alt={subject}
              width={type === "favicon" ? 32 : 120}
              height={type === "favicon" ? 32 : 36}
              className={cn(
                "mx-auto object-contain",
                type === "favicon" ? "max-h-8" : "max-h-16",
              )}
              unoptimized
            />
            {!isUploading && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="absolute -top-2 -end-2 h-6 w-6 rounded-full p-0"
                    disabled={disabled}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("settings.logo.removeTitle", { defaultValue: "Remove the {subject}?", values: { subject } })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("settings.logo.removeBody", { defaultValue: "The current image is removed. You can upload a new one at any time." })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel", { defaultValue: "Cancel" })}</AlertDialogCancel>
                    <AlertDialogAction onClick={onRemove}>
                      {t("settings.logo.remove", { defaultValue: "Remove" })}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      )}

      {/* Upload Progress */}
      {isUploading && (
        <div className="mb-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-500" />
          <Progress
            value={uploadProgress}
            className="w-full max-w-xs mx-auto"
          />
          <p className="text-sm text-muted-foreground mt-2">
            {t("settings.logo.uploading", { defaultValue: "Uploading… {percent}%", values: { percent: uploadProgress } })}
          </p>
        </div>
      )}

      {/* Upload Icon and Text */}
      {!isUploading && (
        <>
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium mb-1">
            {hasCurrentLogo
              ? t("settings.logo.replace", { defaultValue: "Replace the {subject}", values: { subject } })
              : t("settings.logo.upload", { defaultValue: "Upload the {subject}", values: { subject } })}
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            {t("settings.logo.drop", { defaultValue: "Drag a file here, or click to choose one" })}
          </p>
        </>
      )}

      {/* File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={[
          ...validation.allowedFormats.map((f) => `.${f}`),
          ...validation.allowedMimeTypes,
        ].join(",")}
        onChange={handleInputChange}
        // Prevent the programmatic .click() from bubbling back to the
        // dropzone's onClick, which would re-open the picker / double-upload.
        onClick={(e) => e.stopPropagation()}
        className="hidden"
        disabled={disabled}
      />

      {/* Upload Button */}
      {!hasCurrentLogo && !isUploading && !triggerMode && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(e) => {
            // Don't let this bubble to the dropzone onClick (double picker).
            e.stopPropagation();
            openFileDialog();
          }}
          disabled={disabled}
        >
          <ImageIcon className="h-4 w-4 me-2" />
          {t("settings.logo.choose", { defaultValue: "Choose a file" })}
        </Button>
      )}
    </div>
  );

  const content = (
    <>
      {buildUploadArea(false)}

      {/* Validation Messages */}
      {validationErrors.length > 0 && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-700 dark:text-red-300">
              {t("settings.logo.invalid", { defaultValue: "This file cannot be used" })}
            </p>
            <ul className="mt-1 text-red-600 dark:text-red-400 space-y-1">
              {validationErrors.map((error, index) => (
                <li key={index}>• {error}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {validationWarnings.length > 0 && (
        <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <Info className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-yellow-700 dark:text-yellow-300">
              {t("settings.logo.tips", { defaultValue: "Suggestions" })}
            </p>
            <ul className="mt-1 text-yellow-600 dark:text-yellow-400 space-y-1">
              {validationWarnings.map((warning, index) => (
                <li key={index}>• {warning}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Upload Requirements */}
      <div className="text-xs text-muted-foreground space-y-1">
        <div className="flex items-center justify-between">
          <span>{t("settings.logo.maxSize", { defaultValue: "Largest file:" })}</span>
          <Badge variant="outline" className="text-xs">
            {formatFileSize(validation.maxFileSize)}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>{t("settings.logo.formats", { defaultValue: "Formats:" })}</span>
          <Badge variant="outline" className="text-xs">
            {validation.allowedFormats.join(", ").toUpperCase()}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>{t("settings.logo.recommended", { defaultValue: "Best size:" })}</span>
          <Badge variant="outline" className="text-xs">
            {validation.recommendedDimensions.width}×
            {validation.recommendedDimensions.height}px
          </Badge>
        </div>
      </div>
    </>
  );

  if (openInDialog) {
    // User requested no modal. In dialog mode we still only open the file picker.
    return (
      <div className={cn("space-y-3", className)}>{buildUploadArea(false)}</div>
    );
  }

  return <div className={cn("space-y-3", className)}>{content}</div>;
}
