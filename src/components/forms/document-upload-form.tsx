"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { useState, useCallback } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  FileText,
  Upload,
  X,
  File,
  Image,
  Archive,
} from "lucide-react";
import { DocumentType } from "@/types";

// Form validation schema
const documentUploadFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title too long"),
  description: z.string().max(500, "Description too long").optional(),
  type: z.nativeEnum(DocumentType),
  category: z.string().min(1, "Category is required"),
  propertyId: z.string().optional(),
  tenantId: z.string().optional(),
  isShared: z.boolean().default(false),
  isPublic: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
  notes: z.string().max(1000, "Notes too long").optional(),
});

// Input (pre-parse: `.default()` fields optional) vs output (post-parse) types
// diverge, so useForm needs both to satisfy zodResolver's Resolver typing.
type DocumentUploadFormInput = z.input<typeof documentUploadFormSchema>;
type DocumentUploadFormData = z.output<typeof documentUploadFormSchema>;

interface DocumentUploadFormProps {
  onSubmit: (data: DocumentUploadFormData, files: File[]) => void;
  isLoading?: boolean;
  properties?: Array<{ id: string; name: string; address: string }>;
  tenants?: Array<{
    id: string;
    name: string;
    email: string;
    propertyName?: string;
  }>;
}

const documentCategories = [
  "Legal",
  "Maintenance",
  "Applications",
  "Marketing",
  "Financial",
  "Insurance",
  "Inspection",
  "Contracts",
  "Permits",
  "General",
];

export function DocumentUploadForm({
  onSubmit,
  isLoading = false,
  properties = [],
  tenants = [],
}: DocumentUploadFormProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const form = useForm<
    DocumentUploadFormInput,
    unknown,
    DocumentUploadFormData
  >({
    resolver: zodResolver(documentUploadFormSchema),
    defaultValues: {
      title: "",
      description: "",
      type: DocumentType.OTHER,
      category: "",
      propertyId: "",
      tenantId: "",
      isShared: false,
      isPublic: false,
      tags: [],
      notes: "",
    },
  });

  const watchedType = form.watch("type");

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return Image;
    if (file.type === "application/pdf") return FileText;
    if (file.type.includes("zip") || file.type.includes("rar")) return Archive;
    return File;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const validateFile = (file: File) => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/csv",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/zip",
      "application/x-rar-compressed",
    ];

    if (file.size > maxSize) {
      return { isValid: false, error: "File size exceeds 10MB limit" };
    }

    if (!allowedTypes.includes(file.type)) {
      return { isValid: false, error: "File type not supported" };
    }

    return { isValid: true };
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;

    const newFiles: File[] = [];
    const errors: string[] = [];

    Array.from(files).forEach((file) => {
      const validation = validateFile(file);
      if (validation.isValid) {
        newFiles.push(file);
      } else {
        errors.push(`${file.name}: ${validation.error}`);
      }
    });

    if (errors.length > 0) {
      alert("Some files were not added:\n" + errors.join("\n"));
    }

    setSelectedFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files);
    }
  }, []);

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      const newTags = [...tags, tagInput.trim()];
      setTags(newTags);
      form.setValue("tags", newTags);
      setTagInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    const newTags = tags.filter((tag) => tag !== tagToRemove);
    setTags(newTags);
    form.setValue("tags", newTags);
  };

  const handleFormSubmit = (data: DocumentUploadFormData) => {
    if (selectedFiles.length === 0) {
      alert("Please select at least one file to upload");
      return;
    }

    onSubmit(data, selectedFiles);
  };

  const getTypeDescription = (type: DocumentType) => {
    switch (type) {
      case DocumentType.LEASE:
        return "Lease agreements and rental contracts";
      case DocumentType.APPLICATION:
        return "Tenant applications and supporting documents";
      case DocumentType.INSPECTION:
        return "Property inspection reports and checklists";
      case DocumentType.MAINTENANCE:
        return "Maintenance records and work orders";
      case DocumentType.FINANCIAL:
        return "Financial statements and payment records";
      case DocumentType.PHOTO:
        return "Property photos and visual documentation";
      case DocumentType.OTHER:
        return "Other documents and files";
      default:
        return "";
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold">Upload Documents</h1>
        <p className="text-muted-foreground mt-2">
          Upload and organize property-related documents
        </p>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleFormSubmit)}
          className="space-y-6"
        >
          {/* File Upload Area */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Select Files
              </CardTitle>
              <CardDescription>
                Upload documents (PDF, Word, Excel, Images, Archives) up to 10MB
                each
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-gray-300 hover:border-gray-400"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-lg font-medium mb-2">
                  Drop files here or click to browse
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  Supports PDF, Word, Excel, Images, and Archives
                </p>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp,.zip,.rar"
                  onChange={(e) => handleFileSelect(e.target.files)}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload">
                  <Button type="button" variant="outline" asChild>
                    <span>Browse Files</span>
                  </Button>
                </label>
              </div>

              {/* Selected Files */}
              {selectedFiles.length > 0 && (
                <div className="mt-6">
                  <h4 className="font-medium mb-3">
                    Selected Files ({selectedFiles.length})
                  </h4>
                  <div className="space-y-2">
                    {selectedFiles.map((file, index) => {
                      const FileIcon = getFileIcon(file);
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          <div className="flex items-center space-x-3">
                            <FileIcon className="h-8 w-8 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{file.name}</div>
                              <div className="text-sm text-muted-foreground">
                                {formatFileSize(file.size)} • {file.type}
                              </div>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Document Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Document Details
              </CardTitle>
              <CardDescription>
                Provide information about the documents
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Document title" {...field} />
                    </FormControl>
                    <FormDescription>
                      A descriptive title for the document(s)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Document Type</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select document type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={DocumentType.LEASE}>
                            Lease Agreement
                          </SelectItem>
                          <SelectItem value={DocumentType.APPLICATION}>
                            Application
                          </SelectItem>
                          <SelectItem value={DocumentType.INSPECTION}>
                            Inspection Report
                          </SelectItem>
                          <SelectItem value={DocumentType.MAINTENANCE}>
                            Maintenance Record
                          </SelectItem>
                          <SelectItem value={DocumentType.FINANCIAL}>
                            Financial Document
                          </SelectItem>
                          <SelectItem value={DocumentType.PHOTO}>
                            Photo/Image
                          </SelectItem>
                          <SelectItem value={DocumentType.OTHER}>
                            Other
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {getTypeDescription(watchedType)}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {documentCategories.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional details about the document..."
                        className="resize-none"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Submit Button */}
          <div className="flex justify-end space-x-4">
            <Button type="button" variant="outline">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || selectedFiles.length === 0}
            >
              {isLoading
                ? "Uploading..."
                : `Upload ${selectedFiles.length} Document${
                    selectedFiles.length !== 1 ? "s" : ""
                  }`}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
