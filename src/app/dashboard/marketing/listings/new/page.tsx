"use client";

/**
 * PropertyPro - Start a listing
 *
 * First the choice of what is advertised. "From my properties": step one
 * chooses the unit — only vacant units with no live listing of that type are
 * offered, narrowed to the buildings the signed-in person may see — and step
 * two is the listing form, already filled in from the unit and its building.
 * A link with `?unitId=` goes straight to step two.
 *
 * "Not in the system": a property the office has not added, straight to the
 * form, which asks for what a unit would have said (`?mode=standalone` opens
 * it). Offered only to someone who sees every building — such a listing
 * belongs to no building, so a narrower view could not find it again.
 */

import Image from "@/components/ui/app-image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bath,
  BedDouble,
  Building2,
  Loader2,
  MapPinned,
  Ruler,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import GlobalSearch from "@/components/ui/global-search";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ListingForm } from "@/components/listings/ListingForm";
import { describeFailure } from "@/components/listings/listing-ui";
import { usePropertyCategories } from "@/hooks/use-property-categories";
import type { ListingType } from "@/lib/listings/constants";
import { isRenderablePhotoUrl } from "@/lib/listings/photos";
import type { CandidateUnitDto, ListingAbilities } from "@/lib/listings/types";

type NewListingMode = "unit" | "standalone";

