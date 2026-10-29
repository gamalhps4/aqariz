"use client";

/**
 * A custom invoice, or a credit note against one.
 *
 * To a tenant (with or without a contract), an owner, or a customer who is
 * neither; each line with its VAT category and rate, the discount taken
 * before VAT, and the totals worked out as the server will (lib/invoice/
 * vat.ts). A line starts with the contract's treatment for rent — exempt for
 * residential, 15% for a commercial contract with tax — and the office's own
 * services standard-rated. `?creditNoteFor=<invoice>` writes a credit note
 * instead, starting from that invoice's lines.
 */

import Link from "next/link";
import { toast } from "sonner";
import { InvoiceType } from "@/types";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Suspense, useEffect, useState } from "react";
import {
  SearchableSelect,
  type SearchableSelectGroup,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  computeVatInvoice,
  defaultVatTreatment,
  isSaudiVatNumber,
  STANDARD_VAT_RATE,
  VAT_CATEGORIES,
  type ContractTax,
  type VatCategory,
} from "@/lib/invoice/vat";
import { addBusinessDays, businessToday } from "@/lib/dates/business-day";

// Grouped categories for the dropdown
const INVOICE_CATEGORY_GROUPS: SearchableSelectGroup[] = [
  {
    label: "Tenant Charges & Fees",
    options: [
      { value: InvoiceType.RENT, label: "Rent" },
      { value: InvoiceType.SECURITY_DEPOSIT, label: "Security Deposit" },
      { value: InvoiceType.APPLICATION_FEE, label: "Application Fee" },
      { value: InvoiceType.MOVE_IN_FEE, label: "Move-in Fee" },
      { value: InvoiceType.MOVE_OUT_FEE, label: "Move-out Fee" },
      { value: InvoiceType.PET_DEPOSIT, label: "Pet Deposit" },
      { value: InvoiceType.PET_RENT, label: "Pet Rent" },
      { value: InvoiceType.PARKING_FEE, label: "Parking Fee" },
      { value: InvoiceType.STORAGE_FEE, label: "Storage Fee" },
      { value: InvoiceType.LEASE_BREAK_FEE, label: "Lease Break Fee" },
      { value: InvoiceType.NSF_FEE, label: "NSF Fee" },
    ],
  },
  {
    label: "Utilities",
    options: [
      { value: InvoiceType.ELECTRICITY, label: "Electricity" },
      { value: InvoiceType.WATER_SEWER, label: "Water / Sewer" },
      { value: InvoiceType.GAS, label: "Gas" },
      { value: InvoiceType.TRASH, label: "Trash" },
      { value: InvoiceType.INTERNET, label: "Internet" },
      { value: InvoiceType.CABLE, label: "Cable" },
      { value: InvoiceType.UTILITY, label: "Utility (General)" },
    ],
  },
  {
    label: "Maintenance & Repairs",
    options: [
      { value: InvoiceType.MAINTENANCE, label: "Maintenance" },
      { value: InvoiceType.REPAIR, label: "Repair" },
      { value: InvoiceType.CLEANING, label: "Cleaning" },
      { value: InvoiceType.LANDSCAPING, label: "Landscaping" },
    ],
  },
  {
    label: "Other",
    options: [
      { value: InvoiceType.MANAGEMENT_FEE, label: "Management Fee" },
      { value: InvoiceType.LEGAL_FEE, label: "Legal Fee" },
      { value: InvoiceType.INSURANCE, label: "Insurance" },
      { value: InvoiceType.OTHER, label: "Other" },
    ],
  },
];

/** Catalogue names of the groups above, in order. */
const CATEGORY_GROUP_KEYS = ["tenantCharges", "utilities", "maintenance", "other"];

const VAT_CATEGORY_LABELS: Record<VatCategory, string> = {
  S: "Standard rate",
  Z: "Zero-rated",
  E: "Exempt",
  O: "Out of scope",
};

type CustomerType = "tenant" | "owner" | "customer";

interface LeaseOption {
  id: string;
  propertyId: string;
  propertyName: string;
  unitNumber: string | null;
  startDate: string;
  endDate: string;
  taxEnabled: boolean;
  taxRate: number;
}

