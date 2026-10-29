"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import {
  Download,
  Mail,
  Printer,
  Save,
  Share2,
  FileText,
  Loader2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LeaseInvoice } from "./LeaseInvoice";
import { LeaseResponse } from "@/lib/services/lease.service";
import {
  emailInvoicePDF,
  generateLeaseInvoicePDF,
  saveInvoiceToDocuments,
  InvoiceGenerationOptions,
} from "@/lib/invoice-pdf-generator";
import {
  printInvoiceDirect,
  downloadInvoiceAsPDFDirect,
  type PrintableInvoice,
} from "@/lib/invoice-print";
import { buildPrintableInvoiceFromLease } from "@/lib/invoice/invoice-builders";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export interface EnhancedLeaseInvoiceProps {
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
  onInvoiceGenerated?: (fileName: string) => void;
  onInvoiceEmailed?: (email: string) => void;
  onInvoiceSaved?: (documentId: string) => void;
}

export function EnhancedLeaseInvoice({
  lease,
  companyInfo,
  invoiceNumber,
  issueDate,
  dueDate,
  className,
  onInvoiceGenerated,
  onInvoiceEmailed,
  onInvoiceSaved,
}: EnhancedLeaseInvoiceProps) {
  const { t } = useLocalizationContext();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEmailing, setIsEmailing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  // Email form state
  const [emailTo, setEmailTo] = useState(lease.tenantId?.email || "");
  const [emailSubject, setEmailSubject] = useState(() =>
    t("leases.invoiceDoc.email.subjectDefault", { defaultValue: "Lease invoice — {property}", values: { property: lease.propertyId?.name ?? "" } }),
  );
  const [emailMessage, setEmailMessage] = useState(() =>
    t("leases.invoiceDoc.email.messageDefault", { defaultValue: "Dear {tenant},\n\nPlease find attached the invoice for your contract at {property}.\n\nKind regards,\n{company}", values: { tenant: lease.tenantId?.firstName ?? "", property: lease.propertyId?.name ?? "", company: companyInfo?.name ?? "" } }),
  );

  // Build a PrintableInvoice from lease data (keeps print and download identical)
  const buildPrintableFromLease = (): PrintableInvoice =>
    buildPrintableInvoiceFromLease(lease, {
      companyInfo,
      invoiceNumber,
      issueDate,
      dueDate,
    }) as PrintableInvoice;

  // Generate PDF and download using the same HTML design
  const handleDownloadPDF = async () => {
    try {
      setIsGenerating(true);
      const printable = buildPrintableFromLease();
      await downloadInvoiceAsPDFDirect(printable, companyInfo);
      toast.success(t("leases.invoiceDoc.toasts.downloaded", { defaultValue: "Invoice downloaded" }));
      onInvoiceGenerated?.(String(printable.invoiceNumber));
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("leases.invoiceDoc.downloadFailed", { defaultValue: "Could not download the invoice" });
      toast.error(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  // Email PDF directly (server will generate PDF)
  const handleEmailPDF = async () => {
    try {
      setIsEmailing(true);

      const emailResult = await emailInvoicePDF({
        to: emailTo,
        subject: emailSubject,
        message: emailMessage,
        leaseId: lease._id,
        invoiceNumber: invoiceNumber,
      });

      if (emailResult.success) {
        toast.success(
          t("leases.invoiceDoc.toasts.emailed", { defaultValue: "Invoice sent to {email}", values: { email: emailTo } }),
        );
        onInvoiceEmailed?.(emailTo);
        setEmailDialogOpen(false);
      } else {
        throw new Error(
          emailResult.error ||
            t("leases.invoiceDoc.toasts.emailFailed", { defaultValue: "Could not send the email" }),
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("leases.invoiceDoc.toasts.emailFailed", { defaultValue: "Could not send the email" });
      toast.error(errorMessage);
    } finally {
      setIsEmailing(false);
    }
  };

  // Generate PDF and save to documents
  const handleSavePDF = async () => {
    try {
      setIsSaving(true);

      const options: InvoiceGenerationOptions = {
        lease,
        companyInfo,
        invoiceNumber,
        issueDate,
        dueDate,
        includeTerms: true,
        includeNotes: true,
      };

      const result = await generateLeaseInvoicePDF(options);

      if (result.success) {
        const saveResult = await saveInvoiceToDocuments(result, lease._id);

        if (saveResult.success && saveResult.documentId) {
          toast.success(t("leases.invoiceDoc.toasts.saved", { defaultValue: "Invoice saved to the contract's documents" }));
          onInvoiceSaved?.(saveResult.documentId);
        } else {
          throw new Error(
            saveResult.error ||
              t("leases.invoiceDoc.toasts.saveFailed", { defaultValue: "Could not save the invoice" }),
          );
        }
      } else {
        throw new Error(
          result.error ||
            t("leases.invoiceDoc.toasts.saveFailed", { defaultValue: "Could not save the invoice" }),
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("leases.invoiceDoc.toasts.saveFailed", { defaultValue: "Could not save the invoice" });
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // Print invoice using the same HTML design
  const handlePrint = async () => {
    const printable = buildPrintableFromLease();
    await printInvoiceDirect(printable, companyInfo);
  };

  // Copy share link
  const handleCopyShareLink = () => {
    const shareUrl = `${window.location.origin}/dashboard/leases/${
      lease._id || "unknown"
    }/invoice`;
    navigator.clipboard.writeText(shareUrl);
    toast.success(t("leases.invoiceDoc.toasts.linkCopied", { defaultValue: "Link copied" }));
    setShareDialogOpen(false);
  };

  return (
    <div className={className}>
      {/* Action Bar */}
      <Card className="mb-6 print:hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("leases.invoiceDoc.title", { defaultValue: "Lease invoice" })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {/* Print Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="flex items-center gap-2"
            >
              <Printer className="h-4 w-4" />
              {t("leases.invoiceDoc.print", { defaultValue: "Print" })}
            </Button>

            {/* Download PDF Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPDF}
              disabled={isGenerating}
              className="flex items-center gap-2"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isGenerating
                ? t("leases.invoiceDoc.generating", { defaultValue: "Preparing…" })
                : t("leases.invoiceDoc.downloadPdf", { defaultValue: "Download PDF" })}
            </Button>

            {/* Email Button */}
            <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Mail className="h-4 w-4" />
                  {t("leases.invoiceDoc.email.button", { defaultValue: "Email" })}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>
                    {t("leases.invoiceDoc.email.title", { defaultValue: "Email the invoice" })}
                  </DialogTitle>
                  <DialogDescription>
                    {t("leases.invoiceDoc.email.description", { defaultValue: "The invoice goes as a PDF attachment" })}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="email-to">
                      {t("leases.invoiceDoc.email.to", { defaultValue: "To" })}
                    </Label>
                    <Input
                      id="email-to"
                      type="email"
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                      placeholder="recipient@example.com"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email-subject">
                      {t("leases.invoiceDoc.email.subject", { defaultValue: "Subject" })}
                    </Label>
                    <Input
                      id="email-subject"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}

                    />
                  </div>
                  <div>
                    <Label htmlFor="email-message">
                      {t("leases.invoiceDoc.email.message", { defaultValue: "Message" })}
                    </Label>
                    <Textarea
                      id="email-message"
                      value={emailMessage}
                      onChange={(e) => setEmailMessage(e.target.value)}

                      rows={4}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setEmailDialogOpen(false)}
                    disabled={isEmailing}
                  >
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </Button>
                  <Button
                    onClick={handleEmailPDF}
                    disabled={isEmailing || !emailTo}
                  >
                    {isEmailing ? (
                      <Loader2 className="h-4 w-4 animate-spin me-2" />
                    ) : (
                      <Mail className="h-4 w-4 me-2" />
                    )}
                    {isEmailing
                      ? t("leases.invoiceDoc.email.sending", { defaultValue: "Sending…" })
                      : t("leases.invoiceDoc.email.send", { defaultValue: "Send" })}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Save Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSavePDF}
              disabled={isSaving}
              className="flex items-center gap-2"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isSaving
                ? t("leases.invoiceDoc.saving", { defaultValue: "Saving…" })
                : t("leases.invoiceDoc.saveToDocuments", { defaultValue: "Save to documents" })}
            </Button>

            {/* Share Button */}
            <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Share2 className="h-4 w-4" />
                  {t("leases.invoiceDoc.share", { defaultValue: "Share" })}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>
                    {t("leases.invoiceDoc.shareTitle", { defaultValue: "Share the invoice" })}
                  </DialogTitle>
                  <DialogDescription>
                    {t("leases.invoiceDoc.shareDescription", { defaultValue: "Anyone on your team with access can open this link" })}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>{t("leases.invoiceDoc.link", { defaultValue: "Link" })}</Label>
                    <div className="flex gap-2">
                      <Input
                        value={`${window.location.origin}/dashboard/leases/${
                          lease._id || "unknown"
                        }/invoice`}
                        readOnly
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyShareLink}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShareDialogOpen(false)}
                  >
                    {t("leases.invoiceDoc.close", { defaultValue: "Close" })}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Component */}
      <LeaseInvoice
        lease={lease}
        companyInfo={companyInfo}
        invoiceNumber={invoiceNumber}
        issueDate={issueDate}
        dueDate={dueDate}
      />
    </div>
  );
}
