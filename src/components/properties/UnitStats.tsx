"use client";

/**
 * PropertyPro - Unit Statistics Component
 * Display statistics for available units
 */

import {
  Building2,
  DollarSign,
  Home,
  Square,
  TrendingUp,
} from "lucide-react";
import { AvailableUnitResponse } from "@/lib/services/property.service";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { usePropertyCategories } from "@/hooks/use-property-categories";

interface UnitStatsProps {
  units: AvailableUnitResponse[];
  totalUnits?: number;
  totalProperties?: number;
  statusCounts?: {
    available: number;
    occupied: number;
    maintenance: number;
    unavailable: number;
  };
  variant?: "all" | "available";
}

export default function UnitStats({
  units,
  totalUnits: totalUnitsProp,
  totalProperties: totalPropertiesProp,
  statusCounts,
  variant = "all",
}: UnitStatsProps) {
  const { t, formatCurrency: formatCurrencyLocalized } =
    useLocalizationContext();
  const { labelFor: unitTypeLabel } = usePropertyCategories("unit", { activeOnly: false });

  // Calculate statistics - use props if available (for accurate totals across all pages)
  const totalUnits = totalUnitsProp ?? units.length;
  const currentPageUnits = units.length;
  const averageRent =
    currentPageUnits > 0
      ? Math.round(
          units.reduce((sum, unit) => sum + unit.rentAmount, 0) /
            currentPageUnits
        )
      : 0;

  const unitTypes = units.reduce((acc, unit) => {
    acc[unit.unitType] = (acc[unit.unitType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const mostCommonUnitType = Object.entries(unitTypes).reduce(
    (max, [type, count]) => (count > max.count ? { type, count } : max),
    { type: "N/A", count: 0 }
  );

  const rentRange =
    currentPageUnits > 0
      ? {
          min: Math.min(...units.map((unit) => unit.rentAmount)),
          max: Math.max(...units.map((unit) => unit.rentAmount)),
        }
      : { min: 0, max: 0 };
  const averageSquareFootage =
    currentPageUnits > 0
      ? Math.round(
          units.reduce((sum, unit) => sum + unit.squareFootage, 0) /
            currentPageUnits
        )
      : 0;
  const squareFootageRange =
    currentPageUnits > 0
      ? {
          min: Math.min(...units.map((unit) => unit.squareFootage)),
          max: Math.max(...units.map((unit) => unit.squareFootage)),
        }
      : { min: 0, max: 0 };

  const propertyCount =
    totalPropertiesProp ?? new Set(units.map((unit) => unit._id)).size;
  const visibleStatusCounts = units.reduce(
    (acc, unit) => {
      const status = unit.unitStatus as keyof typeof acc;
      if (status in acc) {
        acc[status] += 1;
      }
      return acc;
    },
    { available: 0, occupied: 0, maintenance: 0, unavailable: 0 }
  );
  const unitStatusCounts = statusCounts ?? visibleStatusCounts;
  const occupancyTotal = Object.values(unitStatusCounts).reduce(
    (sum, count) => sum + count,
    0
  );
  const occupiedUnits = unitStatusCounts.occupied;
  const occupancyRate =
    occupancyTotal > 0 ? Math.round((occupiedUnits / occupancyTotal) * 100) : 0;

  return (
    <AnalyticsCardGrid className="md:grid-cols-4 lg:grid-cols-4">
      <AnalyticsCard
        title={
          variant === "available"
            ? t("properties.available.stats.availableUnits.title", {
                defaultValue: "Available Units",
              })
            : t("properties.available.stats.totalUnits.title")
        }
        value={totalUnits.toLocaleString()}
        description={t("properties.available.stats.totalUnits.description", {
          values: {
            count: propertyCount,
            plural:
              propertyCount === 1
                ? t("properties.available.stats.totalUnits.property")
                : t("properties.available.stats.totalUnits.properties"),
          },
        })}
        icon={Home}
        iconColor={variant === "available" ? "success" : "primary"}
      />

      <AnalyticsCard
        title={t("properties.available.stats.averageRent.title")}
        value={formatCurrencyLocalized(averageRent)}
        description={t("properties.available.stats.averageRent.description", {
          values: {
            min: formatCurrencyLocalized(rentRange.min),
            max: formatCurrencyLocalized(rentRange.max),
          },
        })}
        icon={DollarSign}
        iconColor="success"
      />

      <AnalyticsCard
        title={t("properties.available.stats.mostCommonType.title")}
        value={unitTypeLabel(mostCommonUnitType.type)}
        description={t("properties.available.stats.mostCommonType.description", {
          values: {
            count: mostCommonUnitType.count,
            plural:
              mostCommonUnitType.count === 1
                ? t("properties.available.stats.mostCommonType.unit")
                : t("properties.available.stats.mostCommonType.units"),
          },
        })}
        icon={Building2}
        iconColor="info"
      />

      {variant === "available" ? (
        <AnalyticsCard
          title={t("properties.available.stats.averageSize.title", {
            defaultValue: "Average Size",
          })}
          value={`${averageSquareFootage.toLocaleString()} ${t("properties.labels.squareFeetUnit", { defaultValue: "m²" })}`}
          description={t("properties.available.stats.averageSize.description", {
            values: {
              min: squareFootageRange.min.toLocaleString(),
              max: squareFootageRange.max.toLocaleString(),
            },
            defaultValue: `Range: ${squareFootageRange.min.toLocaleString()} - ${squareFootageRange.max.toLocaleString()} m²`,
          })}
          icon={Square}
          iconColor="info"
        />
      ) : (
        <AnalyticsCard
          title={t("properties.available.stats.occupancyRate.title")}
          value={t("properties.available.stats.occupancyRate.value", {
            values: { rate: occupancyRate },
            defaultValue: `${occupancyRate}%`,
          })}
          description={t("properties.available.stats.occupancyRate.description", {
            values: {
              occupied: occupiedUnits.toLocaleString(),
              total: occupancyTotal.toLocaleString(),
            },
            defaultValue: `${occupiedUnits.toLocaleString()} of ${occupancyTotal.toLocaleString()} units occupied`,
          })}
          icon={TrendingUp}
          iconColor="success"
        />
      )}
    </AnalyticsCardGrid>
  );
}
