/**
 * PropertyPro - File Upload Component
 * Reusable file upload component with drag and drop support
 */

"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { showSimpleError } from "@/lib/toast-notifications";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  File,
  X,
  CheckCircle,
  AlertCircle,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiText } from "@/components/ui/use-ui-text";

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  onFileRemove?: (index: number) => void;
  acceptedFileTypes?: string[];
  maxFileSize?: number; // in MB
  maxFiles?: number;
  existingFiles?: UploadedFile[];
  className?: string;
  disabled?: boolean;
}

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  uploadProgress?: number;
  status: "uploading" | "completed" | "error";
}

export function FileUpload({
  onFilesSelected,
  onFileRemove,
  acceptedFileTypes = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"],
  maxFileSize = 10, // 10MB
  maxFiles = 10,
  existingFiles = [],
  className,
  disabled = false,
}: FileUploadProps) {
  const { text } = useUiText();
  const [uploadedFiles, setUploadedFiles] =
    useState<UploadedFile[]>(existingFiles);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (disabled) return;

      // Check if adding these files would exceed the limit
      if (uploadedFiles.length + acceptedFiles.length > maxFiles) {
        showSimpleError("File Limit", `Maximum ${maxFiles} files allowed`);
        return;
      }

      // Validate file sizes
      const oversizedFiles = acceptedFiles.filter(
        (file) => file.size > maxFileSize * 1024 * 1024
      );
      if (oversizedFiles.length > 0) {
        showSimpleError("File Too Large", `Some files exceed the ${maxFileSize}MB size limit`);
        return;
      }

      // Add files to the list
      const newFiles: UploadedFile[] = acceptedFiles.map((file) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        size: file.size,
        type: file.type,
        uploadProgress: 0,
        status: "uploading",
      }));

      setUploadedFiles((prev) => [...prev, ...newFiles]);
      onFilesSelected(acceptedFiles);

      // Simulate upload progress
      newFiles.forEach((file, index) => {
        simulateUpload(file.id);
      });
    },
    [uploadedFiles, maxFiles, maxFileSize, onFilesSelected, disabled]
  );

  const simulateUpload = (fileId: string) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 30;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setUploadedFiles((prev) =>
          prev.map((file) =>
            file.id === fileId
              ? { ...file, uploadProgress: 100, status: "completed" }
              : file
          )
        );
      } else {
        setUploadedFiles((prev) =>
          prev.map((file) =>
            file.id === fileId ? { ...file, uploadProgress: progress } : file
          )
        );
      }
    }, 200);
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
    if (onFileRemove) {
      onFileRemove(index);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: acceptedFileTypes.reduce((acc, type) => {
      acc[type] = [];
      return acc;
    }, {} as Record<string, string[]>),
    maxSize: maxFileSize * 1024 * 1024,
    disabled,
  });

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) {
      return <ImageIcon className="h-4 w-4" />;
    }
    return <File className="h-4 w-4" />;
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Upload Area */}
      <Card
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed transition-colors cursor-pointer",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <input {...getInputProps()} />
          <Upload className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm font-medium">
            {isDragActive
              ? text("ui.files.drop", "Drop the files here…")
              : text("ui.files.dragOrClick", "Drag files here, or click to choose")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {text("ui.files.limits", "Formats: {formats} (up to {size} MB each)")
              .replace("{formats}", acceptedFileTypes.join(", "))
              .replace("{size}", String(maxFileSize))}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={disabled}
          >
            {text("ui.files.choose", "Choose files")}
          </Button>
        </CardContent>
      </Card>

      {/* File List */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">
            Uploaded Files ({uploadedFiles.length}/{maxFiles})
          </h4>
          {uploadedFiles.map((file, index) => (
            <Card key={file.id} className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  {getFileIcon(file.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {file.status === "uploading" && (
                      <div className="w-20">
                        <Progress value={file.uploadProgress} className="h-2" />
                      </div>
                    )}
                    {file.status === "completed" && (
                      <Badge variant="secondary" className="text-green-600">
                        <CheckCircle className="h-3 w-3 me-1" />
                        Uploaded
                      </Badge>
                    )}
                    {file.status === "error" && (
                      <Badge variant="destructive">
                        <AlertCircle className="h-3 w-3 me-1" />
                        Error
                      </Badge>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFile(index)}
                  disabled={disabled}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
