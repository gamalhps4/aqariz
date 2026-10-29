"use client";

/**
 * PropertyPro - Pay through one of the office's gateways
 *
 * One button per gateway the payer can use for this payment: allowed by the
 * platform and the office's package, connected by the office, and able to
 * take the payment's currency (GET /api/payments/config → `available`).
 * Clicking one opens that gateway's hosted page — mada, cards, Apple Pay and
 * STC Pay on the Saudi gateways — and the gateway sends the payer back to
 * `returnPath` with `?payment=success|pending|failed|canceled`, which
 * `useGatewayReturn` turns into a message.
 *
 * Either a payment (`paymentId`: a tenant paying, or staff for them) or an
 * invoice (`invoiceId` + `amount`: staff collecting it online).
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { getPublicPaymentConfig, type AvailableGateway } from "@/lib/stripe-client";
import { gatewayCanCharge } from "@/lib/payments/gateway-currency";

export type GatewayReturnOutcome = "success" | "pending" | "failed" | "canceled";

const METHOD_FALLBACK: Record<string, string> = {
  mada: "mada",
  card: "Visa / Mastercard",
  applepay: "Apple Pay",
  stcpay: "STC Pay",
  paypal: "PayPal",
};

/** The gateways this payer can use for a payment in `currency`. */
export function useAvailableGateways(currency: string | null | undefined): {
  loading: boolean;
  gateways: AvailableGateway[];
} {
  const [loading, setLoading] = useState(true);
  const [all, setAll] = useState<AvailableGateway[]>([]);
  useEffect(() => {
    let active = true;
    getPublicPaymentConfig()
      .then((config) => {
        if (active) setAll(config?.available ?? []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return {
    loading,
    gateways: all.filter((gateway) => gatewayCanCharge(gateway.id, currency)),
  };
}

/**
 * Read the `?payment=` a gateway's return left on this page, say what it
 * means, and take it off the address so a reload does not say it again.
 * Read from `window.location` once: no useSearchParams, so no Suspense
 * boundary is needed under the dashboard layout.
 */
export function useGatewayReturn(onOutcome?: (outcome: GatewayReturnOutcome) => void): void {
  const { t } = useLocalizationContext();
  // Once per page load, however often the language or the callback changes.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || typeof window === "undefined") return;
    handled.current = true;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("payment") as GatewayReturnOutcome | null;
    if (!outcome || !["success", "pending", "failed", "canceled"].includes(outcome)) return;
    url.searchParams.delete("payment");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);

    const translate = t;
    const text = {
      success: translate("payments.online.returned.success", { defaultValue: "Payment received. Thank you." }),
      pending: translate("payments.online.returned.pending", {
        defaultValue: "Your payment is being confirmed. It will show here shortly.",
      }),
      failed: translate("payments.online.returned.failed", {
        defaultValue: "The payment did not go through. Nothing was recorded.",
      }),
      canceled: translate("payments.online.returned.canceled", { defaultValue: "Payment cancelled." }),
    }[outcome];
    if (outcome === "success") toast.success(text);
    else if (outcome === "pending") toast.info(text);
    else toast.error(text);
    onOutcome?.(outcome);
  }, [t, onOutcome]);
}

interface GatewayPayOptionsProps {
  /** Pay this payment… */
  paymentId?: string;
  /** …or collect this invoice for `amount`. */
  invoiceId?: string;
  amount?: number;
  currency?: string | null;
  /** The dashboard page the gateway sends the payer back to. */
  returnPath: string;
  disabled?: boolean;
  /** Shown when no gateway can take this payment. */
  emptyText?: string;
  /** An earlier attempt turned out paid. */
  onAlreadyPaid?: () => void;
}

export function GatewayPayOptions({
  paymentId,
  invoiceId,
  amount,
  currency,
  returnPath,
  disabled,
  emptyText,
  onAlreadyPaid,
}: GatewayPayOptionsProps) {
  const { t } = useLocalizationContext();
  const { loading, gateways } = useAvailableGateways(currency);
  const [opening, setOpening] = useState<string | null>(null);

  const methodLabel = (method: string) =>
    t(`payments.online.method.${method}`, { defaultValue: METHOD_FALLBACK[method] ?? method });

  const open = async (gateway: AvailableGateway) => {
    setOpening(gateway.id);
    try {
      const endpoint = invoiceId
        ? `/api/invoices/${invoiceId}/checkout`
        : `/api/payments/${paymentId}/checkout`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway: gateway.id,
          returnPath,
          ...(invoiceId ? { amount } : {}),
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.error || t("payments.online.startFailed", { defaultValue: "Could not open the payment page" }));
      }
      const data = json?.data ?? json;
      if (data?.alreadyCompleted) {
        toast.success(t("payments.online.alreadyPaid", { defaultValue: "This payment is already complete" }));
        setOpening(null);
        onAlreadyPaid?.();
        return;
      }
      if (!data?.url) {
        throw new Error(t("payments.online.startFailed", { defaultValue: "Could not open the payment page" }));
      }
      // Leaving the page: the button keeps its spinner until it goes.
      window.location.assign(data.url);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("payments.online.startFailed", { defaultValue: "Could not open the payment page" }),
      );
      setOpening(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (gateways.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {emptyText ??
          t("payments.online.unavailableTenant", {
            defaultValue:
              "Online payments are not available right now. Contact your property manager to arrange payment.",
          })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        {t("payments.online.chooseGateway", { defaultValue: "Choose how to pay" })}
      </p>
      {gateways.map((gateway) => (
        <div
          key={gateway.id}
          className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-1.5">
            <p className="font-medium">{gateway.name}</p>
            <div className="flex flex-wrap gap-1.5">
              {gateway.methods.map((method) => (
                <Badge key={method} variant="secondary" className="font-normal">
                  {methodLabel(method)}
                </Badge>
              ))}
            </div>
          </div>
          <Button
            type="button"
            onClick={() => open(gateway)}
            disabled={disabled || opening !== null}
            className="sm:min-w-40"
          >
            {opening === gateway.id ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t("payments.online.redirecting", { defaultValue: "Opening the payment page…" })}
              </>
            ) : (
              <>
                <ExternalLink className="me-2 h-4 w-4" />
                {t("payments.online.payWith", { defaultValue: "Pay with {name}", values: { name: gateway.name } })}
              </>
            )}
          </Button>
        </div>
      ))}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        {t("payments.online.hostedNote", {
          defaultValue: "You finish on the payment service's own secure page; card details never reach us.",
        })}
      </p>
    </div>
  );
}
