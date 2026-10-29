/**
 * PropertyPro - Property Statistics Component
 * Dashboard statistics for property management
 */

"use client";

import { useMemo } from "react";
import { PropertyStatus, PropertyType } from "@/types";
import { Building2, Users, CheckCircle, Wrench } from "lucide-react";
import { PropertyResponse } from "@/lib/services/property.service";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface PropertyStatsProps {
  properties: PropertyResponse[];
  totalCount?: number;
}

export default function PropertyStats({
  properties,
  totalCount,
}: PropertyStatsProps) {
  const { t } = useLocalizationContext();

  const stats = useMemo(() => {
    if (!properties.length) {
      return {
        total: 0,
        available: 0,
        occupied: 0,
        maintenance: 0,
        unavailable: 0,
        averageRent: 0,
        totalRentValue: 0,
        averageSquareFootage: 0,
        houses: 0,
        apartments: 0,
        condos: 0,
        townhouses: 0,
        commercial: 0,
        thisMonthAdded: 0,
        lastMonthAdded: 0,
        totalUnits: 0,
        availableUnits: 0,
        occupiedUnits: 0,
        maintenanceUnits: 0,
      };
    }

    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Status counts for properties
    const available = properties.filter(
      (p) => p.status === PropertyStatus.AVAILABLE
    ).length;
    const occupied = properties.filter(
      (p) => p.status === PropertyStatus.OCCUPIED
    ).length;
    const maintenance = properties.filter(
      (p) => p.status === PropertyStatus.MAINTENANCE
    ).length;
    const unavailable = properties.filter(
      (p) => p.status === PropertyStatus.UNAVAILABLE
    ).length;

    // Unit-based statistics
    let totalUnits = 0;
    let availableUnits = 0;
    let occupiedUnits = 0;
    let maintenanceUnits = 0;

    properties.forEach((property) => {
      if (property.isMultiUnit && property.units) {
        totalUnits += property.units.length;
        property.units.forEach((unit) => {
          switch (unit.status) {
            case PropertyStatus.AVAILABLE:
              availableUnits++;
              break;
            case PropertyStatus.OCCUPIED:
              occupiedUnits++;
              break;
            case PropertyStatus.MAINTENANCE:
              maintenanceUnits++;
              break;
          }
        });
      } else {
        // Single unit properties count as 1 unit
        totalUnits += 1;
        switch (property.status) {
          case PropertyStatus.AVAILABLE:
            availableUnits++;
            break;
          case PropertyStatus.OCCUPIED:
            occupiedUnits++;
            break;
          case PropertyStatus.MAINTENANCE:
            maintenanceUnits++;
            break;
        }
      }
    });

    // Type counts
    const houses = properties.filter(
      (p) => p.type === PropertyType.HOUSE
    ).length;
    const apartments = properties.filter(
      (p) => p.type === PropertyType.APARTMENT
    ).length;
    const condos = properties.filter(
      (p) => p.type === PropertyType.CONDO
    ).length;
    const townhouses = properties.filter(
      (p) => p.type === PropertyType.TOWNHOUSE
    ).length;
    const commercial = properties.filter(
      (p) => p.type === PropertyType.COMMERCIAL
    ).length;

    // Financial calculations — rent lives on units
    const unitRents = properties.flatMap((p) =>
      (p.units ?? [])
        .map((u) => u.rentAmount)
        .filter((r): r is number => typeof r === "number" && r > 0)
    );
    const totalRentValue = unitRents.reduce((sum, r) => sum + r, 0);
    const averageRent = unitRents.length
      ? Math.round(totalRentValue / unitRents.length)
      : 0;

    // Square footage — also stored on units
    const unitSquareFootages = properties.flatMap((p) =>
      (p.units ?? [])
        .map((u) => u.squareFootage)
        .filter((s): s is number => typeof s === "number" && s > 0)
    );
    const averageSquareFootage = unitSquareFootages.length
      ? Math.round(
          unitSquareFootages.reduce((sum, s) => sum + s, 0) /
            unitSquareFootages.length
        )
      : 0;

    // Monthly additions
    const thisMonthAdded = properties.filter(
      (p) => new Date(p.createdAt) >= thisMonth
    ).length;

    const lastMonthAdded = properties.filter((p) => {
      const createdDate = new Date(p.createdAt);
      return createdDate >= lastMonth && createdDate <= lastMonthEnd;
    }).length;

    return {
      total: properties.length,
      available,
      occupied,
      maintenance,
      unavailable,
      averageRent,
      totalRentValue,
      averageSquareFootage,
      houses,
      apartments,
      condos,
      townhouses,
      commercial,
      thisMonthAdded,
      lastMonthAdded,
      totalUnits,
      availableUnits,
      occupiedUnits,
      maintenanceUnits,
    };
  }, [properties]);

  return (
    <AnalyticsCardGrid className="md:grid-cols-4 lg:grid-cols-4">
      <AnalyticsCard
        title={t("properties.stats.totalProperties.title")}
        value={typeof totalCount === "number" ? totalCount : stats.total}
        description={t("properties.stats.totalProperties.description")}
        icon={Building2}
        iconColor="primary"
      />

      <AnalyticsCard
        title={t("properties.stats.availableProperties.title")}
        value={stats.available}
        description={t("properties.stats.availableProperties.description")}
        icon={CheckCircle}
        iconColor="success"
      />

      <AnalyticsCard
        title={t("properties.stats.occupiedProperties.title")}
        value={stats.occupied}
        description={t("properties.stats.occupiedProperties.description")}
        icon={Users}
        iconColor="info"
      />

      <AnalyticsCard
        title={t("properties.stats.underMaintenance.title")}
        value={stats.maintenance}
        description={t("properties.stats.underMaintenance.description")}
        icon={Wrench}
        iconColor="warning"
      />
    </AnalyticsCardGrid>
  );
}
