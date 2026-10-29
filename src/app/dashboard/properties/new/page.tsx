"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { EnhancedPropertyForm } from "@/components/properties/PropertyForm";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  showErrorToast,
  showSimpleError,
  showSimpleSuccess,
  parseValidationErrors,
} from "@/lib/toast-notifications";

export default function EnhancedNewPropertyPage() {
  const router = useRouter();
  const { t } = useLocalizationContext();
  const [isLoading, setIsLoading] = useState(false);

  const handlePropertySubmit = async (data: any) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/properties", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        // Extract detailed error information from various possible response formats
        const errorDetails = result.details || result.error || result.message;
        const errorMessage =
          typeof errorDetails === "string"
            ? errorDetails
            : Array.isArray(errorDetails)
            ? errorDetails.join(", ")
            : JSON.stringify(errorDetails);

        throw new Error(errorMessage || "Failed to create property");
      }

      // The API returns data in result.data
      const property = result.data;
      showSimpleSuccess(
        t("properties.newProperty.success.title"),
        t("properties.newProperty.success.description", {
          values: { name: data.name },
        })
      );

      // Redirect to property details page
      router.push(`/dashboard/properties/${property._id}`);
    } catch (error) {
      console.error("Property creation error:", error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : t("properties.newProperty.error.fallbackMessage");

      // Parse validation errors for better display
      const parsedErrors = parseValidationErrors(errorMessage);

      // If we have multiple errors or errors with field info, show detailed toast
      if (parsedErrors.length > 1 || parsedErrors.some((e) => e.field)) {
        showErrorToast({
          title: t("properties.newProperty.error.title"),
          description: `${parsedErrors.length} validation ${
            parsedErrors.length === 1 ? "error" : "errors"
          } found`,
          items: parsedErrors,
        });
      } else {
        // For single simple errors, show a simple error toast
        showSimpleError(
          t("properties.newProperty.error.title"),
          errorMessage
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("properties.newProperty.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("properties.newProperty.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 border rounded-lg">
          <Link href="/dashboard/properties">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
              {t("properties.newProperty.backToList")}
            </Button>
          </Link>
        </div>
      </div>
      <EnhancedPropertyForm
        onSubmit={handlePropertySubmit}
        isLoading={isLoading}
        mode="create"
      />
    </div>
  );
}
