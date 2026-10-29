"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle,
  Download,
  Mail,
  CreditCard,
  FileText,
  Home,
  User,
  DollarSign,
  Receipt,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

interface PaymentDetails {
  paymentIntentId: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethodId?: string;
  receiptUrl?: string;
  invoice: {
    id: string;
    invoiceNumber: string;
    dueDate: string;
    property: {
      name: string;
      address: string;
    };
  };
  tenant: {
    name: string;
    email: string;
  };
  paidAt: string;
  transactionId?: string;
}
import { formatCurrency } from "@/lib/utils/formatting";

interface PaymentConfirmationProps {
  paymentIntentId: string;
  onClose?: () => void;
  onBackToInvoices?: () => void;
}

export default function PaymentConfirmation({
  paymentIntentId,
  onClose,
  onBackToInvoices,
}: PaymentConfirmationProps) {
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [sendingReceipt, setSendingReceipt] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);

  // const formatCurrency = (amount: number, currency: string = "USD") => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: currency.toUpperCase(),
  //   }).format(amount);
  // };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  useEffect(() => {
    fetchPaymentDetails();
  }, [paymentIntentId]);

  const fetchPaymentDetails = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/payments/${paymentIntentId}/details`);
      const data = await response.json();

      if (data.success && data.data) {
        setPaymentDetails(data.data);
      } else {
        toast.error("Failed to fetch payment details");
      }
    } catch (error) {
      console.error("Error fetching payment details:", error);
      toast.error("Failed to fetch payment details");
    } finally {
      setLoading(false);
    }
  };

  const sendReceiptEmail = async () => {
    if (!paymentDetails) return;

    try {
      setSendingReceipt(true);
      const response = await fetch(
        `/api/payments/${paymentIntentId}/send-receipt`,
        {
          method: "POST",
        }
      );

      const data = await response.json();
      if (data.success) {
        toast.success("Receipt sent to your email address");
      } else {
        toast.error("Failed to send receipt email");
      }
    } catch (error) {
      console.error("Error sending receipt:", error);
      toast.error("Failed to send receipt email");
    } finally {
      setSendingReceipt(false);
    }
  };

  const downloadReceipt = async () => {
    if (!paymentDetails) return;

    try {
      setDownloadingReceipt(true);
      const response = await fetch(
        `/api/payments/${paymentIntentId}/receipt.pdf`
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const invoiceNumber =
          paymentDetails.invoice?.invoiceNumber ?? paymentIntentId;
        a.download = `payment-receipt-${invoiceNumber}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        toast.success("Receipt downloaded successfully");
      } else {
        toast.error("Failed to download receipt");
      }
    } catch (error) {
      console.error("Error downloading receipt:", error);
      toast.error("Failed to download receipt");
    } finally {
      setDownloadingReceipt(false);
    }
  };

  if (loading) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading payment details...</p>
        </CardContent>
      </Card>
    );
  }

  if (!paymentDetails) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Payment details not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Success Header */}
      <Card>
        <CardContent className="p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-green-100 p-3">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-green-600 mb-2">
            Payment Successful!
          </h1>
          <p className="text-muted-foreground">
            Your payment has been processed successfully.
          </p>
        </CardContent>
      </Card>

      {/* Payment Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Payment Receipt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Transaction Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Amount Paid</p>
              <p className="text-2xl font-bold text-green-600">
                {formatCurrency(paymentDetails.amount, paymentDetails.currency)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Payment Date</p>
              <p className="font-medium">{formatDate(paymentDetails.paidAt)}</p>
            </div>
          </div>

          <Separator />

          {/* Invoice Details */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Invoice Details
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Invoice Number</p>
                <p className="font-medium">
                  {paymentDetails.invoice.invoiceNumber}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Due Date</p>
                <p className="font-medium">
                  {new Date(
                    paymentDetails.invoice.dueDate
                  ).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Property Details */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Home className="h-4 w-4" />
              Property Details
            </h3>
            <div className="text-sm">
              <p className="font-medium">
                {paymentDetails.invoice.property.name}
              </p>
              <p className="text-muted-foreground">
                {paymentDetails.invoice.property.address}
              </p>
            </div>
          </div>

          <Separator />

          {/* Payment Method */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Payment Method
            </h3>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Credit Card</Badge>
              {paymentDetails.transactionId && (
                <span className="text-sm text-muted-foreground">
                  Transaction ID: {paymentDetails.transactionId}
                </span>
              )}
            </div>
          </div>

          <Separator />

          {/* Tenant Details */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <User className="h-4 w-4" />
              Tenant Information
            </h3>
            <div className="text-sm">
              <p className="font-medium">{paymentDetails.tenant.name}</p>
              <p className="text-muted-foreground">
                {paymentDetails.tenant.email}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={downloadReceipt}
              disabled={downloadingReceipt}
              className="flex-1"
            >
              <Download className="me-2 h-4 w-4" />
              {downloadingReceipt ? "Downloading..." : "Download Receipt"}
            </Button>
            <Button
              variant="outline"
              onClick={sendReceiptEmail}
              disabled={sendingReceipt}
              className="flex-1"
            >
              <Mail className="me-2 h-4 w-4" />
              {sendingReceipt ? "Sending..." : "Email Receipt"}
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-3">
            {onBackToInvoices && (
              <Button
                variant="outline"
                onClick={onBackToInvoices}
                className="flex-1"
              >
                <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
                Back to Invoices
              </Button>
            )}
            {onClose && (
              <Button variant="secondary" onClick={onClose} className="flex-1">
                Close
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Important Notice */}
      <Alert>
        <AlertDescription>
          Please save this receipt for your records. A copy has been
          automatically sent to your email address. If you have any questions
          about this payment, please contact your property manager.
        </AlertDescription>
      </Alert>
    </div>
  );
}
