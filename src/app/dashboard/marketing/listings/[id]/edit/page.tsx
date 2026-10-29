"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ListingForm } from "@/components/listings/ListingForm";
import {
  ListingStatusBadges,
  describeFailure,
  listingTitleFor,
} from "@/components/listings/listing-ui";
import type { ListingAbilities, ListingDto } from "@/lib/listings/types";

export default function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t, language } = useLocalizationContext();

  const [listing, setListing] = useState<ListingDto | null>(null);
  const [abilities, setAbilities] = useState<ListingAbilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketing/listings/${id}`)
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
              t("marketing.edit.notFound", {
                defaultValue: "This listing no longer exists",
              }),
            ),
          );
          return;
        }
        setListing(payload.data as ListingDto);
        setAbilities(payload.summary?.abilities as ListingAbilities);
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            t("marketing.edit.loadFailed", {
              defaultValue: "The listing could not be loaded",
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
  }, [id, t]);

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
              {t("marketing.edit.title", { defaultValue: "Edit listing" })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {listing ? listingTitleFor(listing, language) : ""}
            </p>
          </div>
        </div>
        {listing && (
          <div className="flex items-center gap-3">
            <ListingStatusBadges listing={listing} />
            {listing.status === "published" && (
              <Button variant="outline" size="sm" asChild>
                <a href={listing.publicPath} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  {t("marketing.listings.actions.viewPublic", {
                    defaultValue: "View public page",
                  })}
                </a>
              </Button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : listing && abilities ? (
        <ListingForm key={listing.id} mode="edit" listing={listing} abilities={abilities} />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {error}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
