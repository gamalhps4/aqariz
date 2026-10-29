"use client";

/**
 * PropertyPro - Create or edit a listing
 *
 * One form for both. Creating starts from a vacant unit and fills in what the
 * unit and its building already say — the price, the district, the amenities,
 * an Arabic title — so the office edits instead of typing. Editing changes the
 * words, the price, the photos and the licence; it cannot change a listing's
 * state, which belongs to Publish, Take down, Archive and Restore.
 *
 * A listing for a property not in the system (`standalone`) has no unit to
 * start from: in place of the unit's card it asks for what the unit would have
 * said — the type, the area, the rooms, the floor, the city and an address —
 * and its photos are its own. Which kind a listing is never changes.
 *
 * What publishing needs is shown as a checklist as the form fills in, from
 * the same rules the server applies (lib/listings/publish-rules.ts) — the
 * server stays the judge, and its refusal is shown if the two ever disagree.
 */

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  MapPinned,
  Circle,
  Loader2,
  Plus,
  Save,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { categoryLabel, usePropertyCategories } from "@/hooks/use-property-categories";
import {
  LISTING_LIMITS,
  LISTING_TYPES,
  UNIT_AMENITY_FLAGS,
  defaultPeriodFor,
  periodsFor,
  type ListingType,
  type PricePeriod,
} from "@/lib/listings/constants";
import { riyadhDay } from "@/lib/listings/dates";
import { publishProblems, type PublishProblem } from "@/lib/listings/publish-rules";
import type {
  CandidateUnitDto,
  ListingAbilities,
  ListingDto,
  OfficeSettingsDto,
} from "@/lib/listings/types";
import { PhotosEditor } from "./PhotosEditor";
import { describeFailure } from "./listing-ui";

interface FormState {
  type: ListingType;
  pricePeriod: PricePeriod;
  price: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  city: string;
  district: string;
  amenities: string[];
  photos: string[];
  contactPhone: string;
  whatsappNumber: string;
  adLicenceNumber: string;
  adLicenceExpiry: string;
  slug: string;
  /** A property not in the system: what a unit would have said. */
  propertyType: string;
  addressLine: string;
  areaSqm: string;
  bedrooms: string;
  bathrooms: string;
  floor: string;
}

interface ListingFormProps {
  mode: "create" | "edit";
  /** Create: the vacant unit the listing is being started for. */
  candidate?: CandidateUnitDto;
  /** Create: a property not in the system — no unit, its own details. */
  standalone?: boolean;
  initialType?: ListingType;
  /** Edit: the stored listing. */
  listing?: ListingDto;
  abilities: ListingAbilities;
  /** Create: go back to choosing another unit. */
  onChangeUnit?: () => void;
}

function stateFromListing(listing: ListingDto): FormState {
  return {
    type: listing.type,
    pricePeriod: listing.pricePeriod,
    price: String(listing.price),
    titleAr: listing.titleAr,
    titleEn: listing.titleEn,
    descriptionAr: listing.descriptionAr ?? "",
    descriptionEn: listing.descriptionEn ?? "",
    city: listing.city ?? "",
    district: listing.district ?? "",
    amenities: listing.amenities,
    photos: listing.photos,
    contactPhone: listing.contactPhone ?? "",
    whatsappNumber: listing.whatsappNumber ?? "",
    adLicenceNumber: listing.adLicenceNumber ?? "",
    adLicenceExpiry: listing.adLicenceExpiry ?? "",
    slug: listing.slug,
    propertyType: listing.propertyType ?? "",
    addressLine: listing.addressLine ?? "",
    areaSqm: numberText(listing.areaSqm),
    bedrooms: numberText(listing.bedrooms),
    bathrooms: numberText(listing.bathrooms),
    floor: numberText(listing.floor),
  };
}

const numberText = (value: number | null) => (value === null ? "" : String(value));

/**
 * Fill the contact numbers the office has not typed from its own defaults
 * (Marketing → Office details). Returns the effect's cleanup.
 */
function prefillOfficeContacts(
  setState: Dispatch<SetStateAction<FormState>>,
): () => void {
  let cancelled = false;
  fetch("/api/marketing/settings")
    .then((response) => response.json().catch(() => null))
    .then((payload) => {
      if (cancelled || !payload?.success) return;
      const office = payload.data as OfficeSettingsDto;
      setState((current) => ({
        ...current,
        contactPhone: current.contactPhone || office.contactPhone || "",
        whatsappNumber: current.whatsappNumber || office.whatsappNumber || "",
      }));
    })
    .catch(() => undefined);
  return () => {
    cancelled = true;
  };
}

