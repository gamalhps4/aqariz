"use client";

/**
 * PropertyPro - Choosing an employee's compounds and buildings
 *
 * The switch and the two lists behind `User.scopeRestricted`, as a controlled
 * part: the Access tab of an existing employee (BuildingScopeCard) and the
 * new-employee form both draw it, so an employee is given buildings the same
 * way wherever it happens.
 *
 * Two things it works hard to make obvious, because both are places where an
 * operator can be wrong without noticing:
 *
 *  1. Assigning a COMPOUND carries its buildings. Those buildings are shown
 *     ticked and disabled, with the compound named, so nobody ticks them
 *     again and nobody wonders why they cannot untick them.
 *  2. Restricted with nothing assigned means the person sees NOTHING. That is
 *     the safe reading of an empty list, but it is not the one people expect,
 *     so it is spelled out rather than left to be discovered.
 */

import { useMemo } from "react";
import { Building2, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export interface AssignableProperty {
  id: string;
  name: string;
  addressCity: string;
  addressDistrict: string | null;
  compoundId: string | null;
  totalUnits: number;
}

export interface AssignableCompound {
  id: string;
  name: string;
  addressCity: string;
}

export interface AssignableBuildings {
  properties: AssignableProperty[];
  compounds: AssignableCompound[];
}

export interface BuildingAssignmentValue {
  restricted: boolean;
  compoundIds: string[];
  propertyIds: string[];
}

interface BuildingAssignmentPickerProps {
  assignable: AssignableBuildings;
  value: BuildingAssignmentValue;
  onChange: (next: BuildingAssignmentValue) => void;
  disabled?: boolean;
  /**
   * The operator is limited to some buildings themselves, so whoever they
   * assign must be too: the switch stays on.
   */
  mustRestrict?: boolean;
}

/** Buildings a ticked compound already carries, keyed by building id. */
function impliedBuildings(
  assignable: AssignableBuildings,
  compoundIds: readonly string[],
): Map<string, string> {
  const map = new Map<string, string>();
  const chosen = new Set(compoundIds);
  for (const property of assignable.properties) {
    if (property.compoundId && chosen.has(property.compoundId)) {
      const compound = assignable.compounds.find(
        (entry) => entry.id === property.compoundId,
      );
      if (compound) map.set(property.id, compound.name);
    }
  }
  return map;
}

/** How many buildings an assignment reaches — the number the rule will use. */
export function assignedBuildingCount(
  assignable: AssignableBuildings,
  value: BuildingAssignmentValue,
): number {
  const reached = new Set(value.propertyIds);
  for (const id of impliedBuildings(assignable, value.compoundIds).keys()) {
    reached.add(id);
  }
  return reached.size;
}

export function BuildingAssignmentPicker({
  assignable,
  value,
  onChange,
  disabled = false,
  mustRestrict = false,
}: BuildingAssignmentPickerProps) {
  const { t } = useLocalizationContext();
  const restricted = value.restricted || mustRestrict;

  const impliedByCompound = useMemo(
    () => impliedBuildings(assignable, value.compoundIds),
    [assignable, value.compoundIds],
  );
  const effectiveCount = useMemo(
    () => assignedBuildingCount(assignable, value),
    [assignable, value],
  );

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold">
            {t("admin.userDetail.buildingScope.toggle", {
              defaultValue: "Limit to assigned buildings",
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {restricted
              ? t("admin.userDetail.buildingScope.toggleOn", {
                  defaultValue:
                    "This employee sees only what is ticked below — properties, units, contracts, tenants, payments, maintenance and reports alike.",
                })
              : t("admin.userDetail.buildingScope.toggleOff", {
                  defaultValue: "This employee sees the whole organization.",
                })}
          </p>
          {mustRestrict && (
            <p className="text-xs text-muted-foreground">
              {t("admin.userDetail.buildingScope.mustRestrict", {
                defaultValue:
                  "You are limited to some buildings yourself, so the people you add are too.",
              })}
            </p>
          )}
        </div>
        <Switch
          checked={restricted}
          disabled={disabled || mustRestrict}
          onCheckedChange={(checked) =>
            onChange({ ...value, restricted: checked })
          }
        />
      </div>

      {restricted && (
        <>
          {effectiveCount === 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {t("admin.userDetail.buildingScope.emptyWarning", {
                defaultValue:
                  "Nothing is assigned, so this employee will see no properties at all. Tick at least one compound or building.",
              })}
            </p>
          )}

          {assignable.compounds.length > 0 && (
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                {t("admin.userDetail.buildingScope.compounds", {
                  defaultValue: "Compounds",
                })}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("admin.userDetail.buildingScope.compoundsHint", {
                  defaultValue:
                    "Assigning a compound includes every building in it, now and in future.",
                })}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {assignable.compounds.map((compound) => (
                  <label
                    key={compound.id}
                    className="flex items-center gap-3 rounded-lg border p-3 text-sm"
                  >
                    <Checkbox
                      checked={value.compoundIds.includes(compound.id)}
                      disabled={disabled}
                      onCheckedChange={() =>
                        onChange({
                          ...value,
                          restricted: true,
                          compoundIds: toggle(value.compoundIds, compound.id),
                        })
                      }
                    />
                    <span className="flex-1">
                      <span className="font-medium">{compound.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {compound.addressCity}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <Label className="text-sm font-semibold">
              {t("admin.userDetail.buildingScope.properties", {
                defaultValue: "Buildings",
              })}
            </Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {assignable.properties.map((property) => {
                const via = impliedByCompound.get(property.id);
                return (
                  <label
                    key={property.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                      via ? "opacity-70" : ""
                    }`}
                  >
                    <Checkbox
                      checked={Boolean(via) || value.propertyIds.includes(property.id)}
                      disabled={disabled || Boolean(via)}
                      onCheckedChange={() =>
                        onChange({
                          ...value,
                          restricted: true,
                          propertyIds: toggle(value.propertyIds, property.id),
                        })
                      }
                    />
                    <span className="flex-1">
                      <span className="font-medium">{property.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[property.addressDistrict, property.addressCity]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {via && (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          {t("admin.userDetail.buildingScope.viaCompound", {
                            defaultValue: "Included via {{name}}",
                            values: { name: via },
                          })}
                        </Badge>
                      )}
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      <Building2 className="me-1 h-3 w-3" />
                      {property.totalUnits}
                    </Badge>
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {restricted
          ? t("admin.userDetail.buildingScope.summary", {
              defaultValue: "Sees {{count}} of {{total}} buildings",
              values: {
                count: effectiveCount,
                total: assignable.properties.length,
              },
            })
          : t("admin.userDetail.buildingScope.summaryAll", {
              defaultValue: "Sees all {{total}} buildings",
              values: { total: assignable.properties.length },
            })}
      </p>
    </div>
  );
}
