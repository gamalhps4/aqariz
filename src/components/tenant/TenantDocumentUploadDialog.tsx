/**
 * Tenant Document Upload Dialog
 * Allows tenants to upload lease-related documents with metadata and validation
 */

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Paperclip, Trash2, Upload as UploadIcon } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  TenantDocument,
  normalizeTenantDocument,
} from "@/components/tenant/DocumentManagement";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const allowedMimeTypes: ReadonlyArray<{ value: string; label: string }> = [
  { value: "application/pdf", label: "PDF" },
  { value: "application/msword", label: "DOC" },
  {
    value:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "DOCX",
  },
  { value: "image/jpeg", label: "JPG" },
  { value: "image/jpg", label: "JPG" },
  { value: "image/png", label: "PNG" },
  { value: "text/plain", label: "TXT" },
];

const documentTypeOptions: ReadonlyArray<string> = [
  "lease",
  "notice",
  "maintenance",
  "insurance",
  "identification",
  "income",
  "inspection",
  "receipt",
  "other",
];

const documentCategoryOptions: ReadonlyArray<string> = [
  "lease",
  "payments",
  "maintenance",
  "insurance",
  "identification",
  "notices",
  "general",
];

const documentTypeDefaultLabels: Record<string, string> = {
  lease: "Lease",
  notice: "Notice",
  maintenance: "Maintenance",
  insurance: "Insurance",
  identification: "Identification",
  income: "Income",
  inspection: "Inspection",
  receipt: "Receipt",
  other: "Other",
};

const documentCategoryDefaultLabels: Record<string, string> = {
  lease: "Lease",
  payments: "Payments",
  maintenance: "Maintenance",
  insurance: "Insurance",
  identification: "Identification",
  notices: "Notices",
  general: "General",
};

interface TenantDocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete?: (
    documents: TenantDocument[],
    summary: { uploaded: number; total: number; message?: string }
  ) => Promise<void> | void;
}

