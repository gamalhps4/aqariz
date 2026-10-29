"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Camera,
  X,
  Loader2,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiText } from "@/components/ui/use-ui-text";

interface AvatarUploadProps {
  currentAvatar?: string;
  onAvatarUploaded: (avatarUrl: string) => void;
  onAvatarRemoved?: () => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  userInitials?: string;
}

export function AvatarUpload({
  currentAvatar,
  onAvatarUploaded,
  onAvatarRemoved,
  disabled = false,
  className = "",
  size = "lg",
  userInitials = "U",
}: AvatarUploadProps) {
  const { text } = useUiText();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sizeClasses = {
    sm: "w-16 h-16",
    md: "w-24 h-24",
    lg: "w-32 h-32",
    xl: "w-40 h-40",
  };

  const validateFile = (file: File): { isValid: boolean; error?: string } => {
    // Check file type
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return {
        isValid: false,
        error: text("ui.avatar.badType", "Choose a JPEG, PNG or WebP picture"),
      };
    }

    // Check file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return {
        isValid: false,
        error: text("ui.avatar.tooLarge", "The picture must be smaller than 5 MB"),
      };
    }

    return { isValid: true };
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const file = files[0];
    const validation = validateFile(file);

    if (!validation.isValid) {
      setError(validation.error!);
      return;
    }

    setError(null);
    setSuccess(false);
    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("files", file);
      formData.append("folder", "PropertyPro/avatars");
      formData.append("quality", "85");
      formData.append("maxWidth", "400");
      formData.append("maxHeight", "400");
      formData.append("crop", "fill"); // Use fill to crop without black background

      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(text("ui.avatar.timeout", "The upload took too long. Try again."))),
          30000
        )
      );

      // Race between fetch and timeout
      const response = (await Promise.race([
        fetch("/api/upload/images", {
          method: "POST",
          body: formData,
          credentials: "include",
        }),
        timeoutPromise,
      ])) as Response;

      clearInterval(progressInterval);
      setUploadProgress(100);

      const result = await response.json();

      if (!response.ok) {
        console.error("Upload failed with status:", response.status, result);
        throw new Error(result.error || "Upload failed");
      }

      if (result.images && result.images.length > 0 && result.images[0].url) {
        onAvatarUploaded(result.images[0].url);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        console.error("No image URL in response:", result);
        throw new Error("No image URL returned");
      }
    } catch (error) {
      console.error("Avatar upload error:", error);
      let errorMessage = text("ui.images.failed", "Upload failed");

      if (error instanceof Error) {
        if (error.message.includes("Unauthorized")) {
          errorMessage = text("ui.avatar.signIn", "Sign in to upload pictures");
        } else if (error.message.includes("No image URL")) {
          errorMessage = text(
            "ui.avatar.noUrl",
            "The upload finished but no picture came back. Try again.",
          );
        } else {
          errorMessage = error.message;
        }
      }

      setError(errorMessage);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const openFileDialog = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleRemoveAvatar = () => {
    if (onAvatarRemoved) {
      onAvatarRemoved();
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Avatar Display */}
      <div className="flex flex-col items-center space-y-4">
        <div className="relative">
          <Avatar
            className={cn(sizeClasses[size], "border-4 border-white shadow-lg")}
          >
            <AvatarImage src={currentAvatar} alt="Avatar" />
            <AvatarFallback className="text-lg font-semibold bg-gradient-to-br from-blue-500 to-purple-600 text-white">
              {userInitials}
            </AvatarFallback>
          </Avatar>

          {/* Upload Progress Overlay */}
          {uploading && (
            <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
              <div className="text-center text-white">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-1" />
                <div className="text-xs">{uploadProgress}%</div>
              </div>
            </div>
          )}

          {/* Success Indicator */}
          {success && (
            <div className="absolute -top-2 -end-2">
              <div className="bg-green-500 rounded-full p-1">
                <CheckCircle className="h-4 w-4 text-white" />
              </div>
            </div>
          )}
        </div>

        {/* Upload Buttons */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openFileDialog}
            disabled={disabled || uploading}
            className="flex items-center gap-2"
          >
            <Camera className="h-4 w-4" />
            {currentAvatar
              ? text("ui.avatar.change", "Change")
              : text("ui.avatar.upload", "Upload")}
          </Button>

          {currentAvatar && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemoveAvatar}
              disabled={disabled || uploading}
              className="flex items-center gap-2 text-red-600 hover:text-red-700"
            >
              <X className="h-4 w-4" />
              {text("ui.avatar.remove", "Remove")}
            </Button>
          )}
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Status Messages */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-red-700">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {success && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm">{text("ui.avatar.saved", "Picture updated")}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Guidelines */}
      <div className="text-center">
        <p className="text-xs text-gray-500">
          {text("ui.avatar.hint", "A square picture works best, up to 5 MB.")}
          <br />
          {text("ui.avatar.formats", "JPEG, PNG or WebP")}
          <br />
          <span className="text-blue-600">
            {text("ui.avatar.optional", "A picture is optional")}
          </span>
        </p>
      </div>
    </div>
  );
}
