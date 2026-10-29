"use client";

import { z } from "zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategorySelectItems } from "@/components/properties/category-select-items";
import { OwnerSelect } from "@/components/properties/OwnerSelect";
import { DEFAULT_COUNTRY, HAS_DISTRICT } from "@/lib/regional/region";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Building2,
  Home,
  MapPin,
  Star,
  Plus,
  X,
  ImageIcon,
  Save,
  Loader2,
} from "lucide-react";
import { PropertyStatus } from "@/types";
import { ImageUpload, type UploadedImage } from "@/components/ui/image-upload";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { optionalAmount } from "@/lib/utils/unit-transformer";

// Enhanced form schema
const enhancedPropertySchema = (
  t: (key: string, options?: any) => string,
  /**
   * Ownership is asked for once, when the building is created. Editing it
   * afterwards is an admin-only, audited action on the building's own page —
   * see `propertyUpdateSchema`, which omits `ownerId` on purpose — so this
   * field is required on the way in and absent on the way back through.
   */
  mode: "create" | "edit" = "create",
) =>
  z.object({
    // Basic Information
    name: z
      .string()
      .min(1, t("properties.form.validation.nameRequired"))
      .max(200),
    description: z.string().max(2000).optional(),
    // Categories come from the organization's catalogue (property_categories),
    // so the picker decides what is valid, not a compile-time enum.
    type: z.string().min(1, t("properties.form.validation.typeRequired")),
    status: z.nativeEnum(PropertyStatus),
    /** Optional parent compound; "" means standalone. */
    compoundId: z.string().optional(),
    /**
     * Who owns the building. Required on create and deliberately not
     * defaulted: the API used to fall back to whoever was signed in, which
     * made every building an office created look like the office's own.
     */
    ownerId:
      mode === "create"
        ? z.string().min(1, t("properties.form.validation.ownerRequired", {
            defaultValue: "Select who owns this property",
          }))
        : z.string().optional(),

    // Address
    address: z.object({
      street: z
        .string()
        .min(1, t("properties.form.validation.streetRequired"))
        .max(200),
      city: z
        .string()
        .min(1, t("properties.form.validation.cityRequired"))
        .max(100),
      // Optional: the office can fill a حي in later, and blocking a save over
      // it would stop work for a field no other market even has.
      district: z.string().max(100).optional(),
      state: z
        .string()
        .min(1, t("properties.form.validation.stateRequired"))
        .max(50),
      zipCode: z
        .string()
        .min(1, t("properties.form.validation.zipRequired"))
        .max(20, t("properties.form.validation.zipTooLong")),
      country: z.string().optional().default(DEFAULT_COUNTRY),
    }),

    // Property-level details removed - units are now required to be configured explicitly

    // Property Type Configuration (auto-calculated based on units)
    // isMultiUnit and totalUnits will be calculated automatically
    // Unit details are now managed through the inline unit management component
    // Optional: left blank it is null, which also clears a year already
    // saved on an edit.
    yearBuilt: z
      .number()
      .min(1800, t("properties.form.validation.yearBuiltMin"))
      .max(
        new Date().getFullYear() + 5,
        t("properties.form.validation.yearBuiltMax")
      )
      .nullable()
      .optional(),

    // Note: Property features have been consolidated into amenities

    // Property Amenities
    amenities: z
      .array(
        z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          category: z.string(),
        })
      )
      .default([]),

    // Images and Attachments
    images: z.array(z.string()).default([]),
    attachments: z
      .array(
        z.object({
          fileName: z.string(),
          fileUrl: z.string(),
          fileSize: z.number(),
          fileType: z.string(),
        })
      )
      .default([]),
  });

type EnhancedPropertyFormData = z.infer<
  ReturnType<typeof enhancedPropertySchema>
>;

// Extended initial data type to include units
interface ExtendedPropertyFormData
  extends Omit<Partial<EnhancedPropertyFormData>, "compoundId" | "ownerId"> {
  /** The API sends null for a standalone property; the form uses a sentinel. */
  compoundId?: string | null;
  /**
   * The legacy response shape populates `ownerId` into the owner record, so
   * the edit page hands this component an object where the form wants an id.
   * Declared honestly and narrowed in `ownerIdOf` rather than typed as a
   * string and quietly holding an object — which fails validation on save,
   * with nothing on screen to say why.
   */
  ownerId?: string | { _id?: string; id?: string } | null;
  units?: Array<{
    _id?: string;
    id?: string;
    unitNumber?: string;
    unitType?: string;
    floor?: number;
    bedrooms?: number;
    bathrooms?: number;
    squareFootage?: number;
    rentAmount?: number;
    securityDeposit?: number;
    status?: PropertyStatus;
    images?: string[];
  }>;
}

