/**
 * PropertyPro - Image Upload API
 * Handle image uploads to R2 for properties and other features
 */

import { NextRequest, NextResponse } from "next/server";
import {
  uploadToR2,
  uploadMultipleToR2,
  validateR2Config,
  getR2ConfigStatus,
  type UploadOptions,
} from "@/lib/r2-server";
import { validateImageFile } from "@/lib/r2";
import { withPermissionAndDB } from "@/lib/api-utils";

export const POST = withPermissionAndDB("profile_management", {
  rateLimit: { windowMs: 60 * 1000, maxRequests: 20 },
})(
  async (_user: any, request: NextRequest) => {
    try {
      // Validate R2 configuration first
      if (!validateR2Config()) {
        const configStatus = getR2ConfigStatus();
        return NextResponse.json(
          {
            error: "R2 configuration missing",
            details: [
              "Please check R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_PUBLIC_URL environment variables",
            ],
            configStatus,
          },
          { status: 500 }
        );
      }

      // Parse form data
      const formData = await request.formData();
      const files = formData.getAll("files") as File[];
      const folder =
        (formData.get("folder") as string) || "PropertyPro/properties";
      const quality = (formData.get("quality") as string) || "auto";
      const maxWidth = formData.get("maxWidth") as string;
      const maxHeight = formData.get("maxHeight") as string;
      const crop = (formData.get("crop") as string) || "preserve";

      if (!files || files.length === 0) {
        return NextResponse.json({ error: "No files provided" }, { status: 400 });
      }

      // Validate files
      const validationErrors: string[] = [];
      files.forEach((file, index) => {
        const validation = validateImageFile(file);
        if (!validation.isValid) {
          console.error(`File validation failed for file ${index + 1}:`, {
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            error: validation.error,
          });
          validationErrors.push(`File ${index + 1}: ${validation.error}`);
        }
      });

      if (validationErrors.length > 0) {
        return NextResponse.json(
          { error: "Validation failed", details: validationErrors },
          { status: 400 }
        );
      }

      // Prepare upload options
      const uploadOptions: UploadOptions = {
        folder,
        quality,
      };

      // Add size constraints if provided
      if (maxWidth || maxHeight) {
        uploadOptions.width = maxWidth ? parseInt(maxWidth) : undefined;
        uploadOptions.height = maxHeight ? parseInt(maxHeight) : undefined;
        uploadOptions.crop = crop; // Use the crop mode from form data
      }

      // Upload files
      let results;
      if (files.length === 1) {
        results = [await uploadToR2(files[0], uploadOptions)];
      } else {
        results = await uploadMultipleToR2(files, uploadOptions);
      }

      // Check for upload errors
      const errors = results.filter((result) => !result.success);
      if (errors.length > 0) {
        console.error("Upload errors:", errors);
        return NextResponse.json(
          {
            error: "Some uploads failed",
            details: errors.map((e) => e.error),
            partialResults: results,
          },
          { status: 207 } // Multi-status
        );
      }

      // Return successful results
      const successResults = results.map((result) => ({
        url: result.url,
        objectKey: result.objectKey,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes,
      }));

      const response = NextResponse.json({
        success: true,
        images: successResults,
        count: successResults.length,
      });

      // Add CORS headers for production
      response.headers.set("Access-Control-Allow-Credentials", "true");

      return response;
    } catch (error) {
      console.error("Upload error:", error);
      return NextResponse.json(
        {
          error: "Internal server error",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  }
);

// Handle OPTIONS request for CORS
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin") || "*";

  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Cookie",
      "Access-Control-Allow-Credentials": "true",
    },
  });
}
