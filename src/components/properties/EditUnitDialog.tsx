"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategorySelectItems } from "@/components/properties/category-select-items";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { unitService } from "@/lib/services/unit.service";
import { optionalAmount } from "@/lib/utils/unit-transformer";
import {
  Building,
  Bed,
  Bath,
  DollarSign,
  Car,
  Zap,
  Droplets,
  Flame,
  Wifi,
  Thermometer,
  Wind,
  Loader2,
} from "lucide-react";
import { useLocalization } from "@/hooks/use-localization";
import type { IEmbeddedUnit as Unit } from "@/types";

// Unit schema for validation
const unitSchema = (t: (key: string, options?: any) => string) =>
  z.object({
    unitNumber: z
      .string()
      .min(1, t("properties.units.validation.unitNumberRequired"))
      .max(20),
    // Unit types are organization-configurable (property_categories); the
    // picker only offers active ones, so shape is all this needs to check.
    unitType: z.string().min(1, t("properties.units.validation.unitTypeRequired")),
    floor: z.number().min(0).max(200).optional(),
    bedrooms: z.number().min(0).max(20),
    bathrooms: z.number().min(0).max(20),
    squareFootage: z.number().min(1).max(50000),
    // Optional: a unit's asking price is a reference, the rent is agreed in
    // each contract. Left empty it is saved as no price (0).
    rentAmount: z.number().min(0).max(100_000_000).optional(),
    securityDeposit: z.number().min(0).max(100_000_000).optional(),
    status: z.enum(["available", "occupied", "maintenance", "unavailable"]),
    balcony: z.boolean().default(false),
    patio: z.boolean().default(false),
    garden: z.boolean().default(false),
    parking: z
      .object({
        included: z.boolean(),
        spaces: z.number().min(0).max(10).optional(),
        type: z.enum(["garage", "covered", "open", "street"]).optional(),
        gated: z.boolean().optional(),
        assigned: z.boolean().optional(),
      })
      .default({ included: false }),
    utilities: z
      .object({
        electricity: z.boolean().default(false),
        water: z.boolean().default(false),
        gas: z.boolean().default(false),
        internet: z.boolean().default(false),
        heating: z.boolean().default(false),
        cooling: z.boolean().default(false),
      })
      .default({}),
    notes: z
      .string()
      .max(1000, t("properties.units.validation.notesTooLong"))
      .optional(),
  });

type UnitFormData = z.infer<ReturnType<typeof unitSchema>>;

interface EditUnitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  unit: Unit | null;
  onUnitUpdated: () => void;
}

