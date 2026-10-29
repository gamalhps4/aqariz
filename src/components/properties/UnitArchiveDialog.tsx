"use client";

/**
 * PropertyPro - Moving a unit to the archive
 *
 * The unit delete buttons had been commented out on every screen, so a unit
 * entered by mistake, or one knocked into its neighbour, could not be removed
 * at all — although the API archived units correctly. This is the one
 * confirmation both the building's unit list and the unit's own page use.
 *
 * The unit goes to the Archive with its pictures kept, and can be restored
 * there. A let unit is refused by the server and said so here.
 */

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { hasAnyPermission } from "@/lib/permissions-manager";

/** The right DELETE /api/properties/[id]/units/[unitId] asks for. */
export function useCanArchiveUnits(): boolean {
  const { permissions } = useAuthorization();
  return hasAnyPermission(permissions, ["property_edit"]);
}

interface UnitArchiveDialogProps {
  propertyId: string;
  unitId: string;
  unitNumber: string;
  /** Called once the unit is in the archive. */
  onArchived: () => void | Promise<void>;
  /** The control that opens the confirmation. */
  children: React.ReactNode;
}

export function UnitArchiveDialog({
  propertyId,
  unitId,
  unitNumber,
  onArchived,
  children,
}: UnitArchiveDialogProps) {
  const { t } = useLocalizationContext();
  const [busy, setBusy] = useState(false);

  const archive = async () => {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/properties/${propertyId}/units/${unitId}`,
        { method: "DELETE" },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(
          result?.code === "UNIT_OCCUPIED"
            ? t("properties.units.archive.occupied", {
                defaultValue:
                  "This unit is let. End its contract before deleting it.",
              })
            : t("properties.units.archive.failed", {
                defaultValue: "The unit could not be deleted.",
              }),
        );
        return;
      }
      toast.success(
        t("properties.units.archive.done", {
          defaultValue: "Unit {unit} was moved to the archive.",
          values: { unit: unitNumber },
        }),
      );
      await onArchived();
    } finally {
      setBusy(false);
    }
  };

  return (
    // Clicks inside the dialog travel up the React tree to whatever holds
    // the trigger — on the unit list, a card that opens the unit's details.
    <span onClick={(event) => event.stopPropagation()} className="contents">
      <ConfirmationDialog
        title={t("properties.units.archive.title", {
          defaultValue: "Delete unit {unit}?",
          values: { unit: unitNumber },
        })}
        description={t("properties.units.archive.description", {
          defaultValue:
            "It moves to the Archive with its pictures, and can be restored there. A let unit cannot be deleted.",
        })}
        confirmText={t("properties.units.archive.confirm", {
          defaultValue: "Delete unit",
        })}
        variant="destructive"
        onConfirm={archive}
        loading={busy}
      >
        {children}
      </ConfirmationDialog>
    </span>
  );
}
