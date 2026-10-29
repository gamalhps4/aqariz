"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategorySelectItems } from "@/components/properties/category-select-items";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { PropertyStatus } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { optionalAmount } from "@/lib/utils/unit-transformer";

// Unit form schema
const unitEditSchema = z.object({
  unitNumber: z.string().min(1, "Unit number is required").max(20),
  // Unit types are organization-configurable (property_categories).
  unitType: z.string().min(1, "Unit type is required"),
  floor: z.number().min(0).max(200).optional(),
  bedrooms: z.number().min(0).max(20),
  bathrooms: z.number().min(0).max(20),
  squareFootage: z.number().min(1).max(50000),
  // Optional: the rent is agreed in each contract; empty saves no price (0).
  rentAmount: z.number().min(0).max(100_000_000).optional(),
  securityDeposit: z.number().min(0).max(100_000_000).optional(),
  status: z.nativeEnum(PropertyStatus),
  balcony: z.boolean().optional(),
  patio: z.boolean().optional(),
  garden: z.boolean().optional(),
  fireplace: z.boolean().optional(),
  walkInCloset: z.boolean().optional(),
  notes: z.string().optional(),
});

type UnitEditFormData = z.infer<typeof unitEditSchema>;

interface UnitEditPageProps {
  // A promise in this version of Next.js: read synchronously it was
  // undefined, so this page fetched /api/properties/undefined and sent every
  // visitor straight back to the property.
  params: Promise<{
    id: string;
    unitId: string;
  }>;
}

