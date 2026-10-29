"use client";

/**
 * PropertyPro - The office's listing details
 *
 * The brokerage licence (FAL, رخصة فال) printed on every public page beside
 * each listing's advertising licence, and the phone and WhatsApp numbers a new
 * listing starts with. Kept once for the office — see lib/listings/settings.ts.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { OfficeSettingsDto } from "@/lib/listings/types";
import { describeFailure } from "./listing-ui";

interface OfficeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** May the viewer change them (Manage listings or Company settings). */
  canEdit: boolean;
  onSaved?: (settings: OfficeSettingsDto) => void;
}

interface Draft {
  falLicenceNumber: string;
  falLicenceExpiry: string;
  contactPhone: string;
  whatsappNumber: string;
}

const EMPTY: Draft = {
  falLicenceNumber: "",
  falLicenceExpiry: "",
  contactPhone: "",
  whatsappNumber: "",
};

export function OfficeSettingsDialog({
  open,
  onOpenChange,
  canEdit,
  onSaved,
}: OfficeSettingsDialogProps) {
  const { t } = useLocalizationContext();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/marketing/settings")
      .then((response) => response.json().catch(() => null))
      .then((payload) => {
        if (cancelled || !payload?.success) return;
        const data = payload.data as OfficeSettingsDto;
        setDraft({
          falLicenceNumber: data.falLicenceNumber ?? "",
          falLicenceExpiry: data.falLicenceExpiry ?? "",
          contactPhone: data.contactPhone ?? "",
          whatsappNumber: data.whatsappNumber ?? "",
        });
        setExpired(data.falExpired);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const set = (key: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/marketing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          falLicenceNumber: draft.falLicenceNumber,
          falLicenceExpiry: draft.falLicenceExpiry || null,
          contactPhone: draft.contactPhone,
          whatsappNumber: draft.whatsappNumber,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        setError(
          describeFailure(
            t,
            payload,
            t("marketing.office.saveFailed", {
              defaultValue: "The details could not be saved",
            }),
          ),
        );
        return;
      }
      toast.success(
        t("marketing.office.saved", { defaultValue: "The office details were saved" }),
      );
      onSaved?.(payload.data as OfficeSettingsDto);
      onOpenChange(false);
    } catch {
      setError(
        t("marketing.office.saveFailed", {
          defaultValue: "The details could not be saved",
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("marketing.office.title", { defaultValue: "Office details" })}
          </DialogTitle>
          <DialogDescription>
            {t("marketing.office.description", {
              defaultValue:
                "Shown on your public listings page, beside each listing's advertising licence.",
            })}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {expired && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {t("marketing.office.falExpired", {
                  defaultValue:
                    "The brokerage licence has expired, so it is no longer printed on the public page. Enter the renewed licence.",
                })}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fal-number">
                  {t("marketing.office.falNumber", {
                    defaultValue: "Brokerage licence number (FAL)",
                  })}
                </Label>
                <Input
                  id="fal-number"
                  value={draft.falLicenceNumber}
                  onChange={(event) => set("falLicenceNumber")(event.target.value)}
                  disabled={!canEdit}
                  dir="ltr"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fal-expiry">
                  {t("marketing.office.falExpiry", {
                    defaultValue: "Brokerage licence expiry",
                  })}
                </Label>
                <Input
                  id="fal-expiry"
                  type="date"
                  value={draft.falLicenceExpiry}
                  onChange={(event) => set("falLicenceExpiry")(event.target.value)}
                  disabled={!canEdit}
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="office-phone">
                  {t("marketing.office.phone", { defaultValue: "Phone" })}
                </Label>
                <Input
                  id="office-phone"
                  value={draft.contactPhone}
                  onChange={(event) => set("contactPhone")(event.target.value)}
                  disabled={!canEdit}
                  dir="ltr"
                  inputMode="tel"
                  placeholder="05XXXXXXXX"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="office-whatsapp">
                  {t("marketing.office.whatsapp", { defaultValue: "WhatsApp number" })}
                </Label>
                <Input
                  id="office-whatsapp"
                  value={draft.whatsappNumber}
                  onChange={(event) => set("whatsappNumber")(event.target.value)}
                  disabled={!canEdit}
                  dir="ltr"
                  inputMode="tel"
                  placeholder="05XXXXXXXX"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("marketing.office.contactsHint", {
                defaultValue:
                  "The phone and WhatsApp numbers are what a new listing starts with; each listing keeps its own.",
              })}
            </p>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          {canEdit && (
            <Button onClick={save} disabled={saving || loading}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("common.save", { defaultValue: "Save" })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
