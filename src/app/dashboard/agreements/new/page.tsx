"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgreementForm } from "@/components/agreements/AgreementForm";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export default function NewAgreementPage() {
  const { t } = useLocalizationContext();
  const kind =
    useSearchParams().get("kind") === "investment" ? "investment" : "management";

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/agreements">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("agreements.new.title", { defaultValue: "New agreement" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {kind === "investment"
              ? t("agreements.new.investmentSubtitle", { defaultValue: "Record a building the office rents from its owner" })
              : t("agreements.new.subtitle", {
                  defaultValue:
                    "Record what the office earns on an owner's buildings",
                })}
          </p>
        </div>
      </div>

      <AgreementForm defaultKind={kind} />
    </div>
  );
}