interface EnhancedPropertyFormProps {
  initialData?: ExtendedPropertyFormData;
  onSubmit: (data: any) => Promise<void>;
  isLoading?: boolean;
  mode?: "create" | "edit";
  propertyId?: string; // For edit mode to enable unit CRUD operations
}

/**
 * Radix `<Select>` rejects an empty string as an item value, so "no compound"
 * needs a sentinel; it is mapped back to null on submit.
 */
const STANDALONE = "__standalone__";

/** The owner's user id, whether the caller passed an id or a populated row. */
function ownerIdOf(owner: ExtendedPropertyFormData["ownerId"]): string {
  if (!owner) return "";
  if (typeof owner === "string") return owner;
  return owner._id ?? owner.id ?? "";
}

interface CompoundOption {
  id: string;
  name: string;
  city: string;
}

// Essential amenities and features (curated list of most common items)
const ESSENTIAL_AMENITIES_AND_FEATURES = [
  "Parking",
  "In-Unit Laundry",
  "Central AC",
  "Central Heating",
  "Internet",
  "Furnished",
  "Hardwood Floors",
  "Dishwasher",
  "Balcony/Patio",
  "Walk-in Closets",
  "Pets Allowed",
  "Pool",
  "Fitness Center",
  "Elevator",
  "Storage",
  "Fireplace",
];

// Map amenity names to translation keys
const getAmenityTranslationKey = (amenityName: string): string => {
  const keyMap: Record<string, string> = {
    Parking: "parking",
    "In-Unit Laundry": "laundry",
    "Central AC": "airConditioning",
    "Central Heating": "heating",
    Internet: "wifi",
    Furnished: "furnished",
    "Hardwood Floors": "hardwoodFloors",
    Dishwasher: "dishwasher",
    "Balcony/Patio": "balcony",
    "Walk-in Closets": "walkInClosets",
    "Pets Allowed": "petFriendly",
    Pool: "pool",
    "Fitness Center": "fitnessCenter",
    Elevator: "elevator",
    Storage: "storage",
    Fireplace: "fireplace",
  };

  return keyMap[amenityName] || amenityName.toLowerCase().replace(/\s+/g, "");
};

// Function to map amenity names to appropriate categories
const getAmenityCategory = (amenityName: string): string => {
  const name = amenityName.toLowerCase();

  // Kitchen amenities
  if (
    name.includes("dishwasher") ||
    name.includes("kitchen") ||
    name.includes("granite") ||
    name.includes("stainless") ||
    name.includes("microwave") ||
    name.includes("refrigerator")
  ) {
    return "Kitchen";
  }

  // Bathroom amenities
  if (
    name.includes("bathroom") ||
    name.includes("jacuzzi") ||
    name.includes("tub")
  ) {
    return "Bathroom";
  }

  // Living amenities
  if (
    name.includes("hardwood") ||
    name.includes("fireplace") ||
    name.includes("furnished") ||
    name.includes("living") ||
    name.includes("carpet")
  ) {
    return "Living";
  }

  // Bedroom amenities
  if (
    name.includes("walk-in") ||
    name.includes("closet") ||
    name.includes("bedroom")
  ) {
    return "Bedroom";
  }

  // Outdoor amenities
  if (
    name.includes("balcony") ||
    name.includes("patio") ||
    name.includes("garden") ||
    name.includes("pool") ||
    name.includes("outdoor") ||
    name.includes("deck")
  ) {
    return "Outdoor";
  }

  // Parking amenities
  if (
    name.includes("parking") ||
    name.includes("garage") ||
    name.includes("carport")
  ) {
    return "Parking";
  }

  // Security amenities
  if (
    name.includes("security") ||
    name.includes("doorman") ||
    name.includes("concierge") ||
    name.includes("alarm") ||
    name.includes("camera")
  ) {
    return "Security";
  }

  // Utilities amenities
  if (
    name.includes("internet") ||
    name.includes("wifi") ||
    name.includes("cable") ||
    name.includes("utilities") ||
    name.includes("electric")
  ) {
    return "Utilities";
  }

  // Recreation amenities
  if (
    name.includes("fitness") ||
    name.includes("gym") ||
    name.includes("tennis") ||
    name.includes("basketball") ||
    name.includes("playground") ||
    name.includes("clubhouse")
  ) {
    return "Recreation";
  }

  // Laundry amenities
  if (
    name.includes("laundry") ||
    name.includes("washer") ||
    name.includes("dryer")
  ) {
    return "Laundry";
  }

  // Climate amenities
  if (
    name.includes("ac") ||
    name.includes("air") ||
    name.includes("heating") ||
    name.includes("hvac") ||
    name.includes("central")
  ) {
    return "Climate";
  }

  // Default to Other
  return "Other";
};