export function EditUnitDialog({
  open,
  onOpenChange,
  propertyId,
  unit,
  onUnitUpdated,
}: EditUnitDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t, formatCurrency } = useLocalization();

  const form = useForm({
    resolver: zodResolver(unitSchema(t)),
    defaultValues: {
      unitNumber: "",
      unitType: "apartment",
      bedrooms: 1,
      bathrooms: 1,
      squareFootage: 500,
      rentAmount: undefined,
      securityDeposit: undefined,
      status: "available",
      balcony: false,
      patio: false,
      garden: false,
      parking: { included: false },
      utilities: {
        electricity: false,
        water: false,
        gas: false,
        internet: false,
        heating: false,
        cooling: false,
      },
      notes: "",
    },
  });

  // Populate form when unit changes
  useEffect(() => {
    if (unit && open) {
      const formData = {
        unitNumber: unit.unitNumber || "",
        unitType: unit.unitType || "apartment",
        floor: unit.floor,
        bedrooms: unit.bedrooms || 1,
        bathrooms: unit.bathrooms || 1,
        squareFootage: unit.squareFootage || 500,
        // A unit without a price shows an empty box — never a made-up
        // 1,000 that saving would then write back.
        rentAmount: unit.rentAmount || undefined,
        securityDeposit: unit.securityDeposit || undefined,
        status: (unit.status as any) || "available",
        balcony: unit.balcony || false,
        patio: unit.patio || false,
        garden: unit.garden || false,
        parking: {
          included: unit.parking?.included || false,
          spaces: unit.parking?.spaces,
          type: unit.parking?.type,
          gated: unit.parking?.gated,
          assigned: unit.parking?.assigned,
        },
        utilities: {
          electricity: unit.utilities?.electricity === "included",
          water: unit.utilities?.water === "included",
          gas: unit.utilities?.gas === "included",
          internet: unit.utilities?.internet === "included",
          heating: unit.utilities?.heating === "included",
          cooling: unit.utilities?.cooling === "included",
        },
        notes: unit.notes || "",
      };

      form.reset(formData);
    }
  }, [unit, open, form]);

  // Watch form values for preview
  const watchedValues = form.watch();

  const onSubmit = async (data: UnitFormData) => {
    if (!unit) return;

    try {
      setIsSubmitting(true);

      // Transform data for API
      const unitData = {
        ...data,
        floor: data.floor || undefined,
        parkingIncluded: data.parking.included,
        parkingSpaces: data.parking.spaces || 0,
        parkingType: data.parking.type || "open",
        parkingGated: data.parking.gated || false,
        parkingAssigned: data.parking.assigned || false,
        electricityIncluded: data.utilities.electricity,
        waterIncluded: data.utilities.water,
        gasIncluded: data.utilities.gas,
        internetIncluded: data.utilities.internet,
        heatingIncluded: data.utilities.heating,
        coolingIncluded: data.utilities.cooling,
      };

      if (!unit._id) return;

      await unitService.updateUnit(propertyId, unit._id.toString(), unitData);

      toast.success(t("properties.units.toasts.update.success"));
      onUnitUpdated();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || t("properties.units.toasts.update.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange(false);
    }
  };

  if (!unit) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            {t("properties.units.form.editTitle", {
              values: { unitNumber: unit.unitNumber },
            })}
          </DialogTitle>
          <DialogDescription>
            {t("properties.units.form.editDescription")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Unit Preview Card */}
            <Card className="border-blue-100 bg-blue-50/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span>{t("properties.units.form.preview.title")}</span>
                  <Badge variant="outline" className="capitalize">
                    {watchedValues.unitType
                      ? t(`properties.units.types.${watchedValues.unitType}`)
                      : t("properties.labels.unknown")}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div className="flex flex-col items-center">
                    <Building className="h-5 w-5 text-blue-600 mb-1" />
                    <span className="font-semibold">
                      {watchedValues.unitNumber || "---"}
                    </span>
                    <span className="text-xs text-gray-600">
                      {t("properties.units.form.preview.labels.unitNumber")}
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <Bed className="h-5 w-5 text-green-600 mb-1" />
                    <span className="font-semibold">
                      {watchedValues.bedrooms}
                    </span>
                    <span className="text-xs text-gray-600">
                      {t("properties.units.form.preview.labels.bedrooms")}
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <Bath className="h-5 w-5 text-purple-600 mb-1" />
                    <span className="font-semibold">
                      {watchedValues.bathrooms}
                    </span>
                    <span className="text-xs text-gray-600">
                      {t("properties.units.form.preview.labels.bathrooms")}
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <DollarSign className="h-5 w-5 text-emerald-600 mb-1" />
                    <span className="font-semibold">
                      {watchedValues.rentAmount
                        ? formatCurrency(watchedValues.rentAmount)
                        : "---"}
                    </span>
                    <span className="text-xs text-gray-600">
                      {t("properties.units.form.preview.labels.monthlyRent")}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {t("properties.units.form.sections.basicInfo")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="unitNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.unitNumber")} *
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t(
                              "properties.units.form.fields.unitNumber.placeholder"
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
                    name="unitType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.unitType")} *
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t(
                                  "properties.units.form.fields.unitType.placeholder"
                                )}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <CategorySelectItems
                              kind="unit"
                              includeSlug={field.value}
                            />
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="floor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.floor")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder={t(
                              "properties.form.units.placeholders.floor"
                            )}
                            {...field}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value
                                  ? parseInt(e.target.value)
                                  : undefined
                              )
                            }
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="bedrooms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.bedrooms")} *
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            max="20"
                            {...field}
                            onChange={(e) =>
                              field.onChange(parseInt(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bathrooms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.bathrooms")} *
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            max="20"
                            step="0.5"
                            {...field}
                            onChange={(e) =>
                              field.onChange(parseFloat(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="squareFootage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.squareFootage")} *
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            max="50000"
                            {...field}
                            onChange={(e) =>
                              field.onChange(parseInt(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Financial Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {t("properties.units.form.sections.financialInfo")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="rentAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.rentAmount")}
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <DollarSign className="absolute start-3 top-3 h-4 w-4 text-gray-400" />
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              className="ps-10"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) =>
                                field.onChange(optionalAmount(e.target.value))
                              }
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="securityDeposit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.securityDeposit")}
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <DollarSign className="absolute start-3 top-3 h-4 w-4 text-gray-400" />
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              className="ps-10"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) =>
                                field.onChange(optionalAmount(e.target.value))
                              }
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.status")} *
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t(
                                  "properties.form.fields.status.placeholder"
                                )}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="available">
                              {t("properties.status.available")}
                            </SelectItem>
                            <SelectItem value="occupied">
                              {t("properties.status.occupied")}
                            </SelectItem>
                            <SelectItem value="maintenance">
                              {t("properties.status.maintenance")}
                            </SelectItem>
                            <SelectItem value="unavailable">
                              {t("properties.status.unavailable")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Unit Features */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {t("properties.units.form.sections.features")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="balcony"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>
                            {t("properties.units.features.balcony")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="patio"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>
                            {t("properties.units.features.patio")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="garden"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>
                            {t("properties.units.features.garden")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Parking Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Car className="h-5 w-5" />
                  {t("properties.units.form.sections.parking")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="parking.included"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          {t("properties.units.parking.included")}
                        </FormLabel>
                        <p className="text-sm text-muted-foreground">
                          {t("properties.units.parking.included.helper")}
                        </p>
                      </div>
                    </FormItem>
                  )}
                />

                {watchedValues.parking?.included && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
                    <FormField
                      control={form.control}
                      name="parking.spaces"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("properties.units.parking.spaces")}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="0"
                              max="10"
                              {...field}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value
                                    ? parseInt(e.target.value)
                                    : undefined
                                )
                              }
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="parking.type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("properties.units.parking.type")}
                          </FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t(
                                    "properties.units.parking.type.placeholder"
                                  )}
                                />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="garage">
                                {t("properties.units.parking.type.garage")}
                              </SelectItem>
                              <SelectItem value="covered">
                                {t("properties.units.parking.type.covered")}
                              </SelectItem>
                              <SelectItem value="open">
                                {t("properties.units.parking.type.open")}
                              </SelectItem>
                              <SelectItem value="street">
                                {t("properties.units.parking.type.street")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="parking.gated"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>
                                {t("properties.units.parking.gated")}
                              </FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="parking.assigned"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>
                                {t("properties.units.parking.assigned")}
                              </FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Utilities */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  {t("properties.units.form.sections.utilities")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="utilities.electricity"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center gap-2">
                            <Zap className="h-4 w-4" />
                            {t("properties.units.utilities.electricity")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="utilities.water"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center gap-2">
                            <Droplets className="h-4 w-4" />
                            {t("properties.units.utilities.water")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="utilities.gas"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center gap-2">
                            <Flame className="h-4 w-4" />
                            {t("properties.units.utilities.gas")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="utilities.internet"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center gap-2">
                            <Wifi className="h-4 w-4" />
                            {t("properties.units.utilities.internet")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="utilities.heating"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center gap-2">
                            <Thermometer className="h-4 w-4" />
                            {t("properties.units.utilities.heating")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="utilities.cooling"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center gap-2">
                            <Wind className="h-4 w-4" />
                            {t("properties.units.utilities.cooling")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {t("properties.units.form.sections.notes")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("properties.units.form.fields.notes.label")}
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t(
                            "properties.units.form.fields.notes.placeholder"
                          )}
                          className="min-h-20"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                )}
                {isSubmitting
                  ? t("properties.units.actions.updatingUnit")
                  : t("properties.units.actions.updateUnit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
