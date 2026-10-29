"use client";

import React, { useRef, useState, useMemo } from "react";
import { toast } from "sonner";
import {
  DollarSign,
  FileText,
  Home,
  Mail,
  MapPin,
  Phone,
  Printer,
  User,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { LeaseResponse } from "@/lib/services/lease.service";
import { LeaseStatus } from "@/types";
import { cn } from "@/lib/utils";
import { deriveCompanyInitials } from "@/lib/invoice/logo-utils";
import {
  downloadInvoiceAsPDFDirect,
  printInvoiceDirect,
  type PrintableInvoice,
} from "@/lib/invoice-print";
import { buildPrintableInvoiceFromLease } from "@/lib/invoice/invoice-builders";
import "../../styles/invoice-print.css";

import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export interface LeaseInvoiceProps {
  lease: LeaseResponse;
  companyInfo?: {
    name: string;
    address: string;
    phone: string;
    email: string;
    website?: string;
    logo?: string;
  };
  invoiceNumber?: string;
  issueDate?: Date;
  dueDate?: Date;
  className?: string;
}

export function LeaseInvoice({
  lease,
  // No invented company: this used to default to "PropertyPro Management,
  // 123 Business Ave …" with a US phone number, which is what an office saw
  // printed whenever its own branding had not loaded. Empty fields are simply
  // not shown.
  companyInfo = { name: "", address: "", phone: "", email: "" },
  invoiceNumber,
  issueDate,
  dueDate,
  className,
}: LeaseInvoiceProps) {
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const { t, formatCurrency, formatDate } = useLocalizationContext();

  const resolvedIssueDate = useMemo(() => {
    if (issueDate instanceof Date) return issueDate;
    if (typeof issueDate === "string") return new Date(issueDate);
    return new Date();
  }, [issueDate]);

  const resolvedDueDate = useMemo(() => {
    if (dueDate instanceof Date) return dueDate;
    if (typeof dueDate === "string") return new Date(dueDate);
    return new Date(resolvedIssueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  }, [dueDate, resolvedIssueDate]);

  const printableInvoice = useMemo(
    () =>
      buildPrintableInvoiceFromLease(lease, {
        companyInfo,
        invoiceNumber,
        issueDate: resolvedIssueDate,
        dueDate: resolvedDueDate,
      }) as PrintableInvoice,
    [lease, companyInfo, invoiceNumber, resolvedIssueDate, resolvedDueDate]
  );

  const generatedInvoiceNumber = printableInvoice.invoiceNumber;
  const companyInitials = useMemo(
    () => deriveCompanyInitials(companyInfo.name),
    [companyInfo.name]
  );

  // Format currency
  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };


  // Calculate lease duration
  const calculateDuration = () => {
    const start = new Date(lease.startDate);
    const end = new Date(lease.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const months = Math.floor(diffDays / 30);
    const days = diffDays % 30;

    if (months > 0) {
      return days > 0
        ? t("leases.invoiceDoc.durationMonthsDays", { defaultValue: "{months} months, {days} days", values: { months, days } })
        : t("leases.invoiceDoc.durationMonths", { defaultValue: "{months} months", values: { months } });
    }
    return t("leases.invoiceDoc.durationDays", { defaultValue: "{days} days", values: { days } });
  };

  const statusLabel = (status?: string) =>
    status
      ? t(`leases.status.${status}`, { defaultValue: status.replace(/_/g, " ") })
      : "—";

  // Get status color
  const getStatusColor = (status: LeaseStatus) => {
    switch (status) {
      case LeaseStatus.ACTIVE:
        return "bg-green-100 text-green-800 border-green-200";
      case LeaseStatus.PENDING:
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case LeaseStatus.EXPIRED:
        return "bg-red-100 text-red-800 border-red-200";
      case LeaseStatus.TERMINATED:
        return "bg-gray-100 text-gray-800 border-gray-200";
      default:
        return "bg-blue-100 text-blue-800 border-blue-200";
    }
  };

  const handlePrint = async () => {
    try {
      await printInvoiceDirect(printableInvoice, companyInfo);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("leases.invoiceDoc.printFailed", { defaultValue: "The print window could not open. Check that pop-ups are allowed." });
      toast.error(errorMessage);
    }
  };

  // Generate HTML content for the invoice
  // Download as PDF using direct jsPDF rendering
  const handleDownload = async () => {
    try {
      setIsGeneratingPDF(true);
      await downloadInvoiceAsPDFDirect(printableInvoice, companyInfo);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("leases.invoiceDoc.downloadFailed", { defaultValue: "Could not download the invoice" });
      toast.error(errorMessage);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  return (
    <div className={cn("max-w-4xl mx-auto", className)}>
      {/* Action Buttons */}
      {/* <div className="flex justify-end gap-2 mb-6 print:hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrint}
          className="flex items-center gap-2"
        >
          <Printer className="h-4 w-4" />
          Print
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={isGeneratingPDF}
          className="flex items-center gap-2"
        >
          {isGeneratingPDF ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {isGeneratingPDF ? "Generating PDF..." : "Download PDF"}
        </Button>
      </div> */}

      {/* Invoice Content */}
      <Card className="print:shadow-none print:border-none">
        <CardContent className="p-8" ref={invoiceRef}>
          <div className="print-container">
            {/* Header */}
            <div className="header flex justify-between items-start mb-8">
              <div className="company-info">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-lg overflow-hidden",
                      companyInfo.logo
                        ? "bg-white ring-1 ring-slate-200"
                        : "bg-emerald-500"
                    )}
                  >
                    {companyInfo.logo ? (
                      <img
                        src={companyInfo.logo}
                        alt={companyInfo.name}
                        className="h-full w-full object-contain"
                        crossOrigin="anonymous"
                      />
                    ) : (
                      <span className="text-lg font-semibold text-white">
                        {companyInitials}
                      </span>
                    )}
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    {companyInfo.name}
                  </h1>
                </div>
                <div className="text-sm text-gray-600 space-y-1">
                  {companyInfo.address && (
                    <p className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {companyInfo.address}
                    </p>
                  )}
                  {companyInfo.phone && (
                    <p className="flex items-center gap-2" dir="ltr">
                      <Phone className="h-4 w-4" />
                      {companyInfo.phone}
                    </p>
                  )}
                  {companyInfo.email && (
                    <p className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      {companyInfo.email}
                    </p>
                  )}
                  {companyInfo.website && (
                    <p className="text-blue-600">{companyInfo.website}</p>
                  )}
                </div>
              </div>

              <div className="invoice-info text-end">
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  {t("leases.invoiceDoc.title", { defaultValue: "Lease invoice" })}
                </h2>
                <div className="text-sm text-gray-600 space-y-1">
                  <p>
                    <span className="font-medium">
                      {t("leases.invoiceDoc.number", { defaultValue: "Invoice no." })}
                    </span>{" "}
                    {generatedInvoiceNumber}
                  </p>
                  <p>
                    <span className="font-medium">
                      {t("leases.invoiceDoc.issueDate", { defaultValue: "Issued" })}
                    </span>{" "}
                    {formatDate(resolvedIssueDate)}
                  </p>
                  <p>
                    <span className="font-medium">
                      {t("leases.invoiceDoc.dueDate", { defaultValue: "Due" })}
                    </span>{" "}
                    {formatDate(resolvedDueDate)}
                  </p>
                  <div className="mt-2">
                    <Badge
                      className={cn(
                        "status-badge",
                        getStatusColor(lease.status)
                      )}
                    >
                      {statusLabel(lease.status)}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <Separator className="mb-8" />

            {/* Parties Information */}
            <div className="parties grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              {/* Property Information */}
              <div className="party">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-4">
                  <Home className="h-5 w-5 text-blue-600" />
                  {t("leases.invoiceDoc.property", { defaultValue: "Property" })}
                </h3>
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-gray-900">
                    {lease.propertyId?.name || "—"}
                  </p>
                  <p className="text-gray-600">
                    {[
                      lease.propertyId?.address?.street,
                      lease.propertyId?.address?.city,
                      lease.propertyId?.address?.state,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </p>
                  <div className="mt-3 space-y-1">
                    <p className="text-gray-600">
                      <span className="font-medium">
                        {t("leases.invoiceDoc.type", { defaultValue: "Type" })}:
                      </span>{" "}
                      {lease.propertyId?.type || "—"}
                    </p>
                    <p className="text-gray-600">
                      <span className="font-medium">
                        {t("leases.invoiceDoc.bedrooms", { defaultValue: "Bedrooms" })}:
                      </span>{" "}
                      {lease.propertyId?.bedrooms || "—"}
                    </p>
                    <p className="text-gray-600">
                      <span className="font-medium">
                        {t("leases.invoiceDoc.bathrooms", { defaultValue: "Bathrooms" })}:
                      </span>{" "}
                      {lease.propertyId?.bathrooms || "—"}
                    </p>
                    <p className="text-gray-600">
                      <span className="font-medium">
                        {t("leases.invoiceDoc.area", { defaultValue: "Area" })}:
                      </span>{" "}
                      {lease.propertyId?.squareFootage || "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tenant Information */}
              <div className="party">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-4">
                  <User className="h-5 w-5 text-blue-600" />
                  {t("leases.invoiceDoc.tenant", { defaultValue: "Tenant" })}
                </h3>
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-gray-900">
                    {lease.tenantId?.firstName || "—"}{" "}
                    {lease.tenantId?.lastName || ""}
                  </p>
                  <p className="flex items-center gap-2 text-gray-600">
                    <Mail className="h-4 w-4" />
                    {lease.tenantId?.email || "—"}
                  </p>
                  {lease.tenantId?.phone && (
                    <p className="flex items-center gap-2 text-gray-600">
                      <Phone className="h-4 w-4" />
                      {lease.tenantId?.phone}
                    </p>
                  )}

                </div>
              </div>
            </div>

            {/* Lease Details */}
            <div className="lease-details bg-gray-50 p-6 rounded-lg mb-8">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-4">
                <FileText className="h-5 w-5 text-blue-600" />
                {t("leases.invoiceDoc.contract", { defaultValue: "Contract" })}
              </h3>
              <div className="details-grid grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="detail-item flex justify-between py-2 border-b border-gray-200">
                  <span className="detail-label font-medium text-gray-700">
                    {t("leases.invoiceDoc.contractNumber", { defaultValue: "Contract no." })}
                  </span>
                  <span className="detail-value text-gray-600">
                    {(lease as { contractNumber?: string | null }).contractNumber ?? lease._id}
                  </span>
                </div>
                <div className="detail-item flex justify-between py-2 border-b border-gray-200">
                  <span className="detail-label font-medium text-gray-700">
                    {t("leases.invoiceDoc.status", { defaultValue: "Status" })}
                  </span>
                  <Badge
                    className={cn("text-xs", getStatusColor(lease.status))}
                  >
                    {statusLabel(lease.status)}
                  </Badge>
                </div>
                <div className="detail-item flex justify-between py-2 border-b border-gray-200">
                  <span className="detail-label font-medium text-gray-700">
                    {t("leases.invoiceDoc.start", { defaultValue: "Start" })}
                  </span>
                  <span className="detail-value text-gray-600">
                    {formatDate(lease.startDate)}
                  </span>
                </div>
                <div className="detail-item flex justify-between py-2 border-b border-gray-200">
                  <span className="detail-label font-medium text-gray-700">
                    {t("leases.invoiceDoc.end", { defaultValue: "End" })}
                  </span>
                  <span className="detail-value text-gray-600">
                    {formatDate(lease.endDate)}
                  </span>
                </div>
                <div className="detail-item flex justify-between py-2 border-b border-gray-200">
                  <span className="detail-label font-medium text-gray-700">
                    {t("leases.invoiceDoc.duration", { defaultValue: "Term" })}
                  </span>
                  <span className="detail-value text-gray-600">
                    {calculateDuration()}
                  </span>
                </div>
                {lease.signedDate && (
                  <div className="detail-item flex justify-between py-2 border-b border-gray-200">
                    <span className="detail-label font-medium text-gray-700">
                      {t("leases.invoiceDoc.signed", { defaultValue: "Signed" })}
                    </span>
                    <span className="detail-value text-gray-600">
                      {formatDate(lease.signedDate)}
                    </span>
                  </div>
                )}
                <div className="detail-item flex justify-between py-2 border-b border-gray-200">
                  <span className="detail-label font-medium text-gray-700">
                    {t("leases.invoiceDoc.created", { defaultValue: "Created" })}
                  </span>
                  <span className="detail-value text-gray-600">
                    {formatDate(lease.createdAt)}
                  </span>
                </div>
                <div className="detail-item flex justify-between py-2 border-b border-gray-200">
                  <span className="detail-label font-medium text-gray-700">
                    {t("leases.invoiceDoc.updated", { defaultValue: "Last updated" })}
                  </span>
                  <span className="detail-value text-gray-600">
                    {formatDate(lease.updatedAt)}
                  </span>
                </div>
              </div>
            </div>

            {/* Financial Summary */}
            <div className="financial-summary bg-blue-50 p-6 rounded-lg mb-8">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-4">
                <DollarSign className="h-5 w-5 text-blue-600" />
                {t("leases.invoiceDoc.financial", { defaultValue: "Amounts" })}
              </h3>
              <div className="summary-grid space-y-3">
                <div className="summary-item flex justify-between py-3 border-b border-blue-200">
                  <span className="summary-label font-medium text-blue-900">
                    {t("leases.invoiceDoc.rent", { defaultValue: "Rent per installment" })}
                  </span>
                  <span className="summary-value font-semibold text-blue-900">
                    {formatCurrency(lease.terms?.rentAmount || 0)}
                  </span>
                </div>
                <div className="summary-item flex justify-between py-3 border-b border-blue-200">
                  <span className="summary-label font-medium text-blue-900">
                    {t("leases.invoiceDoc.deposit", { defaultValue: "Security deposit" })}
                  </span>
                  <span className="summary-value font-semibold text-blue-900">
                    {formatCurrency(lease.terms?.securityDeposit || 0)}
                  </span>
                </div>
                {lease.terms?.petDeposit && lease.terms?.petDeposit > 0 && (
                  <div className="summary-item flex justify-between py-3 border-b border-blue-200">
                    <span className="summary-label font-medium text-blue-900">
                      {t("leases.invoiceDoc.petDeposit", { defaultValue: "Pet deposit" })}
                    </span>
                    <span className="summary-value font-semibold text-blue-900">
                      {formatCurrency(lease.terms?.petDeposit || 0)}
                    </span>
                  </div>
                )}

                {/* Total Initial Payment */}
                <div className="total-row summary-item flex justify-between py-3 border-t-2 border-blue-600 mt-4">
                  <span className="summary-label font-bold text-blue-900 text-lg">
                    {t("leases.invoiceDoc.total", { defaultValue: "Due at signing" })}
                  </span>
                  <span className="summary-value font-bold text-blue-900 text-lg">
                    {/* First rent and the deposits. */}
                    {formatCurrency(
                      (lease.terms?.rentAmount || 0) +
                        (lease.terms?.securityDeposit || 0) +
                        (lease.terms?.petDeposit || 0)
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Lease Terms & Conditions */}
            {((lease.terms?.utilities?.length ?? 0) > 0 ||
              (lease.terms?.restrictions?.length ?? 0) > 0) && (
              <div className="lease-terms bg-gray-50 p-6 rounded-lg mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {t("leases.invoiceDoc.terms", { defaultValue: "Terms" })}
                </h3>

                {(lease.terms?.utilities?.length ?? 0) > 0 && (
                  <div className="mb-4">
                    <h4 className="font-medium text-gray-800 mb-2">
                      {t("leases.invoiceDoc.utilities", { defaultValue: "Utilities included" })}
                    </h4>
                    <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                      {lease.terms?.utilities?.map((utility, index) => (
                        <li key={index}>{utility}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(lease.terms?.restrictions?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="font-medium text-gray-800 mb-2">
                      {t("leases.invoiceDoc.restrictions", { defaultValue: "Restrictions" })}
                    </h4>
                    <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                      {lease.terms?.restrictions?.map((restriction, index) => (
                        <li key={index}>{restriction}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Renewal Options */}
            {lease.renewalOptions?.available && (
              <div className="renewal-options bg-green-50 p-6 rounded-lg mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {t("leases.invoiceDoc.renewal", { defaultValue: "Renewal" })}
                </h3>
                <p className="text-sm text-gray-600">
                  {t("leases.invoiceDoc.renewable", { defaultValue: "This contract can be renewed." })}
                </p>
                {lease.renewalOptions?.terms && (
                  <p className="text-sm text-gray-600 mt-2">
                    <span className="font-medium">
                      {t("leases.invoiceDoc.terms", { defaultValue: "Terms" })}:
                    </span>{" "}
                    {lease.renewalOptions?.terms}
                  </p>
                )}
              </div>
            )}

            {/* Additional Notes */}
            {lease.notes && (
              <div className="notes bg-yellow-50 p-6 rounded-lg mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {t("leases.invoiceDoc.notes", { defaultValue: "Notes" })}
                </h3>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">
                  {lease.notes}
                </p>
              </div>
            )}

            {/* Documents */}
            {lease.documents?.length > 0 && (
              <div className="documents bg-gray-50 p-6 rounded-lg mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {t("leases.invoiceDoc.documents", { defaultValue: "Documents" })}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {lease.documents?.map((_, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 text-sm text-gray-600"
                    >
                      <FileText className="h-4 w-4" />
                      <span>
                        {t("leases.invoiceDoc.document", { defaultValue: "Document {number}", values: { number: index + 1 } })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="footer text-center text-gray-500 text-sm mt-12 pt-6 border-t border-gray-200">
              <p className="mb-2">
                {t("leases.invoiceDoc.generatedOn", { defaultValue: "Issued on {date}", values: { date: formatDate(new Date()) } })}
              </p>
              {(companyInfo.email || companyInfo.phone) && (
                <p className="mb-2">
                  {t("leases.invoiceDoc.contact", { defaultValue: "Questions about this invoice: {contact}", values: { contact: [companyInfo.email, companyInfo.phone].filter(Boolean).join(" · ") } })}
                </p>
              )}
              <p className="text-xs">{generatedInvoiceNumber}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