interface TenantOption {
  id: string;
  name: string;
  email: string | null;
  leases: LeaseOption[];
}

interface OwnerOption {
  id: string;
  name: string;
  email: string | null;
  vatNumber: string | null;
  address: string | null;
  properties: Array<{ id: string; name: string }>;
}

interface BuildingOption {
  id: string;
  name: string;
}

interface LineDraft {
  key: number;
  description: string;
  category: string;
  quantity: number;
  unitPrice: number;
  vatCategory: VatCategory;
  vatRate: number;
  /** Set once the treatment is chosen by hand; a default no longer moves it. */
  vatChosen: boolean;
}

interface OriginalInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string | null;
  totalAmount: number;
  creditedAmount: number;
  lines: Array<{
    description: string;
    category: string | null;
    quantity: number;
    unitPrice: number;
    vatCategory: VatCategory;
    vatRate: number;
  }>;
}

function todayIso(): string {
  return businessToday();
}

let nextLineKey = 1;

function newLine(category: string, contract: ContractTax | null): LineDraft {
  const treatment = defaultVatTreatment(category || undefined, contract);
  return {
    key: nextLineKey++,
    description: "",
    category: "",
    quantity: 1,
    unitPrice: 0,
    vatCategory: treatment.vatCategory,
    vatRate: treatment.vatRate,
    vatChosen: false,
  };
}

/**
 * The draft's totals as the server will work them out, with the key of each
 * line counted (a line without a description or a price is not).
 */
