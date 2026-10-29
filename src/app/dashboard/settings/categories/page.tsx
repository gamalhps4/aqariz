"use client";

/**
 * PropertyPro - Property category & unit type management
 *
 * The list used to be a compile-time enum, so adding "Residential Tower" or a
 * "Shop" unit type meant a code change. This screen is where an organization
 * extends it instead.
 *
 * Two guard rails matter here and are enforced by the API too:
 *  - a slug is never editable — it is the value already stored on every
 *    property/unit row that uses it;
 *  - a category in use, or a seeded default, cannot be deleted. Deactivating
 *    removes it from the pickers while existing records keep their label.
 */

import { useCallback, useEffect, useState } from "react";
import { Building2, DoorOpen, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsLayout } from "@/components/settings/settings-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  refreshPropertyCategories,
  type CategoryKind,
  type CategoryOption,
} from "@/hooks/use-property-categories";

const KINDS: Array<{
  kind: CategoryKind;
  labelKey: string;
  fallback: string;
  icon: typeof Building2;
}> = [
  {
    kind: "property",
    labelKey: "settings.categories.propertyCategories",
    fallback: "Property categories",
    icon: Building2,
  },
  {
    kind: "unit",
    labelKey: "settings.categories.unitTypes",
    fallback: "Unit types",
    icon: DoorOpen,
  },
];

interface DraftCategory {
  nameEn: string;
  nameAr: string;
}

