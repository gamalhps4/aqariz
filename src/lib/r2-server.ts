/**
 * PropertyPro - Cloudflare R2 Server-Side Utilities
 * Server-side only utilities for R2 integration
 * This file should only be imported in API routes and server-side code
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { getOrgContext, shouldBypassScope } from "./tenancy/context";

/**
 * Namespace an object key under the active organization for tenant isolation.
 */
function withOrgPrefix(key: string): string {
  if (shouldBypassScope()) return key;

  const orgId = getOrgContext()?.organizationId;
  if (!orgId) {
    throw new Error("Organization context is required for R2 access");
  }

  const normalized = key.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.startsWith("org/")) {
    throw new Error("Invalid R2 object key");
  }
  return `org/${orgId}/${normalized}`;
}

function requireOwnedObjectKey(key: string): string {
  if (shouldBypassScope()) return key;

  const orgId = getOrgContext()?.organizationId;
  if (!orgId) {
    throw new Error("Organization context is required for R2 access");
  }

  const expectedPrefix = `org/${orgId}/`;
  if (!key.startsWith(expectedPrefix) || key.includes("..")) {
    throw new Error("R2 object does not belong to the active organization");
  }
  return key;
}

/**
 * Get R2 configuration dynamically
 */
function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl,
  };
}

/**
 * Create R2 client instance
 */
