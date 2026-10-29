import { useState } from "react";
import { PaymentMethod } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CreditCard,
  Banknote,
  Building2,
  FileText,
  DollarSign,
  Smartphone,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PaymentMethodSelectorProps {
  selectedMethod?: PaymentMethod;
  onMethodSelect: (method: PaymentMethod) => void;
  availableMethods?: PaymentMethod[];
  disabled?: boolean;
  className?: string;
}

interface PaymentMethodConfig {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  selectedColor: string;
}

// Typed as a total record so a method added to the enum fails the build here
// rather than crashing on `config.icon` of an undefined entry.
const paymentMethodConfig: Record<PaymentMethod, PaymentMethodConfig> = {
  [PaymentMethod.CREDIT_CARD]: {
    label: "Credit Card",
    description: "Visa, Mastercard, American Express",
    icon: CreditCard,
    color: "bg-blue-50 border-blue-200 text-blue-700",
    selectedColor: "bg-blue-100 border-blue-300",
  },
  [PaymentMethod.DEBIT_CARD]: {
    label: "Debit Card",
    description: "Direct debit from bank account",
    icon: CreditCard,
    color: "bg-green-50 border-green-200 text-green-700",
    selectedColor: "bg-green-100 border-green-300",
  },
  [PaymentMethod.BANK_TRANSFER]: {
    label: "Bank Transfer",
    description: "Direct bank-to-bank transfer",
    icon: Building2,
    color: "bg-purple-50 border-purple-200 text-purple-700",
    selectedColor: "bg-purple-100 border-purple-300",
  },
  [PaymentMethod.ACH]: {
    label: "ACH Transfer",
    description: "Automated Clearing House",
    icon: Building2,
    color: "bg-indigo-50 border-indigo-200 text-indigo-700",
    selectedColor: "bg-indigo-100 border-indigo-300",
  },
  [PaymentMethod.CHECK]: {
    label: "Check",
    description: "Physical or electronic check",
    icon: FileText,
    color: "bg-gray-50 border-gray-200 text-gray-700",
    selectedColor: "bg-gray-100 border-gray-300",
  },
  [PaymentMethod.CASH]: {
    label: "Cash",
    description: "Physical cash payment",
    icon: Banknote,
    color: "bg-yellow-50 border-yellow-200 text-yellow-700",
    selectedColor: "bg-yellow-100 border-yellow-300",
  },
  [PaymentMethod.POS]: {
    label: "POS",
    description: "Card paid on the office's terminal",
    icon: CreditCard,
    color: "bg-lime-50 border-lime-200 text-lime-700",
    selectedColor: "bg-lime-100 border-lime-300",
  },
  [PaymentMethod.MONEY_ORDER]: {
    label: "Money Order",
    description: "Certified payment instrument",
    icon: FileText,
    color: "bg-orange-50 border-orange-200 text-orange-700",
    selectedColor: "bg-orange-100 border-orange-300",
  },
  [PaymentMethod.EJARI]: {
    label: "Ejar Platform",
    description: "Settled on the tenancy platform, not through the office",
    icon: Building2,
    color: "bg-teal-50 border-teal-200 text-teal-700",
    selectedColor: "bg-teal-100 border-teal-300",
  },
  [PaymentMethod.OWNER_ACCOUNT]: {
    label: "Transfer to Owner",
    description: "Tenant transferred to the owner directly; nothing to remit",
    icon: Building2,
    color: "bg-emerald-50 border-emerald-200 text-emerald-700",
    selectedColor: "bg-emerald-100 border-emerald-300",
  },
  [PaymentMethod.OWNER_CASH]: {
    label: "Cash to Owner",
    description: "Tenant paid the owner in cash; nothing to remit",
    icon: Banknote,
    color: "bg-amber-50 border-amber-200 text-amber-700",
    selectedColor: "bg-amber-100 border-amber-300",
  },
  [PaymentMethod.PAYPAL]: {
    label: "PayPal",
    description: "Pay with a PayPal account",
    icon: Smartphone,
    color: "bg-sky-50 border-sky-200 text-sky-700",
    selectedColor: "bg-sky-100 border-sky-300",
  },
  // Razorpay and Paystack were retired as gateways. These entries stay so
  // payments recorded while they were live still render a method name.
  [PaymentMethod.RAZORPAY]: {
    label: "Razorpay",
    description: "Cards, UPI, netbanking and wallets",
    icon: Smartphone,
    color: "bg-blue-50 border-blue-200 text-blue-700",
    selectedColor: "bg-blue-100 border-blue-300",
  },
  [PaymentMethod.PAYSTACK]: {
    label: "Paystack",
    description: "Cards, bank transfer and mobile money",
    icon: Smartphone,
    color: "bg-cyan-50 border-cyan-200 text-cyan-700",
    selectedColor: "bg-cyan-100 border-cyan-300",
  },
  [PaymentMethod.OTHER]: {
    label: "Other",
    description: "Alternative payment method",
    icon: DollarSign,
    color: "bg-slate-50 border-slate-200 text-slate-700",
    selectedColor: "bg-slate-100 border-slate-300",
  },
};

