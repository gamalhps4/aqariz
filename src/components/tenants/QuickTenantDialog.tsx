"use client";

/**
 * PropertyPro - Add a tenant without leaving the contract
 *
 * "Add a tenant from the New Lease Contract page without having to leave the
 * page." Sending the operator to /dashboard/tenants/new mid-contract throws
 * away everything they had typed — the building, the unit, the dates — so the
 * contract is begun twice.
 *
 * This asks only what a contract needs: who they are, what they are, the ID
 * the contract is written against, and a phone number. Email is optional,
 * because most of these tenants do not have one on file — the whole point of
 * the review item that made it optional everywhere else.
 *
 * No password: the office does not choose a tenant's password (client
 * request, 2026-10-16). A tenant with an address chooses one through
 * "Forgot your password?" on the sign-in page, which sets the first one.
 */

import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { personErrorText } from "@/lib/person-error-text";

export interface QuickTenant {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

interface QuickTenantDialogProps {
  /** Handed the tenant that was just created, so the caller can select it. */
  onCreated: (tenant: QuickTenant) => void;
  disabled?: boolean;
}

interface FormState {
  fullName: string;
  entityType: "individual" | "company";
  idNumber: string;
  phone: string;
  email: string;
}

const EMPTY: FormState = {
  fullName: "",
  entityType: "individual",
  idNumber: "",
  phone: "",
  email: "",
};

export function QuickTenantDialog({
  onCreated,
  disabled,
}: QuickTenantDialogProps) {
  const { t } = useLocalizationContext();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasEmail = form.email.trim() !== "";

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const close = () => {
    setOpen(false);
    setForm(EMPTY);
    setError(null);
  };

  const submit = async () => {
    if (!form.fullName.trim()) {
      setError(
        t("tenants.quickAdd.errors.nameRequired", {
          defaultValue: "A name is required.",
        }),
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          entityType: form.entityType,
          idNumber: form.idNumber.trim() || undefined,
          phone: form.phone.trim() || undefined,
          // Blank means "no address", which the API stores as NULL rather
          // than an empty string that would collide with the next one.
          email: form.email.trim() || undefined,
          sendInvitation: false,
          role: "tenant",
          tenantStatus: "active",
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        // Name and email refusals arrive as codes, said in the reader's
        // language; a one-word name is accepted by the server now.
        setError(
          personErrorText(
            t,
            result,
            t("tenants.quickAdd.errors.failed", {
              defaultValue: "The tenant could not be created.",
            }),
          ),
        );
        return;
      }

      // The API answers with the created user under a couple of shapes
      // depending on the creation mode; take whichever carries an id.
      const created = result.data?.user ?? result.data;
      const id = created?.id ?? created?._id;
      if (!id) {
        setError(
          t("tenants.quickAdd.errors.failed", {
            defaultValue: "The tenant could not be created.",
          }),
        );
        return;
      }

      onCreated({
        id,
        firstName: created.firstName ?? form.fullName.trim(),
        lastName: created.lastName ?? "",
        email: created.email ?? null,
      });
      toast.success(
        t("tenants.quickAdd.created", {
          defaultValue: "{name} was added and selected.",
          values: { name: form.fullName.trim() },
        }),
      );
      close();
    } catch {
      setError(
        t("tenants.quickAdd.errors.failed", {
          defaultValue: "The tenant could not be created.",
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0"
          disabled={disabled}
          title={t("tenants.quickAdd.trigger", {
            defaultValue: "Add a new tenant",
          })}
          aria-label={t("tenants.quickAdd.trigger", {
            defaultValue: "Add a new tenant",
          })}
        >
          <UserPlus className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("tenants.quickAdd.title", { defaultValue: "Add a tenant" })}
          </DialogTitle>
          <DialogDescription>
            {t("tenants.quickAdd.subtitle", {
              defaultValue:
                "Just what the contract needs — the rest can be filled in on their page later.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="quick-tenant-name">
              {t("tenants.form.fields.fullName.label", {
                defaultValue: "Full name",
              })}
            </Label>
            <Input
              id="quick-tenant-name"
              value={form.fullName}
              onChange={(event) => set("fullName", event.target.value)}
              placeholder={t("tenants.form.fields.fullName.placeholder", {
                defaultValue: "Full name as written on the ID",
              })}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-tenant-entity">
              {t("tenants.form.fields.entityType.label", {
                defaultValue: "Entity type",
              })}
            </Label>
            <Select
              value={form.entityType}
              onValueChange={(value) =>
                set("entityType", value as FormState["entityType"])
              }
            >
              <SelectTrigger id="quick-tenant-entity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">
                  {t("tenants.form.fields.entityType.individual", {
                    defaultValue: "Individual",
                  })}
                </SelectItem>
                <SelectItem value="company">
                  {t("tenants.form.fields.entityType.company", {
                    defaultValue: "Company",
                  })}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-tenant-id">
              {form.entityType === "company"
                ? t("tenants.form.fields.commercialRegistration.label", {
                    defaultValue: "Commercial registration",
                  })
                : t("tenants.form.fields.idNumber.label", {
                    defaultValue: "ID number",
                  })}
            </Label>
            <Input
              id="quick-tenant-id"
              value={form.idNumber}
              onChange={(event) => set("idNumber", event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-tenant-phone">
              {t("tenants.form.fields.phone.label", {
                defaultValue: "Phone",
              })}
            </Label>
            <Input
              id="quick-tenant-phone"
              value={form.phone}
              onChange={(event) => set("phone", event.target.value)}
              placeholder="+966 5X XXX XXXX"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-tenant-email">
              {t("tenants.form.fields.email.label", { defaultValue: "Email" })}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {t("tenants.form.fields.email.optional", {
                  defaultValue: "(optional)",
                })}
              </span>
            </Label>
            <Input
              id="quick-tenant-email"
              type="email"
              value={form.email}
              onChange={(event) => set("email", event.target.value)}
            />
          </div>

          {/* Only an address makes a sign-in possible: say how the tenant
              gets in, since nobody here chooses their password. */}
          {hasEmail && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {t("tenants.quickAdd.passwordBySelf")}
            </p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t("tenants.quickAdd.submit", { defaultValue: "Add tenant" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