export default function NewListingPage() {
  const { t, formatCurrency } = useLocalizationContext();
  const { labelFor } = usePropertyCategories("unit", { activeOnly: false });
  const params = useSearchParams();
  const wantedUnit = params.get("unitId");

  const [type, setType] = useState<ListingType>(
    params.get("type") === "sale" ? "sale" : "rent",
  );
  const [search, setSearch] = useState("");
  const [units, setUnits] = useState<CandidateUnitDto[]>([]);
  const [abilities, setAbilities] = useState<ListingAbilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CandidateUnitDto | null>(null);
  const [mode, setMode] = useState<NewListingMode>(
    params.get("mode") === "standalone" ? "standalone" : "unit",
  );
  const [standaloneAllowed, setStandaloneAllowed] = useState(false);
  // Someone narrowed to some buildings is never offered the second choice,
  // whatever the link asked for.
  const current: NewListingMode = standaloneAllowed ? mode : "unit";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ type, limit: "60" });
    if (search) query.set("search", search);
    fetch(`/api/marketing/listings/candidates?${query}`)
      .then(async (response) => ({
        ok: response.ok,
        payload: await response.json().catch(() => null),
      }))
      .then(({ ok, payload }) => {
        if (cancelled) return;
        if (!ok || !payload?.success) {
          setError(
            describeFailure(
              t,
              payload,
              t("marketing.new.loadFailed", {
                defaultValue: "The vacant units could not be loaded",
              }),
            ),
          );
          return;
        }
        const rows = (payload.data ?? []) as CandidateUnitDto[];
        setUnits(rows);
        setAbilities(payload.summary?.abilities ?? null);
        setStandaloneAllowed(payload.summary?.standaloneAllowed === true);
        if (wantedUnit) {
          const match = rows.find((unit) => unit.id === wantedUnit);
          if (match) setSelected((current) => current ?? match);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            t("marketing.new.loadFailed", {
              defaultValue: "The vacant units could not be loaded",
            }),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, search, wantedUnit, t]);

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link
            href="/dashboard/marketing/listings"
            aria-label={t("marketing.new.back", { defaultValue: "Back to listings" })}
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("marketing.new.title", { defaultValue: "New listing" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {current === "standalone"
              ? t("marketing.new.subtitleStandalone", {
                  defaultValue: "Describe the property, then save.",
                })
              : selected
                ? t("marketing.new.subtitleForm", {
                    defaultValue: "Review what was filled in from the unit, then save.",
                  })
                : t("marketing.new.subtitlePick", {
                    defaultValue: "Choose the vacant unit to advertise",
                  })}
          </p>
        </div>
      </div>

      {standaloneAllowed && (
        <div
          role="radiogroup"
          aria-label={t("marketing.new.mode.label", {
            defaultValue: "What are you advertising?",
          })}
          className="grid gap-3 sm:grid-cols-2"
        >
          {(["unit", "standalone"] as const).map((option) => {
            const chosen = current === option;
            const Icon = option === "unit" ? Building2 : MapPinned;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => setMode(option)}
                className={`flex items-start gap-3 rounded-xl border p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  chosen ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <Icon
                  className={`mt-0.5 h-5 w-5 shrink-0 ${
                    chosen ? "text-primary" : "text-muted-foreground"
                  }`}
                />
                <span>
                  <span className="block text-sm font-medium">
                    {option === "unit"
                      ? t("marketing.new.mode.unit", { defaultValue: "From my properties" })
                      : t("marketing.new.mode.standalone", {
                          defaultValue: "Not in the system",
                        })}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {option === "unit"
                      ? t("marketing.new.mode.unitHint", {
                          defaultValue: "A vacant unit already in the system",
                        })
                      : t("marketing.new.mode.standaloneHint", {
                          defaultValue: "A property you have not added to the system",
                        })}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {current === "standalone" && abilities ? (
        <ListingForm
          key="standalone"
          mode="create"
          standalone
          initialType={type}
          abilities={abilities}
        />
      ) : selected && abilities ? (
        <ListingForm
          key={`${selected.id}-${type}`}
          mode="create"
          candidate={selected}
          initialType={type}
          abilities={abilities}
          onChangeUnit={() => setSelected(null)}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="inline-flex rounded-lg border p-1" role="group">
              {(["rent", "sale"] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={type === option ? "default" : "ghost"}
                  onClick={() => setType(option)}
                  aria-pressed={type === option}
                >
                  {t(`marketing.type.${option}`, { defaultValue: option })}
                </Button>
              ))}
            </div>
            <GlobalSearch
              placeholder={t("marketing.new.searchPlaceholder", {
                defaultValue: "Search by unit, building or district…",
              })}
              initialValue={search}
              debounceDelay={300}
              onSearch={setSearch}
              isLoading={loading}
              className="min-w-0 flex-1"
              ariaLabel={t("marketing.new.searchPlaceholder", {
                defaultValue: "Search vacant units",
              })}
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-destructive">
                {error}
              </CardContent>
            </Card>
          ) : units.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 font-medium">
                  {t("marketing.new.empty.title", {
                    defaultValue: "No vacant unit without a listing",
                  })}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("marketing.new.empty.description", {
                    defaultValue:
                      "A unit can be advertised once it is vacant, and only once for rent and once for sale. Units already advertised are not shown.",
                  })}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {units.map((unit) => {
                const photo =
                  unit.images[0] ?? unit.property.images[0] ?? null;
                const drawable =
                  photo &&
                  isRenderablePhotoUrl(photo, process.env.NEXT_PUBLIC_R2_PUBLIC_URL);
                return (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => setSelected(unit)}
                    className="overflow-hidden rounded-xl border bg-card text-start transition-colors hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <div className="relative h-32 bg-muted">
                      {drawable ? (
                        <Image
                          src={photo}
                          alt={`${unit.property.name} · ${unit.unitNumber}`}
                          fill
                          className="object-cover"
                          sizes="(max-width: 640px) 100vw, 33vw"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Building2 className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {unit.property.name} · {unit.unitNumber}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {labelFor(unit.unitType)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[unit.property.addressDistrict, unit.property.addressCity]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <BedDouble className="h-3.5 w-3.5" />
                          {unit.bedrooms}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Bath className="h-3.5 w-3.5" />
                          {unit.bathrooms}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Ruler className="h-3.5 w-3.5" />
                          {unit.squareFootage} m²
                        </span>
                        <span className="ms-auto font-medium text-foreground">
                          {formatCurrency(unit.rentAmount)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
