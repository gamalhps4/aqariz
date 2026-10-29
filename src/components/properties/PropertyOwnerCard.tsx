"use client";

/**
 * PropertyPro - Who owns this building, and putting it right
 *
 * `PATCH /api/properties/[id]/ownership` has existed, admin-gated and
 * audited, since ownership was taken out of the ordinary update schema — but
 * nothing in the app called it. So a building recorded against the wrong
 * owner stayed wrong, and ownership drives owner statements, the owner
 * portal, the owner filter on every report and the agreements. This is the
 * missing button.
 *
 * Read-only for everyone else. Seeing who owns a building is ordinary; moving
 * it between owners is not.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthorization } from "@/hooks/useAuthorization";
import { OwnerSelect } from "@/components/properties/OwnerSelect";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface PopulatedParty {
  _id?: string;
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface PropertyOwnerCardProps {
  propertyId: string;
  /** The populated `ownerId` the legacy response shape carries. */
  owner?: PopulatedParty | string | null;
  /** Called with the refreshed owner once a reassignment succeeds. */
  onChanged: (owner: PopulatedParty) => void;
}

function partyId(party: PropertyOwnerCardProps["owner"]): string {
  if (!party) return "";
  if (typeof party === "string") return party;
  return party._id ?? party.id ?? "";
}

function partyName(party: PropertyOwnerCardProps["owner"]): string {
  if (!party || typeof party === "string") return "";
  return `${party.firstName ?? ""} ${party.lastName ?? ""}`.trim();
}

export function PropertyOwnerCard({
  propertyId,
  owner,
  onChanged,
}: PropertyOwnerCardProps) {
  const { t } = useLocalizationContext();
  const { isAdmin } = useAuthorization();

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(partyId(owner));
  const [saving, setSaving] = useState(false);

  const currentId = partyId(owner);
  const name = partyName(owner);

  const save = async () => {
    if (!selected || selected === currentId) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        `/api/properties/${propertyId}/ownership`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerId: selected }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Failed to reassign the owner");
      }
      onChanged(payload.data?.owner ?? { _id: selected });
      setEditing(false);
      toast.success(
        t("properties.details.owner.saved", {
          defaultValue: "Owner reassigned",
        }),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("properties.details.owner.failed", {
              defaultValue: "Could not reassign the owner",
            }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border border-gray-100 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-900">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-800">
              <UserRound className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {name ||
                  t("properties.details.owner.unassigned", {
                    defaultValue: "No owner on record",
                  })}
              </p>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {t("properties.details.owner.label", { defaultValue: "Owner" })}
              </p>
            </div>
          </div>

          {isAdmin && !editing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected(currentId);
                setEditing(true);
              }}
            >
              {t("properties.details.owner.reassign", {
                defaultValue: "Reassign owner",
              })}
            </Button>
          )}
        </div>

        {isAdmin && editing && (
          <div className="space-y-3 border-t pt-4">
            <OwnerSelect value={selected} onChange={setSelected} />
            <p className="text-xs text-muted-foreground">
              {t("properties.details.owner.hint", {
                defaultValue:
                  "Statements, agreements and the owner's own portal all follow this. The change is recorded in the audit log.",
              })}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving || !selected}>
                {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t("common.save", { defaultValue: "Save" })}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
