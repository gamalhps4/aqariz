"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CompoundForm } from "@/components/compounds/CompoundForm";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export default function NewCompoundPage() {
  const { t } = useLocalizationContext();

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/compounds">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("compounds.new.title", { defaultValue: "New compound" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("compounds.new.subtitle", {
              defaultValue:
                "Group related buildings, villas and other properties into one residential complex",
            })}
          </p>
        </div>
      </div>

      <CompoundForm />
    </div>
  );
}