type TenantDocumentUploadFormValues = {
  type: string;
  category: string;
  description?: string;
  tags?: string;
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const units = ["Bytes", "KB", "MB", "GB"] as const;
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const size = bytes / Math.pow(1024, index);
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const allowedMimeTypeValues = allowedMimeTypes.map((item) => item.value);

export default function TenantDocumentUploadDialog({
  open,
  onOpenChange,
  onUploadComplete,
}: TenantDocumentUploadDialogProps) {
  const { t } = useLocalizationContext();

  const uploadSchema = useMemo(
    () =>
      z.object({
        type: z
          .string()
          .min(
            1,
            t("leases.documents.upload.validation.selectDocumentType", {
              defaultValue: "Select a document type",
            })
          ),
        category: z
          .string()
          .min(
            1,
            t("leases.documents.upload.validation.selectCategory", {
              defaultValue: "Select a document category",
            })
          ),
        description: z
          .string()
          .max(
            500,
            t("leases.documents.upload.validation.descriptionMax", {
              defaultValue: "Description must be 500 characters or less",
            })
          )
          .optional()
          .or(z.literal("")),
        tags: z
          .string()
          .max(
            200,
            t("leases.documents.upload.validation.tagsMax", {
              defaultValue: "Tags must be 200 characters or less",
            })
          )
          .optional()
          .or(z.literal("")),
      }),
    [t]
  );

  const form = useForm<TenantDocumentUploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      type: "lease",
      category: "general",
      description: "",
      tags: "",
    },
  });

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedFiles([]);
      form.reset({
        type: "lease",
        category: "general",
        description: "",
        tags: "",
      });
    }
  }, [open, form]);

  const selectedFileNames = useMemo(
    () => new Set(selectedFiles.map((file) => file.name)),
    [selectedFiles]
  );

  const handleFilesAdded = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;

      const incomingFiles = Array.from(fileList);

      if (incomingFiles.length + selectedFiles.length > MAX_FILES) {
        toast.error(
          t("leases.documents.upload.errors.maxFiles", {
            defaultValue: "You can upload up to {maxFiles} files at a time.",
            values: { maxFiles: MAX_FILES },
          })
        );
        return;
      }

      const validFiles: File[] = [];
      const errors: string[] = [];

      incomingFiles.forEach((file) => {
        if (selectedFileNames.has(file.name)) {
          errors.push(
            t("leases.documents.upload.errors.alreadyAdded", {
              defaultValue: "{name}: already added",
              values: { name: file.name },
            })
          );
          return;
        }
        if (!allowedMimeTypeValues.includes(file.type)) {
          errors.push(
            t("leases.documents.upload.errors.unsupportedType", {
              defaultValue: "{name}: unsupported type",
              values: { name: file.name },
            })
          );
          return;
        }
        if (file.size > MAX_FILE_SIZE) {
          errors.push(
            t("leases.documents.upload.errors.exceedsLimit", {
              defaultValue: "{name}: exceeds {maxSize} limit",
              values: {
                name: file.name,
                maxSize: formatFileSize(MAX_FILE_SIZE),
              },
            })
          );
          return;
        }
        validFiles.push(file);
      });

      if (errors.length > 0) {
        toast.error(errors.join("\n"));
      }

      if (validFiles.length > 0) {
        setSelectedFiles((prev) => [...prev, ...validFiles]);
      }
    },
    [selectedFiles.length, selectedFileNames, t]
  );

  const removeFile = useCallback((name: string) => {
    setSelectedFiles((prev) => prev.filter((file) => file.name !== name));
  }, []);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!uploading) {
        setIsDragActive(true);
      }
    },
    [uploading]
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragActive(false);
    },
    []
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragActive(false);
      if (uploading) return;
      handleFilesAdded(event.dataTransfer.files);
    },
    [handleFilesAdded, uploading]
  );

  const submitHandler = form.handleSubmit(async (values) => {
    if (selectedFiles.length === 0) {
      toast.error(
        t("leases.documents.upload.validation.selectAtLeastOneFile", {
          defaultValue: "Select at least one file to upload",
        })
      );
      return;
    }

    const formData = new FormData();
    selectedFiles.forEach((file) => {
      formData.append("files", file);
    });

    formData.append("type", values.type);
    formData.append("category", values.category);

    if (values.description) {
      formData.append("description", values.description);
    }

    if (values.tags) {
      formData.append("tags", values.tags);
    }

    try {
      setUploading(true);
      const response = await fetch("/api/tenant/documents/upload", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ??
            payload?.error ??
            t("ui.images.failed", { defaultValue: "Upload failed" }),
        );
      }

      const normalizedDocuments: TenantDocument[] = (
        payload?.data?.documents ?? []
      ).map(normalizeTenantDocument);

      if (onUploadComplete) {
        await onUploadComplete(normalizedDocuments, {
          uploaded: payload?.data?.uploaded ?? normalizedDocuments.length,
          total: payload?.data?.total ?? selectedFiles.length,
          message: payload?.message,
        });
      } else {
        toast.success(
          payload?.message ??
            t("leases.documents.upload.toasts.uploadSuccess", {
              defaultValue: "Documents uploaded successfully",
            })
        );
      }

      onOpenChange(false);
    } catch (error) {
      console.error("Document upload failed", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("leases.documents.upload.toasts.uploadError", {
              defaultValue: "Failed to upload documents",
            })
      );
    } finally {
      setUploading(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("leases.documents.upload.dialog.title", {
              defaultValue: "Upload Documents",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("leases.documents.upload.dialog.description", {
              defaultValue:
                "Select up to {maxFiles} files. Supported types: PDF, DOC, DOCX, JPG, PNG, TXT.",
              values: { maxFiles: MAX_FILES },
            })}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={submitHandler} className="space-y-6">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("leases.documents.upload.form.type.label", {
                        defaultValue: "Document Type",
                      })}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t(
                              "leases.documents.upload.form.type.placeholder",
                              { defaultValue: "Select type" }
                            )}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {documentTypeOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {t(`leases.documents.types.${option}`, {
                              defaultValue: documentTypeDefaultLabels[option] ?? option,
                            })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("leases.documents.upload.form.category.label", {
                        defaultValue: "Category",
                      })}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t(
                              "leases.documents.upload.form.category.placeholder",
                              { defaultValue: "Select category" }
                            )}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {documentCategoryOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {t(`leases.documents.categories.${option}`, {
                              defaultValue:
                                documentCategoryDefaultLabels[option] ?? option,
                            })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("leases.documents.upload.form.description.label", {
                        defaultValue: "Description (optional)",
                      })}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          "leases.documents.upload.form.description.placeholder",
                          {
                            defaultValue:
                              "Add a short description for these files",
                          }
                        )}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("leases.documents.upload.form.tags.label", {
                        defaultValue: "Tags (optional)",
                      })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t(
                          "leases.documents.upload.form.tags.placeholder",
                          {
                            defaultValue:
                              "Enter comma-separated tags, e.g. lease, renewal",
                          }
                        )}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor="tenant-document-upload">
                {t("leases.documents.upload.form.files.label", {
                  defaultValue: "Files",
                })}
              </Label>
              <div
                className={`rounded-lg border border-dashed p-6 text-center transition-colors ${
                  isDragActive
                    ? "border-primary bg-primary/10"
                    : "border-muted-foreground/40"
                }`}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="flex flex-col items-center gap-2">
                  <UploadIcon className="h-8 w-8 text-muted-foreground" />
                  <div className="text-sm text-muted-foreground">
                    {t("leases.documents.upload.form.dropzone.help", {
                      defaultValue: "Drag and drop files here, or",
                    })}
                  </div>
                  <Button type="button" variant="outline" size="sm">
                    <label
                      htmlFor="tenant-document-upload"
                      className="cursor-pointer"
                    >
                      {t("leases.documents.upload.form.dropzone.browse", {
                        defaultValue: "Browse files",
                      })}
                    </label>
                  </Button>
                  <input
                    id="tenant-document-upload"
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => handleFilesAdded(event.target.files)}
                    accept={allowedMimeTypeValues.join(",")}
                    disabled={uploading}
                  />
                  <div className="text-xs text-muted-foreground">
                    {t("leases.documents.upload.form.dropzone.limits", {
                      defaultValue:
                        "Maximum size {maxSize} per file. Up to {maxFiles} files.",
                      values: {
                        maxSize: formatFileSize(MAX_FILE_SIZE),
                        maxFiles: MAX_FILES,
                      },
                    })}
                  </div>
                </div>
              </div>

              {selectedFiles.length > 0 && (
                <ScrollArea className="max-h-48 rounded-md border p-3">
                  <div className="space-y-2">
                    {selectedFiles.map((file) => (
                      <div
                        key={file.name}
                        className="flex items-start justify-between gap-3 rounded-md bg-muted/60 px-3 py-2"
                      >
                        <div className="flex items-start gap-3 min-w-0 flex-1 overflow-hidden">
                          <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div
                              className="text-sm font-medium break-all line-clamp-2"
                              title={file.name}
                            >
                              {file.name}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {formatFileSize(file.size)}
                            </div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive flex-shrink-0 h-8 w-8"
                          onClick={() => removeFile(file.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">
                            {t("leases.documents.upload.form.removeFile", {
                              defaultValue: "Remove file",
                            })}
                          </span>
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {selectedFiles.length === 0 && (
                <div className="flex flex-wrap gap-2">
                  {allowedMimeTypes.map((item) => (
                    <Badge key={item.value} variant="secondary">
                      {item.label}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={uploading}
              >
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
              <Button type="submit" disabled={uploading}>
                {uploading
                  ? t("leases.documents.upload.buttons.uploading", {
                      defaultValue: "Uploading...",
                    })
                  : t("leases.documents.upload.buttons.upload", {
                      defaultValue: "Upload",
                    })}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