export function ListingForm({
  mode,
  candidate,
  standalone = false,
  initialType = "rent",
  listing,
  abilities,
  onChangeUnit,
}: ListingFormProps) {
  const router = useRouter();
  const { t, formatCurrency, language } = useLocalizationContext();
  const { categories } = usePropertyCategories("unit", { activeOnly: false });
  const isStandalone = listing ? listing.standalone : standalone;

  const unitSummary = useMemo(() => {
    if (listing?.unit && listing.property) {
      return {
        property: listing.property.name,
        unitNumber: listing.unit.unitNumber,
        unitType: listing.unit.unitType,
        bedrooms: listing.unit.bedrooms,
        bathrooms: listing.unit.bathrooms,
        area: listing.unit.squareFootage,
        rent: listing.unit.rentAmount,
        available: listing.unit.available,
        status: listing.unit.status,
      };
    }
    if (candidate) {
      return {
        property: candidate.property.name,
        unitNumber: candidate.unitNumber,
        unitType: candidate.unitType,
        bedrooms: candidate.bedrooms,
        bathrooms: candidate.bathrooms,
        area: candidate.squareFootage,
        rent: candidate.rentAmount,
        available: true,
        status: "available",
      };
    }
    return null;
  }, [listing, candidate]);

  const [state, setState] = useState<FormState>(() => {
    if (listing) return stateFromListing(listing);
    const type = initialType;
    return {
      type,
      pricePeriod: defaultPeriodFor(type),
      price: type === "rent" && candidate ? String(candidate.rentAmount || "") : "",
      titleAr: "",
      titleEn: "",
      descriptionAr: "",
      descriptionEn: "",
      city: candidate?.property.addressCity ?? "",
      district: candidate?.property.addressDistrict ?? "",
      amenities: [],
      photos: [],
      contactPhone: "",
      whatsappNumber: "",
      adLicenceNumber: "",
      adLicenceExpiry: "",
      slug: "",
      propertyType: "",
      addressLine: "",
      areaSqm: "",
      bedrooms: "",
      bathrooms: "",
      floor: "",
    };
  });
  const [amenityDraft, setAmenityDraft] = useState("");
  const [saving, setSaving] = useState<"save" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  const readOnly =
    mode === "edit" && (!abilities.edit || listing?.status === "archived");
  const status = listing?.status ?? "draft";

  // A new listing starts from the office's own numbers, and from the facts the
  // unit and its building already record — in Arabic, the language the public
  // page leads with. Everything is editable; none of it is saved unless the
  // office saves it.
  useEffect(() => {
    if (mode !== "create" || !candidate) return;

    const arabic = (key: string, values?: Record<string, string | number>) =>
      t(key, { language: "ar", values, defaultValue: "" });

    const featureLabels = UNIT_AMENITY_FLAGS.filter(
      (flag) => candidate.features[flag] === true,
    ).map((flag) => arabic(`marketing.amenity.${flag}`));
    const parking = candidate.features.parking as { included?: boolean } | undefined;
    if (parking?.included) featureLabels.push(arabic("marketing.amenity.parking"));

    const amenities = [
      ...new Set([...candidate.property.amenities, ...featureLabels].filter(Boolean)),
    ].slice(0, LISTING_LIMITS.amenities);

    setState((current) => ({
      ...current,
      amenities: current.amenities.length > 0 ? current.amenities : amenities,
    }));

    return prefillOfficeContacts(setState);
    // The unit is fixed for the life of this form; everything else is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, candidate?.id]);

  // A property not in the system has no unit or building to start from, but
  // its listing still starts from the office's own numbers.
  useEffect(() => {
    if (mode !== "create" || !isStandalone) return;
    return prefillOfficeContacts(setState);
  }, [mode, isStandalone]);

  // The office's unit types, for a property not in the system: the active
  // ones, and the one the listing already has even if it was switched off.
  const propertyTypes = useMemo(
    () =>
      categories.filter(
        (category) => category.isActive || category.slug === state.propertyType,
      ),
    [categories, state.propertyType],
  );

  // The Arabic title starts as "<unit type> للإيجار في حي <district>" once the
  // unit-type names have loaded, unless the office has already written one.
  const unitTypeAr = useMemo(() => {
    if (!unitSummary) return "";
    const match = categories.find((category) => category.slug === unitSummary.unitType);
    return match
      ? categoryLabel(match, "ar")
      : t(`marketing.unitType.${unitSummary.unitType}`, {
          language: "ar",
          defaultValue: unitSummary.unitType,
        });
  }, [categories, unitSummary, t]);

  useEffect(() => {
    if (mode !== "create" || !unitSummary || !unitTypeAr) return;
    setState((current) => {
      if (current.titleAr.trim()) return current;
      const place = current.district
        ? t("marketing.form.inDistrict", {
            language: "ar",
            values: { district: current.district },
            defaultValue: current.district,
          })
        : current.city;
      return {
        ...current,
        titleAr: t(`marketing.form.defaultTitle.${current.type}`, {
          language: "ar",
          values: { type: unitTypeAr, place },
          defaultValue: "",
        }),
      };
    });
    // Once, when the unit-type name is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, unitTypeAr]);

  const changeType = (type: ListingType) =>
    setState((current) => ({
      ...current,
      type,
      pricePeriod: periodsFor(type).includes(current.pricePeriod)
        ? current.pricePeriod
        : defaultPeriodFor(type),
    }));

  const addAmenity = (raw: string) => {
    const names = raw
      .split(/[,،\n]/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    setState((current) => ({
      ...current,
      amenities: [...new Set([...current.amenities, ...names])].slice(
        0,
        LISTING_LIMITS.amenities,
      ),
    }));
    setAmenityDraft("");
  };

  const defaultPhotos = useMemo(() => {
    if (listing) {
      // What the page would show if the listing had no photos of its own.
      return listing.photos.length === 0 ? listing.effectivePhotos : [];
    }
    if (candidate) {
      return candidate.images.length > 0
        ? candidate.images
        : candidate.property.images;
    }
    return [];
  }, [listing, candidate]);

  // What the listing is missing to be published, by the server's own rules.
  const problems: PublishProblem[] = publishProblems(
    {
      titleAr: state.titleAr,
      titleEn: state.titleEn,
      price: state.price === "" ? null : Number(state.price),
      type: state.type,
      pricePeriod: state.pricePeriod,
      adLicenceNumber: state.adLicenceNumber,
      adLicenceExpiry: state.adLicenceExpiry || null,
      unitStatus: unitSummary?.available ? "available" : (unitSummary?.status ?? null),
      standalone: isStandalone,
      propertyType: state.propertyType,
      city: state.city,
      areaSqm: state.areaSqm === "" ? null : Number(state.areaSqm),
    },
    riyadhDay(),
  );

  const payload = () => ({
    type: state.type,
    pricePeriod: state.pricePeriod,
    price: state.price === "" ? 0 : Number(state.price),
    titleAr: state.titleAr,
    titleEn: state.titleEn,
    descriptionAr: state.descriptionAr,
    descriptionEn: state.descriptionEn,
    city: state.city,
    district: state.district,
    amenities: state.amenities,
    photos: state.photos,
    contactPhone: state.contactPhone,
    whatsappNumber: state.whatsappNumber,
    adLicenceNumber: state.adLicenceNumber,
    adLicenceExpiry: state.adLicenceExpiry || null,
    // Only a listing with no unit has these; one made from a unit reads them
    // from the unit, and the API refuses them there.
    ...(isStandalone
      ? {
          propertyType: state.propertyType,
          addressLine: state.addressLine,
          areaSqm: state.areaSqm,
          bedrooms: state.bedrooms,
          bathrooms: state.bathrooms,
          floor: state.floor,
        }
      : {}),
  });

  const save = async (publish: boolean) => {
    // What it is and where it is name a listing with no unit, so even a draft
    // needs both; said here in the reader's language rather than by the API.
    if (isStandalone && (!state.propertyType || !state.city.trim())) {
      setError(
        t("marketing.error.listing_standalone_details", {
          defaultValue:
            "A listing for a property that is not in the system needs its property type and city.",
        }),
      );
      return;
    }
    setSaving(publish ? "publish" : "save");
    setError(null);
    try {
      let savedId = listing?.id ?? "";

      if (mode === "create") {
        if (!candidate && !isStandalone) return;
        const response = await fetch("/api/marketing/listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            candidate
              ? { unitId: candidate.id, ...payload() }
              : { standalone: true, ...payload() },
          ),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
          setError(
            describeFailure(
              t,
              result,
              t("marketing.form.saveFailed", {
                defaultValue: "The listing could not be saved",
              }),
            ),
          );
          return;
        }
        savedId = result.data.id as string;
      } else if (listing) {
        const body: Record<string, unknown> = payload();
        // The address can be changed by hand only while the listing is a
        // draft, and only if it actually changed.
        if (status === "draft" && state.slug && state.slug !== listing.slug) {
          body.slug = state.slug;
        }
        const response = await fetch(`/api/marketing/listings/${listing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
          setError(
            describeFailure(
              t,
              result,
              t("marketing.form.saveFailed", {
                defaultValue: "The listing could not be saved",
              }),
            ),
          );
          return;
        }
      }

      if (publish && savedId) {
        const response = await fetch(`/api/marketing/listings/${savedId}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "publish" }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
          // Saved, but not published: say so, and stay on a page where the
          // problem can be fixed.
          toast.error(
            describeFailure(
              t,
              result,
              t("marketing.form.publishFailed", {
                defaultValue: "Saved as a draft, but it could not be published",
              }),
            ),
          );
          router.replace(`/dashboard/marketing/listings/${savedId}/edit`);
          return;
        }
        toast.success(
          t("marketing.listings.done.publish", { defaultValue: "Published" }),
        );
      } else {
        toast.success(
          t("marketing.form.saved", { defaultValue: "The listing was saved" }),
        );
      }
      router.push("/dashboard/marketing/listings");
    } catch {
      setError(
        t("marketing.form.saveFailed", {
          defaultValue: "The listing could not be saved",
        }),
      );
    } finally {
      setSaving(null);
    }
  };

  const publicPrefix = listing
    ? listing.publicPath.slice(0, listing.publicPath.length - listing.slug.length)
    : "";
  const checklist: Array<{ id: string; ok: boolean; label: string }> = [
    {
      id: "title",
      ok: !problems.includes("title_missing"),
      label: t("marketing.problem.title_missing", { defaultValue: "Add a title" }),
    },
    {
      id: "price",
      ok: !problems.includes("price_missing"),
      label: t("marketing.problem.price_missing", { defaultValue: "Enter a price" }),
    },
    {
      id: "licence",
      ok:
        !problems.includes("licence_missing") &&
        !problems.includes("licence_expiry_missing") &&
        !problems.includes("licence_expired"),
      label: t("marketing.form.checklist.licence", {
        defaultValue: "A valid advertising licence number and expiry date",
      }),
    },
    isStandalone
      ? {
          id: "property",
          ok:
            !problems.includes("property_type_missing") &&
            !problems.includes("city_missing") &&
            !problems.includes("area_missing"),
          label: t("marketing.form.checklist.property", {
            defaultValue: "The property type, city and area",
          }),
        }
      : {
          id: "unit",
          ok: !problems.includes("unit_unavailable"),
          label: t("marketing.form.checklist.unit", {
            defaultValue: "The unit is vacant",
          }),
        },
  ];

  // The city and district: in the offer for a listing made from a unit (the
  // building's, as a start), with the property itself for one that has none.
  const locationFields = (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="listing-city">
          {t("marketing.form.city", { defaultValue: "City" })}
        </Label>
        <Input
          id="listing-city"
          value={state.city}
          onChange={(event) => update("city", event.target.value)}
          disabled={readOnly}
          maxLength={LISTING_LIMITS.city}
          required={isStandalone}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="listing-district">
          {t("marketing.form.district", { defaultValue: "District" })}
        </Label>
        <Input
          id="listing-district"
          value={state.district}
          onChange={(event) => update("district", event.target.value)}
          disabled={readOnly}
          maxLength={LISTING_LIMITS.district}
        />
      </div>
    </>
  );

  const numberField = (
    key: "areaSqm" | "bedrooms" | "bathrooms" | "floor",
    label: string,
    limits: { min: number; max: number; step?: string },
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`listing-${key}`}>{label}</Label>
      <Input
        id={`listing-${key}`}
        type="number"
        inputMode={limits.step ? "decimal" : "numeric"}
        min={limits.min}
        max={limits.max}
        step={limits.step ?? "1"}
        value={state[key]}
        onChange={(event) => update(key, event.target.value)}
        disabled={readOnly}
        dir="ltr"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {readOnly && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {listing?.status === "archived"
            ? t("marketing.form.archivedNote", {
                defaultValue: "This listing is archived. Restore it to edit it.",
              })
            : t("marketing.form.readOnlyNote", {
                defaultValue: "You can view this listing but not change it.",
              })}
        </div>
      )}

      {unitSummary && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">
                  {unitSummary.property} · {unitSummary.unitNumber}
                </CardTitle>
                <CardDescription>
                  {[
                    unitSummary.bedrooms > 0
                      ? t("marketing.form.unit.bedrooms", {
                          defaultValue: "{count} bedrooms",
                          values: { count: unitSummary.bedrooms },
                        })
                      : null,
                    unitSummary.bathrooms > 0
                      ? t("marketing.form.unit.bathrooms", {
                          defaultValue: "{count} bathrooms",
                          values: { count: unitSummary.bathrooms },
                        })
                      : null,
                    t("marketing.form.unit.area", {
                      defaultValue: "{area} m²",
                      values: { area: unitSummary.area },
                    }),
                    t("marketing.form.unit.rent", {
                      defaultValue: "Rent on the unit: {amount}",
                      values: { amount: formatCurrency(unitSummary.rent) },
                    }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </CardDescription>
                {!unitSummary.available && (
                  <Badge variant="warning" className="mt-2 font-normal">
                    {t("marketing.badge.unitUnavailable", {
                      defaultValue: "Unit no longer available",
                    })}
                  </Badge>
                )}
              </div>
            </div>
            {mode === "create" && onChangeUnit && (
              <Button type="button" variant="outline" size="sm" onClick={onChangeUnit}>
                {t("marketing.form.changeUnit", { defaultValue: "Change unit" })}
              </Button>
            )}
          </CardHeader>
        </Card>
      )}

      {isStandalone && (
        <Card>
          <CardHeader className="flex flex-row items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <MapPinned className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {t("marketing.form.property.title", { defaultValue: "The property" })}
                <Badge variant="outline" className="font-normal">
                  {t("marketing.listings.standalone", {
                    defaultValue: "Not in the system",
                  })}
                </Badge>
              </CardTitle>
              <CardDescription>
                {t("marketing.form.property.description", {
                  defaultValue:
                    "This property is not in the system, so the listing holds its details itself.",
                })}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="listing-property-type">
                  {t("marketing.form.property.type", { defaultValue: "Property type" })}
                </Label>
                <Select
                  value={state.propertyType}
                  onValueChange={(value) => update("propertyType", value)}
                  disabled={readOnly}
                >
                  <SelectTrigger id="listing-property-type">
                    <SelectValue
                      placeholder={t("marketing.form.property.typePlaceholder", {
                        defaultValue: "Choose a type",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {propertyTypes.map((category) => (
                      <SelectItem key={category.slug} value={category.slug}>
                        {categoryLabel(category, language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {numberField(
                "areaSqm",
                t("marketing.form.property.area", { defaultValue: "Area (m²)" }),
                { min: 0, max: LISTING_LIMITS.areaSqm, step: "0.01" },
              )}
              {numberField(
                "bedrooms",
                t("marketing.form.property.bedrooms", { defaultValue: "Bedrooms" }),
                { min: 0, max: LISTING_LIMITS.rooms },
              )}
              {numberField(
                "bathrooms",
                t("marketing.form.property.bathrooms", { defaultValue: "Bathrooms" }),
                { min: 0, max: LISTING_LIMITS.rooms },
              )}
              {numberField(
                "floor",
                t("marketing.form.property.floor", { defaultValue: "Floor" }),
                { min: LISTING_LIMITS.floorMin, max: LISTING_LIMITS.floorMax },
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {locationFields}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="listing-address">
                  {t("marketing.form.property.address", { defaultValue: "Address" })}
                </Label>
                <Input
                  id="listing-address"
                  value={state.addressLine}
                  onChange={(event) => update("addressLine", event.target.value)}
                  disabled={readOnly}
                  maxLength={LISTING_LIMITS.addressLine}
                  aria-describedby="listing-address-hint"
                />
                <p id="listing-address-hint" className="text-xs text-muted-foreground">
                  {t("marketing.form.property.addressHint", {
                    defaultValue:
                      "For your office only. The public page shows the district and the city.",
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("marketing.form.offer.title", { defaultValue: "The offer" })}
          </CardTitle>
        </CardHeader>
        <CardContent
          className={`grid gap-4 sm:grid-cols-2 ${isStandalone ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}
        >
          <div className="space-y-1.5">
            <Label>{t("marketing.form.type", { defaultValue: "Listing type" })}</Label>
            <Select
              value={state.type}
              onValueChange={(value) => changeType(value as ListingType)}
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LISTING_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`marketing.type.${type}`, { defaultValue: type })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="listing-price">
              {t("marketing.form.price", { defaultValue: "Price (SAR)" })}
            </Label>
            <Input
              id="listing-price"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={state.price}
              onChange={(event) => update("price", event.target.value)}
              disabled={readOnly}
              dir="ltr"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("marketing.form.period", { defaultValue: "Price is per" })}</Label>
            <Select
              value={state.pricePeriod}
              onValueChange={(value) => update("pricePeriod", value as PricePeriod)}
              disabled={readOnly || state.type === "sale"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periodsFor(state.type).map((period) => (
                  <SelectItem key={period} value={period}>
                    {t(`marketing.period.${period}`, { defaultValue: period })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!isStandalone && <div className="grid grid-cols-2 gap-2">{locationFields}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("marketing.form.text.title", { defaultValue: "Title and description" })}
          </CardTitle>
          <CardDescription>
            {t("marketing.form.text.description", {
              defaultValue:
                "The public page leads in Arabic. The English text is shown to visitors who switch language; without it they see the Arabic.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="listing-title-ar">
              {t("marketing.form.titleAr", { defaultValue: "Title (Arabic)" })}
            </Label>
            <Input
              id="listing-title-ar"
              dir="rtl"
              lang="ar"
              value={state.titleAr}
              onChange={(event) => update("titleAr", event.target.value)}
              disabled={readOnly}
              maxLength={LISTING_LIMITS.title}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="listing-title-en">
              {t("marketing.form.titleEn", { defaultValue: "Title (English)" })}
            </Label>
            <Input
              id="listing-title-en"
              dir="ltr"
              lang="en"
              value={state.titleEn}
              onChange={(event) => update("titleEn", event.target.value)}
              disabled={readOnly}
              maxLength={LISTING_LIMITS.title}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="listing-desc-ar">
              {t("marketing.form.descriptionAr", {
                defaultValue: "Description (Arabic)",
              })}
            </Label>
            <Textarea
              id="listing-desc-ar"
              dir="rtl"
              lang="ar"
              rows={6}
              value={state.descriptionAr}
              onChange={(event) => update("descriptionAr", event.target.value)}
              disabled={readOnly}
              maxLength={LISTING_LIMITS.description}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="listing-desc-en">
              {t("marketing.form.descriptionEn", {
                defaultValue: "Description (English)",
              })}
            </Label>
            <Textarea
              id="listing-desc-en"
              dir="ltr"
              lang="en"
              rows={6}
              value={state.descriptionEn}
              onChange={(event) => update("descriptionEn", event.target.value)}
              disabled={readOnly}
              maxLength={LISTING_LIMITS.description}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("marketing.form.amenities.title", { defaultValue: "Amenities" })}
          </CardTitle>
          <CardDescription>
            {isStandalone
              ? t("marketing.form.amenities.descriptionStandalone", {
                  defaultValue: "What the property offers. Add or remove any.",
                })
              : t("marketing.form.amenities.description", {
                  defaultValue:
                    "Started from the building's amenities and the unit's features. Add or remove any.",
                })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {state.amenities.map((amenity) => (
              <Badge key={amenity} variant="secondary" className="gap-1 font-normal">
                {amenity}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        "amenities",
                        state.amenities.filter((item) => item !== amenity),
                      )
                    }
                    aria-label={t("marketing.form.amenities.remove", {
                      defaultValue: "Remove {name}",
                      values: { name: amenity },
                    })}
                    className="rounded hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
            {state.amenities.length === 0 && (
              <span className="text-sm text-muted-foreground">
                {t("marketing.form.amenities.none", {
                  defaultValue: "No amenities listed",
                })}
              </span>
            )}
          </div>
          {!readOnly && (
            <div className="flex gap-2">
              <Input
                value={amenityDraft}
                onChange={(event) => setAmenityDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addAmenity(amenityDraft);
                  }
                }}
                placeholder={t("marketing.form.amenities.placeholder", {
                  defaultValue: "Add an amenity and press Enter",
                })}
                maxLength={LISTING_LIMITS.amenity}
                className="max-w-sm"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => addAmenity(amenityDraft)}
                disabled={!amenityDraft.trim()}
              >
                <Plus className="h-4 w-4" />
                {t("marketing.form.amenities.add", { defaultValue: "Add" })}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("marketing.form.photos.title", { defaultValue: "Photos" })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PhotosEditor
            photos={state.photos}
            onChange={(photos) => update("photos", photos)}
            defaults={defaultPhotos}
            fallback={!isStandalone}
            disabled={readOnly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("marketing.form.contact.title", { defaultValue: "Contact" })}
          </CardTitle>
          <CardDescription>
            {t("marketing.form.contact.description", {
              defaultValue:
                "Shown on the listing as Call and WhatsApp buttons. Visitors can also send a message through the form.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="listing-phone">
              {t("marketing.form.phone", { defaultValue: "Phone" })}
            </Label>
            <Input
              id="listing-phone"
              dir="ltr"
              inputMode="tel"
              placeholder="05XXXXXXXX"
              value={state.contactPhone}
              onChange={(event) => update("contactPhone", event.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="listing-whatsapp">
              {t("marketing.form.whatsapp", { defaultValue: "WhatsApp number" })}
            </Label>
            <Input
              id="listing-whatsapp"
              dir="ltr"
              inputMode="tel"
              placeholder="05XXXXXXXX"
              value={state.whatsappNumber}
              onChange={(event) => update("whatsappNumber", event.target.value)}
              disabled={readOnly}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("marketing.form.licence.title", {
              defaultValue: "Advertising licence (REGA)",
            })}
          </CardTitle>
          <CardDescription>
            {t("marketing.form.licence.description", {
              defaultValue:
                "Required to publish. The number is shown on the public page, and the listing is hidden from the day after the licence expires.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="listing-licence">
              {t("marketing.form.licence.number", {
                defaultValue: "Advertising licence number",
              })}
            </Label>
            <Input
              id="listing-licence"
              dir="ltr"
              inputMode="numeric"
              value={state.adLicenceNumber}
              onChange={(event) => update("adLicenceNumber", event.target.value)}
              disabled={readOnly}
              maxLength={LISTING_LIMITS.licenceNumber}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="listing-licence-expiry">
              {t("marketing.form.licence.expiry", {
                defaultValue: "Licence expiry date",
              })}
            </Label>
            <Input
              id="listing-licence-expiry"
              type="date"
              dir="ltr"
              value={state.adLicenceExpiry}
              onChange={(event) => update("adLicenceExpiry", event.target.value)}
              disabled={readOnly}
            />
          </div>
          {problems.includes("licence_expired") && state.adLicenceExpiry && (
            <p className="flex items-center gap-1.5 text-sm text-destructive sm:col-span-2">
              <AlertTriangle className="h-4 w-4" />
              {t("marketing.problem.licence_expired", {
                defaultValue: "The advertising licence has expired.",
              })}
            </p>
          )}
        </CardContent>
      </Card>

      {mode === "edit" && status === "draft" && !readOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("marketing.form.slug.title", { defaultValue: "Public address" })}
            </CardTitle>
            <CardDescription>
              {t("marketing.form.slug.description", {
                defaultValue:
                  "The address of this listing on your page. It can be changed until the listing is published, and not after, so shared links keep working.",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1 text-sm" dir="ltr">
              <span className="text-muted-foreground">{publicPrefix}</span>
              <Input
                value={state.slug}
                onChange={(event) => update("slug", event.target.value.toLowerCase())}
                className="max-w-xs"
                maxLength={LISTING_LIMITS.slug}
                aria-label={t("marketing.form.slug.title", {
                  defaultValue: "Public address",
                })}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {!readOnly && status !== "published" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("marketing.form.checklist.title", {
                defaultValue: "Before it can be published",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {checklist.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  {item.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={item.ok ? "text-muted-foreground" : ""}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {error && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href="/dashboard/marketing/listings">
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Link>
        </Button>
        {!readOnly && (
          <>
            <Button
              variant="outline"
              onClick={() => save(false)}
              disabled={saving !== null}
            >
              {saving === "save" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {status === "published"
                ? t("marketing.form.saveChanges", { defaultValue: "Save changes" })
                : t("marketing.form.saveDraft", { defaultValue: "Save as draft" })}
            </Button>
            {status !== "published" && abilities.publish && (
              <Button onClick={() => save(true)} disabled={saving !== null}>
                {saving === "publish" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {t("marketing.form.saveAndPublish", {
                  defaultValue: "Save and publish",
                })}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
