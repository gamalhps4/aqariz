/**
 * PropertyPro - Saying what bringing a contract into force billed
 *
 * Signing, activating and renewing a contract now bill its installments, and
 * that billing runs after the status change has been saved. So a contract can
 * be active while some installments failed to generate — and the one thing
 * the screen must not do then is report plain success. One helper, so the
 * three places a contract comes into force say it the same way.
 */

import { toast } from "sonner";
import type { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { InstallmentGenerationOutcome } from "@/types/installment";

type Translate = ReturnType<typeof useLocalizationContext>["t"];

export function notifyInstallmentGeneration(
  outcome: InstallmentGenerationOutcome | null | undefined,
  t: Translate,
): void {
  // Nothing was billed because nothing came into force (a draft renewal, a
  // change to some other status).
  if (!outcome) return;

  if (outcome.errors.length > 0) {
    toast.warning(
      t("leases.installments.notBilledWarning", {
        defaultValue:
          "The contract is active, but not all of its installments could be billed. Use “Generate installments” on the Installments tab to finish.",
      }),
      { description: outcome.errors.join(" · "), duration: 10000 },
    );
    return;
  }

  if (outcome.invoicesGenerated > 0) {
    toast.success(
      t("leases.installments.generated", {
        defaultValue: "Installments billed: {count}",
        values: { count: outcome.invoicesGenerated },
      }),
    );
  }
}
