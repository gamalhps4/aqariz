/**
 * PropertyPro - R2 Client-Side Utilities
 * Client-side utilities for R2 integration (validation, URL generation, etc.)
 * Server-side upload functionality is in separate server utilities
 */

// Client-side interfaces and types
export interface R2UploadResult {
  success: boolean;
  url?: string;
  objectKey?: string;
  error?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}

/**
 * Check if a URL is an R2 URL
 */
export function isR2Url(url: string): boolean {
  const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "";
  return url.includes(r2PublicUrl) || url.includes("r2.cloudflarestorage.com");
}

/**
 * Extract object key from R2 URL
 */
export function extractObjectKey(url: string): string | null {
  try {
    const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "";

    if (!url.includes(r2PublicUrl)) {
      return null;
    }

    // Extract the path after the public URL
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Remove leading slash
    return pathname.startsWith("/") ? pathname.substring(1) : pathname;
  } catch (error) {
    console.error("Error extracting object key:", error);
    return null;
  }
}

/**
 * Generate R2 URL from object key
 */
export function buildR2Url(objectKey: string): string {
  const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "";
  return `${r2PublicUrl}/${objectKey}`;
}

/**
 * Validate image file
 */
export function validateImageFile(file: File): {
  isValid: boolean;
  error?: string;
} {
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = [
    "image/jpeg",
    "image/avif",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
  ];

  const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];

  // Get file extension
  const fileName = file.name.toLowerCase();
  const hasValidExtension = allowedExtensions.some((ext) =>
    fileName.endsWith(ext)
  );

  // Check MIME type first, fallback to extension if MIME type is missing or generic
  const hasValidMimeType = allowedTypes.includes(file.type);
  const isGenericMimeType =
    file.type === "" || file.type === "application/octet-stream" || !file.type;

  if (!hasValidMimeType && !hasValidExtension) {
    return {
      isValid: false,
      error:
        "Invalid file type. Please upload JPEG, JPG, PNG, WebP, AVIF, or GIF images.",
    };
  }

  // If MIME type is generic but extension is valid, allow it
  if (isGenericMimeType && !hasValidExtension) {
    return {
      isValid: false,
      error:
        "Invalid file type. Please upload JPEG, JPG, PNG, WebP, AVIF, or GIF images.",
    };
  }

  if (file.size > maxSize) {
    return {
      isValid: false,
      error: "File size too large. Please upload images smaller than 10MB.",
    };
  }

  return { isValid: true };
}

// ============================================================================
// BRANDING-SPECIFIC UTILITIES
// ============================================================================

export interface BrandingValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export const BRANDING_VALIDATION = {
  logo: {
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedFormats: ["png", "jpg", "jpeg", "svg", "webp"],
    allowedMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/svg+xml",
      "image/webp",
    ],
    minDimensions: { width: 100, height: 30 },
    maxDimensions: { width: 2000, height: 600 },
    recommendedDimensions: { width: 400, height: 120 },
  },
  favicon: {
    maxFileSize: 1 * 1024 * 1024, // 1MB
    allowedFormats: ["png", "ico", "svg", "jpg", "jpeg", "webp"],
    allowedMimeTypes: [
      "image/png",
      "image/x-icon",
      "image/vnd.microsoft.icon",
      "image/svg+xml",
      "image/jpeg",
      "image/jpg",
      "image/webp",
    ],
    minDimensions: { width: 16, height: 16 },
    maxDimensions: { width: 512, height: 512 },
    recommendedDimensions: { width: 32, height: 32 },
  },
};

/**
 * Validate branding image file
 */
export function validateBrandingFile(
  file: File,
  type: "logo" | "favicon"
): BrandingValidationResult {
  const result: BrandingValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  const validation = BRANDING_VALIDATION[type];

  // Check file size
  if (file.size > validation.maxFileSize) {
    result.errors.push(
      `File size (${(file.size / 1024 / 1024).toFixed(
        2
      )}MB) exceeds maximum allowed size (${
        validation.maxFileSize / 1024 / 1024
      }MB)`
    );
    result.isValid = false;
  }

  // Check file format or MIME type (allow if either check passes to avoid false negatives)
  const fileExtension = file.name.split(".").pop()?.toLowerCase();
  const extAllowed =
    !!fileExtension && validation.allowedFormats.includes(fileExtension);
  const mimeAllowed =
    !!file.type && validation.allowedMimeTypes.includes(file.type);

  if (!extAllowed && !mimeAllowed) {
    result.errors.push(
      `Unsupported file. Formats: ${validation.allowedFormats.join(
        ", "
      )}. Types: ${validation.allowedMimeTypes.join(", ")}`
    );
    result.isValid = false;
  }

  return result;
}

/**
 * Validate image dimensions for branding
 */
export function validateBrandingDimensions(
  width: number,
  height: number,
  type: "logo" | "favicon"
): BrandingValidationResult {
  const result: BrandingValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  const validation = BRANDING_VALIDATION[type];

  // Check minimum dimensions
  if (
    width < validation.minDimensions.width ||
    height < validation.minDimensions.height
  ) {
    result.errors.push(
      `Image dimensions (${width}x${height}) are below minimum required (${validation.minDimensions.width}x${validation.minDimensions.height})`
    );
    result.isValid = false;
  }

  // Check maximum dimensions
  if (
    width > validation.maxDimensions.width ||
    height > validation.maxDimensions.height
  ) {
    result.errors.push(
      `Image dimensions (${width}x${height}) exceed maximum allowed (${validation.maxDimensions.width}x${validation.maxDimensions.height})`
    );
    result.isValid = false;
  }

  // Check recommended dimensions (warning only)
  if (
    width !== validation.recommendedDimensions.width ||
    height !== validation.recommendedDimensions.height
  ) {
    result.warnings.push(
      `Recommended dimensions are ${validation.recommendedDimensions.width}x${validation.recommendedDimensions.height} for optimal display`
    );
  }

  return result;
}

/**
 * Get file dimensions from image file
 */
export function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

/**
 * Validate branding file with dimensions
 */
export async function validateBrandingFileWithDimensions(
  file: File,
  type: "logo" | "favicon"
): Promise<BrandingValidationResult> {
  const fileValidation = validateBrandingFile(file, type);

  if (!fileValidation.isValid) {
    return fileValidation;
  }

  try {
    const { width, height } = await getImageDimensions(file);
    const dimensionValidation = validateBrandingDimensions(width, height, type);

    return {
      isValid: fileValidation.isValid && dimensionValidation.isValid,
      errors: [...fileValidation.errors, ...dimensionValidation.errors],
      warnings: [...fileValidation.warnings, ...dimensionValidation.warnings],
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [...fileValidation.errors, "Failed to validate image dimensions"],
      warnings: fileValidation.warnings,
    };
  }
}
