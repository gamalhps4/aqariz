"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CompoundForm } from "@/components/compounds/CompoundForm";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { CompoundDetail } from "@/types/compound";

export default function EditCompoundPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t } = useLocalizationContext();

  const [compound, setCompound] = useState<CompoundDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/compounds/${id}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled) return;
        if (payload?.success) setCompound(payload.data as CompoundDetail);
      })
      .catch((error) => console.error("Failed to load compound:", error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/dashboard/compounds/${id}`}>
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("compounds.edit.title", { defaultValue: "Edit compound" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {compound?.name ?? ""}
          </p>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : compound ? (
        // Keyed on the loaded record so the form's defaultValues are seeded
        // from real data instead of mounting empty and never re-initialising.
        <CompoundForm key={compound.id} compound={compound} />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t("compounds.detail.notFound", {
              defaultValue: "This compound no longer exists",
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
