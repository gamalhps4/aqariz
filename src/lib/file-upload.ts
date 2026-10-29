/**
 * PropertyPro - File Upload Utilities
 * Handle file uploads, validation, and cloud storage integration
 */

import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// File upload configuration
export const UPLOAD_CONFIG = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: {
    documents: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/csv",
    ],
    images: ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"],
    archives: [
      "application/zip",
      "application/x-rar-compressed",
      "application/x-7z-compressed",
    ],
  },
  uploadDir: process.env.UPLOAD_DIR || "./uploads",
  baseUrl: process.env.APP_URL || "http://localhost:3000",
};

// File type categories
export enum FileCategory {
  DOCUMENT = "document",
  IMAGE = "image",
  ARCHIVE = "archive",
}

// Upload result interface
export interface UploadResult {
  success: boolean;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  error?: string;
}

// File validation interface
export interface FileValidation {
  isValid: boolean;
  error?: string;
  category?: FileCategory;
}

// ============================================================================
// FILE VALIDATION
// ============================================================================

export function validateFile(file: File): FileValidation {
  // Check file size
  if (file.size > UPLOAD_CONFIG.maxFileSize) {
    return {
      isValid: false,
      error: `File size exceeds maximum limit of ${
        UPLOAD_CONFIG.maxFileSize / (1024 * 1024)
      }MB`,
    };
  }

  // Check file type
  const category = getFileCategory(file.type);
  if (!category) {
    return {
      isValid: false,
      error: `File type ${file.type} is not allowed`,
    };
  }

  // Check file name
  if (!file.name || file.name.length > 255) {
    return {
      isValid: false,
      error: "Invalid file name",
    };
  }

  return {
    isValid: true,
    category,
  };
}

export function getFileCategory(mimeType: string): FileCategory | null {
  if (UPLOAD_CONFIG.allowedTypes.documents.includes(mimeType)) {
    return FileCategory.DOCUMENT;
  }
  if (UPLOAD_CONFIG.allowedTypes.images.includes(mimeType)) {
    return FileCategory.IMAGE;
  }
  if (UPLOAD_CONFIG.allowedTypes.archives.includes(mimeType)) {
    return FileCategory.ARCHIVE;
  }
  return null;
}

export function getFileExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

export function sanitizeFileName(fileName: string): string {
  // Remove special characters and spaces
  return fileName
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_{2,}/g, "_")
    .toLowerCase();
}

// ============================================================================
// LOCAL FILE UPLOAD
// ============================================================================

export async function uploadFileLocally(
  file: File,
  category: string
): Promise<UploadResult> {
  try {
    // Validate file
    const validation = validateFile(file);
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // Create upload directory if it doesn't exist
    const uploadPath = path.join(UPLOAD_CONFIG.uploadDir, category);
    if (!existsSync(uploadPath)) {
      await mkdir(uploadPath, { recursive: true });
    }

    // Generate unique filename
    const fileExtension = getFileExtension(file.name);
    const sanitizedName = sanitizeFileName(
      file.name.replace(fileExtension, "")
    );
    const uniqueFileName = `${sanitizedName}_${uuidv4()}${fileExtension}`;
    const filePath = path.join(uploadPath, uniqueFileName);

    // Convert file to buffer and save
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // Generate file URL
    const fileUrl = `${UPLOAD_CONFIG.baseUrl}/uploads/${category}/${uniqueFileName}`;

    return {
      success: true,
      fileUrl,
      fileName: uniqueFileName,
      fileSize: file.size,
      mimeType: file.type,
    };
  } catch (error) {
    console.error("File upload error:", error);
    return {
      success: false,
      error: "Failed to upload file",
    };
  }
}

// ============================================================================
// CLOUD STORAGE INTEGRATION (AWS S3, Google Cloud, etc.)
// ============================================================================

export async function uploadFileToCloud(
  file: File,
  category: string
): Promise<UploadResult> {
  // This is a placeholder for cloud storage integration
  // In a real application, you would integrate with AWS S3, Google Cloud Storage, etc.

  try {
    // Validate file
    const validation = validateFile(file);
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // For now, we'll use local storage
    // In production, replace this with actual cloud storage implementation
    return await uploadFileLocally(file, category);

    // Example AWS S3 integration:
    /*
    const s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION,
    });

    const fileExtension = getFileExtension(file.name);
    const sanitizedName = sanitizeFileName(file.name.replace(fileExtension, ''));
    const uniqueFileName = `${category}/${sanitizedName}_${uuidv4()}${fileExtension}`;

    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: uniqueFileName,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: file.type,
      ACL: 'private', // or 'public-read' depending on requirements
    };

    const result = await s3.upload(uploadParams).promise();

    return {
      success: true,
      fileUrl: result.Location,
      fileName: uniqueFileName,
      fileSize: file.size,
      mimeType: file.type,
    };
    */
  } catch (error) {
    console.error("Cloud upload error:", error);
    return {
      success: false,
      error: "Failed to upload file to cloud storage",
    };
  }
}

// ============================================================================
// PUBLIC UPLOAD ENTRYPOINT
// ============================================================================

export async function uploadFile(
  file: File,
  category: string
): Promise<UploadResult> {
  const provider = process.env.UPLOAD_STORAGE_PROVIDER?.toLowerCase();

  if (provider === "cloud") {
    return uploadFileToCloud(file, category);
  }

  // Default to local uploads when provider is not specified or not supported
  return uploadFileLocally(file, category);
}

// ============================================================================
// FILE DELETION
// ============================================================================

export async function deleteFile(fileUrl: string): Promise<boolean> {
  try {
    // For local files
    if (fileUrl.includes("/uploads/")) {
      const fs = await import("fs/promises");
      const filePath = fileUrl.replace(`${UPLOAD_CONFIG.baseUrl}/uploads/`, "");
      const fullPath = path.join(UPLOAD_CONFIG.uploadDir, filePath);

      if (existsSync(fullPath)) {
        await fs.unlink(fullPath);
        return true;
      }
    }

    // For cloud storage, implement deletion logic here
    // Example for AWS S3:
    /*
    const s3 = new AWS.S3({...});
    const key = extractKeyFromUrl(fileUrl);
    await s3.deleteObject({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: key,
    }).promise();
    */

    return true;
  } catch (error) {
    console.error("File deletion error:", error);
    return false;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.includes("word")) return "📝";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet"))
    return "📊";
  if (mimeType.includes("zip") || mimeType.includes("rar")) return "🗜️";
  return "📎";
}

export function isImageFile(mimeType: string): boolean {
  return UPLOAD_CONFIG.allowedTypes.images.includes(mimeType);
}

export function isPDFFile(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

export function generateThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isImageFile(file.type)) {
      reject(new Error("File is not an image"));
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.onload = () => {
      const maxSize = 200;
      const ratio = Math.min(maxSize / img.width, maxSize / img.height);

      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;

      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}
