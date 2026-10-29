"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer, Download } from "lucide-react";
import { PaymentStatus, PaymentType, PaymentMethod } from "@/types";
import { PaymentReceipt } from "@/components/payments/payment-receipt";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { downloadReceiptPdf, printReceiptPdf } from "@/lib/receipt-print";
import type { ReceiptPaymentData } from "@/lib/invoice/receipt-data";
import { receiptNumberFor } from "@/lib/payments/receipt-number";

interface PaymentDetails {
  _id: string;
  /**
   * The receipt's number: the payment number (RCP-000123); before the
   * payment is numbered, the receipt it was sent, else one made from its id.
   */
  receiptNumber?: string;
  amount: number;
  type: PaymentType;
  status: PaymentStatus;
  paymentMethod?: PaymentMethod;
  dueDate: string;
  paidDate?: string;
  description?: string;
  notes?: string;
  /** ISO code the payment was taken in. */
  currency?: string | null;
  /** Flat as the payment API sends it; `userId` is the older nesting. */
  tenantId: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    userId?: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
    };
  };
  propertyId: {
    _id: string;
    name: string;
    address: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
    };
  };
  leaseId?: {
    _id: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  createdAt: string;
  updatedAt: string;
}

export default function PaymentReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const { t } = useLocalizationContext();

  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [resolvedParams, setResolvedParams] = useState<{ id: string } | null>(
    null
  );

  // Resolve params
  useEffect(() => {
    params.then(setResolvedParams);
  }, [params]);

  // Fetch payment details
  useEffect(() => {
    const fetchPayment = async () => {
      if (!resolvedParams?.id) return;

      try {
        setIsLoading(true);
        const response = await fetch(`/api/payments/${resolvedParams.id}`);

        if (response.ok) {
          const result = await response.json();
          // `receiptNumber` arrives as the payment number (RCP-000123).
          setPayment(result.data);
        } else {
          const error = await response.json();
          throw new Error(error.error || "Failed to fetch payment");
        }
      } catch (error) {
        console.error("Error fetching payment:", error);
        toast.error(t("payments.receipt.toasts.loadFailed"));
        router.push("/dashboard/payments");
      } finally {
        setIsLoading(false);
      }
    };

    if (session && resolvedParams) {
      fetchPayment();
    }
  }, [session, resolvedParams, router, t]);

  /** The payment as the receipt is made from it (see receipt-data.ts). */
  const receiptData = (details: PaymentDetails): ReceiptPaymentData => ({
    _id: details._id,
    receiptNumber: details.receiptNumber,
    amount: details.amount,
    currency: details.currency,
    paymentMethod: details.paymentMethod,
    paidDate: details.paidDate ? new Date(details.paidDate) : undefined,
    createdAt: new Date(details.createdAt),
    description: details.description,
    type: details.type,
    tenantId: details.tenantId,
    propertyId: details.propertyId,
  });

  // Print and Download both produce the receipt the tenant portal serves:
  // the office's logo, the reader's language, and the printed-on date and
  // page count at its foot.
  const handlePrint = () => {
    if (!payment) return;
    printReceiptPdf(receiptData(payment));
  };

  const handleDownloadPDF = async () => {
    try {
      if (!payment) return;
      await downloadReceiptPdf(receiptData(payment));
      toast.success(t("payments.receipt.toasts.downloadSuccess"));
    } catch (error) {
      console.error("Error downloading PDF:", error);
      toast.error(t("payments.receipt.toasts.downloadFailed"));
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>

        {/* Receipt Skeleton */}
        <div className="max-w-2xl mx-auto">
          <div className="space-y-4 p-6 border rounded-lg">
            <Skeleton className="h-8 w-48 mx-auto" />
            <Skeleton className="h-4 w-64 mx-auto" />
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h2 className="text-2xl font-semibold">
            {t("payments.receipt.notFound.title")}
          </h2>
          <p className="text-muted-foreground mt-2">
            {t("payments.receipt.notFound.message")}
          </p>
          <Link href="/dashboard/payments">
            <Button className="mt-4">
              <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
              {t("payments.receipt.notFound.backButton")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href={`/dashboard/payments/${payment._id}`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
                {t("payments.receipt.header.backButton")}
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("payments.receipt.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("payments.receipt.header.subtitle", {
              // The receipt's own number, as the card below and the owner
              // statement's السند column print it.
              values: {
                receiptId: receiptNumberFor(payment._id, payment.receiptNumber),
              },
            })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 me-2" />
            {t("payments.receipt.header.printButton")}
          </Button>
          <Button variant="outline" onClick={handleDownloadPDF}>
            <Download className="h-4 w-4 me-2" />
            {t("payments.receipt.header.downloadButton")}
          </Button>
        </div>
      </div>

      {/* Receipt */}
      <PaymentReceipt
        payment={payment}
        onPrint={handlePrint}
        onDownload={handleDownloadPDF}
        showActions={false} // We have our own action buttons in the header
      />
    </div>
  );
}
