"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AgreementForm } from "@/components/agreements/AgreementForm";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { AgreementDetail } from "@/types/agreement";

export default function EditAgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t } = useLocalizationContext();
  const [agreement, setAgreement] = useState<AgreementDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agreements/${id}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled) return;
        if (payload?.success) setAgreement(payload.data as AgreementDetail);
      })
      .catch((error) => console.error("Failed to load agreement:", error))
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
          <Link href={`/dashboard/agreements/${id}`}>
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("agreements.edit.title", { defaultValue: "Edit agreement" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {agreement?.agreementNumber ?? ""}
          </p>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : agreement ? (
        // Keyed on the loaded record so the form seeds from real data rather
        // than mounting empty and never re-initialising.
        <AgreementForm key={agreement.id} agreement={agreement} />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t("agreements.notFound", {
              defaultValue: "This agreement no longer exists",
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
