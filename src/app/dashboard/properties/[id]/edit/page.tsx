"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import { propertyService } from "@/lib/services/property.service";
import {
  showSimpleError,
  showSimpleSuccess,
  showErrorToast,
  parseValidationErrors,
} from "@/lib/toast-notifications";
import { EnhancedPropertyForm } from "@/components/properties/PropertyForm";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export default function EditPropertyPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useLocalizationContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [propertyData, setPropertyData] = useState<any>(null);

  const propertyId = params.id as string;

  useEffect(() => {
    const fetchProperty = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await propertyService.getProperty(propertyId);
        setPropertyData(data);
      } catch (err: any) {
        setError(err.message || t("properties.edit.loadFailed", { defaultValue: "Could not load the building" }));
        showSimpleError(
          t("properties.edit.loadFailedTitle", { defaultValue: "Could not load" }),
          err.message || t("properties.edit.loadFailed", { defaultValue: "Could not load the building" }),
        );
      } finally {
        setLoading(false);
      }
    };

    if (propertyId) {
      fetchProperty();
    }
  }, [propertyId]);

  const handlePropertySubmit = async (data: any) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/properties/${propertyId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            result.message ||
            t("properties.edit.updateFailed", { defaultValue: "Could not save the building" })
        );
      }

      showSimpleSuccess(
        t("properties.edit.savedTitle", { defaultValue: "Building saved" }),
        t("properties.edit.saved", { defaultValue: "Your changes are saved." }),
      );
      router.push(`/dashboard/properties/${propertyId}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("properties.edit.updateFailed", { defaultValue: "Could not save the building" });
      setError(errorMessage);

      // Parse validation errors for better display
      const parsedErrors = parseValidationErrors(errorMessage);

      if (parsedErrors.length > 1 || parsedErrors.some((e) => e.field)) {
        showErrorToast({
          title: t("properties.edit.updateFailedTitle", { defaultValue: "Could not save" }),
          description: t("properties.edit.validationCount", { defaultValue: "{count} fields need attention", values: { count: parsedErrors.length } }),
          items: parsedErrors,
        });
      } else {
        showSimpleError(t("properties.edit.updateFailedTitle", { defaultValue: "Could not save" }), errorMessage);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t("properties.edit.loadFailed", { defaultValue: "Could not load the building" })}
            </h3>
            <p className="text-gray-600 text-center mb-6">{error}</p>
            <Button onClick={() => router.push("/dashboard/properties")}>
              <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
              {t("properties.edit.backToList", { defaultValue: "Back to buildings" })}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("properties.edit.title", { defaultValue: "Edit building" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("properties.edit.subtitle", { defaultValue: "The building's details and its units" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/dashboard/properties/${propertyId}`)}
          >
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            {t("properties.edit.backToBuilding", { defaultValue: "Back to the building" })}
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-6">
          <EnhancedPropertyForm
            initialData={propertyData}
            onSubmit={handlePropertySubmit}
            isLoading={saving}
            mode="edit"
            propertyId={propertyId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