function CategoryPanel({ kind }: { kind: CategoryKind }) {
  const { t } = useLocalizationContext();

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftCategory>({ nameEn: "", nameAr: "" });
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CategoryOption | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // activeOnly is omitted on purpose: this screen manages the full list,
      // including the categories that are currently switched off.
      const response = await fetch(`/api/property-categories?kind=${kind}`);
      const payload = await response.json();
      if (payload?.success) setCategories(payload.data?.categories ?? []);
    } catch (loadError) {
      console.error("Failed to load categories:", loadError);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    load();
  }, [load]);

  const afterMutation = async () => {
    refreshPropertyCategories();
    await load();
  };

  const toggleActive = async (category: CategoryOption, isActive: boolean) => {
    setSaving(category.id);
    setError(null);
    try {
      const response = await fetch(`/api/property-categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        setError(result?.message || result?.error || "Update failed");
        return;
      }
      await afterMutation();
    } finally {
      setSaving(null);
    }
  };

  const rename = async (category: CategoryOption, nameEn: string, nameAr: string) => {
    if (nameEn === category.nameEn && nameAr === (category.nameAr ?? "")) return;
    setSaving(category.id);
    setError(null);
    try {
      const response = await fetch(`/api/property-categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameEn, nameAr: nameAr || null }),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        setError(result?.message || result?.error || "Update failed");
        return;
      }
      await afterMutation();
    } finally {
      setSaving(null);
    }
  };

  const addCategory = async () => {
    if (!draft.nameEn.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const response = await fetch("/api/property-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          nameEn: draft.nameEn.trim(),
          nameAr: draft.nameAr.trim() || null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        setError(result?.message || result?.error || "Could not add category");
        return;
      }
      setDraft({ nameEn: "", nameAr: "" });
      await afterMutation();
    } finally {
      setAdding(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setSaving(pendingDelete.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/property-categories/${pendingDelete.id}`,
        { method: "DELETE" },
      );
      const result = await response.json();
      if (!response.ok || !result?.success) {
        setError(result?.message || result?.error || "Could not delete");
        return;
      }
      setPendingDelete(null);
      await afterMutation();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-nameEn`}>
            {t("settings.categories.nameEn", { defaultValue: "Name (English)" })}
          </Label>
          <Input
            id={`${kind}-nameEn`}
            value={draft.nameEn}
            onChange={(event) =>
              setDraft((current) => ({ ...current, nameEn: event.target.value }))
            }
            placeholder={
              kind === "unit" ? "Rooftop Suite" : "Residential Compound"
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-nameAr`}>
            {t("settings.categories.nameAr", { defaultValue: "Name (Arabic)" })}
          </Label>
          <Input
            id={`${kind}-nameAr`}
            value={draft.nameAr}
            onChange={(event) =>
              setDraft((current) => ({ ...current, nameAr: event.target.value }))
            }
            dir="rtl"
          />
        </div>
        <Button onClick={addCategory} disabled={adding || !draft.nameEn.trim()}>
          {adding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {t("settings.categories.add", { defaultValue: "Add" })}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {categories.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              busy={saving === category.id}
              onToggle={(isActive) => toggleActive(category, isActive)}
              onRename={(nameEn, nameAr) => rename(category, nameEn, nameAr)}
              onDelete={() => setPendingDelete(category)}
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.categories.deleteTitle", {
                defaultValue: "Delete category?",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.categories.deleteDescription", {
                defaultValue:
                  'This removes "{name}" from the picker permanently. It is only possible while no record uses it — otherwise deactivate it instead.',
                values: { name: pendingDelete?.nameEn ?? "" },
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("common.delete", { defaultValue: "Delete" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CategoryRow({
  category,
  busy,
  onToggle,
  onRename,
  onDelete,
}: {
  category: CategoryOption;
  busy: boolean;
  onToggle: (isActive: boolean) => void;
  onRename: (nameEn: string, nameAr: string) => void;
  onDelete: () => void;
}) {
  const { t } = useLocalizationContext();
  const [nameEn, setNameEn] = useState(category.nameEn);
  const [nameAr, setNameAr] = useState(category.nameAr ?? "");

  useEffect(() => {
    setNameEn(category.nameEn);
    setNameAr(category.nameAr ?? "");
  }, [category.nameEn, category.nameAr]);

  return (
    <div className="grid items-center gap-3 p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
      <div className="space-y-1">
        <Input
          value={nameEn}
          onChange={(event) => setNameEn(event.target.value)}
          onBlur={() => onRename(nameEn.trim() || category.nameEn, nameAr.trim())}
          disabled={busy}
          className="h-9"
        />
        <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          {category.slug}
        </p>
      </div>

      <Input
        value={nameAr}
        onChange={(event) => setNameAr(event.target.value)}
        onBlur={() => onRename(nameEn.trim() || category.nameEn, nameAr.trim())}
        disabled={busy}
        dir="rtl"
        className="h-9"
      />

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={category.isActive}
          disabled={busy}
          onCheckedChange={(checked) => onToggle(checked === true)}
        />
        <span className="text-muted-foreground">
          {t("settings.categories.active", { defaultValue: "Active" })}
        </span>
      </label>

      <div className="flex items-center justify-end gap-2">
        {category.isSystem ? (
          <Badge variant="outline" className="text-xs font-normal">
            {t("settings.categories.builtIn", { defaultValue: "Built-in" })}
          </Badge>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive"
            onClick={onDelete}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function CategorySettingsPage() {
  const { t } = useLocalizationContext();
  const [activeKind, setActiveKind] = useState<CategoryKind>("property");

  return (
    <SettingsLayout
      title={t("settings.categories.title", {
        defaultValue: "Categories & unit types",
      })}
      description={t("settings.categories.description", {
        defaultValue:
          "Define the property categories and unit types your team can choose from",
      })}
      section="categories"
      adminOnly
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {KINDS.map(({ kind, labelKey, fallback, icon: Icon }) => (
              <Button
                key={kind}
                type="button"
                variant={activeKind === kind ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveKind(kind)}
              >
                <Icon className="h-4 w-4" />
                {t(labelKey, { defaultValue: fallback })}
              </Button>
            ))}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Keyed so switching tabs remounts with the right kind's state
              instead of briefly showing the previous list. */}
          <CategoryPanel key={activeKind} kind={activeKind} />
        </CardContent>
      </Card>
    </SettingsLayout>
  );
}
