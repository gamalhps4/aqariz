"use client";

/**
 * PropertyPro - Add an owner
 *
 * The owners list is derived from who owns each property, which works
 * perfectly for a landlord managing their own buildings but left a management
 * office with no way to enter a client it has just signed: the owner had to
 * exist as a user before a property could point at them, and creating that
 * user meant Administration → Users and knowing to pick the Owner role.
 *
 * This asks only for identity. Payout details, tax numbers and notes are the
 * profile form on the owner's own page, which is where the dialog sends you
 * next — so the two forms never ask for the same thing twice.
 *
 * The name is one field, as on the tenant forms and the contract: split into
 * a first and a last name, "أحمد بن عبدالله السيد" had no last name to put in
 * the second box, and a company or a person known by one name could not be
 * entered at all.
 */

import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { personErrorText } from "@/lib/person-error-text";

/** What the caller learns about the owner it just created. */
export interface CreatedOwner {
  userId: string;
  name: string;
  /**
   * False when the caller is narrowed to some buildings: a new owner holds
   * none of theirs yet, so the owner's page is not theirs to open.
   */
  inReach: boolean;
}

interface AddOwnerDialogProps {
  /** Called with the new owner's user id once the record exists. */
  onCreated: (userId: string, owner: CreatedOwner) => void | Promise<void>;
  trigger?: React.ReactNode;
}

const EMPTY = {
  fullName: "",
  email: "",
  phone: "",
  companyName: "",
  nationalId: "",
};

export function AddOwnerDialog({ onCreated, trigger }: AddOwnerDialogProps) {
  const { t } = useLocalizationContext();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  const set = (field: keyof typeof form, value: string) =>
    setForm((previous) => ({ ...previous, [field]: value }));

  // Email is deliberately absent from this list: an owner is a client
  // record, not a login, and many are known only by phone and national ID.
  const canSubmit = form.fullName.trim() !== "";

  const reset = () => {
    setForm(EMPTY);
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);

    try {
      // No userId in the body is what tells the endpoint this is a new
      // person rather than a profile for an existing one.
      const response = await fetch("/api/owners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Split into the stored columns by the server (lib/full-name.ts).
          fullName: form.fullName.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || null,
          companyName: form.companyName.trim() || null,
          nationalId: form.nationalId.trim() || null,
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(
          personErrorText(
            t,
            result,
            t("errors.ui.saveFailed", { defaultValue: "Could not save. Try again." }),
          ),
        );
        return;
      }

      setOpen(false);
      reset();
      await onCreated(result.data.userId, {
        userId: result.data.userId,
        name: result.data.name ?? form.fullName.trim(),
        inReach: result.data.inReach !== false,
      });
    } catch (submitError) {
      console.error("Failed to create owner:", submitError);
      setError(
        t("errors.ui.saveFailed", { defaultValue: "Could not save. Try again." }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <UserPlus className="me-2 h-4 w-4" />
            {t("clients.owners.add.trigger", { defaultValue: "Add owner" })}
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {t("clients.owners.add.title", { defaultValue: "Add owner" })}
          </DialogTitle>
          <DialogDescription>
            {t("clients.owners.add.description", {
              defaultValue:
                "Create the owner record now; payout and tax details can be filled in on their page afterwards.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ownerFullName">
              {t("clients.owners.add.fullName", { defaultValue: "Full name" })}
            </Label>
            <Input
              id="ownerFullName"
              value={form.fullName}
              onChange={(event) => set("fullName", event.target.value)}
              placeholder={t("clients.owners.add.fullNamePlaceholder", {
                defaultValue: "Full name as written on the ID",
              })}
              maxLength={160}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ownerEmail">
              {t("clients.owners.add.email", { defaultValue: "Email" })}
              <span className="ms-1 text-xs font-normal text-muted-foreground">
                {t("clients.owners.add.emailOptional", {
                  defaultValue: "(optional)",
                })}
              </span>
            </Label>
            <Input
              id="ownerEmail"
              type="email"
              value={form.email}
              onChange={(event) => set("email", event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("clients.owners.add.emailHint", {
                defaultValue:
                  "Needed only if this owner should sign in to the portal.",
              })}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ownerPhone">
                {t("clients.owners.add.phone", { defaultValue: "Phone" })}
              </Label>
              <Input
                id="ownerPhone"
                value={form.phone}
                onChange={(event) => set("phone", event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ownerNationalId">
                {t("clients.owners.add.nationalId", {
                  defaultValue: "ID / CR number",
                })}
              </Label>
              <Input
                id="ownerNationalId"
                value={form.nationalId}
                onChange={(event) => set("nationalId", event.target.value)}
              />
            </div>
          </div>

          {/* Filled in only when the owner is a company; the statement prints
              this name instead of the person's. */}
          <div className="space-y-2">
            <Label htmlFor="ownerCompanyName">
              {t("clients.owners.add.companyName", {
                defaultValue: "Company name (leave blank for an individual)",
              })}
            </Label>
            <Input
              id="ownerCompanyName"
              value={form.companyName}
              onChange={(event) => set("companyName", event.target.value)}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button onClick={submit} disabled={!canSubmit || saving}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t("clients.owners.add.submit", { defaultValue: "Create owner" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
