"use client";

/**
 * PropertyPro - Choosing who owns a building
 *
 * Every building must name an owner, because `Property.ownerId` is what the
 * owners list, the owner portal, the owner filter on every report and the
 * management agreements are all built from. The create form used to ask for
 * none, and the API quietly filled in whoever was signed in — so an office
 * that manages other people's buildings ended up owning all of them, with no
 * screen anywhere to correct it.
 *
 * Hence an explicit choice with no default. A landlord managing their own
 * portfolio is a real case, so "I own this myself" is offered as an option
 * the person picks, not as a blank that resolves to them behind their back.
 *
 * Shared by the create form and the reassignment card on a building's page,
 * so the two always offer the same people.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AddOwnerDialog } from "@/components/owners/AddOwnerDialog";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface OwnerOption {
  userId: string;
  name: string;
  email: string;
  companyName: string | null;
  propertyCount: number;
}

interface OwnerSelectProps {
  /** The chosen owner's user id; "" means nothing chosen yet. */
  value: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
  /** Hides the inline "add owner" affordance where it does not belong. */
  allowCreate?: boolean;
}

export function OwnerSelect({
  value,
  onChange,
  disabled,
  allowCreate = true,
}: OwnerSelectProps) {
  const { t } = useLocalizationContext();
  const { data: session } = useSession();

  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (keep?: OwnerOption) => {
    try {
      const response = await fetch("/api/owners");
      const payload = response.ok ? await response.json() : null;
      if (!payload?.success) return;
      const loaded: OwnerOption[] = (payload.data ?? []).map((row: any) => ({
        userId: row.userId,
        name: (row.name ?? "").trim(),
        email: row.email ?? "",
        companyName: row.companyName ?? null,
        propertyCount: row.propertyCount ?? 0,
      }));
      // The owner just created stays on offer even when the list cannot
      // carry them: for someone narrowed to some buildings the list is the
      // owners of those, and a new owner holds none of them yet — so the
      // choice they just made would otherwise show as nothing chosen.
      if (keep && !loaded.some((owner) => owner.userId === keep.userId)) {
        loaded.push(keep);
      }
      setOwners(loaded);
    } catch (error) {
      // A failed load must not trap someone on the form with no way forward;
      // the list is empty, the field stays required, and "add owner" still
      // works.
      console.error("Failed to load owners:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The signed-in person is only offered when they are not already an owner
  // in their own right — otherwise they would appear twice under two names.
  const self = session?.user;
  const selfAlreadyListed = owners.some((owner) => owner.userId === self?.id);

  const label = (owner: OwnerOption) => {
    const name = owner.name || owner.email || owner.userId;
    return owner.companyName ? `${name} — ${owner.companyName}` : name;
  };

  return (
    <div className="space-y-2">
      <Select
        value={value || undefined}
        onValueChange={onChange}
        disabled={disabled || loading}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={
              loading
                ? t("properties.form.fields.owner.loading", {
                    defaultValue: "Loading owners…",
                  })
                : t("properties.form.fields.owner.placeholder", {
                    defaultValue: "Select the owner",
                  })
            }
          />
        </SelectTrigger>
        <SelectContent>
          {self?.id && !selfAlreadyListed && (
            <SelectItem value={self.id}>
              {t("properties.form.fields.owner.self", {
                defaultValue: "I own this myself",
              })}
            </SelectItem>
          )}
          {owners.map((owner) => (
            <SelectItem key={owner.userId} value={owner.userId}>
              {label(owner)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {allowCreate && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          <span>
            {t("properties.form.fields.owner.missing", {
              defaultValue: "Owner not in the list?",
            })}
          </span>
          {/* Creating the owner here rather than sending someone to
              Administration → Users and back, losing the form on the way. */}
          <AddOwnerDialog
            onCreated={async (userId, created) => {
              await load({
                userId,
                name: created.name,
                email: "",
                companyName: null,
                propertyCount: 0,
              });
              onChange(userId);
            }}
            // `type="button"` spelled out: this sits inside the property form,
            // and a trigger that defaults to submit would save a half-filled
            // building the moment someone reached for the dialog.
            trigger={
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
              >
                {t("clients.owners.add.trigger", { defaultValue: "Add owner" })}
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
