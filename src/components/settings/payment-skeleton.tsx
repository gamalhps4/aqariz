import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PAYMENT_GATEWAYS } from "@/lib/payments/gateway-registry";
import { cn } from "@/lib/utils";

/** Label + `h-10` input, matching the real credential field stack. */
function FieldSkeleton({ labelWidth = "w-28" }: { labelWidth?: string }) {
  return (
    <div className="space-y-2">
      <Skeleton className={cn("h-4", labelWidth)} />
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}

/** Gateway names are short and uneven, so the title bars read as names. */
const GATEWAY_TITLE_WIDTHS = ["w-20", "w-24", "w-28", "w-24"];

/**
 * Shape-matched skeleton for Settings › Payments, rendered under the real
 * (static) page header while the gateway settings load. It mirrors the actual
 * layout — the default-gateway card and one card per registered gateway — so
 * the page keeps its height instead of jumping when data arrives.
 */
export function PaymentSettingsSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Loading payment gateway settings"
    >
      {/* Default gateway */}
      <Card>
        <CardHeader className="gap-1">
          <Skeleton className="h-5 w-36" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-full max-w-lg" />
            <Skeleton className="h-3.5 w-2/3 max-w-sm" />
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-full rounded-md sm:w-72" />
        </CardContent>
      </Card>

      {/* One card per gateway */}
      {PAYMENT_GATEWAYS.map((gateway, index) => (
        <Card key={gateway.id}>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Skeleton
                  className={cn(
                    "h-5",
                    GATEWAY_TITLE_WIDTHS[index % GATEWAY_TITLE_WIDTHS.length],
                  )}
                />
                <Skeleton className="h-6 w-24 rounded-lg" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-3.5 w-full max-w-lg" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-start justify-between gap-4 rounded-lg p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_18px_rgba(15,23,42,0.025)] dark:shadow-none">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-52" />
                <Skeleton className="h-3.5 w-full max-w-md" />
              </div>
              <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldSkeleton labelWidth="w-24" />
              <FieldSkeleton labelWidth="w-32" />
            </div>
            <div className="flex justify-end gap-2">
              <Skeleton className="h-10 w-32 rounded-xl" />
            </div>
          </CardContent>
        </Card>
      ))}

      <span className="sr-only">Loading payment gateway settings…</span>
    </div>
  );
}