export default function UnitEditPage({ params: paramsPromise }: UnitEditPageProps) {
  const params = use(paramsPromise);
  const router = useRouter();
  const { t } = useLocalizationContext();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [unit, setUnit] = useState<any>(null);
  const [property, setProperty] = useState<any>(null);

  const form = useForm<UnitEditFormData>({
    resolver: zodResolver(unitEditSchema),
    defaultValues: {
      unitNumber: "",
      unitType: "apartment",
      bedrooms: 1,
      bathrooms: 1,
      squareFootage: 500,
      rentAmount: undefined,
      securityDeposit: undefined,
      status: PropertyStatus.AVAILABLE,
      balcony: false,
      patio: false,
      garden: false,
      fireplace: false,
      walkInCloset: false,
      notes: "",
    },
  });

  // Load unit and property data
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);

        // Load property data
        const propertyResponse = await fetch(`/api/properties/${params.id}`);
        if (!propertyResponse.ok) {
          throw new Error("Failed to load property");
        }
        const propertyData = await propertyResponse.json();
        setProperty(propertyData.data);

        // Load unit data
        const unitResponse = await fetch(
          `/api/properties/${params.id}/units/${params.unitId}`
        );
        if (!unitResponse.ok) {
          throw new Error("Failed to load unit");
        }
        const unitData = await unitResponse.json();
        setUnit(unitData.data);

        // Set form values
        form.reset({
          unitNumber: unitData.data.unitNumber,
          unitType: unitData.data.unitType,
          floor: unitData.data.floor,
          bedrooms: unitData.data.bedrooms,
          bathrooms: unitData.data.bathrooms,
          squareFootage: unitData.data.squareFootage,
          rentAmount: unitData.data.rentAmount || undefined,
          securityDeposit: unitData.data.securityDeposit || undefined,
          status: unitData.data.status,
          balcony: unitData.data.balcony || false,
          patio: unitData.data.patio || false,
          garden: unitData.data.garden || false,
          fireplace: unitData.data.fireplace || false,
          walkInCloset: unitData.data.walkInCloset || false,
          notes: unitData.data.notes || "",
        });
      } catch (error: any) {
        toast.error(
          error.message ||
            t("properties.unitEdit.toasts.loadFailed", { defaultValue: "Could not load the unit" }),
        );
        router.push(`/dashboard/properties/${params.id}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [params.id, params.unitId, form, router, t]);

  const onSubmit = async (data: UnitEditFormData) => {
    try {
      setIsSaving(true);

      const response = await fetch(
        `/api/properties/${params.id}/units/${params.unitId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          // An emptied price is sent as 0: the API only writes the fields it
          // receives, so leaving it out would keep the old price.
          body: JSON.stringify({
            ...data,
            rentAmount: data.rentAmount ?? 0,
            securityDeposit: data.securityDeposit ?? 0,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ||
            t("properties.unitEdit.toasts.saveFailed", { defaultValue: "Could not save the unit" }),
        );
      }

      toast.success(t("properties.unitEdit.toasts.saved", { defaultValue: "Unit saved" }));
      router.push(`/dashboard/properties/${params.id}?tab=units`);
    } catch (error: any) {
      toast.error(
        error.message ||
          t("properties.unitEdit.toasts.saveFailed", { defaultValue: "Could not save the unit" }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            router.push(`/dashboard/properties/${params.id}?tab=units`)
          }
        >
          <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
          {t("properties.unitDetails.actions.viewProperty", { defaultValue: "View Property" })}
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("properties.unitEdit.title", { defaultValue: "Edit unit {unitNumber}", values: { unitNumber: unit?.unitNumber ?? "" } })}
          </h1>
          <p className="text-sm text-muted-foreground">{property?.name}</p>
        </div>
      </div>

      {/* Edit Form */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>
                {t("properties.unitDetails.sections.basicInformation", { defaultValue: "Basic Information" })}
              </CardTitle>
              <CardDescription>
                {t("properties.unitEdit.basicDescription", { defaultValue: "Number, type, floor and status" })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="unitNumber">
                    {t("properties.unitDetails.fields.unitNumber", { defaultValue: "Unit Number" })} *
                  </Label>
                  <Input
                    id="unitNumber"
                    {...form.register("unitNumber")}
                    placeholder={t("properties.units.form.fields.unitNumber.placeholder", { defaultValue: "e.g., 101, A1, Unit 5" })}
                  />
                  {form.formState.errors.unitNumber && (
                    <p className="text-sm text-red-600">
                      {form.formState.errors.unitNumber.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unitType">
                    {t("properties.unitDetails.stats.unitType", { defaultValue: "Unit Type" })} *
                  </Label>
                  <Select
                    value={form.watch("unitType")}
                    onValueChange={(value) =>
                      form.setValue("unitType", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <CategorySelectItems
                        kind="unit"
                        includeSlug={form.watch("unitType")}
                      />
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="floor">
                  {t("properties.unitDetails.fields.floor", { defaultValue: "Floor" })}
                </Label>
                <Input
                  id="floor"
                  type="number"
                  min="0"
                  max="200"
                  {...form.register("floor", { valueAsNumber: true })}
                  placeholder="1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">
                  {t("properties.unitDetails.fields.status", { defaultValue: "Status" })} *
                </Label>
                <Select
                  value={form.watch("status")}
                  onValueChange={(value) =>
                    form.setValue("status", value as PropertyStatus)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(PropertyStatus).map((status) => (
                      <SelectItem key={status} value={status}>
                        {t(`properties.status.${status}`, {
                          defaultValue:
                            status.charAt(0).toUpperCase() + status.slice(1),
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Unit Details */}
          <Card>
            <CardHeader>
              <CardTitle>
                {t("properties.unitEdit.detailsTitle", { defaultValue: "Size and layout" })}
              </CardTitle>
              <CardDescription>
                {t("properties.unitEdit.detailsDescription", { defaultValue: "Rooms, bathrooms and area" })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bedrooms">
                    {t("properties.unitDetails.fields.bedrooms", { defaultValue: "Bedrooms" })} *
                  </Label>
                  <Input
                    id="bedrooms"
                    type="number"
                    min="0"
                    max="20"
                    {...form.register("bedrooms", { valueAsNumber: true })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bathrooms">
                    {t("properties.unitDetails.fields.bathrooms", { defaultValue: "Bathrooms" })} *
                  </Label>
                  <Input
                    id="bathrooms"
                    type="number"
                    min="0"
                    max="20"
                    step="0.5"
                    {...form.register("bathrooms", { valueAsNumber: true })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="squareFootage">
                  {t("properties.unitDetails.stats.squareFootage", { defaultValue: "Square Footage" })} *
                </Label>
                <Input
                  id="squareFootage"
                  type="number"
                  min="1"
                  max="50000"
                  {...form.register("squareFootage", { valueAsNumber: true })}
                />
                {form.formState.errors.squareFootage && (
                  <p className="text-sm text-red-600">
                    {form.formState.errors.squareFootage.message}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Financial Information */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t("properties.unitEdit.financialTitle", { defaultValue: "Rent and deposit" })}
            </CardTitle>
            <CardDescription>
              {t("properties.unitEdit.financialDescription", { defaultValue: "The asking rent and the deposit a new tenant pays" })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rentAmount">
                  {t("properties.unitDetails.stats.monthlyRent", { defaultValue: "Monthly Rent" })}
                </Label>
                <Input
                  id="rentAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  {...form.register("rentAmount", { setValueAs: optionalAmount })}
                />
                {form.formState.errors.rentAmount && (
                  <p className="text-sm text-red-600">
                    {form.formState.errors.rentAmount.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="securityDeposit">
                  {t("properties.unitDetails.stats.securityDeposit", { defaultValue: "Security Deposit" })}
                </Label>
                <Input
                  id="securityDeposit"
                  type="number"
                  min="0"
                  step="0.01"
                  {...form.register("securityDeposit", { setValueAs: optionalAmount })}
                />
                {form.formState.errors.securityDeposit && (
                  <p className="text-sm text-red-600">
                    {form.formState.errors.securityDeposit.message}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Unit Features */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t("properties.unitDetails.sections.unitFeatures", { defaultValue: "Unit Features" })}
            </CardTitle>
            <CardDescription>
              {t("properties.unitEdit.featuresDescription", { defaultValue: "What this unit has" })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="balcony"
                  checked={form.watch("balcony")}
                  onCheckedChange={(checked) =>
                    form.setValue("balcony", checked as boolean)
                  }
                />
                <Label htmlFor="balcony">
                  {t("properties.unitDetails.features.balcony", { defaultValue: "Balcony" })}
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="patio"
                  checked={form.watch("patio")}
                  onCheckedChange={(checked) =>
                    form.setValue("patio", checked as boolean)
                  }
                />
                <Label htmlFor="patio">
                  {t("properties.unitDetails.features.patio", { defaultValue: "Patio" })}
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="garden"
                  checked={form.watch("garden")}
                  onCheckedChange={(checked) =>
                    form.setValue("garden", checked as boolean)
                  }
                />
                <Label htmlFor="garden">
                  {t("properties.unitDetails.features.garden", { defaultValue: "Garden" })}
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="fireplace"
                  checked={form.watch("fireplace")}
                  onCheckedChange={(checked) =>
                    form.setValue("fireplace", checked as boolean)
                  }
                />
                <Label htmlFor="fireplace">
                  {t("properties.unitEdit.features.fireplace", { defaultValue: "Fireplace" })}
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="walkInCloset"
                  checked={form.watch("walkInCloset")}
                  onCheckedChange={(checked) =>
                    form.setValue("walkInCloset", checked as boolean)
                  }
                />
                <Label htmlFor="walkInCloset">
                  {t("properties.unitEdit.features.walkInCloset", { defaultValue: "Walk-in closet" })}
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t("properties.unitDetails.sections.notes", { defaultValue: "Notes" })}
            </CardTitle>
            <CardDescription>
              {t("properties.unitEdit.notesDescription", { defaultValue: "Anything worth knowing about this unit" })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              {...form.register("notes")}
              placeholder={t("properties.unitEdit.notesPlaceholder", { defaultValue: "Notes about this unit…" })}
              rows={4}
            />
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              router.push(`/dashboard/properties/${params.id}?tab=units`)
            }
            disabled={isSaving}
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
                {t("properties.unitEdit.saving", { defaultValue: "Saving…" })}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 me-2" />
                {t("properties.unitEdit.save", { defaultValue: "Save changes" })}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