function createR2Client() {
  const config = getR2Config();

  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error("R2 configuration missing");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export interface R2UploadResult {
  success: boolean;
  url?: string;
  objectKey?: string;
  error?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  metadata?: {
    width?: number;
    height?: number;
    format?: string;
    bytes?: number;
  };
  optimizedUrls?: Record<string, string>;
  validation?: {
    warnings?: string[];
  };
}

export interface UploadOptions {
  folder?: string;
  quality?: number | string;
  width?: number;
  height?: number;
  crop?: string;
}

/**
 * Process image with sharp (resize, optimize)
 */
async function processImage(
  buffer: Buffer,
  options: UploadOptions = {}
): Promise<{ buffer: Buffer; metadata: sharp.Metadata }> {
  let image = sharp(buffer);

  // Get original metadata
  const metadata = await image.metadata();

  // Parse quality option - handle both string and number
  let qualityValue = 80; // default
  if (options.quality) {
    if (typeof options.quality === "string") {
      const parsed = parseInt(options.quality);
      qualityValue = isNaN(parsed) ? 80 : parsed;
    } else {
      qualityValue = options.quality;
    }
  }

  // Skip resizing for property images to avoid any black background/padding
  // Only apply resizing for specific cases like avatars where exact dimensions are needed
  if (options.width || options.height) {
    // Skip resizing entirely for "preserve" mode to maintain original dimensions
    if (options.crop === "preserve") {
      // Do nothing - preserve original image dimensions
    } else if (options.crop === "fill" || options.crop === "fit") {
      // Only resize if explicitly requested with "fill" or "fit" crop modes
      const resizeOptions: sharp.ResizeOptions = {
        fit: options.crop === "fill" ? "cover" : "inside",
      };

      if (options.width) resizeOptions.width = options.width;
      if (options.height) resizeOptions.height = options.height;

      image = image.resize(resizeOptions);
    }
    // For any other crop mode, skip resizing entirely
  }

  // Optimize based on format
  if (metadata.format === "jpeg" || metadata.format === "jpg") {
    image = image.jpeg({ quality: qualityValue });
  } else if (metadata.format === "png") {
    image = image.png({ quality: qualityValue });
  } else if (metadata.format === "webp") {
    image = image.webp({ quality: qualityValue });
  }

  const processedBuffer = await image.toBuffer();
  const processedMetadata = await sharp(processedBuffer).metadata();

  return { buffer: processedBuffer, metadata: processedMetadata };
}

/**
 * Upload branding asset to R2
 */
export async function uploadBrandingAsset(
  buffer: Buffer,
  filename: string,
  type: "logo" | "favicon",
  variant?: "light" | "dark"
): Promise<R2UploadResult> {
  try {
    const config = getR2Config();
    if (!config.bucketName || !config.publicUrl) {
      throw new Error(
        "R2 configuration missing. Please check environment variables."
      );
    }

    const client = createR2Client();

    // Process image
    const { buffer: processedBuffer, metadata } = await processImage(buffer, {
      quality: 85,
    });

    // Generate unique filename
    const timestamp = Date.now();
    const variantSuffix = variant ? `_${variant}` : "";
    const extension = metadata.format || filename.split(".").pop() || "png";
    const sanitizedFilename = `${type}${variantSuffix}_${timestamp}.${extension}`;

    // Object key (path in R2), namespaced per organization
    const objectKey = withOrgPrefix(
      `PropertyPro/branding/${type}s/${sanitizedFilename}`,
    );

    // Determine content type from extension
    const contentTypeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      svg: "image/svg+xml",
      ico: "image/x-icon",
    };
    const contentType = contentTypeMap[extension] || "application/octet-stream";

    // Upload to R2
    const upload = new Upload({
      client,
      params: {
        Bucket: config.bucketName,
        Key: objectKey,
        Body: processedBuffer,
        ContentType: contentType,
        Metadata: {
          type,
          variant: variant || "default",
          uploadedAt: new Date().toISOString(),
          originalFilename: filename,
        },
      },
    });

    const result = await upload.done();

    // Generate public URL
    const url = `${config.publicUrl}/${objectKey}`;

    return {
      success: true,
      url,
      objectKey,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      bytes: processedBuffer.length,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        bytes: processedBuffer.length,
      },
      optimizedUrls: {
        original: url,
      },
    };
  } catch (error) {
    throw new Error(
      `R2 upload failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Delete asset from R2
 */
export async function deleteFromR2(objectKey: string): Promise<boolean> {
  try {
    const ownedObjectKey = requireOwnedObjectKey(objectKey);
    const config = getR2Config();
    if (!config.bucketName) {
      return false;
    }

    const client = createR2Client();

    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucketName,
        Key: ownedObjectKey,
      })
    );

    return true;
  } catch (error) {
    // Silently fail - object may not exist
    return false;
  }
}

/**
 * Generate optimized URLs for branding assets
 * Note: R2 doesn't have built-in transformations
 * We return the base URL and rely on pre-processing during upload using sharp
 */
export function generateBrandingUrls(
  objectKey: string,
  type: "logo" | "favicon"
): Record<string, string> {
  const config = getR2Config();
  const ownedObjectKey = requireOwnedObjectKey(objectKey);
  const baseUrl = `${config.publicUrl}/${ownedObjectKey}`;

  // Since R2 doesn't have on-the-fly transformations,
  // we return the same URL for all variants
  // In production, you might want to upload multiple sizes
  if (type === "logo") {
    return {
      standard: baseUrl,
      retina: baseUrl,
      small: baseUrl,
      medium: baseUrl,
      large: baseUrl,
    };
  } else {
    // Favicon URLs
    return {
      standard: baseUrl,
      ico16: baseUrl,
      ico32: baseUrl,
      png192: baseUrl,
    };
  }
}

/**
 * Upload single file to R2
 */
export async function uploadToR2(
  file: File,
  options: UploadOptions = {}
): Promise<R2UploadResult> {
  try {
    const config = getR2Config();
    if (!config.bucketName || !config.publicUrl) {
      return {
        success: false,
        error: "R2 configuration missing. Please check environment variables.",
      };
    }

    const client = createR2Client();

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Process image if it's an image file
    let finalBuffer: Buffer<ArrayBufferLike> = buffer;
    let metadata: sharp.Metadata | undefined;

    if (file.type.startsWith("image/")) {
      const processed = await processImage(buffer, options);
      finalBuffer = processed.buffer;
      metadata = processed.metadata;
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const extension = file.name.split(".").pop() || "bin";
    const filename = `${timestamp}_${randomStr}.${extension}`;

    // Object key (path in R2), namespaced per organization
    const folder = options.folder || "PropertyPro/uploads";
    const objectKey = withOrgPrefix(`${folder}/${filename}`);

    // Upload to R2
    const upload = new Upload({
      client,
      params: {
        Bucket: config.bucketName,
        Key: objectKey,
        Body: finalBuffer,
        ContentType: file.type,
        Metadata: {
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    await upload.done();

    // Generate public URL
    const url = `${config.publicUrl}/${objectKey}`;

    return {
      success: true,
      url,
      objectKey,
      width: metadata?.width,
      height: metadata?.height,
      format: metadata?.format,
      bytes: finalBuffer.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Upload a raw buffer (e.g. a server-rendered PDF) to R2.
 *
 * `key` is the logical path (e.g. "PropertyPro/receipts/RCP-....pdf"); the
 * `org/{orgId}/` tenant prefix is applied automatically, exactly like every
 * other R2 write. Mirrors `uploadToR2`'s graceful failure contract: missing
 * configuration or a failed upload returns `{ success: false }`, never throws.
 */
export async function uploadBufferToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
  metadata: Record<string, string> = {}
): Promise<R2UploadResult> {
  try {
    const config = getR2Config();
    if (!config.bucketName || !config.publicUrl) {
      return {
        success: false,
        error: "R2 configuration missing. Please check environment variables.",
      };
    }

    const client = createR2Client();

    // Object key (path in R2), namespaced per organization
    const objectKey = withOrgPrefix(key);

    const upload = new Upload({
      client,
      params: {
        Bucket: config.bucketName,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
        Metadata: {
          uploadedAt: new Date().toISOString(),
          ...metadata,
        },
      },
    });

    await upload.done();

    return {
      success: true,
      url: `${config.publicUrl}/${objectKey}`,
      objectKey,
      bytes: buffer.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

const DOWNLOAD_PRESIGN_EXPIRES_SECONDS = 5 * 60;

/**
 * Mint a short-lived presigned GET for a stored object so download routes can
 * redirect instead of proxying bytes. The key must belong to the active
 * organization (same `org/{orgId}/` isolation contract as every other read).
 * Never throws: missing configuration or a foreign key returns
 * `{ success: false }`.
 */
export async function createPresignedDownloadUrl(
  objectKey: string,
  options: { expiresIn?: number; fileName?: string } = {}
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const ownedObjectKey = requireOwnedObjectKey(objectKey);

    const config = getR2Config();
    if (
      !config.accountId ||
      !config.accessKeyId ||
      !config.secretAccessKey ||
      !config.bucketName
    ) {
      return { success: false, error: "File storage is not configured" };
    }

    const client = createR2Client();
    const command = new GetObjectCommand({
      Bucket: config.bucketName,
      Key: ownedObjectKey,
      ...(options.fileName
        ? {
            ResponseContentDisposition: `attachment; filename="${options.fileName.replace(/["\\\r\n]/g, "")}"`,
          }
        : {}),
    });

    const url = await getSignedUrl(client, command, {
      expiresIn: options.expiresIn ?? DOWNLOAD_PRESIGN_EXPIRES_SECONDS,
    });

    return { success: true, url };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create download URL",
    };
  }
}