export function PaymentMethodSelector({
  selectedMethod,
  onMethodSelect,
  availableMethods = Object.values(PaymentMethod),
  disabled = false,
  className,
}: PaymentMethodSelectorProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {availableMethods.map((method) => {
          const config = paymentMethodConfig[method];
          const Icon = config.icon;
          const isSelected = selectedMethod === method;

          return (
            <Card
              key={method}
              className={cn(
                "cursor-pointer transition-all duration-200 hover:shadow-md",
                isSelected ? config.selectedColor : config.color,
                disabled && "opacity-50 cursor-not-allowed"
              )}
              onClick={() => !disabled && onMethodSelect(method)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className="h-6 w-6" />
                    <div>
                      <h3 className="font-medium text-sm">{config.label}</h3>
                      <p className="text-xs text-muted-foreground">
                        {config.description}
                      </p>
                    </div>
                  </div>
                  {isSelected && (
                    <div className="flex items-center justify-center w-6 h-6 bg-white dark:bg-gray-800 rounded-full">
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function PaymentMethodBadge({
  method,
  className,
}: {
  method: PaymentMethod;
  className?: string;
}) {
  const config = paymentMethodConfig[method];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn("flex items-center gap-1", className)}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

export function PaymentMethodIcon({
  method,
  className,
}: {
  method: PaymentMethod;
  className?: string;
}) {
  const config = paymentMethodConfig[method];
  const Icon = config.icon;

  return <Icon className={cn("h-4 w-4", className)} />;
}

interface CompactPaymentMethodSelectorProps {
  selectedMethod?: PaymentMethod;
  onMethodSelect: (method: PaymentMethod) => void;
  availableMethods?: PaymentMethod[];
  disabled?: boolean;
  className?: string;
}

export function CompactPaymentMethodSelector({
  selectedMethod,
  onMethodSelect,
  availableMethods = Object.values(PaymentMethod),
  disabled = false,
  className,
}: CompactPaymentMethodSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={cn("relative", className)}>
      <Button
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full justify-between"
      >
        <div className="flex items-center gap-2">
          {selectedMethod ? (
            <>
              <PaymentMethodIcon method={selectedMethod} />
              {paymentMethodConfig[selectedMethod].label}
            </>
          ) : (
            "Select payment method"
          )}
        </div>
        <Smartphone className="h-4 w-4" />
      </Button>

      {isOpen && (
        <div className="absolute top-full start-0 end-0 z-50 mt-1 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-md shadow-lg">
          <div className="p-2 space-y-1">
            {availableMethods.map((method) => {
              const config = paymentMethodConfig[method];
              const Icon = config.icon;
              const isSelected = selectedMethod === method;

              return (
                <Button
                  key={method}
                  variant={isSelected ? "secondary" : "ghost"}
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    onMethodSelect(method);
                    setIsOpen(false);
                  }}
                >
                  <Icon className="h-4 w-4" />
                  {config.label}
                  {isSelected && <Check className="h-4 w-4 ms-auto" />}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function PaymentMethodList({
  methods,
  className,
}: {
  methods: PaymentMethod[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {methods.map((method) => (
        <PaymentMethodBadge key={method} method={method} />
      ))}
    </div>
  );
}
