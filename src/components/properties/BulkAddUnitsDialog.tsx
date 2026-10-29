"use client";

/**
 * PropertyPro - Add several units at once
 *
 * The client's request: pick a unit type, a base name and a starting number,
 * tick "Auto-number unit names" to get "Driver Room 1" … "Driver Room N", and
 * see the whole list before saving — every name editable, any row removable.
 *
 * The list is derived from the fields above it, so changing them rebuilds it
 * and drops the edits made to the old one (the hint says so),
 * and the problems shown on each row are the ones the API refuses
 * (lib/units/bulk-names), so what saves is exactly what was checked.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Layers, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CategorySelectItems } from "@/components/properties/category-select-items";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  MAX_BULK_UNITS,
  findNameProblems,
  generateUnitNames,
} from "@/lib/units/bulk-names";

interface BulkAddUnitsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  /** The building's current unit numbers, to flag names already taken. */
  existingUnitNumbers: string[];
  onUnitsAdded: () => void;
}

const STATUSES = ["available", "occupied", "maintenance", "unavailable"] as const;

interface Row {
  id: number;
  name: string;
}

/** Edits made to one generated list; a different list starts clean. */
interface Edits {
  signature: string;
  names: Record<number, string>;
  removed: number[];
}

export function BulkAddUnitsDialog({
  open,
  onOpenChange,
  propertyId,
  existingUnitNumbers,
  onUnitsAdded,
}: BulkAddUnitsDialogProps) {
  const { t } = useLocalizationContext();
  const [unitType, setUnitType] = useState("apartment");
  const [baseName, setBaseName] = useState("");
  const [start, setStart] = useState("1");
  const [count, setCount] = useState("5");
  const [autoNumber, setAutoNumber] = useState(true);
  const [rentAmount, setRentAmount] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("available");
  const [saving, setSaving] = useState(false);

  // The generator fields decide the list; edits apply to that list only.
  const signature = JSON.stringify([baseName, start, count, autoNumber]);
  const [edits, setEdits] = useState<Edits>({ signature, names: {}, removed: [] });
  const rows: Row[] = useMemo(() => {
    const current: Pick<Edits, "names" | "removed"> =
      edits.signature === signature ? edits : { names: {}, removed: [] };
    return generateUnitNames({
      baseName,
      start: Number(start),
      count: Number(count),
      autoNumber,
    })
      .map((name, id) => ({ id, name: current.names[id] ?? name }))
      .filter((row) => !current.removed.includes(row.id));
  }, [edits, signature, baseName, start, count, autoNumber]);

  const problems = useMemo(
    () => findNameProblems(rows.map((row) => row.name), existingUnitNumbers),
    [rows, existingUnitNumbers],
  );

  const reset = () => {
    setBaseName("");
    setStart("1");
    setCount("5");
    setAutoNumber(true);
    setRentAmount("");
    setStatus("available");
  };

  const close = (next: boolean) => {
    if (saving) return;
    onOpenChange(next);
    if (!next) reset();
  };

  const editList = (change: (edits: Edits) => Edits) =>
    setEdits((previous) =>
      change(
        previous.signature === signature
          ? previous
          : { signature, names: {}, removed: [] },
      ),
    );
  const rename = (id: number, name: string) =>
    editList((current) => ({ ...current, names: { ...current.names, [id]: name } }));
  const remove = (id: number) =>
    editList((current) => ({ ...current, removed: [...current.removed, id] }));

  const canSave = rows.length > 0 && problems.size === 0 && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/properties/${propertyId}/units/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          units: rows.map((row) => ({ unitNumber: row.name.trim() })),
          unitType,
          status,
          ...(rentAmount.trim() ? { rentAmount: Number(rentAmount) } : {}),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || t("properties.units.bulk.error"));
      }
      toast.success(
        t("properties.units.bulk.success", {
          values: { count: result.data?.created ?? rows.length },
        }),
      );
      onUnitsAdded();
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("properties.units.bulk.error"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-blue-600" />
            {t("properties.units.bulk.title")}
          </DialogTitle>
          <DialogDescription>
            {t("properties.units.bulk.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("properties.form.units.fields.unitType")}</Label>
            <Select value={unitType} onValueChange={setUnitType}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t("properties.units.form.fields.unitType.placeholder")}
                />
              </SelectTrigger>
              <SelectContent>
                <CategorySelectItems kind="unit" includeSlug={unitType} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-base-name">{t("properties.units.bulk.baseName")}</Label>
            <Input
              id="bulk-base-name"
              value={baseName}
              placeholder={t("properties.units.bulk.baseNamePlaceholder")}
              onChange={(event) => setBaseName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-start">{t("properties.units.bulk.start")}</Label>
            <Input
              id="bulk-start"
              type="number"
              inputMode="numeric"
              min={0}
              value={start}
              disabled={!autoNumber}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-count">{t("properties.units.bulk.count")}</Label>
            <Input
              id="bulk-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_BULK_UNITS}
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("properties.units.bulk.maxHint", { values: { max: MAX_BULK_UNITS } })}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-rent">{t("properties.units.bulk.rentOptional")}</Label>
            <Input
              id="bulk-rent"
              type="number"
              inputMode="decimal"
              min={0}
              value={rentAmount}
              onChange={(event) => setRentAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("properties.form.units.fields.status")}</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as (typeof STATUSES)[number])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`properties.status.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-start gap-3 rounded-lg border p-3 sm:col-span-2">
            <Checkbox
              checked={autoNumber}
              onCheckedChange={(checked) => setAutoNumber(checked === true)}
              className="mt-0.5"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">
                {t("properties.units.bulk.autoNumber")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("properties.units.bulk.autoNumberHint")}
              </span>
            </span>
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">
              {t("properties.units.bulk.preview", { values: { count: rows.length } })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("properties.units.bulk.rebuildHint")}
            </p>
          </div>
          {rows.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("properties.units.bulk.empty")}
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>{t("properties.units.bulk.colName")}</TableHead>
                    <TableHead className="w-16 text-end">
                      <span className="sr-only">{t("properties.units.bulk.removeRow")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => {
                    const problem = problems.get(index);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell>
                          <Input
                            value={row.name}
                            aria-invalid={problem ? true : undefined}
                            className={problem ? "border-destructive" : undefined}
                            onChange={(event) => rename(row.id, event.target.value)}
                          />
                          {problem && (
                            <p className="mt-1 text-xs text-destructive">
                              {t(`properties.units.bulk.problem.${problem}`)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("properties.units.bulk.removeRow")}
                            onClick={() => remove(row.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button type="button" onClick={submit} disabled={!canSave}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t("properties.units.bulk.submit", { values: { count: rows.length } })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
