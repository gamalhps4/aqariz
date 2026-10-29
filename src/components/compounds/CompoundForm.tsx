"use client";

/**
 * PropertyPro - Compound create/edit form
 *
 * The property picker is the important part: membership is edited here as a
 * complete list, and the API treats it that way (attach what is new, detach
 * what dropped off). Detaching only clears a foreign key — the property and
 * everything under it survives untouched.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building, Loader2, MapPin, Save, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { usePropertyCategories } from "@/hooks/use-property-categories";
import type { CompoundDetail } from "@/types/compound";
import { DEFAULT_COUNTRY, HAS_DISTRICT } from "@/lib/regional/region";

const compoundFormSchema = z.object({
  name: z.string().min(1, "Compound name is required").max(200),
  code: z.string().max(40).optional(),
  description: z.string().max(2000).optional(),
  street: z.string().min(1, "Street address is required").max(200),
  city: z.string().min(1, "City is required").max(100),
  // Optional — see the note on `addressSchema` in lib/validations.ts.
  district: z.string().max(100).optional(),
  state: z.string().min(1, "Region/State is required").max(50),
  zipCode: z.string().min(1, "Postal code is required").max(20),
  country: z.string().min(1, "Country is required").max(100),
  totalArea: z.string().optional(),
  yearBuilt: z.string().optional(),
  notes: z.string().max(2000).optional(),
  ownerId: z.string().optional(),
  managerId: z.string().optional(),
});

type CompoundFormValues = z.infer<typeof compoundFormSchema>;

interface SelectableProperty {
  id: string;
  name: string;
  type: string;
  city: string;
  compoundId: string | null;
}

interface SelectableUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

const UNASSIGNED = "__none__";

interface CompoundFormProps {
  compound?: CompoundDetail;
}

export function CompoundForm({ compound }: CompoundFormProps) {
  const router = useRouter();
  const { t } = useLocalizationContext();
  const { labelFor: categoryLabelFor } = usePropertyCategories("property");

  const [properties, setProperties] = useState<SelectableProperty[]>([]);
  const [people, setPeople] = useState<SelectableUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    compound?.properties?.map((property) => property.id) ?? [],
  );
  const [propertySearch, setPropertySearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<CompoundFormValues>({
    resolver: zodResolver(compoundFormSchema),
    defaultValues: {
      name: compound?.name ?? "",
      code: compound?.code ?? "",
      description: compound?.description ?? "",
      street: compound?.address?.street ?? "",
      city: compound?.address?.city ?? "",
      district: compound?.address?.district ?? "",
      state: compound?.address?.state ?? "",
      zipCode: compound?.address?.zipCode ?? "",
      country: compound?.address?.country ?? DEFAULT_COUNTRY,
      totalArea: compound?.totalArea != null ? String(compound.totalArea) : "",
      yearBuilt: compound?.yearBuilt != null ? String(compound.yearBuilt) : "",
      notes: compound?.notes ?? "",
      ownerId: compound?.owner?.id ?? UNASSIGNED,
      managerId: compound?.manager?.id ?? UNASSIGNED,
    },
  });

  // Offer the properties that are unattached plus the ones already in this
  // compound; anything belonging to another compound is left alone.
  const loadProperties = useCallback(async () => {
    try {
      const response = await fetch("/api/properties?limit=100");
      const payload = await response.json();
      if (!payload?.success) return;
      const rows = (payload.data ?? []) as Array<Record<string, any>>;
      setProperties(
        rows.map((row) => ({
          id: row.id ?? row._id,
          name: row.name,
          type: row.type,
          city: row.address?.city ?? "",
          compoundId: row.compoundId ?? null,
        })),
      );
    } catch (loadError) {
      console.error("Failed to load properties:", loadError);
    }
  }, []);

  const loadPeople = useCallback(async () => {
    try {
      const response = await fetch("/api/users?limit=100");
      const payload = await response.json();
      if (!payload?.success) return;
      // /api/users nests its rows under data.users, unlike /api/properties.
      const rows = (payload.data?.users ?? []) as Array<Record<string, any>>;
      setPeople(
        rows.map((row) => ({
          id: row.id ?? row._id,
          firstName: row.firstName ?? "",
          lastName: row.lastName ?? "",
          email: row.email ?? "",
        })),
      );
    } catch (loadError) {
      console.error("Failed to load users:", loadError);
    }
  }, []);

  useEffect(() => {
    loadProperties();
    loadPeople();
  }, [loadProperties, loadPeople]);

  const availableProperties = useMemo(() => {
    const query = propertySearch.trim().toLowerCase();
    return properties
      .filter(
        (property) =>
          !property.compoundId ||
          property.compoundId === compound?.id ||
          selectedIds.includes(property.id),
      )
      .filter(
        (property) =>
          !query ||
          property.name.toLowerCase().includes(query) ||
          property.city.toLowerCase().includes(query),
      );
  }, [properties, propertySearch, compound?.id, selectedIds]);

  const toggleProperty = (id: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((v) => v !== id),
    );
  };

  const onSubmit = async (values: CompoundFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name: values.name,
        code: values.code?.trim() || null,
        description: values.description?.trim() || null,
        address: {
          street: values.street,
          city: values.city,
          district: values.district?.trim() || undefined,
          state: values.state,
          zipCode: values.zipCode,
          country: values.country,
        },
        totalArea: values.totalArea ? Number(values.totalArea) : null,
        yearBuilt: values.yearBuilt ? Number(values.yearBuilt) : null,
        notes: values.notes?.trim() || null,
        ownerId: values.ownerId === UNASSIGNED ? null : values.ownerId,
        managerId: values.managerId === UNASSIGNED ? null : values.managerId,
        propertyIds: selectedIds,
      };

      const response = await fetch(
        compound ? `/api/compounds/${compound.id}` : "/api/compounds",
        {
          method: compound ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const result = await response.json();
      if (!response.ok || !result?.success) {
        setError(
          result?.message ||
            result?.error ||
            t("compounds.form.saveFailed", {
              defaultValue: "Could not save the compound",
            }),
        );
        return;
      }

      const id = compound?.id ?? result.data?.id;
      router.push(id ? `/dashboard/compounds/${id}` : "/dashboard/compounds");
      router.refresh();
    } catch (submitError) {
      console.error("Failed to save compound:", submitError);
      setError(
        t("compounds.form.saveFailed", {
          defaultValue: "Could not save the compound",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building className="h-4 w-4" />
            {t("compounds.form.basics", { defaultValue: "Compound details" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">
              {t("compounds.form.name", { defaultValue: "Compound name" })} *
            </Label>
            <Input id="name" {...form.register("name")} />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">
              {t("compounds.form.code", { defaultValue: "Reference code" })}
            </Label>
            <Input id="code" {...form.register("code")} placeholder="CMP-001" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="yearBuilt">
              {t("compounds.form.yearBuilt", { defaultValue: "Year built" })}
            </Label>
            <Input id="yearBuilt" type="number" {...form.register("yearBuilt")} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="description">
              {t("compounds.form.description", { defaultValue: "Description" })}
            </Label>
            <Textarea id="description" rows={3} {...form.register("description")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" />
            {t("compounds.form.location", { defaultValue: "Location" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="street">
              {t("compounds.form.street", { defaultValue: "Street address" })} *
            </Label>
            <Input id="street" {...form.register("street")} />
            {errors.street && (
              <p className="text-sm text-destructive">{errors.street.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">
              {t("compounds.form.city", { defaultValue: "City" })} *
            </Label>
            <Input id="city" {...form.register("city")} />
            {errors.city && (
              <p className="text-sm text-destructive">{errors.city.message}</p>
            )}
          </div>
          {HAS_DISTRICT && (
            <div className="space-y-2">
              <Label htmlFor="district">
                {t("compounds.form.district", { defaultValue: "District" })}
              </Label>
              <Input id="district" {...form.register("district")} />
              {errors.district && (
                <p className="text-sm text-destructive">
                  {errors.district.message}
                </p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="state">
              {t("compounds.form.state", { defaultValue: "Region / State" })} *
            </Label>
            <Input id="state" {...form.register("state")} />
            {errors.state && (
              <p className="text-sm text-destructive">{errors.state.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="zipCode">
              {t("compounds.form.zipCode", { defaultValue: "Postal code" })} *
            </Label>
            <Input id="zipCode" {...form.register("zipCode")} />
            {errors.zipCode && (
              <p className="text-sm text-destructive">{errors.zipCode.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="country">
              {t("compounds.form.country", { defaultValue: "Country" })} *
            </Label>
            <Input id="country" {...form.register("country")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalArea">
              {t("compounds.form.totalArea", { defaultValue: "Total area (m²)" })}
            </Label>
            <Input id="totalArea" type="number" {...form.register("totalArea")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            {t("compounds.form.people", { defaultValue: "Owner & manager" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("compounds.form.owner", { defaultValue: "Owner" })}</Label>
            <Select
              value={form.watch("ownerId") || UNASSIGNED}
              onValueChange={(value) => form.setValue("ownerId", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>
                  {t("compounds.form.unassigned", { defaultValue: "Unassigned" })}
                </SelectItem>
                {people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.firstName} {person.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              {t("compounds.form.manager", { defaultValue: "Manager" })}
            </Label>
            <Select
              value={form.watch("managerId") || UNASSIGNED}
              onValueChange={(value) => form.setValue("managerId", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>
                  {t("compounds.form.unassigned", { defaultValue: "Unassigned" })}
                </SelectItem>
                {people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.firstName} {person.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Building className="h-4 w-4" />
              {t("compounds.form.properties", {
                defaultValue: "Properties in this compound",
              })}
            </span>
            <Badge variant="outline">{selectedIds.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("compounds.form.propertiesHint", {
              defaultValue:
                "Each property stays independently manageable — its contracts, units, payments and reports are unaffected by joining a compound.",
            })}
          </p>
          <Input
            value={propertySearch}
            onChange={(event) => setPropertySearch(event.target.value)}
            placeholder={t("compounds.form.searchProperties", {
              defaultValue: "Search properties...",
            })}
          />
          <ScrollArea className="h-64 rounded-lg border">
            <div className="divide-y">
              {availableProperties.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  {t("compounds.form.noProperties", {
                    defaultValue: "No unassigned properties available",
                  })}
                </p>
              )}
              {availableProperties.map((property) => (
                <label
                  key={property.id}
                  className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedIds.includes(property.id)}
                    onCheckedChange={(checked) =>
                      toggleProperty(property.id, checked === true)
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {property.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[categoryLabelFor(property.type), property.city]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <Label htmlFor="notes">
            {t("compounds.form.notes", { defaultValue: "Internal notes" })}
          </Label>
          <Textarea id="notes" rows={3} {...form.register("notes")} />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={submitting}
        >
          <X className="h-4 w-4" />
          {t("common.cancel", { defaultValue: "Cancel" })}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {compound
            ? t("common.saveChanges", { defaultValue: "Save changes" })
            : t("compounds.actions.add", { defaultValue: "Add Compound" })}
        </Button>
      </div>
    </form>
  );
}
