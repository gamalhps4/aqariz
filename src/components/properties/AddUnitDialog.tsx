"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
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
import { UnitFormData, optionalAmount } from "@/lib/utils/unit-transformer";
import {
  Building,
  Bed,
  Bath,
  DollarSign,
  Wifi,
  Droplets,
  Zap,
  Flame,
  Wind,
} from "lucide-react";
import { useLocalization } from "@/hooks/use-localization";

interface AddUnitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  onUnitAdded: () => void;
}

export function AddUnitDialog({
  open,
  onOpenChange,
  propertyId,
  onUnitAdded,
}: AddUnitDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t, formatCurrency, formatNumber } = useLocalization();

  const form = useForm<UnitFormData>({
    defaultValues: {
      unitNumber: "",
      unitType: "apartment",
      bedrooms: 1,
      bathrooms: 1,
      squareFootage: 500,
      // No asking price unless one is typed: the rent is set per contract,
      // and a default here used to reach contracts as if it had been agreed.
      rentAmount: undefined,
      securityDeposit: undefined,
      status: "available",
      floor: undefined,

      // Unit features
      balcony: false,
      patio: false,
      garden: false,
      dishwasher: false,
      inUnitLaundry: false,
      hardwoodFloors: false,
      fireplace: false,
      walkInClosets: false,
      centralAir: false,
      ceilingFans: false,

      // Parking
      parkingIncluded: false,
      parkingSpaces: undefined,
      parkingType: undefined,
      parkingGated: false,
      parkingAssigned: false,

      // Utilities
      electricityIncluded: false,
      waterIncluded: false,
      gasIncluded: false,
      internetIncluded: false,
      heatingIncluded: false,
      coolingIncluded: false,

      // Appliances
      refrigerator: false,
      stove: false,
      oven: false,
      microwave: false,
      washer: false,
      dryer: false,

      // Additional fields
      notes: "",
      images: [],
      availableFrom: undefined,
      lastRenovated: undefined,
    },
  });

  const onSubmit = async (data: UnitFormData) => {
    try {
      setIsSubmitting(true);
      await unitService.createUnit(propertyId, data);
      toast.success(t("properties.units.toasts.add.success"));
      form.reset();
      onUnitAdded();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || t("properties.units.toasts.add.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const watchedValues = form.watch();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Building className="h-5 w-5 me-2 text-blue-600" />
            {t("properties.units.form.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("properties.units.form.addDescription")}
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
                    {watchedValues.unitType}
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
                <CardTitle>
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
                          defaultValue={field.value}
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
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value
                                  ? parseInt(e.target.value)
                                  : undefined
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.status")}
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
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

            {/* Unit Details */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {t("properties.units.form.sections.unitDetails")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
                              field.onChange(parseInt(e.target.value) || 0)
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
                              field.onChange(parseFloat(e.target.value) || 0)
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
                              field.onChange(parseInt(e.target.value) || 0)
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
                <CardTitle>
                  {t("properties.units.form.sections.financialInfo")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="rentAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("properties.form.units.fields.rentAmount")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(optionalAmount(e.target.value))
                            }
                          />
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
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(optionalAmount(e.target.value))
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

            {/* Features */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {t("properties.units.form.sections.features")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

            {/* Parking */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {t("properties.units.form.sections.parking")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="parkingIncluded"
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
                      </div>
                    </FormItem>
                  )}
                />

                {watchedValues.parkingIncluded && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="parkingSpaces"
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
                              placeholder="1"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value
                                    ? parseInt(e.target.value)
                                    : undefined
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="parkingType"
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
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Utilities */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {t("properties.units.form.sections.utilities")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="electricityIncluded"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center">
                            <Zap className="h-4 w-4 me-1" />
                            {t("properties.units.utilities.electricity")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="waterIncluded"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center">
                            <Droplets className="h-4 w-4 me-1" />
                            {t("properties.units.utilities.water")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="gasIncluded"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center">
                            <Flame className="h-4 w-4 me-1" />
                            {t("properties.units.utilities.gas")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="internetIncluded"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center">
                            <Wifi className="h-4 w-4 me-1" />
                            {t("properties.units.utilities.internet")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="heatingIncluded"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center">
                            <Flame className="h-4 w-4 me-1" />
                            {t("properties.units.utilities.heating")}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="coolingIncluded"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="flex items-center">
                            <Wind className="h-4 w-4 me-1" />
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
                <CardTitle>
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

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("properties.units.actions.addingUnit")
                  : t("properties.units.actions.addUnit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
