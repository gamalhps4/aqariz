"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Receipt } from "lucide-react";
import { LeaseInvoice } from "./LeaseInvoice";
import { LeaseResponse } from "@/lib/services/lease.service";
import { getCompanyInfo, CompanyInfo } from "@/lib/utils/company-info";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useUiText } from "@/components/ui/use-ui-text";

export interface LeaseInvoiceModalProps {
  lease: LeaseResponse;
  trigger?: React.ReactNode;
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
}

export function LeaseInvoiceModal({
  lease,
  trigger,
  companyInfo: propCompanyInfo,
  invoiceNumber,
  issueDate,
  dueDate,
}: LeaseInvoiceModalProps) {
  const { t } = useLocalizationContext();
  const [isOpen, setIsOpen] = useState(false);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(
    propCompanyInfo || null
  );
  const [isLoadingCompanyInfo, setIsLoadingCompanyInfo] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  // Only fetch company info when dialog opens for the first time
  const fetchCompanyInfo = useCallback(async () => {
    if (propCompanyInfo || hasFetched) return;

    setIsLoadingCompanyInfo(true);
    try {
      const info = await getCompanyInfo();
      if (info) {
        setCompanyInfo(info);
      }
    } catch (error) {
      console.error("Failed to fetch company info:", error);
    } finally {
      setIsLoadingCompanyInfo(false);
      setHasFetched(true);
    }
  }, [propCompanyInfo, hasFetched]);

  // Fetch when dialog opens
  useEffect(() => {
    if (isOpen && !propCompanyInfo && !hasFetched) {
      fetchCompanyInfo();
    }
  }, [isOpen, propCompanyInfo, hasFetched, fetchCompanyInfo]);

  const defaultTrigger = (
    <Button
      variant="outline"
      size="sm"
      className="flex items-center gap-2 border-none! shadow-none! text-gray-600!"
    >
      <Receipt className="h-4 w-4" />
      {t("leases.invoiceDoc.preview", { defaultValue: "Preview invoice" })}
    </Button>
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
      <DialogContent className="w-full min-w-4/5! max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("leases.invoiceDoc.title", { defaultValue: "Lease invoice" })}
          </DialogTitle>
          <DialogDescription>
            {t("leases.invoiceDoc.description", { defaultValue: "The contract's terms and amounts, ready to print" })}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {isLoadingCompanyInfo ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <LeaseInvoice
              lease={lease}
              companyInfo={companyInfo || undefined}
              invoiceNumber={invoiceNumber}
              issueDate={issueDate}
              dueDate={dueDate}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Quick action component for lease cards/lists
export interface QuickInvoiceButtonProps {
  lease: LeaseResponse;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default" | "lg";
  className?: string;
}

export function QuickInvoiceButton({
  lease,
  variant = "outline",
  size = "sm",
  className,
}: QuickInvoiceButtonProps) {
  const { text } = useUiText();
  return (
    <LeaseInvoiceModal
      lease={lease}
      trigger={
        <Button variant={variant} size={size} className={className}>
          <Receipt className="h-4 w-4" />
          {size !== "sm" && <span className="ms-2">{text("ui.invoice", "Invoice")}</span>}
        </Button>
      }
    />
  );
}