/**
 * Upload multiple files to R2
 */
export async function uploadMultipleToR2(
  files: File[],
  options: UploadOptions = {}
): Promise<R2UploadResult[]> {
  const uploadPromises = files.map((file) => uploadToR2(file, options));
  return Promise.all(uploadPromises);
}

/**
 * Validate R2 configuration
 */
export function validateR2Config(): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const config = getR2Config();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.accountId) {
    errors.push("Missing R2_ACCOUNT_ID environment variable");
  }
  if (!config.accessKeyId) {
    errors.push("Missing R2_ACCESS_KEY_ID environment variable");
  }
  if (!config.secretAccessKey) {
    errors.push("Missing R2_SECRET_ACCESS_KEY environment variable");
  }
  if (!config.bucketName) {
    errors.push("Missing R2_BUCKET_NAME environment variable");
  }
  if (!config.publicUrl) {
    errors.push("Missing R2_PUBLIC_URL environment variable");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get detailed R2 configuration status (for debugging)
 */
export function getR2ConfigStatus() {
  const config = getR2Config();
  return {
    hasAccountId: !!config.accountId,
    hasAccessKeyId: !!config.accessKeyId,
    hasSecretAccessKey: !!config.secretAccessKey,
    hasBucketName: !!config.bucketName,
    hasPublicUrl: !!config.publicUrl,
    accountId: config.accountId
      ? `${config.accountId.substring(0, 3)}***`
      : "missing",
    bucketName: config.bucketName || "missing",
    publicUrl: config.publicUrl || "missing",
    envVars: {
      R2_ACCOUNT_ID: !!process.env.R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID: !!process.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: !!process.env.R2_SECRET_ACCESS_KEY,
      R2_BUCKET_NAME: !!process.env.R2_BUCKET_NAME,
      R2_PUBLIC_URL: !!process.env.R2_PUBLIC_URL,
    },
  };
}

/**
 * Test R2 connection
 */
export async function testR2Connection() {
  try {
    const config = getR2Config();
    const validation = validateR2Config();
    if (!validation.isValid) {
      return {
        success: false,
        error: `R2 configuration missing: ${validation.errors.join(", ")}`,
        configStatus: getR2ConfigStatus(),
      };
    }

    const client = createR2Client();

    // Try to list objects (just to test connection)
    await client.send(
      new HeadObjectCommand({
        Bucket: config.bucketName!,
        Key: "test", // This will fail but confirms connection works
      })
    );

    return {
      success: true,
      configStatus: getR2ConfigStatus(),
    };
  } catch (error: any) {
    // 404 error means connection works but object doesn't exist (which is fine)
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      return {
        success: true,
        configStatus: getR2ConfigStatus(),
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection test failed",
      configStatus: getR2ConfigStatus(),
    };
  }
}

/**
 * Get asset info from R2
 */
export async function getAssetInfo(objectKey: string) {
  try {
    const ownedObjectKey = requireOwnedObjectKey(objectKey);
    const config = getR2Config();
    if (!config.bucketName) {
      return {
        success: false,
        error: "R2 bucket name missing",
      };
    }

    const client = createR2Client();

    const result = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucketName,
        Key: ownedObjectKey,
      })
    );

    return {
      success: true,
      data: {
        objectKey: ownedObjectKey,
        url: `${config.publicUrl}/${ownedObjectKey}`,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
        metadata: result.Metadata,
      },
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get asset info",
    };
  }
}