function computeDraftTotals(lines: LineDraft[], category: string, discount: number) {
  const counted = lines.filter((line) => line.description.trim() && line.unitPrice > 0);
  try {
    return {
      keys: counted.map((line) => line.key),
      result: computeVatInvoice(
        counted.map((line) => ({
          description: line.description,
          category: line.category || category || null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatCategory: line.vatCategory,
          vatRate: line.vatRate,
        })),
        discount,
      ),
      error: null as string | null,
    };
  } catch (error) {
    return {
      keys: [] as number[],
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const body = await response.json();
    return (body?.data ?? null) as T | null;
  } catch {
    return null;
  }
}

function NewInvoiceForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const creditNoteFor = searchParams.get("creditNoteFor");
  const isCreditNote = Boolean(creditNoteFor);
  const { t, formatCurrency, formatDate } = useLocalizationContext();

  const categoryGroups: SearchableSelectGroup[] = INVOICE_CATEGORY_GROUPS.map(
    (group, index) => ({
      label: t(`transactions.categoryGroups.${CATEGORY_GROUP_KEYS[index]}`, {
        defaultValue: group.label,
      }),
      options: group.options.map((option) => ({
        ...option,
        label: t(`transactions.categories.${option.value}`, {
          defaultValue: option.label,
        }),
      })),
    }),
  );
  const categoryOptions = categoryGroups.flatMap((group) => group.options);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [original, setOriginal] = useState<OriginalInvoice | null>(null);

  // Form state
  const [customerType, setCustomerType] = useState<CustomerType>("tenant");
  const [category, setCategory] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [leaseId, setLeaseId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [buyerVatNumber, setBuyerVatNumber] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso);
  const [dueDate, setDueDate] = useState(() =>
    addBusinessDays(businessToday(), 1),
  );
  const [discountAmount, setDiscountAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine("", null)]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (creditNoteFor) {
        const invoice = await readJson<{
          id?: string;
          _id?: string;
          invoiceNumber: string;
          customerName?: string | null;
          totalAmount: number;
          creditedAmount?: number;
          creditableLines?: OriginalInvoice["lines"];
        }>(`/api/invoices/${creditNoteFor}`);
        if (cancelled) return;
        if (invoice) {
          const originalLines = invoice.creditableLines ?? [];
          setOriginal({
            id: invoice.id ?? invoice._id ?? creditNoteFor,
            invoiceNumber: invoice.invoiceNumber,
            customerName: invoice.customerName ?? null,
            totalAmount: Number(invoice.totalAmount) || 0,
            creditedAmount: Number(invoice.creditedAmount) || 0,
            lines: originalLines,
          });
          setLines(
            originalLines.map((line) => ({
              key: nextLineKey++,
              description: line.description,
              category: line.category ?? "",
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatCategory: line.vatCategory,
              vatRate: line.vatRate,
              vatChosen: true,
            })),
          );
        }
        setIsLoadingData(false);
        return;
      }
      const [tenantData, ownerData, buildingData] = await Promise.all([
        readJson<{ tenants: TenantOption[] }>("/api/invoices/customers?type=tenant"),
        readJson<{ owners: OwnerOption[] }>("/api/invoices/customers?type=owner"),
        readJson<{ properties: BuildingOption[] }>("/api/invoices/customers?type=property"),
      ]);
      if (cancelled) return;
      setTenants(tenantData?.tenants ?? []);
      setOwners(ownerData?.owners ?? []);
      setBuildings(buildingData?.properties ?? []);
      setIsLoadingData(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [creditNoteFor]);

  const selectedTenant = tenants.find((tenant) => tenant.id === tenantId) ?? null;
  const selectedLease =
    selectedTenant?.leases.find((lease) => lease.id === leaseId) ?? null;
  const selectedOwner = owners.find((owner) => owner.id === ownerId) ?? null;
  const contract: ContractTax | null =
    customerType === "tenant" && selectedLease
      ? { taxEnabled: selectedLease.taxEnabled, taxRate: selectedLease.taxRate }
      : null;

  /** Lines nobody has set a treatment on follow the category and contract. */
  const reDefault = (nextCategory: string, nextContract: ContractTax | null) => {
    setLines((previous) =>
      previous.map((line) => {
        if (line.vatChosen) return line;
        const treatment = defaultVatTreatment(
          line.category || nextCategory || undefined,
          nextContract,
        );
        return { ...line, vatCategory: treatment.vatCategory, vatRate: treatment.vatRate };
      }),
    );
  };

  const chooseCategory = (value: string) => {
    setCategory(value);
    reDefault(value, contract);
  };

  const chooseTenant = (value: string) => {
    setTenantId(value);
    const tenant = tenants.find((entry) => entry.id === value);
    // Their one live contract, when they have exactly one.
    const only = tenant && tenant.leases.length === 1 ? tenant.leases[0] : null;
    setLeaseId(only?.id ?? "");
    setPropertyId(only?.propertyId ?? "");
    reDefault(
      category,
      only ? { taxEnabled: only.taxEnabled, taxRate: only.taxRate } : null,
    );
  };

  const chooseLease = (value: string) => {
    setLeaseId(value);
    const lease = selectedTenant?.leases.find((entry) => entry.id === value);
    if (lease) setPropertyId(lease.propertyId);
    reDefault(
      category,
      lease ? { taxEnabled: lease.taxEnabled, taxRate: lease.taxRate } : null,
    );
  };

  const chooseOwner = (value: string) => {
    setOwnerId(value);
    setPropertyId("");
    const owner = owners.find((entry) => entry.id === value);
    setBuyerVatNumber(owner?.vatNumber ?? "");
  };

  const chooseCustomerType = (value: CustomerType) => {
    setCustomerType(value);
    setTenantId("");
    setLeaseId("");
    setOwnerId("");
    setPropertyId("");
    setBuyerVatNumber("");
    reDefault(category, null);
  };

  const updateLine = (key: number, patch: Partial<LineDraft>) => {
    setLines((previous) =>
      previous.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        // A new category on a line nobody has set VAT on takes its default.
        if (patch.category !== undefined && !line.vatChosen) {
          const treatment = defaultVatTreatment(
            next.category || category || undefined,
            contract,
          );
          next.vatCategory = treatment.vatCategory;
          next.vatRate = treatment.vatRate;
        }
        if (patch.vatCategory !== undefined) {
          next.vatChosen = true;
          next.vatRate =
            patch.vatCategory === "S"
              ? line.vatCategory === "S"
                ? line.vatRate
                : STANDARD_VAT_RATE
              : 0;
        }
        if (patch.vatRate !== undefined) next.vatChosen = true;
        return next;
      }),
    );
  };

  const tenantOptions: SearchableSelectOption[] = tenants.map((tenant) => ({
    value: tenant.id,
    label: tenant.name,
    subtitle: tenant.email ?? undefined,
  }));
  const leaseOptions: SearchableSelectOption[] = (selectedTenant?.leases ?? []).map(
    (lease) => ({
      value: lease.id,
      label: [lease.propertyName, lease.unitNumber].filter(Boolean).join(" · "),
      subtitle: `${formatDate(new Date(lease.startDate))} – ${formatDate(new Date(lease.endDate))}`,
      badge: lease.taxEnabled ? `${lease.taxRate}%` : undefined,
    }),
  );
  const ownerOptions: SearchableSelectOption[] = owners.map((owner) => ({
    value: owner.id,
    label: owner.name,
    subtitle: owner.email ?? undefined,
  }));
  const buildingOptions: SearchableSelectOption[] = (
    customerType === "owner" && selectedOwner ? selectedOwner.properties : buildings
  ).map((building) => ({ value: building.id, label: building.name }));

  // The totals as the server will work them out.
  const discount = parseFloat(discountAmount) || 0;
  const computed = computeDraftTotals(lines, category, isCreditNote ? 0 : discount);

  const creditable = original
    ? Math.round((original.totalAmount - original.creditedAmount) * 100) / 100
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validLines = lines.filter(
      (line) => line.description.trim() && line.unitPrice > 0,
    );
    if (validLines.length === 0) {
      toast.error(
        t("invoices.form.lineItemsError", {
          defaultValue: "Add at least one line item with a description and amount",
        }),
      );
      return;
    }
    if (computed.error) {
      toast.error(computed.error);
      return;
    }
    if (buyerVatNumber.trim() && !isSaudiVatNumber(buyerVatNumber)) {
      toast.error(
        t("invoices.vat.numberInvalid", {
          defaultValue: "A VAT number is 15 digits that begin and end with 3",
        }),
      );
      return;
    }

    let body: Record<string, unknown>;
    if (isCreditNote) {
      if (!original) return;
      body = {
        documentType: "credit_note",
        originalInvoiceId: original.id,
        reason: reason.trim() || undefined,
        issueDate: new Date(issueDate),
        notes: notes || undefined,
        lines: validLines.map((line) => ({
          description: line.description,
          category: line.category || undefined,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatCategory: line.vatCategory,
          vatRate: line.vatRate,
        })),
      };
    } else {
      if (customerType === "tenant" && !tenantId) {
        toast.error(
          t("invoices.form.selectTenantError", { defaultValue: "Please select a tenant" }),
        );
        return;
      }
      if (customerType === "tenant" && !leaseId && !propertyId) {
        toast.error(
          t("invoices.form.selectPropertyError", { defaultValue: "Please select a property" }),
        );
        return;
      }
      if (customerType === "owner" && !ownerId) {
        toast.error(
          t("invoices.customer.selectOwnerError", { defaultValue: "Please select an owner" }),
        );
        return;
      }
      if (customerType === "customer" && !customerName.trim()) {
        toast.error(
          t("invoices.customer.nameError", { defaultValue: "Enter the customer's name" }),
        );
        return;
      }
      if (!dueDate) {
        toast.error(
          t("invoices.form.dueDateError", { defaultValue: "Please set a due date" }),
        );
        return;
      }
      body = {
        documentType: "invoice",
        customerType,
        tenantId: customerType === "tenant" ? tenantId : undefined,
        leaseId: customerType === "tenant" && leaseId ? leaseId : undefined,
        ownerId: customerType === "owner" ? ownerId : undefined,
        propertyId: propertyId || undefined,
        customer:
          customerType === "customer"
            ? {
                name: customerName.trim(),
                vatNumber: buyerVatNumber.trim() || undefined,
                address: customerAddress.trim() || undefined,
              }
            : undefined,
        customerAddress: customerAddress.trim() || undefined,
        buyerVatNumber:
          customerType !== "customer" && buyerVatNumber.trim()
            ? buyerVatNumber.trim()
            : undefined,
        category: category || undefined,
        issueDate: new Date(issueDate),
        dueDate: new Date(dueDate),
        discountAmount: discount,
        notes: notes || undefined,
        lines: validLines.map((line) => ({
          description: line.description,
          category: line.category || category || undefined,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatCategory: line.vatCategory,
          vatRate: line.vatRate,
        })),
      };
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(
          result.error ||
            t("invoices.toasts.createFailed", { defaultValue: "Could not create the invoice" }),
        );
      }
      toast.success(
        isCreditNote
          ? t("invoices.creditNote.created", { defaultValue: "Credit note issued" })
          : t("invoices.toasts.createSuccess", { defaultValue: "Invoice created successfully" }),
      );
      const createdId = result?.data?.id ?? result?.data?._id;
      router.push(
        createdId
          ? `/dashboard/accounting/invoices/${createdId}`
          : "/dashboard/accounting/invoices",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("invoices.toasts.createFailed", { defaultValue: "Could not create the invoice" }),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingData) {
    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="bg-card border rounded-xl p-6 space-y-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const totals = computed.result?.totals;
  const standardRows = (computed.result?.breakdown ?? []).filter(
    (row) => row.vatCategory === "S",
  );

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isCreditNote
              ? t("invoices.creditNote.title", { defaultValue: "Issue credit note" })
              : t("invoices.new.title", { defaultValue: "Create Invoice" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isCreditNote && original
              ? t("invoices.creditNote.subtitle", {
                  defaultValue: "Against invoice {number} · up to {amount}",
                  values: {
                    number: original.invoiceNumber,
                    amount: formatCurrency(creditable),
                  },
                })
              : t("invoices.new.subtitleAny", {
                  defaultValue: "To a tenant, an owner or any customer, with VAT on each line",
                })}
          </p>
        </div>
        <Link href="/dashboard/accounting/invoices">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 me-2 rtl:rotate-180" />
            {t("invoices.new.backToInvoices", {
              defaultValue: "Back to Invoices",
            })}
          </Button>
        </Link>
      </div>

      {isCreditNote && !original ? (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          {t("leases.invoices.details.notFound.title", { defaultValue: "Invoice not found" })}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="bg-card border rounded-xl p-6 space-y-8">
            {isCreditNote && original ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <Label className="font-semibold">
                    {t("invoices.customer.billedTo", { defaultValue: "Billed to" })}
                  </Label>
                  <p className="text-sm">{original.customerName || "—"}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reason" className="font-semibold">
                    {t("invoices.creditNote.reason", { defaultValue: "Reason" })}
                  </Label>
                  <Input
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    placeholder={t("invoices.creditNote.reasonPlaceholder", {
                      defaultValue: "e.g. Discount agreed after issue",
                    })}
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Who the invoice is to */}
                <div className="space-y-2">
                  <Label className="font-semibold">
                    {t("invoices.customer.type.label", { defaultValue: "Invoice to" })}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {(["tenant", "owner", "customer"] as CustomerType[]).map((type) => (
                      <Button
                        key={type}
                        type="button"
                        size="sm"
                        variant={customerType === type ? "default" : "outline"}
                        onClick={() => chooseCustomerType(type)}
                      >
                        {t(`invoices.customer.type.${type}`, {
                          defaultValue:
                            type === "tenant" ? "Tenant" : type === "owner" ? "Owner" : "Other customer",
                        })}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {customerType === "tenant" && (
                    <>
                      <div className="space-y-2">
                        <Label className="font-semibold">
                          {t("invoices.form.tenant", { defaultValue: "Tenant" })} *
                        </Label>
                        <SearchableSelect
                          value={tenantId}
                          onValueChange={chooseTenant}
                          options={tenantOptions}
                          placeholder={t("invoices.form.chooseTenant", {
                            defaultValue: "Select a tenant...",
                          })}
                          searchPlaceholder={t("invoices.form.searchTenant", {
                            defaultValue: "Search by name...",
                          })}
                          emptyMessage={t("invoices.form.noTenantFound", {
                            defaultValue: "No tenant found.",
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-semibold">
                          {t("invoices.form.lease", { defaultValue: "Lease (optional)" })}
                        </Label>
                        <SearchableSelect
                          value={leaseId}
                          onValueChange={chooseLease}
                          options={leaseOptions}
                          disabled={!selectedTenant || leaseOptions.length === 0}
                          placeholder={
                            selectedTenant && leaseOptions.length === 0
                              ? t("invoices.customer.noLease", {
                                  defaultValue: "No live contract: choose the building",
                                })
                              : t("invoices.form.chooseLease", {
                                  defaultValue: "Select a lease...",
                                })
                          }
                          searchPlaceholder={t("invoices.form.searchLease", {
                            defaultValue: "Search leases...",
                          })}
                          emptyMessage={t("invoices.form.noLeaseFound", {
                            defaultValue: "No lease found for the selected tenant/property.",
                          })}
                        />
                        {selectedLease ? (
                          <p className="text-xs text-muted-foreground">
                            {selectedLease.taxEnabled
                              ? t("invoices.vat.contractTaxed", {
                                  defaultValue: "Commercial contract: rent carries VAT at {rate}%",
                                  values: { rate: selectedLease.taxRate },
                                })
                              : t("invoices.vat.contractExempt", {
                                  defaultValue: "Residential contract: rent is VAT-exempt",
                                })}
                          </p>
                        ) : null}
                      </div>
                    </>
                  )}

                  {customerType === "owner" && (
                    <div className="space-y-2">
                      <Label className="font-semibold">
                        {t("invoices.customer.owner", { defaultValue: "Owner" })} *
                      </Label>
                      <SearchableSelect
                        value={ownerId}
                        onValueChange={chooseOwner}
                        options={ownerOptions}
                        placeholder={t("invoices.customer.chooseOwner", {
                          defaultValue: "Select an owner...",
                        })}
                        searchPlaceholder={t("invoices.form.searchTenant", {
                          defaultValue: "Search by name...",
                        })}
                        emptyMessage={t("invoices.customer.noOwnerFound", {
                          defaultValue: "No owner found.",
                        })}
                      />
                    </div>
                  )}

                  {customerType === "customer" && (
                    <div className="space-y-2">
                      <Label htmlFor="customerName" className="font-semibold">
                        {t("invoices.customer.name", { defaultValue: "Customer name" })} *
                      </Label>
                      <Input
                        id="customerName"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        maxLength={200}
                      />
                    </div>
                  )}

                  {/* The building: required for a tenant without a contract,
                      a reference on anyone else's invoice. */}
                  {(customerType !== "tenant" || !leaseId) && (
                    <div className="space-y-2">
                      <Label className="font-semibold">
                        {t("invoices.form.property", { defaultValue: "Property" })}
                        {customerType === "tenant" ? " *" : ""}
                      </Label>
                      <SearchableSelect
                        value={propertyId}
                        onValueChange={setPropertyId}
                        options={buildingOptions}
                        placeholder={t("invoices.form.chooseProperty", {
                          defaultValue: "Select a property...",
                        })}
                        searchPlaceholder={t("invoices.form.searchProperty", {
                          defaultValue: "Search properties...",
                        })}
                        emptyMessage={t("invoices.form.noPropertyFound", {
                          defaultValue: "No property found for this tenant.",
                        })}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="buyerVat" className="font-semibold">
                      {t("invoices.customer.vatNumber", { defaultValue: "Customer's VAT number" })}
                    </Label>
                    <Input
                      id="buyerVat"
                      value={buyerVatNumber}
                      onChange={(e) => setBuyerVatNumber(e.target.value)}
                      inputMode="numeric"
                      maxLength={20}
                      placeholder="3XXXXXXXXXXXXX3"
                    />
                    <p className="text-xs text-muted-foreground">
                      {buyerVatNumber.trim()
                        ? t("invoices.vat.standardInvoice", {
                            defaultValue: "With a VAT number this is a tax invoice",
                          })
                        : t("invoices.vat.simplifiedInvoice", {
                            defaultValue: "Without one it is a simplified tax invoice",
                          })}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="customerAddress" className="font-semibold">
                      {t("invoices.customer.address", { defaultValue: "Customer's address" })}
                    </Label>
                    <Input
                      id="customerAddress"
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      maxLength={500}
                      placeholder={
                        customerType === "owner" && selectedOwner?.address
                          ? selectedOwner.address
                          : undefined
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="font-semibold">
                      {t("invoices.form.category", {
                        defaultValue: "Category & Subcategory",
                      })}
                    </Label>
                    <SearchableSelect
                      value={category}
                      onValueChange={chooseCategory}
                      groups={categoryGroups}
                      placeholder={t("invoices.form.chooseCategory", {
                        defaultValue: "Select a category...",
                      })}
                      searchPlaceholder={t("invoices.form.searchCategory", {
                        defaultValue: "Search categories...",
                      })}
                      emptyMessage={t("invoices.form.noCategoryFound", {
                        defaultValue: "No category found.",
                      })}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="issueDate" className="font-semibold">
                  {t("invoices.form.dateCreated", { defaultValue: "Date Created" })}
                </Label>
                <Input
                  id="issueDate"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
              {!isCreditNote && (
                <div className="space-y-2">
                  <Label htmlFor="dueDate" className="font-semibold">
                    {t("invoices.form.dueDate", { defaultValue: "Due Date" })}
                  </Label>
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Lines */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">
                {t("invoices.form.itemsDetails", { defaultValue: "Items Details" })}
              </Label>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="min-w-45">
                        {t("invoices.form.itemDescription", { defaultValue: "Item Description" })}
                      </TableHead>
                      <TableHead className="min-w-35">
                        {t("invoices.form.category", { defaultValue: "Category" })}
                      </TableHead>
                      <TableHead className="w-20 text-end">
                        {t("leases.invoicePrint.quantity", { defaultValue: "Qty" })}
                      </TableHead>
                      <TableHead className="w-28 text-end">
                        {t("leases.invoicePrint.unitPrice", { defaultValue: "Unit price" })}
                      </TableHead>
                      <TableHead className="min-w-32.5">
                        {t("invoices.vat.category.label", { defaultValue: "VAT" })}
                      </TableHead>
                      <TableHead className="w-20 text-end">
                        {t("invoices.vat.rate", { defaultValue: "Rate %" })}
                      </TableHead>
                      <TableHead className="w-28 text-end">
                        {t("leases.invoicePrint.total", { defaultValue: "Total" })}
                      </TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => {
                      const index = computed.keys.indexOf(line.key);
                      const shown = index >= 0 ? computed.result?.lines[index] : undefined;
                      return (
                        <TableRow key={line.key}>
                          <TableCell>
                            <Input
                              value={line.description}
                              onChange={(e) =>
                                updateLine(line.key, { description: e.target.value })
                              }
                              placeholder={t("invoices.form.itemDescriptionPlaceholder", {
                                defaultValue: "e.g., Monthly Rent, Utility",
                              })}
                              maxLength={200}
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={line.category || "__invoice"}
                              onValueChange={(value) =>
                                updateLine(line.key, {
                                  category: value === "__invoice" ? "" : value,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__invoice">
                                  {t("invoices.form.sameAsInvoice", {
                                    defaultValue: "As the invoice",
                                  })}
                                </SelectItem>
                                {categoryOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={line.quantity || ""}
                              onChange={(e) =>
                                updateLine(line.key, {
                                  quantity: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="text-end"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.unitPrice || ""}
                              onChange={(e) =>
                                updateLine(line.key, {
                                  unitPrice: parseFloat(e.target.value) || 0,
                                })
                              }
                              placeholder="0.00"
                              className="text-end"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={line.vatCategory}
                              onValueChange={(value) =>
                                updateLine(line.key, { vatCategory: value as VatCategory })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {VAT_CATEGORIES.map((code) => (
                                  <SelectItem key={code} value={code}>
                                    {t(`invoices.vat.category.${code}`, {
                                      defaultValue: VAT_CATEGORY_LABELS[code],
                                    })}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={line.vatCategory === "S" ? line.vatRate : 0}
                              disabled={line.vatCategory !== "S"}
                              onChange={(e) =>
                                updateLine(line.key, {
                                  vatRate: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="text-end"
                            />
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {shown ? formatCurrency(shown.totalAmount) : "—"}
                            {shown && shown.vatAmount > 0 ? (
                              <div className="text-xs text-muted-foreground">
                                {t("leases.invoicePrint.vat", { defaultValue: "VAT" })}{" "}
                                {formatCurrency(shown.vatAmount)}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="px-1">
                            {lines.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setLines((previous) =>
                                    previous.filter((entry) => entry.key !== line.key),
                                  )
                                }
                                className="p-1 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLines((previous) => [...previous, newLine(category, contract)])
                }
              >
                <Plus className="h-4 w-4 me-1" />
                {t("invoices.form.addItem", { defaultValue: "Add Item" })}
              </Button>
            </div>

            {/* Summary */}
            <div className="bg-muted/30 border rounded-lg p-6">
              <div className="flex justify-end">
                <div className="w-full max-w-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {t("invoices.summary.subTotal", { defaultValue: "Sub Total:" })}
                    </span>
                    <span className="text-sm font-medium">
                      {formatCurrency(totals?.subtotal ?? 0)}
                    </span>
                  </div>
                  {!isCreditNote && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {t("invoices.vat.discountBeforeVat", {
                          defaultValue: "Discount (before VAT):",
                        })}
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={discountAmount}
                        onChange={(e) => setDiscountAmount(e.target.value)}
                        placeholder="0"
                        className="h-8 w-28 text-sm text-end"
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {t("leases.invoicePrint.totalExclVat", {
                        defaultValue: "Total excluding VAT",
                      })}
                    </span>
                    <span className="text-sm font-medium">
                      {formatCurrency(totals?.netAmount ?? 0)}
                    </span>
                  </div>
                  {standardRows.length > 0 ? (
                    standardRows.map((row) => (
                      <div key={row.vatRate} className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {t("leases.invoicePrint.vat", { defaultValue: "VAT" })} ({row.vatRate}%)
                        </span>
                        <span className="text-sm font-medium">
                          {formatCurrency(row.vatAmount)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {t("leases.invoicePrint.vat", { defaultValue: "VAT" })}
                      </span>
                      <span className="text-sm font-medium">{formatCurrency(0)}</span>
                    </div>
                  )}
                  <div className="border-t pt-3 flex items-center justify-between">
                    <span className="font-bold">
                      {t("invoices.summary.grandTotal", { defaultValue: "Grand Total:" })}
                    </span>
                    <span className="font-bold text-lg">
                      {formatCurrency(totals?.totalAmount ?? 0)}
                    </span>
                  </div>
                  {computed.error ? (
                    <p className="text-xs text-destructive">{computed.error}</p>
                  ) : null}
                  {isCreditNote && totals && totals.totalAmount > creditable + 0.005 ? (
                    <Badge variant="destructive">
                      {t("invoices.creditNote.tooMuch", {
                        defaultValue: "More than is left to credit ({amount})",
                        values: { amount: formatCurrency(creditable) },
                      })}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes" className="font-semibold">
                {t("invoices.form.notesOptional", { defaultValue: "Notes (optional)" })}
              </Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("invoices.form.notesPlaceholder", {
                  defaultValue: "Add any notes for this invoice...",
                })}
                rows={4}
                maxLength={1000}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 mt-6 pt-6 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/dashboard/accounting/invoices")}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {isCreditNote
                ? t("invoices.creditNote.submit", { defaultValue: "Issue credit note" })
                : t("invoices.form.submit", { defaultValue: "Create Invoice" })}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function NewInvoicePage() {
  // The form reads `?creditNoteFor=`; under the dashboard layout that needs
  // a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <NewInvoiceForm />
    </Suspense>
  );
}
