"use client";

/**
 * PropertyPro - Small pieces the Marketing screens share
 *
 * The status badges (a published listing that is not actually on the public
 * page says why, in the row), the licence badge, a title in the reader's
 * language, a price with what it is per, and the one place an API refusal is
 * turned into a sentence in the reader's language.
 */

import { AlertTriangle, CheckCircle2, EyeOff, Home } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { ListingStatus } from "@/lib/listings/constants";
import type { ListingDto } from "@/lib/listings/types";

type Translate = (
  key: string,
  options?: { defaultValue?: string; values?: Record<string, string | number> },
) => string;

/** The title in the reader's language, falling back to the other one. */
export function listingTitleFor(
  listing: Pick<ListingDto, "titleAr" | "titleEn" | "slug">,
  language: string,
): string {
  const arabic = language.toLowerCase().startsWith("ar");
  const first = arabic ? listing.titleAr : listing.titleEn;
  const second = arabic ? listing.titleEn : listing.titleAr;
  return first || second || listing.slug;
}

const STATUS_VARIANT: Record<ListingStatus, "success" | "outline" | "secondary"> = {
  published: "success",
  draft: "outline",
  archived: "secondary",
};

export function ListingStatusBadges({ listing }: { listing: ListingDto }) {
  const { t } = useLocalizationContext();
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={STATUS_VARIANT[listing.status]}>
        {t(`marketing.status.${listing.status}`, { defaultValue: listing.status })}
      </Badge>
      {listing.hiddenReasons.includes("unit_unavailable") && (
        <Badge variant="warning" className="font-normal">
          <Home />
          {t("marketing.badge.unitUnavailable", {
            defaultValue: "Unit no longer available",
          })}
        </Badge>
      )}
      {listing.hiddenReasons.includes("licence") && (
        <Badge variant="destructive" className="font-normal">
          <EyeOff />
          {t("marketing.badge.hiddenLicence", {
            defaultValue: "Hidden: licence out of date",
          })}
        </Badge>
      )}
    </div>
  );
}

export function LicenceBadge({
  licence,
}: {
  licence: ListingDto["licence"];
}) {
  const { t } = useLocalizationContext();
  if (licence.state === "valid") {
    return (
      <Badge variant="success" className="font-normal">
        <CheckCircle2 />
        {t("marketing.licence.valid", { defaultValue: "Valid" })}
      </Badge>
    );
  }
  if (licence.state === "expiring") {
    return (
      <Badge variant="warning" className="font-normal">
        <AlertTriangle />
        {licence.daysLeft === 0
          ? t("marketing.licence.expiresToday", { defaultValue: "Expires today" })
          : t("marketing.licence.expiresIn", {
              defaultValue: "Expires in {days} days",
              values: { days: licence.daysLeft ?? 0 },
            })}
      </Badge>
    );
  }
  if (licence.state === "expired") {
    return (
      <Badge variant="destructive" className="font-normal">
        <AlertTriangle />
        {t("marketing.licence.expired", { defaultValue: "Expired" })}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal">
      {t("marketing.licence.missing", { defaultValue: "No licence" })}
    </Badge>
  );
}

/** "5,000.00 / per month" — the price with what it is per. */
export function usePriceText() {
  const { t, formatCurrency } = useLocalizationContext();
  return (listing: Pick<ListingDto, "price" | "currency" | "pricePeriod">) => {
    const amount = formatCurrency(listing.price, listing.currency);
    if (listing.pricePeriod === "total") return amount;
    return `${amount} ${t(`marketing.period.per.${listing.pricePeriod}`, {
      defaultValue: `/ ${listing.pricePeriod}`,
    })}`;
  };
}

interface ApiFailure {
  error?: string;
  code?: string;
  problems?: string[];
}

/**
 * An API refusal as a sentence in the reader's language. The server sends
 * stable codes (and, for a publish refusal, every problem at once); the
 * English text it also sends is only the last resort.
 */
export function describeFailure(
  t: Translate,
  payload: ApiFailure | null | undefined,
  fallback: string,
): string {
  if (!payload) return fallback;
  if (payload.code === "listing_not_publishable" && payload.problems?.length) {
    return payload.problems
      .map((problem) =>
        t(`marketing.problem.${problem}`, { defaultValue: problem }),
      )
      .join(" ");
  }
  if (payload.code && payload.code !== "VALIDATION_ERROR") {
    const key = `marketing.error.${payload.code}`;
    // A missing entry comes back as the key itself.
    const known = t(key, { defaultValue: "" });
    if (known && known !== key) return known;
  }
  return payload.error || fallback;
}