// ============================================================================
// PRESIGNED UPLOADS (mobile / large files)
// ============================================================================

export interface PresignedUpload {
  /** PUT the file bytes here with the exact Content-Type header. */
  uploadUrl: string;
  /** Store this key on the record referencing the file. */
  objectKey: string;
  /** Public URL the file is served from after upload. */
  publicUrl: string;
  /** Seconds until uploadUrl expires. */
  expiresIn: number;
}

const PRESIGN_EXPIRES_SECONDS = 10 * 60;

function sanitizeKeyFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "file";
  return base
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-120);
}

/**
 * Mint a presigned PUT so clients (the mobile app especially) upload straight
 * to R2 instead of proxying every byte through the Node process. Keys are
 * namespaced under the active organization — the same `org/{orgId}/` prefix
 * every other R2 write uses — so tenant isolation carries into storage.
 */
export async function createPresignedUpload(input: {
  folder: string;
  fileName: string;
  contentType: string;
  contentLength: number;
}): Promise<PresignedUpload> {
  const config = getR2Config();
  if (
    !config.accountId ||
    !config.accessKeyId ||
    !config.secretAccessKey ||
    !config.bucketName ||
    !config.publicUrl
  ) {
    throw Object.assign(new Error("File storage is not configured"), {
      statusCode: 503,
    });
  }

  const orgId = getOrgContext()?.organizationId;
  if (!orgId) {
    throw Object.assign(
      new Error("Organization context is required for uploads"),
      { statusCode: 403 },
    );
  }

  const safeFolder = input.folder.replace(/[^a-z0-9/_-]/gi, "");
  const objectKey = `org/${orgId}/${safeFolder}/${randomUUID()}-${sanitizeKeyFileName(input.fileName)}`;

  const client = createR2Client();
  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: objectKey,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  });

  return {
    uploadUrl,
    objectKey,
    publicUrl: `${config.publicUrl.replace(/\/+$/, "")}/${objectKey}`,
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  };
}
