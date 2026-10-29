import { PaymentSettingsSkeleton } from "@/components/settings/payment-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level fallback while this page's chunk loads. It mirrors the page's own
 * loading state so the mount does not jump from a generic field card to the
 * gateway card stack.
 */
export default function PaymentSettingsLoading() {
  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <PaymentSettingsSkeleton />
    </div>
  );
}
