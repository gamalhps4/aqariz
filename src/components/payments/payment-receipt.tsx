"use client";

import { forwardRef, useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle,
  Download,
  Printer,
  Building2,
  User,
  Calendar,
  CreditCard,
  FileText,
  MapPin,
} from "lucide-react";
import { PaymentStatus, PaymentType, PaymentMethod } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { getCompanyInfo, type CompanyInfo } from "@/lib/utils/company-info";
import { paymentMethodLabel } from "@/lib/payments/methods";
import { paymentTypeLabel } from "@/lib/payments/type-labels";
import { describeCharge } from "@/lib/i18n/charge-description";
import { receiptNumberFor } from "@/lib/payments/receipt-number";

interface PaymentReceiptProps {
  payment: {
    _id: string;
    /** The receipt's number — the stored one when a receipt was issued. */
    receiptNumber?: string;
    amount: number;
    type: PaymentType;
    status: PaymentStatus;
    paymentMethod?: PaymentMethod;
    dueDate: string;
    paidDate?: string;
    description?: string;
    notes?: string;
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
    };
    createdAt: string;
    updatedAt: string;
  };
  companyInfo?: {
    name: string;
    address: string;
    phone: string;
    email: string;
    website?: string;
  };
  onPrint?: () => void;
  onDownload?: () => void;
  showActions?: boolean;
}

