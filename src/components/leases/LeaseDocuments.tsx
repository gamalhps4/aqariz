"use client";

import { toast } from "sonner";
import { useState, useRef, type ChangeEvent, type DragEvent } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  Upload,
  Download,
  Eye,
  MoreHorizontal,
  File,
  FileImage,
  FileVideo,
  FileAudio,
  ExternalLink,
  X,
  CloudUpload,
  Image as ImageIcon,
} from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { leaseService, LeaseResponse } from "@/lib/services/lease.service";

interface LeaseDocumentsProps {
  lease: LeaseResponse;
  onUpdate: () => void;
}

export function LeaseDocuments({ lease, onUpdate }: LeaseDocumentsProps) {
  const { t } = useLocalizationContext();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getFileIcon = (filename: string) => {
    const extension = filename.split(".").pop()?.toLowerCase();
    switch (extension) {
      case "pdf":
        return <FileText className="h-4 w-4 text-red-600" />;
      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
      case "webp":
      case "avif":
        return <FileImage className="h-4 w-4 text-blue-600" />;
      case "mp4":
      case "avi":
      case "mov":
        return <FileVideo className="h-4 w-4 text-purple-600" />;
      case "mp3":
      case "wav":
        return <FileAudio className="h-4 w-4 text-green-600" />;
      default:
        return <File className="h-4 w-4 text-gray-600" />;
    }
  };

  const getFileSize = (url: string) => {
    // In a real implementation, you would fetch the file size
    // For now, return a placeholder
    return t("leases.details.documents.unknownSize");
  };

  const formatFileName = (url: string) => {
    const parts = url.split("/");
    return parts[parts.length - 1] || url;
  };

  const allowedImageTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/avif",
    "application/pdf",
    "application/msword",
    "application/docx",
  ];

  const validateFiles = (files: File[]) => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const oversized = files.find((f) => f.size > maxSize);
    if (oversized) {
      toast.error(
        t("leases.details.documents.toasts.fileTooLarge", {
          values: { name: oversized.name },
        })
      );
      return false;
    }

    const invalid = files.find((f) => !allowedImageTypes.includes(f.type));
    if (invalid) {
      toast.error(
        t("leases.details.documents.toasts.invalidFileType", {
          values: { name: invalid.name },
        })
      );
      return false;
    }

    return true;
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) {
      setSelectedFiles([]);
      return;
    }

    if (validateFiles(files)) {
      setSelectedFiles(files);
    } else {
      e.target.value = "";
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (validateFiles(files)) {
      setSelectedFiles(files);
    }
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleUploadImages = async () => {
    if (selectedFiles.length === 0) {
      toast.error(t("leases.details.documents.toasts.noFiles"));
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      // Do not send custom type/category; API defaults to valid lease/general
      await leaseService.uploadDocuments(lease._id, selectedFiles);

      clearInterval(progressInterval);
      setUploadProgress(100);

      toast.success(
        t("leases.details.documents.toasts.uploadSuccess", {
          values: { count: selectedFiles.length },
        })
      );
      setSelectedFiles([]);
      setIsUploadOpen(false);
      onUpdate();
    } catch (error) {
      console.error("Error uploading images:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("leases.details.documents.toasts.uploadError")
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // DISABLED: Delete functionality temporarily disabled
  // const handleRemoveDocument = async (documentUrl: string) => {
  //   try {
  //     await leaseService.removeDocument(lease._id, documentUrl);
  //     toast.success("Document removed successfully!");
  //     onUpdate();
  //   } catch (error) {
  //     console.error("Error removing document:", error);
  //     toast.error(
  //       error instanceof Error ? error.message : "Failed to remove document"
  //     );
  //   }
  const handleDownloadDocument = (url: string) => {
    // Open the document in a new tab for download
    window.open(url, "_blank");
  };

  const handleViewDocument = (url: string) => {
    // Open the document in a new tab for viewing
    window.open(url, "_blank");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("leases.details.documents.title")} ({lease.documents.length})
            </CardTitle>
            <CardDescription>
              {t("leases.details.documents.description")}
            </CardDescription>
          </div>
          <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                <CloudUpload className="me-2 h-4 w-4" />
                {t("leases.details.documents.uploadButton")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5 text-blue-600" />
                  {t("leases.details.documents.dialogTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t("leases.details.documents.dialogDescription")}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Drag and Drop Area */}
                <div
                  className={`relative border-2 border-dashed rounded-lg p-6 transition-all duration-200 ${
                    isDragOver
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                      : "border-gray-300 hover:border-gray-400"
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="text-center">
                    <CloudUpload
                      className={`mx-auto h-12 w-12 mb-4 ${
                        isDragOver ? "text-blue-500" : "text-gray-400"
                      }`}
                    />
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        {isDragOver
                          ? t("leases.details.documents.dragDropActive")
                          : t("leases.details.documents.dragDropInactive")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("leases.details.documents.dragDropOr")}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {t("leases.details.documents.browseFiles")}
                      </Button>
                    </div>
                  </div>

                  <Input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/jpg,image/webp,image/avif,application/pdf, application/msword,application/docx"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>

                {/* Selected Files Preview */}
                {selectedFiles.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">
                        {t("leases.details.documents.selectedFilesLabel")} (
                        {selectedFiles.length})
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedFiles([])}
                        className="text-xs"
                      >
                        {t("leases.details.documents.clearAll")}
                      </Button>
                    </div>

                    <div className="max-h-32 overflow-y-auto space-y-2">
                      {selectedFiles.map((file, index) => (
                        <div
                          key={index}
                          className="flex items-start justify-between gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-md"
                        >
                          <div className="flex items-start gap-2 flex-1 min-w-0 overflow-hidden">
                            <FileImage className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <p
                                className="text-xs font-medium break-all line-clamp-2"
                                title={file.name}
                              >
                                {file.name}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {formatFileSize(file.size)}
                              </p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeSelectedFile(index)}
                            className="h-6 w-6 p-0 hover:bg-red-100 hover:text-red-600 flex-shrink-0"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Upload Progress */}
                {isUploading && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>
                        {t("leases.details.documents.uploadingLabel")}
                      </span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} className="h-2" />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsUploadOpen(false);
                    setSelectedFiles([]);
                  }}
                  disabled={isUploading}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleUploadImages}
                  disabled={isUploading || selectedFiles.length === 0}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  {isUploading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white me-2" />
                      {t("leases.details.documents.uploadingLabel")}
                    </>
                  ) : (
                    <>
                      <Upload className="me-2 h-4 w-4" />
                      {t("leases.details.documents.uploadButton")}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {lease.documents.length === 0 ? (
          <div className="text-center py-12">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/20 dark:to-purple-900/20 rounded-full blur-3xl opacity-50" />
              <ImageIcon className="relative mx-auto h-16 w-16 text-blue-600 mb-6" />
            </div>
            <h3 className="text-xl font-semibold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              {t("leases.details.documents.noImagesTitle")}
            </h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              {t("leases.details.documents.noImagesDescription")}
            </p>
            <div className="space-y-2">
              <Button
                onClick={() => setIsUploadOpen(true)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                <CloudUpload className="me-2 h-4 w-4" />
                {t("leases.details.documents.firstUploadButton")}
              </Button>
              <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                <Badge variant="secondary" className="text-xs">
                  PNG
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  JPG
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  WEBP
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  AVIF
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  PDF
                </Badge>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {lease.documents.map((document, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {getFileIcon(document)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {formatFileName(document)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getFileSize(document)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleViewDocument(document)}
                    title={t("leases.details.documents.tooltips.view")}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownloadDocument(document)}
                    title={t("leases.details.documents.tooltips.download")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>
                        {t("leases.details.dropdown.actionsLabel")}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => handleViewDocument(document)}
                      >
                        <Eye className="me-2 h-4 w-4" />
                        {t("leases.details.documents.actions.view")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDownloadDocument(document)}
                      >
                        <Download className="me-2 h-4 w-4" />
                        {t("leases.details.documents.actions.download")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => window.open(document, "_blank")}
                      >
                        <ExternalLink className="me-2 h-4 w-4" />
                        {t("leases.details.documents.actions.openInNewTab")}
                      </DropdownMenuItem>
                      {/* DISABLED: Delete functionality temporarily disabled */}
                      {/* <DropdownMenuSeparator />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem
                            className="text-red-600"
                            onSelect={(e) => e.preventDefault()}
                          >
                            <Trash2 className="me-2 h-4 w-4" />
                            Remove
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove Document</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to remove this document from
                              the lease? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRemoveDocument(document)}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Remove Document
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog> */}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Component for displaying document preview
interface DocumentPreviewProps {
  url: string;
  filename: string;
}

export function DocumentPreview({ url, filename }: DocumentPreviewProps) {
  const { t } = useLocalizationContext();
  const extension = filename.split(".").pop()?.toLowerCase();

  if (extension === "pdf") {
    return (
      <div className="w-full h-96 border rounded-lg">
        <iframe
          src={url}
          className="w-full h-full rounded-lg"
          title={filename}
        />
      </div>
    );
  }

  if (["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(extension || "")) {
    return (
      <div className="w-full max-w-md mx-auto">
        <img
          src={url}
          alt={filename}
          className="w-full h-auto rounded-lg border"
        />
      </div>
    );
  }

  return (
    <div className="text-center py-8">
      <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
      <p className="text-muted-foreground">
        {t("leases.details.documents.preview.notAvailable")}
      </p>
      <Button
        variant="outline"
        className="mt-4"
        onClick={() => window.open(url, "_blank")}
      >
        <ExternalLink className="me-2 h-4 w-4" />
        {t("leases.details.documents.preview.openInNewTab")}
      </Button>
    </div>
  );
}