export function EnhancedPropertyForm({
  initialData,
  onSubmit,
  isLoading = false,
  mode = "create",
  propertyId,
}: EnhancedPropertyFormProps) {
  // Alert dialog state
  const [showAlert, setShowAlert] = useState(false);

  // Manage amenities state (features are now consolidated into amenities)
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>(() => {
    const amenities =
      initialData?.amenities?.map((a) =>
        typeof a === "string" ? a : a.name
      ) || [];
    return amenities;
  });
  const [customAmenity, setCustomAmenity] = useState("");

  // Image upload state
  const [propertyImages, setPropertyImages] = useState<UploadedImage[]>(() => {
    return (initialData?.images || []).map((url, index) => ({
      url,
      publicId: `existing-${index}`,
    }));
  });

  // Units state for both create and edit mode
  const [units, setUnits] = useState<
    Array<{
      id: string;
      unitNumber: string;
      unitType: string;
      floor?: number;
      bedrooms: number;
      bathrooms: number;
      squareFootage: number;
      /** Optional asking price; each contract sets the rent. */
      rentAmount?: number;
      securityDeposit?: number;
      status: PropertyStatus;
      images: UploadedImage[];
    }>
  >(() => {
    // Initialize with units from initialData if in edit mode
    if (mode === "edit" && initialData?.units) {
      const mappedUnits = initialData.units.map((unit: any, index: number) => ({
        id: unit._id || unit.id || `unit-${index}`,
        unitNumber: unit.unitNumber || `Unit ${index + 1}`,
        unitType: unit.unitType || "apartment",
        // A unit with no floor (added in bulk or by import) stays without
        // one, and a recorded 0 stays 0: `|| 1` and `|| 500` used to write
        // invented bedrooms and area back on the next save.
        floor: unit.floor ?? undefined,
        bedrooms: unit.bedrooms ?? 0,
        bathrooms: unit.bathrooms ?? 0,
        squareFootage: unit.squareFootage ?? 0,
        rentAmount: unit.rentAmount || undefined,
        securityDeposit: unit.securityDeposit || undefined,
        status: unit.status || PropertyStatus.AVAILABLE,
        images: (unit.images || []).map((url: string, imgIndex: number) => ({
          url,
          publicId: `existing-unit-${index}-${imgIndex}`,
        })),
      }));
      return mappedUnits;
    }
    // In create mode, initialize with one default unit
    return [
      {
        id: `unit-${Date.now()}`,
        unitNumber: "Unit 1",
        unitType: "apartment" as const,
        floor: 1,
        bedrooms: 1,
        bathrooms: 1,
        squareFootage: 500,
        rentAmount: undefined,
        securityDeposit: undefined,
        status: PropertyStatus.AVAILABLE,
        images: [],
      },
    ];
  });

  const { t } = useLocalizationContext();

  const form = useForm({
    resolver: zodResolver(enhancedPropertySchema(t, mode)),
    mode: "onChange", // Enable real-time validation
    defaultValues: {
      name: initialData?.name || "",
      description: initialData?.description || "",
      type: initialData?.type || "apartment",
      status: initialData?.status || PropertyStatus.AVAILABLE,
      compoundId: initialData?.compoundId || STANDALONE,
      // No fallback to the signed-in user: an unanswered question must stay
      // unanswered until someone answers it.
      ownerId: ownerIdOf(initialData?.ownerId),
      address: {
        street: initialData?.address?.street || "",
        city: initialData?.address?.city || "",
        district: initialData?.address?.district || "",
        state: initialData?.address?.state || "",
        zipCode: initialData?.address?.zipCode || "",
        country: initialData?.address?.country || DEFAULT_COUNTRY,
      },
      yearBuilt: initialData?.yearBuilt,
      amenities: initialData?.amenities || [],
      images: initialData?.images || [],
      attachments: initialData?.attachments || [],
    },
  });

  const { watch, setValue } = form;
  const watchedValues = watch();

  // Compounds are optional grouping, so a failed load must not block the form.
  const [compounds, setCompounds] = useState<CompoundOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/compounds?limit=100")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.success) return;
        setCompounds(
          (payload.data ?? []).map((row: any) => ({
            id: row.id,
            name: row.name,
            city: row.address?.city ?? "",
          })),
        );
      })
      .catch(() => setCompounds([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Note: Unit management is now handled separately

  // Handle amenity selection
  const handleAmenityToggle = (item: string) => {
    const newItems = selectedAmenities.includes(item)
      ? selectedAmenities.filter((i) => i !== item)
      : [...selectedAmenities, item];

    setSelectedAmenities(newItems);

    // Update amenities in the form
    const amenityObjects = newItems.map((name) => ({
      name,
      category: getAmenityCategory(name),
    }));
    setValue("amenities", amenityObjects);
  };

  const handleAddCustomAmenity = () => {
    if (
      customAmenity.trim() &&
      !selectedAmenities.includes(customAmenity.trim())
    ) {
      const newItems = [...selectedAmenities, customAmenity.trim()];
      setSelectedAmenities(newItems);

      const amenityObjects = newItems.map((name) => ({
        name,
        category: getAmenityCategory(name),
      }));
      setValue("amenities", amenityObjects);
      setCustomAmenity("");
    }
  };

  const handleRemoveAmenity = (item: string) => {
    const newItems = selectedAmenities.filter((i) => i !== item);
    setSelectedAmenities(newItems);

    const amenityObjects = newItems.map((name) => ({
      name,
      category: getAmenityCategory(name),
    }));
    setValue("amenities", amenityObjects);
  };

  // Image upload handlers
  const handleImagesUploaded = (newImages: UploadedImage[]) => {
    const updatedImages = [...propertyImages, ...newImages];
    setPropertyImages(updatedImages);
    setValue(
      "images",
      updatedImages.map((img) => img.url)
    );
  };

  // DISABLED: Delete functionality temporarily disabled
  const handleImageRemove = (imageToRemove: UploadedImage) => {
    const updatedImages = propertyImages.filter(
      (img) => img.publicId !== imageToRemove.publicId
    );
    setPropertyImages(updatedImages);
    setValue(
      "images",
      updatedImages.map((img) => img.url)
    );
  };

  const handleFormSubmit = async (data: EnhancedPropertyFormData) => {
    try {
      // Check if there are any units configured
      if (units.length === 0) {
        // Show a user-friendly error message using AlertDialog
        setShowAlert(true);
        return; // Don't proceed with submission
      }

      // Automatically determine if this is a multi-unit property based on units
      const isMultiUnit = units.length > 1;
      const totalUnits = Math.max(units.length, 1);

      // Transform units data for API submission (remove id field and convert images to URLs)
      const apiUnits = units.map(({ id: _id, images, ...unit }) => ({
        ...unit,
        // An empty price is sent as 0 (no price): the API only writes the
        // fields it receives, so leaving it out would keep an old price.
        rentAmount: unit.rentAmount ?? 0,
        securityDeposit: unit.securityDeposit ?? 0,
        images: images.map((img) => img.url), // Convert UploadedImage[] to string[]
      }));

      // Include units data and auto-calculated multi-unit status
      // For unified architecture, always include units array
      const submissionData = {
        ...data,
        // The sentinel exists only because Radix forbids an empty item value;
        // the API expects null for a standalone property.
        compoundId:
          !data.compoundId || data.compoundId === STANDALONE
            ? null
            : data.compoundId,
        isMultiUnit,
        totalUnits,
        units: apiUnits, // Always include units array for unified architecture
      };

      // The update endpoint rejects ownership changes by design, so the edit
      // form does not offer to make one and does not send a stale value.
      if (mode !== "create") {
        delete (submissionData as { ownerId?: unknown }).ownerId;
      }

      await onSubmit(submissionData);
    } catch (error) {
      throw error; // Re-throw to show user the error
    }
  };

  return (
    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
      {/* General Information - Modern Design */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-gray-50/50 dark:from-gray-900 dark:to-gray-800/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-xl font-semibold">
            <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-900/30">
              <Building2 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            {t("properties.form.general.title")}
          </CardTitle>
          <CardDescription className="text-base text-gray-600 dark:text-gray-300">
            {t("properties.form.general.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                {t("properties.form.fields.name.label")}
              </Label>
              <Input
                id="name"
                placeholder={t("properties.form.fields.name.placeholder")}
                {...form.register("name")}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">
                {t("properties.form.fields.type.label")}
              </Label>
              <Select
                value={watchedValues.type}
                onValueChange={(value) => setValue("type", value)}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("properties.form.fields.type.placeholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <CategorySelectItems
                    kind="property"
                    includeSlug={watchedValues.type}
                  />
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">
                {t("properties.form.fields.status.label")}
              </Label>
              <Select
                value={watchedValues.status}
                onValueChange={(value) =>
                  setValue("status", value as PropertyStatus)
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("properties.form.fields.status.placeholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(PropertyStatus).map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.status && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.status.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="compoundId">
                {t("properties.form.fields.compound.label", {
                  defaultValue: "Compound",
                })}
              </Label>
              <Select
                value={watchedValues.compoundId || STANDALONE}
                onValueChange={(value) => setValue("compoundId", value)}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("properties.form.fields.compound.placeholder", {
                      defaultValue: "Not part of a compound",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STANDALONE}>
                    {t("properties.form.fields.compound.none", {
                      defaultValue: "Not part of a compound",
                    })}
                  </SelectItem>
                  {compounds.map((compound) => (
                    <SelectItem key={compound.id} value={compound.id}>
                      {compound.city
                        ? `${compound.name} — ${compound.city}`
                        : compound.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("properties.form.fields.compound.hint", {
                  defaultValue:
                    "Grouping only — this property keeps its own contracts, units, payments and reports.",
                })}
              </p>
            </div>

            {/* Ownership. Only on create: changing it later is an audited,
                admin-only action on the building's own page, because who owns
                a building drives statements, agreements and payouts. */}
            {mode === "create" && (
              <div className="space-y-2">
                <Label htmlFor="ownerId">
                  {t("properties.form.fields.owner.label", {
                    defaultValue: "Owner",
                  })}
                  <span className="ms-1 text-red-600">*</span>
                </Label>
                <OwnerSelect
                  value={watchedValues.ownerId || ""}
                  onChange={(userId) =>
                    setValue("ownerId", userId, { shouldValidate: true })
                  }
                />
                {form.formState.errors.ownerId && (
                  <p className="text-sm text-red-600">
                    {form.formState.errors.ownerId.message}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="yearBuilt">
                {t("properties.form.fields.yearBuilt.label")}
              </Label>
              {/* setValueAs alone: with valueAsNumber beside it, React Hook
                  Form ignores setValueAs and a blank field became NaN, which
                  the schema refused — the "optional" year could not be left
                  empty. */}
              <Input
                className="w-full"
                id="yearBuilt"
                type="number"
                min="1800"
                max={new Date().getFullYear() + 5}
                placeholder={t("properties.form.fields.yearBuilt.placeholder")}
                {...form.register("yearBuilt", {
                  setValueAs: (value) =>
                    value === "" || value === null || value === undefined
                      ? null
                      : Number(value),
                })}
              />
              {form.formState.errors.yearBuilt && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.yearBuilt.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              {t("properties.form.fields.description.label")}
            </Label>
            <Textarea
              id="description"
              placeholder={t("properties.form.fields.description.placeholder")}
              rows={3}
              {...form.register("description")}
            />
          </div>

          {/* Address */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <Label className="text-base font-medium">
                {t("properties.form.address.title")}
              </Label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="street">
                  {t("properties.form.fields.street.label")}
                </Label>
                <Input
                  id="street"
                  placeholder={t("properties.form.fields.street.placeholder")}
                  {...form.register("address.street")}
                />
                {form.formState.errors.address?.street && (
                  <p className="text-sm text-red-600">
                    {form.formState.errors.address.street.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="city">
                  {t("properties.form.fields.city.label")}
                </Label>
                <Input
                  id="city"
                  placeholder={t("properties.form.fields.city.placeholder")}
                  {...form.register("address.city")}
                />
                {form.formState.errors.address?.city && (
                  <p className="text-sm text-red-600">
                    {form.formState.errors.address.city.message}
                  </p>
                )}
              </div>

              {HAS_DISTRICT && (
                <div className="space-y-2">
                  <Label htmlFor="district">
                    {t("properties.form.fields.district.label")}
                  </Label>
                  <Input
                    id="district"
                    placeholder={t(
                      "properties.form.fields.district.placeholder"
                    )}
                    {...form.register("address.district")}
                  />
                  {form.formState.errors.address?.district && (
                    <p className="text-sm text-red-600">
                      {form.formState.errors.address.district.message}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="state">
                  {t("properties.form.fields.state.label")}
                </Label>
                <Input
                  id="state"
                  placeholder={t("properties.form.fields.state.placeholder")}
                  {...form.register("address.state")}
                />
                {form.formState.errors.address?.state && (
                  <p className="text-sm text-red-600">
                    {form.formState.errors.address.state.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="zipCode">
                  {t("properties.form.fields.zipCode.label")}
                </Label>
                <Input
                  id="zipCode"
                  placeholder={t("properties.form.fields.zipCode.placeholder")}
                  {...form.register("address.zipCode")}
                />
                {form.formState.errors.address?.zipCode && (
                  <p className="text-sm text-red-600">
                    {form.formState.errors.address.zipCode.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">
                  {t("properties.form.fields.country.label")}
                </Label>
                <Input id="country" {...form.register("address.country")} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Property Units - Unified Design */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-gray-50/50 dark:from-gray-900 dark:to-gray-800/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-xl font-semibold">
            <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/30">
              <Home className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            {t("properties.form.units.title")}
          </CardTitle>
          <CardDescription className="text-base text-gray-600 dark:text-gray-300">
            {t("properties.form.units.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Smart Unit Management Info */}
          <div className="text-sm text-gray-600 bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
            <p className="font-medium text-blue-800 dark:text-blue-300 mb-1">
              {t("properties.form.units.smartTitle", { defaultValue: "One unit or many" })}
            </p>
            <p>
              {t("properties.form.units.smartBody", { defaultValue: "The building is set up as single- or multi-unit from the number of units you add. Start with one and add more with the button below." })}
            </p>
          </div>
          {units.map((unit, index) => (
            <Card key={unit.id} className="p-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">
                    {t("properties.form.units.unitTitle", {
                      values: { index: index + 1 },
                    })}
                  </h3>
                  {units.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setUnits(units.filter((_, i) => i !== index));
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>
                      {t("properties.form.units.fields.unitNumber")}
                    </Label>
                    <Input
                      value={unit.unitNumber}
                      onChange={(e) => {
                        const newUnits = [...units];
                        newUnits[index].unitNumber = e.target.value;
                        setUnits(newUnits);
                      }}
                      placeholder={t("properties.form.units.numberPlaceholder", { defaultValue: "e.g. 101" })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("properties.form.units.fields.unitType")}</Label>
                    <Select
                      value={unit.unitType}
                      onValueChange={(value: any) => {
                        const newUnits = [...units];
                        newUnits[index].unitType = value;
                        setUnits(newUnits);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <CategorySelectItems
                          kind="unit"
                          includeSlug={unit.unitType}
                        />
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("properties.form.units.fields.floor")}</Label>
                    <Input
                      type="number"
                      value={unit.floor || ""}
                      onChange={(e) => {
                        const newUnits = [...units];
                        newUnits[index].floor =
                          parseInt(e.target.value) || undefined;
                        setUnits(newUnits);
                      }}
                      placeholder={t(
                        "properties.form.units.placeholders.floor"
                      )}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("properties.form.units.fields.bedrooms")}</Label>
                    <Input
                      type="number"
                      value={unit.bedrooms}
                      onChange={(e) => {
                        const newUnits = [...units];
                        newUnits[index].bedrooms =
                          parseInt(e.target.value) || 0;
                        setUnits(newUnits);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("properties.form.units.fields.bathrooms")}</Label>
                    <Input
                      type="number"
                      value={unit.bathrooms}
                      onChange={(e) => {
                        const newUnits = [...units];
                        newUnits[index].bathrooms =
                          parseInt(e.target.value) || 0;
                        setUnits(newUnits);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>
                      {t("properties.form.units.fields.squareFootage")}
                    </Label>
                    <Input
                      type="number"
                      value={unit.squareFootage}
                      onChange={(e) => {
                        const newUnits = [...units];
                        newUnits[index].squareFootage =
                          parseInt(e.target.value) || 0;
                        setUnits(newUnits);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>
                      {t("properties.form.units.fields.rentAmount")}
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={unit.rentAmount ?? ""}
                      onChange={(e) => {
                        const newUnits = [...units];
                        newUnits[index].rentAmount = optionalAmount(
                          e.target.value,
                        );
                        setUnits(newUnits);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>
                      {t("properties.form.units.fields.securityDeposit")}
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={unit.securityDeposit ?? ""}
                      onChange={(e) => {
                        const newUnits = [...units];
                        newUnits[index].securityDeposit = optionalAmount(
                          e.target.value,
                        );
                        setUnits(newUnits);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("properties.form.units.fields.status")}</Label>
                    <Select
                      value={unit.status}
                      onValueChange={(value: PropertyStatus) => {
                        const newUnits = [...units];
                        newUnits[index].status = value;
                        setUnits(newUnits);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.values(PropertyStatus).map((status) => (
                          <SelectItem key={status} value={status}>
                            {t(`properties.status.${status}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Unit Images */}
                <div className="space-y-2 pt-3 border-t">
                  <Label className="flex items-center gap-2 text-sm">
                    <ImageIcon className="h-4 w-4" />
                    {t("properties.form.units.fields.images")}
                  </Label>
                  <ImageUpload
                    onImagesUploaded={(newImages) => {
                      const newUnits = [...units];
                      newUnits[index].images = [
                        ...newUnits[index].images,
                        ...newImages,
                      ];
                      setUnits(newUnits);
                    }}
                    onImagesRemoved={(imagesToRemove) => {
                      const newUnits = [...units];
                      newUnits[index].images = newUnits[index].images.filter(
                        (img) =>
                          !imagesToRemove.some(
                            (remove) => remove.publicId === img.publicId
                          )
                      );
                      setUnits(newUnits);
                    }}
                    existingImages={unit.images}
                    maxFiles={15}
                    folder="PropertyPro/units"
                    quality="auto"
                    disabled={isLoading}
                    className="w-full"
                    compact
                    label={t("properties.form.units.uploadImages")}
                  />
                  {unit.images.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("ui.images.doneBody", {
                        defaultValue: "{count} pictures uploaded",
                        values: { count: unit.images.length },
                      })}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const newUnit = {
                id: `unit-${Date.now()}`,
                unitNumber: `Unit ${units.length + 1}`,
                unitType: "apartment" as const,
                bedrooms: 1,
                bathrooms: 1,
                squareFootage: 500,
                rentAmount: undefined,
                securityDeposit: undefined,
                status: PropertyStatus.AVAILABLE,
                images: [],
              };
              setUnits([...units, newUnit]);
            }}
            className="w-full"
          >
            <Plus className="h-4 w-4 me-2" />
            {t("properties.form.units.add", { defaultValue: "Add unit" })}
          </Button>
        </CardContent>
      </Card>

      {/* Note: Unit information is now handled by IntegratedUnitManagement component above */}

      {/* Amenities & Features - Modern Bento Box Design */}
      <Card className="border-0 shadow-lg bg-linear-to-br from-white to-gray-50/50 dark:from-gray-900 dark:to-gray-800/50">
        <CardHeader className="pb-6">
          <CardTitle className="flex items-center gap-3 text-xl font-semibold">
            <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/30">
              <Star className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            {t("properties.form.amenities.title")}
          </CardTitle>
          <CardDescription className="text-base text-gray-600 dark:text-gray-300">
            {t("properties.form.amenities.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Essential Amenities Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {ESSENTIAL_AMENITIES_AND_FEATURES.map((item) => {
              const translationKey = getAmenityTranslationKey(item);
              const labelKey = `properties.amenities.items.${translationKey}`;
              return (
                <div
                  key={item}
                  className={`group relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-md ${
                    selectedAmenities.includes(item)
                      ? "border-blue-500 bg-blue-50 text-blue-700 shadow-blue-100 dark:bg-blue-950/30 dark:border-blue-400 dark:text-blue-300"
                      : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:border-blue-600 dark:hover:bg-blue-950/20"
                  }`}
                  onClick={() => handleAmenityToggle(item)}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={selectedAmenities.includes(item)}
                      onChange={() => {}} // Handled by parent click
                      className={`pointer-events-none transition-colors ${
                        selectedAmenities.includes(item)
                          ? "data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                          : ""
                      }`}
                    />
                    <span className="flex-1 font-medium text-sm leading-tight">
                      {t(labelKey)}
                    </span>
                  </div>
                  {/* Selection indicator */}
                  {selectedAmenities.includes(item) && (
                    <div className="absolute top-2 end-2 w-2 h-2 bg-blue-500 rounded-full"></div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Custom Amenity Input - Modern Design */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 block">
              {t("properties.form.amenities.custom.label")}
            </Label>
            <div className="flex gap-3">
              <Input
                placeholder={t("properties.form.amenities.custom.placeholder")}
                value={customAmenity}
                onChange={(e) => setCustomAmenity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomAmenity();
                  }
                }}
                className="flex-1 border-gray-300 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:focus:border-blue-400"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAddCustomAmenity}
                disabled={!customAmenity.trim()}
                className="px-4 border-blue-300 text-blue-600 hover:bg-blue-50 hover:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/20"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Selected Items Display - Enhanced */}
          {selectedAmenities.length > 0 && (
            <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
              <Label className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-4 block">
                {t("properties.form.amenities.selected.label", {
                  values: { count: selectedAmenities.length },
                })}
              </Label>
              <div className="flex flex-wrap gap-2">
                {selectedAmenities.map((item) => (
                  <Badge
                    key={item}
                    variant="secondary"
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 border border-blue-300 text-blue-700 hover:bg-blue-200 transition-colors dark:bg-blue-900/50 dark:border-blue-700 dark:text-blue-300"
                  >
                    <span className="font-medium">{item}</span>
                    <button
                      type="button"
                      className="ms-1 p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRemoveAmenity(item);
                      }}
                      aria-label={t(
                        "properties.form.amenities.selected.remove",
                        {
                          values: { name: item },
                        }
                      )}
                    >
                      <X className="h-3.5 w-3.5 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-100" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Property Images - Modern Design */}
      <Card className="border-0 shadow-lg bg-linear-to-br from-white to-gray-50/50 dark:from-gray-900 dark:to-gray-800/50">
        <CardHeader className="pb-6">
          <CardTitle className="flex items-center gap-3 text-xl font-semibold">
            <div className="p-2 rounded-xl bg-green-100 dark:bg-green-900/30">
              <ImageIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            {t("properties.form.images.title")}
          </CardTitle>
          <CardDescription className="text-base text-gray-600 dark:text-gray-300">
            {t("properties.form.images.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ImageUpload
            onImagesUploaded={handleImagesUploaded}
            // DISABLED: Delete functionality temporarily disabled
            onImagesRemoved={(images) => {
              // Handle batch removal if needed
              images.forEach(handleImageRemove);
            }}
            existingImages={propertyImages}
            maxFiles={20}
            folder="PropertyPro/properties"
            quality="auto"
            disabled={isLoading}
            className="w-full"
          />

          {/* Image count display */}
          {propertyImages.length > 0 && (
            <div className="text-sm text-gray-600 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border">
              <span className="font-medium">{propertyImages.length}</span>{" "}
              {t("properties.form.images.count", {
                values: { count: propertyImages.length },
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form Actions */}
      <div className="flex justify-end gap-4">
        <Button type="button" variant="outline">
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-6 py-2 rounded-xl bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:shadow-none text-base font-medium"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.saving")}
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {mode === "create"
                ? t("properties.form.actions.create")
                : t("properties.form.actions.update")}
            </>
          )}
        </Button>
      </div>

      {/* Enhanced Alert Dialog for Missing Units - Red Error Theme */}
      <AlertDialog open={showAlert} onOpenChange={setShowAlert}>
        <AlertDialogContent className="max-w-md border-red-200 dark:border-red-800">
          <AlertDialogHeader className="space-y-4">
            <div className="flex items-center justify-center w-14 h-14 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 ring-4 ring-red-50 dark:ring-red-900/20">
              <Building2 className="h-7 w-7 text-red-600 dark:text-red-400" />
            </div>
            <AlertDialogTitle className="text-center text-xl font-semibold text-red-900 dark:text-red-100">
              {t("properties.form.alert.unitRequired.title")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-center text-base space-y-3 text-muted-foreground">
                <p className="text-gray-700 dark:text-gray-200 font-medium">
                  {t("properties.form.alert.unitRequired.summary")}
                </p>
                <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-start">
                  <p className="font-semibold text-red-900 dark:text-red-100 mb-2 flex items-center gap-2">
                    <span className="text-lg">⚠️</span>{" "}
                    {t("properties.form.alert.unitRequired.callout")}
                  </p>
                  <p className="text-red-800 dark:text-red-200 leading-relaxed">
                    {t("properties.form.alert.unitRequired.instructions")}
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-center">
            <AlertDialogAction
              onClick={() => setShowAlert(false)}
              className="bg-linear-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white px-8 shadow-lg hover:shadow-xl transition-all"
            >
              {t("properties.form.alert.unitRequired.cta")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