export const PaymentReceipt = forwardRef<HTMLDivElement, PaymentReceiptProps>(
  ({ payment, companyInfo, onPrint, onDownload, showActions = true }, ref) => {
    const { t, formatCurrency, formatDate, language } = useLocalizationContext();

    const formatDateTime = (dateString: string) => {
      return formatDate(dateString, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    };

    const getPaymentTypeLabel = (type: PaymentType) => paymentTypeLabel(type, t);

    const getPaymentMethodLabel = (method?: PaymentMethod) => {
      if (!method)
        return t("payments.receipt.component.paymentMethod.notSpecified");
      return paymentMethodLabel(method, t);
    };

    // The office's own name and contacts. The receipt page never passed any,
    // so every receipt fell back to translated placeholder text — "PropertyPro
    // Management, 123 Business Ave, San Francisco, CA, (555) 123-4567".
    const [loadedCompany, setLoadedCompany] = useState<CompanyInfo | null>(
      null,
    );
    useEffect(() => {
      if (companyInfo) return;
      let cancelled = false;
      getCompanyInfo()
        .then((info) => {
          if (!cancelled) setLoadedCompany(info);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [companyInfo]);

    const company = companyInfo ??
      loadedCompany ?? { name: "", address: "", phone: "", email: "" };
    const companyContacts = [company.phone, company.email, company.website]
      .filter(Boolean)
      .join(" • ");

    // The payment API sends the tenant flat; this card only read the older
    // `userId` nesting, so it showed a blank name, email and phone.
    const tenant = payment?.tenantId?.userId ?? payment?.tenantId;

    return (
      <div ref={ref} className="max-w-2xl mx-auto">
        {/* Actions Bar - Only show when not printing */}
        {showActions && (
          <div className="flex justify-end gap-2 mb-4 print:hidden">
            <Button variant="outline" onClick={onPrint}>
              <Printer className="h-4 w-4 me-2" />
              {t("payments.receipt.component.printButton")}
            </Button>
            <Button variant="outline" onClick={onDownload}>
              <Download className="h-4 w-4 me-2" />
              {t("payments.receipt.component.downloadButton")}
            </Button>
          </div>
        )}

        {/* Receipt Content */}
        <Card className="print:shadow-none print:border-none">
          <CardHeader className="text-center pb-6">
            {/* Company Header */}
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-primary">
                {company.name}
              </h1>
              {company.address && (
                <p className="text-sm text-muted-foreground">
                  {company.address}
                </p>
              )}
              {companyContacts && (
                <p className="text-sm text-muted-foreground" dir="ltr">
                  {companyContacts}
                </p>
              )}
            </div>

            <Separator className="my-6" />

            {/* Receipt Title */}
            <div className="space-y-2">
              <h2 className="text-xl font-semibold flex items-center justify-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                {t("payments.receipt.component.title")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("payments.receipt.component.receiptNumber", {
                  values: {
                    receiptId: receiptNumberFor(payment._id, payment.receiptNumber),
                  },
                })}
              </p>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Payment Status */}
            <div className="text-center">
              <Badge
                variant={
                  payment.status === PaymentStatus.PAID
                    ? "default"
                    : "secondary"
                }
                className="text-sm px-4 py-2"
              >
                {t(`exports.value.${payment.status}`, {
                  defaultValue: payment.status,
                })}
              </Badge>
            </div>

            {/* Payment Details */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Tenant Information */}
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <User className="h-4 w-4" />
                  {t("payments.receipt.component.tenantInfo.title")}
                </h3>
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {tenant?.firstName ?? ""} {tenant?.lastName ?? ""}
                  </p>
                  <p className="text-muted-foreground">
                    {tenant?.email ?? ""}
                  </p>
                  {tenant?.phone && (
                    <p className="text-muted-foreground" dir="ltr">
                      {tenant.phone}
                    </p>
                  )}
                </div>
              </div>

              {/* Property Information */}
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {t("payments.receipt.component.propertyInfo.title")}
                </h3>
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {payment?.propertyId?.name ?? ""}
                  </p>
                  <div className="text-muted-foreground">
                    <p>{payment?.propertyId?.address?.street ?? ""}</p>
                    <p>
                      {payment?.propertyId?.address?.city ?? ""},{" "}
                      {payment?.propertyId?.address?.state ?? ""}{" "}
                      {payment?.propertyId?.address?.zipCode ?? ""}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Payment Summary */}
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                {t("payments.receipt.component.paymentSummary.title")}
              </h3>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">
                    {t("payments.receipt.component.paymentSummary.paymentType")}
                  </span>
                  <span className="font-medium">
                    {getPaymentTypeLabel(payment.type)}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">
                    {t(
                      "payments.receipt.component.paymentSummary.paymentMethod"
                    )}
                  </span>
                  <span className="font-medium">
                    {getPaymentMethodLabel(payment.paymentMethod)}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">
                    {t("payments.receipt.component.paymentSummary.dueDate")}
                  </span>
                  <span className="font-medium">
                    {formatDate(payment.dueDate)}
                  </span>
                </div>

                {payment.paidDate && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">
                      {t("payments.receipt.component.paymentSummary.paidDate")}
                    </span>
                    <span className="font-medium">
                      {formatDate(payment.paidDate)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">
                    {t(
                      "payments.receipt.component.paymentSummary.transactionDate"
                    )}
                  </span>
                  <span className="font-medium">
                    {formatDateTime(payment.createdAt)}
                  </span>
                </div>
              </div>

              <Separator />

              {/* Amount */}
              <div className="flex justify-between items-center text-lg">
                <span className="font-semibold">
                  {t("payments.receipt.component.paymentSummary.totalAmount")}
                </span>
                <span className="font-bold text-2xl">
                  {formatCurrency(payment.amount)}
                </span>
              </div>
            </div>

            {/* Description */}
            {payment.description && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {t("payments.receipt.component.description.title")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {describeCharge(
                      { description: payment.description, type: payment.type },
                      language,
                    )}
                  </p>
                </div>
              </>
            )}

            {/* Lease Information */}
            {payment.leaseId && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {t("payments.receipt.component.leaseInfo.title")}
                  </h3>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("payments.receipt.component.leaseInfo.leasePeriod")}
                      </span>
                      <span>
                        {formatDate(payment.leaseId.startDate)} -{" "}
                        {formatDate(payment.leaseId.endDate)}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* Footer */}
            <div className="text-center text-xs text-muted-foreground space-y-2">
              <p>{t("payments.receipt.component.footer.thankYou")}</p>
              <p>
                {t("payments.receipt.component.footer.generatedOn", {
                  values: { date: formatDateTime(new Date().toISOString()) },
                })}
              </p>
              {company.email && company.phone && (
                <p>
                  {t("payments.receipt.component.footer.contact", {
                    values: { email: company.email, phone: company.phone },
                  })}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
);

PaymentReceipt.displayName = "PaymentReceipt";
