/**
 * PropertyPro - Simplified Lease Creation Form
 * Streamlined lease creation focusing on core fields only
 */

"use client";

import React, { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Home,
  Calendar,
  DollarSign,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { LeaseStatus, PropertyStatus } from "@/types";
import { FormDatePicker } from "@/components/ui/date-picker";
import { LeaseResponse, leaseService } from "@/lib/services/lease.service";
import {
  FREQUENCY_LABELS,
  PAYMENT_FREQUENCIES,
  installmentCount,
  normalizeFrequency,
  planInstallments,
  splitContractAmount,
  summarizeInstallments,
  type PaymentFrequencyKey,
} from "@/lib/lease-installments";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/utils/formatting";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { LeaseAmendmentDialog } from "@/components/lease/LeaseAmendmentDialog";
import {
  QuickTenantDialog,
  type QuickTenant,
} from "@/components/tenants/QuickTenantDialog";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface SimplifiedLeaseData {
  // Core Information
  propertyId: string;
  unitId: string;
  tenantId: string;

  // Contract identity
  /** Electronic Contract Number (Ejar) — optional, unique per organization. */
  contractNumber: string;

  // Dates
  startDate: string;
  endDate: string;

  // Financial Terms
  /**
   * The amount due per installment. Typed in "installment" mode; in "total"
   * mode it is derived — the regular share of the total (see withContractShare).
   */
  rentAmount: number;
  /**
   * Which figure the amount box holds. Offices write contracts both ways —
   * "1,000 a month" and "12,000 for the year" — and the second is the default,
   * being the figure on the paper the contract is copied from.
   */
  amountBasis: AmountBasis;
  /** The total for the whole term as typed, kept as text so typing is never reformatted. */
  contractAmount: string;
  /** Optional utility charges billed with each installment, like the rent. */
  electricityAmount: number;
  waterAmount: number;
  securityDeposit: number;
  rentDueDay: number;
  paymentFrequency: PaymentFrequencyKey;

  // Tax — per contract, since one office holds both taxable and exempt ones
  taxEnabled: boolean;
  taxRate: number;

  // Whether the generated invoices are emailed to the tenant
  autoEmailInvoices: boolean;
}

interface Property {
  _id: string;
  name: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  units: Array<{
    _id: string;
    unitNumber: string;
    unitType: string;
    bedrooms: number;
    bathrooms: number;
    squareFootage: number;
    rentAmount: number;
    securityDeposit: number;
    status: string;
  }>;
}

interface Tenant {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface SimplifiedLeaseCreationProps {
  mode?: "create" | "edit";
  leaseId?: string;
  initialLease?: LeaseResponse;
  onSuccess?: (leaseId?: string) => void;
}

const createInitialLeaseState = (): SimplifiedLeaseData => ({
  propertyId: "",
  unitId: "",
  tenantId: "",
  contractNumber: "",
  startDate: "",
  endDate: "",
  rentAmount: 0,
  amountBasis: "total",
  contractAmount: "",
  electricityAmount: 0,
  waterAmount: 0,
  securityDeposit: 0,
  rentDueDay: 1,
  paymentFrequency: "monthly",
  taxEnabled: false,
  taxRate: 15,
  autoEmailInvoices: false,
});

const LEASE_DATE_FROM_YEAR = 1900;

function getInitials(firstName?: string, lastName?: string) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
}

type AmountBasis = "installment" | "total";

/** A typed amount as a number, or 0 while the box is empty or mid-edit. */
function parseAmount(text: string): number {
  const amount = parseFloat(text);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * In total mode the rent per installment is never typed: it is the regular
 * share of the total over the installments the term produces. Re-derived on
 * every change, so it always matches the dates and cycle on screen — the old
 * way round divided on each keystroke and multiplied back for display, which
 * rounded 12,000 typed into a monthly contract down to 0.96.
 */
function withContractShare(data: SimplifiedLeaseData): SimplifiedLeaseData {
  if (data.amountBasis !== "total") return data;
  const count = installmentCount({
    startDate: data.startDate,
    endDate: data.endDate,
    frequency: data.paymentFrequency,
  });
  // Until the dates are in there is nothing to divide by, and the whole
  // figure stands in; the dates' own errors say what is missing.
  const { share } = splitContractAmount(
    parseAmount(data.contractAmount),
    Math.max(count, 1),
  );
  return data.rentAmount === share ? data : { ...data, rentAmount: share };
}

/**
 * The same contract read the other way round: rent per installment becomes
 * the total it adds up to over the term, and a total becomes its regular
 * share, which `rentAmount` already holds.
 */
function withAmountBasis(
  data: SimplifiedLeaseData,
  basis: AmountBasis,
): SimplifiedLeaseData {
  if (data.amountBasis === basis) return data;
  if (basis === "installment") return { ...data, amountBasis: basis };

  const rentTotal =
    Math.round(
      planInstallments({
        startDate: data.startDate,
        endDate: data.endDate,
        rentAmount: data.rentAmount,
        frequency: data.paymentFrequency,
      }).reduce((sum, installment) => sum + installment.rentAmount, 0) * 100,
    ) / 100;

  return withContractShare({
    ...data,
    amountBasis: basis,
    contractAmount: rentTotal > 0 ? String(rentTotal) : data.contractAmount,
  });
}

export default function SimplifiedLeaseCreation({
  mode = "create",
  leaseId,
  initialLease,
  onSuccess,
}: SimplifiedLeaseCreationProps) {
  const { t, formatCurrency } = useLocalizationContext();

  const [leaseData, setLeaseData] = useState<SimplifiedLeaseData>(
    createInitialLeaseState
  );
  const [originalLeaseData, setOriginalLeaseData] =
    useState<SimplifiedLeaseData>(createInitialLeaseState);

  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initializingLease, setInitializingLease] = useState(mode === "edit");
  const [leaseError, setLeaseError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /**
   * Editing a contract whose installments are billed: its terms are what
   * those bills were written from, and the server refuses to change them
   * (lib/lease-term-edits.ts). The fields say so up front instead of the
   * save failing at the end. A contract in force cannot move to another
   * building, unit or tenant either.
   */
  const [termsLocked, setTermsLocked] = useState(false);
  const [placementLocked, setPlacementLocked] = useState(false);
  /**
   * A billed contract is changed by amendment instead (POST .../amend): the
   * operator asks for it, the fields open, and saving shows what it re-bills
   * before anything is written (LeaseAmendmentDialog). The level says what
   * may change — while nothing is paid, the building, unit and tenant too.
   * Null for a viewer who may not amend.
   */
  const [amendmentLevel, setAmendmentLevel] = useState<
    "correction" | "amendment" | null
  >(null);
  const [amending, setAmending] = useState(false);
  const [amendPayload, setAmendPayload] = useState<Record<
    string,
    unknown
  > | null>(null);
  const termsReadOnly = termsLocked && !amending;
  const placementReadOnly =
    placementLocked && !(amending && amendmentLevel === "correction");

  const isEditMode = mode === "edit";
  const submitLabel = amending
    ? t("leases.amend.review")
    : isEditMode
      ? t("leases.new.form.buttons.saveChanges")
      : t("leases.new.form.buttons.createLease");
  const submitLoadingLabel = isEditMode
    ? t("leases.new.form.buttons.savingChanges")
    : t("leases.new.form.buttons.creatingLease");
  const resetLabel = isEditMode
    ? t("leases.new.form.buttons.resetChanges")
    : t("leases.new.form.buttons.resetForm");

  // Fetch properties and tenants on component mount
  useEffect(() => {
    fetchProperties();
    fetchTenants();
  }, []);

  const fetchProperties = async () => {
    try {
      setLoadingProperties(true);
      const response = await fetch("/api/properties?limit=100");
      const data = await response.json();

      if (response.ok && data.success) {
        // The API returns properties directly in data.data
        const properties = Array.isArray(data.data) ? data.data : [];

        // Ensure all properties have a units array (even if empty)
        const normalizedProperties = properties.map((property: any) => ({
          ...property,
          units: Array.isArray(property.units) ? property.units : [],
        }));

        setProperties(normalizedProperties);
      } else {
        toast.error(
          t("leases.new.form.toasts.loadPropertiesError"),
          data.error
            ? {
                description: data.error,
                duration: 5000,
              }
            : undefined
        );
        setProperties([]);
      }
    } catch (error) {
      toast.error(t("leases.new.form.toasts.loadPropertiesError"));
      setProperties([]);
    } finally {
      setLoadingProperties(false);
    }
  };

  /**
   * Put the new tenant at the operator's fingertips immediately: into the
   * list behind the select, and selected — refetching would cost a round trip
   * and lose the selection they just made implicitly by creating them.
   */
  const handleTenantCreated = (tenant: QuickTenant) => {
    setTenants((current) => [
      {
        _id: tenant.id,
        firstName: tenant.firstName,
        lastName: tenant.lastName,
        email: tenant.email ?? "",
      },
      ...current.filter((existing) => existing._id !== tenant.id),
    ]);
    handleInputChange("tenantId", tenant.id);
  };

  const fetchTenants = async () => {
    try {
      const response = await fetch("/api/users?role=tenant&limit=100");
      const data = await response.json();
      if (data.success) {
        setTenants(data.data?.users || []);
      } else {
        toast.error(
          t("leases.new.form.toasts.loadTenantsError"),
          data.error
            ? {
                description: data.error,
                duration: 5000,
              }
            : undefined
        );
      }
    } catch (error) {
      toast.error(t("leases.new.form.toasts.loadTenantsError"));
    }
  };

  const mapLeaseToFormData = (lease: LeaseResponse): SimplifiedLeaseData => {
    const propertyId =
      typeof lease.propertyId === "string"
        ? lease.propertyId
        : lease.propertyId?._id || "";
    const tenantId =
      typeof lease.tenantId === "string"
        ? lease.tenantId
        : lease.tenantId?._id || "";
    const unitId =
      typeof lease.unitId === "string" ? lease.unitId : lease.unit?._id || "";

    const paymentConfig = (lease.terms as any)?.paymentConfig;

    const contract = lease as unknown as {
      contractNumber?: string | null;
      paymentFrequency?: string;
      contractAmount?: number | null;
      electricityAmount?: number;
      waterAmount?: number;
      taxEnabled?: boolean;
      taxRate?: number;
    };

    return {
      propertyId: propertyId || "",
      unitId: unitId || "",
      tenantId: tenantId || "",
      contractNumber: contract.contractNumber ?? "",
      startDate: lease.startDate ? lease.startDate.slice(0, 10) : "",
      endDate: lease.endDate ? lease.endDate.slice(0, 10) : "",
      rentAmount: lease.terms?.rentAmount ?? 0,
      // A contract saved as a total opens as one, with the figure as typed.
      amountBasis: contract.contractAmount != null ? "total" : "installment",
      contractAmount:
        contract.contractAmount != null ? String(contract.contractAmount) : "",
      electricityAmount: contract.electricityAmount ?? 0,
      waterAmount: contract.waterAmount ?? 0,
      securityDeposit: lease.terms?.securityDeposit ?? 0,
      rentDueDay: paymentConfig?.rentDueDay ?? 1,
      paymentFrequency: normalizeFrequency(contract.paymentFrequency),
      taxEnabled: Boolean(contract.taxEnabled),
      // Keep a sensible default in the field when tax is off, so switching it
      // on does not present a 0% rate as if that were intended.
      taxRate: contract.taxEnabled ? (contract.taxRate ?? 0) : 15,
      autoEmailInvoices: paymentConfig?.autoEmailInvoices ?? false,
    };
  };

  const hydrateLeaseData = (lease: LeaseResponse) => {
    const mapped = mapLeaseToFormData(lease);
    setLeaseData(mapped);
    setOriginalLeaseData({ ...mapped });
    const billed = Boolean(lease.termsLocked);
    setTermsLocked(billed);
    setPlacementLocked(billed || lease.status === LeaseStatus.ACTIVE);
    setAmendmentLevel(billed ? (lease.amendmentLevel ?? null) : null);
    setAmending(false);
  };

  const stopAmending = () => {
    setAmending(false);
    setLeaseData({ ...originalLeaseData });
  };

  const loadLeaseDetails = async (id: string) => {
    try {
      setInitializingLease(true);
      const lease = await leaseService.getLeaseById(id);
      hydrateLeaseData(lease);
      setLeaseError(null);
    } catch (error) {
      console.error("Failed to load lease", error);
      const fallbackMessage = t("leases.new.form.errors.loadLeaseGeneric");
      const message = error instanceof Error ? error.message : fallbackMessage;
      setLeaseError(message);
      toast.error(t("leases.new.form.toasts.loadLeaseError"), {
        description: message !== fallbackMessage ? message : undefined,
        duration: 5000,
      });
    } finally {
      setInitializingLease(false);
    }
  };

  useEffect(() => {
    if (mode !== "edit") {
      setOriginalLeaseData(createInitialLeaseState());
      return;
    }

    if (initialLease) {
      hydrateLeaseData(initialLease);
      setInitializingLease(false);
      setLeaseError(null);
      return;
    }

    if (leaseId) {
      void loadLeaseDetails(leaseId);
    } else {
      setInitializingLease(false);
    }
  }, [mode, leaseId, initialLease]);

  const handleInputChange = (field: keyof SimplifiedLeaseData, value: any) => {
    setLeaseData((prev) =>
      withContractShare({
        ...prev,
        [field]: value,
      }),
    );
    validateField(field, value);
    // A total is checked through the rent it divides into, which is what the
    // rent rule guards and where the amount box shows its error.
    if (field === "contractAmount") {
      validateField(
        "rentAmount",
        withContractShare({ ...leaseData, contractAmount: value }).rentAmount,
      );
    }
  };

  const switchAmountBasis = (basis: AmountBasis) => {
    const switched = withAmountBasis(leaseData, basis);
    setLeaseData(switched);
    if (fieldErrors.rentAmount) validateField("rentAmount", switched.rentAmount);
  };

  const setError = (
    field: keyof SimplifiedLeaseData,
    message: string | null
  ) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  };

  const getFieldErrorMessage = (
    field: keyof SimplifiedLeaseData,
    value: any
  ): string | null => {
    let message: string | null = null;
    if (field === "propertyId" && !value)
      message = t("leases.new.form.validation.propertyRequired");
    if (field === "unitId" && !value)
      message = t("leases.new.form.validation.unitRequired");
    if (field === "tenantId" && !value)
      message = t("leases.new.form.validation.tenantRequired");
    if (field === "startDate" && !value)
      message = t("leases.new.form.validation.startDateRequired");
    if (field === "endDate" && !value)
      message = t("leases.new.form.validation.endDateRequired");
    if (field === "rentAmount" && (typeof value !== "number" || value <= 0))
      message = t("leases.new.form.validation.rentPositive");
    if (field === "securityDeposit" && (typeof value !== "number" || value < 0))
      message = t("leases.new.form.validation.securityDepositNonNegative");

    if (field === "endDate" && value && leaseData.startDate) {
      const start = new Date(leaseData.startDate);
      const end = new Date(value);
      if (end <= start)
        message = t("leases.new.form.validation.endDateAfterStart");
    }

    return message;
  };

  const validateField = (
    field: keyof SimplifiedLeaseData,
    value: any
  ): boolean => {
    const message = getFieldErrorMessage(field, value);
    setError(field, message);
    return !message;
  };

  const validateAll = (): {
    ok: boolean;
    messages: string[];
    invalidFields: Array<keyof SimplifiedLeaseData>;
  } => {
    const checks: Array<[keyof SimplifiedLeaseData, any]> = [
      ["propertyId", leaseData.propertyId],
      ["unitId", leaseData.unitId],
      ["tenantId", leaseData.tenantId],
      ["startDate", leaseData.startDate],
      ["endDate", leaseData.endDate],
      ["rentAmount", leaseData.rentAmount],
      ["securityDeposit", leaseData.securityDeposit],
    ];
    const messages: string[] = [];
    const invalidFields: Array<keyof SimplifiedLeaseData> = [];
    checks.forEach(([f, v]) => {
      const message = getFieldErrorMessage(f, v);
      setError(f, message);
      if (message) {
        invalidFields.push(f);
        messages.push(message);
      }
    });
    return { ok: messages.length === 0, messages, invalidFields };
  };

  const focusField = (field: keyof SimplifiedLeaseData) => {
    const idMap: Record<keyof SimplifiedLeaseData, string> = {
      propertyId: "propertySelect",
      unitId: "unitSelect",
      tenantId: "tenantSelect",
      startDate: "startDatePicker",
      endDate: "endDatePicker",
      rentAmount: "rentAmount",
      amountBasis: "rentAmount",
      contractAmount: "rentAmount",
      electricityAmount: "electricityAmount",
      waterAmount: "waterAmount",
      securityDeposit: "securityDeposit",
      rentDueDay: "rentDueDaySelect",
      autoEmailInvoices: "autoEmailInvoices",
      contractNumber: "contractNumber",
      paymentFrequency: "paymentFrequencySelect",
      taxEnabled: "taxEnabled",
      taxRate: "taxRate",
    };
    const id = idMap[field];
    if (!id) return;
    const el = document.getElementById(id) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
    }
  };

  const focusFirstInvalid = (
    invalidFields: Array<keyof SimplifiedLeaseData>
  ) => {
    if (invalidFields.length > 0) {
      focusField(invalidFields[0]);
    }
  };

  const getSelectedProperty = () => {
    return properties.find((p) => p._id === leaseData.propertyId);
  };

  const getAvailableUnits = () => {
    const property = getSelectedProperty();

    if (!property || !Array.isArray(property.units)) {
      return [];
    }

    const selectedUnitId = leaseData.unitId;

    const availableUnits = property.units.filter((unit) => {
      if (!unit || typeof unit !== "object") {
        return false;
      }

      if (!unit.unitNumber) {
        return false;
      }

      if (mode === "edit" && unit._id === selectedUnitId) {
        return true;
      }

      const status =
        typeof unit.status === "string" ? unit.status.toLowerCase() : "";
      return status === PropertyStatus.AVAILABLE;
    });

    if (
      mode === "edit" &&
      selectedUnitId &&
      !availableUnits.some((unit) => unit._id === selectedUnitId)
    ) {
      const selectedUnit = property.units.find(
        (unit) => unit?._id === selectedUnitId
      );
      if (selectedUnit) {
        return [selectedUnit, ...availableUnits];
      }
    }

    return availableUnits;
  };

  const contractTotal =
    leaseData.amountBasis === "total"
      ? parseAmount(leaseData.contractAmount)
      : null;

  // Live preview of what the contract will bill. Uses the same planner the
  // generator does, so what the operator sees here is exactly what gets
  // invoiced — not a separate estimate that can drift from it.
  const plannedInstallments = useMemo(
    () =>
      planInstallments({
        startDate: leaseData.startDate,
        endDate: leaseData.endDate,
        rentAmount: leaseData.rentAmount,
        contractAmount: contractTotal,
        electricityAmount: leaseData.electricityAmount,
        waterAmount: leaseData.waterAmount,
        frequency: leaseData.paymentFrequency,
        rentDueDay: leaseData.rentDueDay,
        taxEnabled: leaseData.taxEnabled,
        taxRate: leaseData.taxRate,
      }),
    [
      leaseData.startDate,
      leaseData.endDate,
      leaseData.rentAmount,
      contractTotal,
      leaseData.electricityAmount,
      leaseData.waterAmount,
      leaseData.paymentFrequency,
      leaseData.rentDueDay,
      leaseData.taxEnabled,
      leaseData.taxRate,
    ],
  );
  const installmentPreview = summarizeInstallments(plannedInstallments);

  /** How the typed total divides, for the line under the amount box. */
  const contractSplit = splitContractAmount(
    contractTotal ?? 0,
    plannedInstallments.length,
  );

  const getSelectedUnit = () => {
    const availableUnits = getAvailableUnits();
    return availableUnits.find((unit) => unit?._id === leaseData?.unitId);
  };

  // A unit's listed price is not offered here, as a pre-fill or on screen:
  // the rent is whatever this contract says, and a default the operator did
  // not type was being saved as the contract's rent.
  const handleUnitChange = (unitId: string) => {
    handleInputChange("unitId", unitId);
  };

  const propertyOptions: SearchableSelectOption[] = properties.map(
    (property) => ({
      value: property._id,
      label: property.name,
      subtitle: [property.address?.street, property.address?.city]
        .filter(Boolean)
        .join(", "),
      icon: <Home className="h-4 w-4 text-muted-foreground" />,
    })
  );

  const unitOptions: SearchableSelectOption[] = getAvailableUnits().map(
    (unit) => ({
      value: unit._id,
      label: t("leases.new.form.sections.propertyTenant.unitLabel", {
        values: { unitNumber: unit.unitNumber },
      }),
      subtitle: t("leases.new.form.sections.selectedUnit.sizeValue", {
        values: {
          bedrooms: unit.bedrooms ?? 0,
          bathrooms: unit.bathrooms ?? 0,
        },
      }),
    })
  );

  const tenantOptions: SearchableSelectOption[] = tenants.map((tenant) => ({
    value: tenant._id,
    label: `${tenant.firstName} ${tenant.lastName}`,
    subtitle: tenant.email,
    icon: (
      <Avatar className="h-7 w-7 text-xs">
        <AvatarFallback>
          {getInitials(tenant.firstName, tenant.lastName)}
        </AvatarFallback>
      </Avatar>
    ),
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { ok, messages, invalidFields } = validateAll();
    if (!ok) {
      toast.error(
        t("leases.new.form.toasts.validationErrors", {
          values: { errors: messages.join(", ") },
        })
      );
      focusFirstInvalid(invalidFields);
      return;
    }

    if (mode === "edit" && !(leaseId || initialLease?._id)) {
      toast.error(t("leases.new.form.errors.missingLeaseIdentifier"));
      return;
    }

    setSubmitting(true);

    const basePayload = {
      propertyId: leaseData.propertyId,
      unitId: leaseData.unitId,
      tenantId: leaseData.tenantId,
      contractNumber: leaseData.contractNumber.trim() || null,
      startDate: leaseData.startDate,
      endDate: leaseData.endDate,
      paymentFrequency: leaseData.paymentFrequency,
      electricityAmount: leaseData.electricityAmount,
      waterAmount: leaseData.waterAmount,
      taxEnabled: leaseData.taxEnabled,
      taxRate: leaseData.taxEnabled ? leaseData.taxRate : 0,
      // Null prices the contract per installment; the server divides a total.
      contractAmount: contractTotal || null,
      terms: {
        rentAmount: leaseData.rentAmount,
        securityDeposit: leaseData.securityDeposit,
        utilities: [],
        restrictions: [],
        paymentConfig: {
          rentDueDay: leaseData.rentDueDay,
          // No longer a choice — an active contract is always billed. Still
          // saved, as true, for anything that reads the contract's settings.
          autoGenerateInvoices: true,
          autoEmailInvoices: leaseData.autoEmailInvoices,
          autoCreatePayments: true,
          prorationEnabled: true,
          advancePaymentMonths: 0,
        },
      },
    };

    const targetLeaseId = leaseId ?? initialLease?._id;

    // An amendment is reviewed before it is written: the dialog previews it
    // from this payload and confirms it.
    if (mode === "edit" && amending && targetLeaseId) {
      setAmendPayload(basePayload);
      setSubmitting(false);
      return;
    }

    const endpoint =
      mode === "edit" && targetLeaseId
        ? `/api/leases/${targetLeaseId}`
        : "/api/leases";
    const method = mode === "edit" ? "PUT" : "POST";
    const payload =
      mode === "edit"
        ? basePayload
        : {
            ...basePayload,
            status: "active" as const,
          };

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            result.message ||
            t("leases.new.form.errors.saveLeaseGeneric")
        );
      }

      const resultLease = result.data?.lease ?? result.data ?? null;
      const resultLeaseId =
        resultLease?._id ??
        targetLeaseId ??
        (typeof result.data?.id === "string" ? result.data.id : undefined);

      if (mode === "edit") {
        toast.success(t("leases.new.form.toasts.updateSuccess"));

        setLeaseError(null);

        if (resultLease) {
          hydrateLeaseData(resultLease);
        } else if (targetLeaseId) {
          void loadLeaseDetails(targetLeaseId);
        }

        if (onSuccess) {
          onSuccess(resultLeaseId);
        } else if (resultLeaseId) {
          window.location.href = `/dashboard/leases/${resultLeaseId}`;
        }
        return;
      }

      toast.success(t("leases.new.form.toasts.createSuccess"));

      if (result.data?.invoiceGeneration) {
        const { invoicesGenerated, errors: invoiceErrors } =
          result.data.invoiceGeneration;
        if (invoicesGenerated > 0) {
          toast.success(
            t("leases.new.form.toasts.invoicesGenerated", {
              values: { count: invoicesGenerated },
            }),
            {
              description: t("leases.new.form.toasts.invoicesAvailable"),
              duration: 6000,
            }
          );
        }
        if (Array.isArray(invoiceErrors) && invoiceErrors.length > 0) {
          toast.warning(
            t("leases.new.form.toasts.invoiceWarnings", {
              values: { warnings: invoiceErrors.join(", ") },
            })
          );
        }
      }

      setLeaseData(createInitialLeaseState());
      setOriginalLeaseData(createInitialLeaseState());

      const navigateAfterCreate = () => {
        if (onSuccess) {
          onSuccess(resultLeaseId);
        } else if (resultLeaseId) {
          window.location.href = `/dashboard/leases/${resultLeaseId}`;
        } else {
          window.location.href = "/dashboard/leases";
        }
      };

      setTimeout(navigateAfterCreate, 2000);
    } catch (error) {
      const fallbackMessage = t("leases.new.form.errors.saveLeaseGeneric");
      const message = error instanceof Error ? error.message : fallbackMessage;
      toast.error(
        mode === "edit"
          ? t("leases.new.form.toasts.updateError")
          : t("leases.new.form.toasts.createError"),
        {
          description: message,
          duration: 5000,
        }
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (isEditMode && initializingLease) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {leaseError && (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <span>{leaseError}</span>
              {isEditMode && (leaseId || initialLease?._id) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void loadLeaseDetails(leaseId ?? initialLease?._id ?? "")
                  }
                >
                  {t("leases.new.form.actions.retryLoadLease")}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {termsLocked && (
          <Alert>
            <AlertDescription className="space-y-3">
              <p>
                {amending
                  ? t("leases.amend.amendingNote")
                  : t("leases.edit.termsLocked", {
                      defaultValue:
                        "This contract already has billed installments, so its dates, rent, frequency, tax, utilities, deposit, unit and tenant can no longer change. The contract number can still be corrected. To change an amount, edit single installments on the contract's Installments tab, or terminate the contract and create a new one.",
                    })}
              </p>
              {amendmentLevel && !amending && (
                <p>{t(`leases.amend.offer.${amendmentLevel}`)}</p>
              )}
              {amendmentLevel && (
                <Button
                  type="button"
                  size="sm"
                  variant={amending ? "outline" : "default"}
                  onClick={amending ? stopAmending : () => setAmending(true)}
                >
                  {amending ? t("leases.amend.stop") : t("leases.amend.start")}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Property & Tenant Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              {t("leases.new.form.sections.propertyTenant.title")}
            </CardTitle>
            <CardDescription>
              {t("leases.new.form.sections.propertyTenant.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="propertySelect">
                  {t(
                    "leases.new.form.sections.propertyTenant.labels.property",
                    {
                      values: { count: properties.length },
                    }
                  )}
                </Label>
                <SearchableSelect
                  id="propertySelect"
                  value={leaseData.propertyId}
                  onValueChange={(value) => {
                    handleInputChange("propertyId", value);
                    handleInputChange("unitId", ""); // Reset unit when property changes
                  }}
                  options={propertyOptions}
                  placeholder={t(
                    "leases.new.form.sections.propertyTenant.placeholders.property"
                  )}
                  searchPlaceholder={t(
                    "leases.new.form.sections.propertyTenant.search.property",
                    { defaultValue: "Search properties..." }
                  )}
                  emptyMessage={t(
                    "leases.new.form.sections.propertyTenant.messages.noPropertiesFound",
                    { defaultValue: "No property found." }
                  )}
                  disabled={loadingProperties || placementReadOnly}
                />
                {fieldErrors.propertyId && (
                  <p className="text-destructive text-sm">
                    {fieldErrors.propertyId}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="unitSelect">
                  {leaseData.propertyId
                    ? t(
                        "leases.new.form.sections.propertyTenant.labels.unitWithCount",
                        { values: { count: getAvailableUnits().length } }
                      )
                    : t("leases.new.form.sections.propertyTenant.labels.unit")}
                </Label>
                <SearchableSelect
                  id="unitSelect"
                  value={leaseData.unitId}
                  onValueChange={handleUnitChange}
                  disabled={
                    !leaseData.propertyId || loadingProperties || placementReadOnly
                  }
                  options={unitOptions}
                  placeholder={
                    !leaseData.propertyId
                      ? t(
                          "leases.new.form.sections.propertyTenant.placeholders.selectPropertyFirst"
                        )
                      : loadingProperties
                      ? t(
                          "leases.new.form.sections.propertyTenant.placeholders.loadingUnits"
                        )
                      : getAvailableUnits().length === 0
                      ? t(
                          "leases.new.form.sections.propertyTenant.placeholders.noUnits"
                        )
                      : t(
                          "leases.new.form.sections.propertyTenant.placeholders.unit"
                        )
                  }
                  searchPlaceholder={t(
                    "leases.new.form.sections.propertyTenant.search.unit",
                    { defaultValue: "Search units..." }
                  )}
                  emptyMessage={
                    leaseData.propertyId
                      ? t(
                          "leases.new.form.sections.propertyTenant.messages.noUnitsInProperty"
                        )
                      : t(
                          "leases.new.form.sections.propertyTenant.placeholders.selectPropertyFirst"
                        )
                  }
                />
                {fieldErrors.unitId && (
                  <p className="text-destructive text-sm">
                    {fieldErrors.unitId}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenantSelect">
                {t("leases.new.form.sections.propertyTenant.labels.tenant")}
              </Label>
              {/* The contract is often the first time this person is
                  recorded at all, so the tenant can be created here rather
                  than by abandoning a half-filled contract. */}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SearchableSelect
                    id="tenantSelect"
                    disabled={placementReadOnly}
                    value={leaseData.tenantId}
                    onValueChange={(value) =>
                      handleInputChange("tenantId", value)
                    }
                    options={tenantOptions}
                    placeholder={t(
                      "leases.new.form.sections.propertyTenant.placeholders.tenant"
                    )}
                    searchPlaceholder={t(
                      "leases.new.form.sections.propertyTenant.search.tenant",
                      { defaultValue: "Search tenants..." }
                    )}
                    emptyMessage={t(
                      "leases.new.form.sections.propertyTenant.messages.noTenantFound",
                      { defaultValue: "No tenant found." }
                    )}
                  />
                </div>
                {!placementReadOnly && (
                  <QuickTenantDialog onCreated={handleTenantCreated} />
                )}
              </div>
              {fieldErrors.tenantId && (
                <p className="text-destructive text-sm">
                  {fieldErrors.tenantId}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Selected Unit Details */}
        {leaseData.unitId && getSelectedUnit() && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-primary">
                {t("leases.new.form.sections.selectedUnit.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <div className="text-xs text-gray-500 mb-1">
                    {t("leases.new.form.sections.selectedUnit.labels.unit")}
                  </div>
                  <div className="font-medium">
                    {getSelectedUnit()?.unitNumber} (
                    {getSelectedUnit()?.unitType})
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">
                    {t("leases.new.form.sections.selectedUnit.labels.size")}
                  </div>
                  <div className="font-medium">
                    {t("leases.new.form.sections.selectedUnit.sizeValue", {
                      values: {
                        bedrooms: getSelectedUnit()?.bedrooms ?? 0,
                        bathrooms: getSelectedUnit()?.bathrooms ?? 0,
                      },
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">
                    {t("leases.new.form.sections.selectedUnit.labels.area")}
                  </div>
                  <div className="font-medium">
                    {t("leases.new.form.sections.selectedUnit.areaValue", {
                      values: { area: getSelectedUnit()?.squareFootage ?? 0 },
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Lease Dates */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {t("leases.new.form.sections.dates.title")}
            </CardTitle>
            <CardDescription>
              {t("leases.new.form.sections.dates.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contractNumber">
                {t("leases.contract.number", {
                  defaultValue: "Electronic contract number",
                })}
              </Label>
              <Input
                id="contractNumber"
                value={leaseData.contractNumber}
                onChange={(event) =>
                  handleInputChange("contractNumber", event.target.value)
                }
                placeholder="EJAR-000000"
              />
              <p className="text-muted-foreground text-xs">
                {t("leases.contract.numberHint", {
                  defaultValue:
                    "The authority reference for this contract. Optional, but unique across your contracts when set.",
                })}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startDate">
                  {t("leases.new.form.sections.dates.labels.startDate")}
                </Label>
                <FormDatePicker
                  id="startDatePicker"
                  readOnly={termsReadOnly}
                  key={`start-date-${leaseData.startDate}`}
                  value={
                    leaseData.startDate
                      ? new Date(leaseData.startDate + "T00:00:00")
                      : undefined
                  }
                  onChange={(date) => {
                    if (date) {
                      // Create a new date to avoid timezone issues
                      const localDate = new Date(
                        date.getFullYear(),
                        date.getMonth(),
                        date.getDate()
                      );
                      handleInputChange(
                        "startDate",
                        format(localDate, "yyyy-MM-dd")
                      );
                    } else {
                      handleInputChange("startDate", "");
                    }
                  }}
                  placeholder={t(
                    "leases.new.form.sections.dates.placeholders.startDate"
                  )}
                  fromYear={LEASE_DATE_FROM_YEAR}
                  toYear={new Date().getFullYear() + 5}
                />
                {fieldErrors.startDate && (
                  <p className="text-destructive text-sm">
                    {fieldErrors.startDate}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="endDate">
                  {t("leases.new.form.sections.dates.labels.endDate")}
                </Label>
                <FormDatePicker
                  id="endDatePicker"
                  readOnly={termsReadOnly}
                  key={`end-date-${leaseData.endDate}-${leaseData.startDate}`}
                  value={
                    leaseData.endDate
                      ? new Date(leaseData.endDate + "T00:00:00")
                      : undefined
                  }
                  onChange={(date) => {
                    if (date) {
                      // Create a new date to avoid timezone issues
                      const localDate = new Date(
                        date.getFullYear(),
                        date.getMonth(),
                        date.getDate()
                      );
                      handleInputChange(
                        "endDate",
                        format(localDate, "yyyy-MM-dd")
                      );
                    } else {
                      handleInputChange("endDate", "");
                    }
                  }}
                  placeholder={t(
                    "leases.new.form.sections.dates.placeholders.endDate"
                  )}
                  disabled={(date) => {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const checkDate = new Date(date);
                    checkDate.setHours(0, 0, 0, 0);

                    if (!leaseData.startDate) return checkDate < today;

                    const startDate = new Date(
                      leaseData.startDate + "T00:00:00"
                    );
                    startDate.setHours(0, 0, 0, 0);
                    return checkDate <= startDate;
                  }}
                  fromYear={
                    leaseData.startDate
                      ? new Date(
                          leaseData.startDate + "T00:00:00"
                        ).getFullYear()
                      : new Date().getFullYear()
                  }
                  toYear={new Date().getFullYear() + 10}
                />
                {fieldErrors.endDate && (
                  <p className="text-destructive text-sm">
                    {fieldErrors.endDate}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Financial Terms */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              {t("leases.details.financial.title")}
            </CardTitle>
            <CardDescription>
              {t("leases.new.form.sections.financial.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="paymentFrequency">
                  {t("leases.contract.frequency", {
                    defaultValue: "Installment frequency",
                  })}
                </Label>
                <Select
                  disabled={termsReadOnly}
                  value={leaseData.paymentFrequency}
                  onValueChange={(value) =>
                    handleInputChange(
                      "paymentFrequency",
                      value as PaymentFrequencyKey,
                    )
                  }
                >
                  <SelectTrigger id="paymentFrequencySelect">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_FREQUENCIES.map((frequency) => (
                      <SelectItem key={frequency} value={frequency}>
                        {t(`leases.contract.frequency.${frequency}`, {
                          defaultValue: FREQUENCY_LABELS[frequency],
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rentAmount">
                  {leaseData.amountBasis === "installment"
                    ? t("leases.contract.rentPerInstallment", {
                        defaultValue: "Rent per installment",
                      })
                    : t("leases.contract.rentTotal", {
                        defaultValue: "Total contract value",
                      })}
                </Label>
                {/* The contract on the desk may be written either way round,
                    so the form reads it either way round. The total is kept
                    as typed; the rent per installment is derived from it. */}
                <div className="flex items-center gap-2">
                  <Input
                    id="rentAmount"
                    disabled={termsReadOnly}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    className="min-w-0 flex-1"
                    value={
                      leaseData.amountBasis === "total"
                        ? leaseData.contractAmount
                        : leaseData.rentAmount
                    }
                    onChange={(e) =>
                      leaseData.amountBasis === "total"
                        ? handleInputChange("contractAmount", e.target.value)
                        : handleInputChange(
                            "rentAmount",
                            parseFloat(e.target.value) || 0,
                          )
                    }
                    placeholder={
                      leaseData.amountBasis === "total" ? "12000.00" : "1000.00"
                    }
                    required
                  />
                  <Select
                    disabled={termsReadOnly}
                    value={leaseData.amountBasis}
                    onValueChange={(value) =>
                      switchAmountBasis(value as AmountBasis)
                    }
                  >
                    <SelectTrigger className="w-[150px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="installment">
                        {t("leases.contract.basis.installment", {
                          defaultValue: "Per installment",
                        })}
                      </SelectItem>
                      <SelectItem value="total">
                        {t("leases.contract.basis.total", {
                          defaultValue: "Total",
                        })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {leaseData.amountBasis === "total" && (
                  <p className="text-xs text-muted-foreground">
                    {contractSplit.count === 0
                      ? t("leases.contract.basis.needDates", {
                          defaultValue:
                            "Choose the start and end dates to see the installments.",
                        })
                      : contractSplit.last === contractSplit.share
                        ? t("leases.contract.basis.hint", {
                            defaultValue: "{count} installments of {each}",
                            values: {
                              count: contractSplit.count,
                              each: formatCurrency(contractSplit.share),
                            },
                          })
                        : t("leases.contract.basis.hintRemainder", {
                            defaultValue:
                              "{count} installments of {each} and a last one of {last}",
                            values: {
                              count: contractSplit.count - 1,
                              each: formatCurrency(contractSplit.share),
                              last: formatCurrency(contractSplit.last),
                            },
                          })}{" "}
                    {t("leases.contract.basis.beforeTax", {
                      defaultValue: "Before tax; any tax is added to each installment.",
                    })}
                  </p>
                )}
                {fieldErrors.rentAmount && (
                  <p className="text-destructive text-sm">
                    {fieldErrors.rentAmount}
                  </p>
                )}
              </div>

              {/* Charged with each installment, like the rent — left at 0 for
                  a contract where the tenant pays the utility directly. */}
              <div className="space-y-2">
                <Label htmlFor="electricityAmount">
                  {t("leases.contract.electricityPerInstallment", {
                    defaultValue: "Electricity per installment (optional)",
                  })}
                </Label>
                <Input
                  id="electricityAmount"
                  disabled={termsReadOnly}
                  type="number"
                  min="0"
                  step="0.01"
                  value={leaseData.electricityAmount}
                  onChange={(e) =>
                    handleInputChange(
                      "electricityAmount",
                      parseFloat(e.target.value) || 0
                    )
                  }
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="waterAmount">
                  {t("leases.contract.waterPerInstallment", {
                    defaultValue: "Water per installment (optional)",
                  })}
                </Label>
                <Input
                  id="waterAmount"
                  disabled={termsReadOnly}
                  type="number"
                  min="0"
                  step="0.01"
                  value={leaseData.waterAmount}
                  onChange={(e) =>
                    handleInputChange(
                      "waterAmount",
                      parseFloat(e.target.value) || 0
                    )
                  }
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="securityDeposit">
                  {t("leases.details.financial.securityDeposit")}
                </Label>
                <Input
                  id="securityDeposit"
                  disabled={termsReadOnly}
                  type="number"
                  min="0"
                  step="0.01"
                  value={leaseData.securityDeposit}
                  onChange={(e) =>
                    handleInputChange(
                      "securityDeposit",
                      parseFloat(e.target.value) || 0
                    )
                  }
                  placeholder="2000.00"
                />
                {fieldErrors.securityDeposit && (
                  <p className="text-destructive text-sm">
                    {fieldErrors.securityDeposit}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="rentDueDay">
                  {t("leases.new.form.sections.financial.labels.rentDueDay")}
                </Label>
                <Select
                  disabled={termsReadOnly}
                  value={leaseData.rentDueDay.toString()}
                  onValueChange={(value) =>
                    handleInputChange("rentDueDay", parseInt(value))
                  }
                >
                  <SelectTrigger id="rentDueDaySelect">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                      <SelectItem key={day} value={day.toString()}>
                        {t(
                          "leases.new.form.sections.financial.labels.rentDueDayOption",
                          { values: { day } }
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Tax is decided per contract: one office holds both
                VAT-bearing and exempt agreements. */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex items-center gap-3">
                <Switch
                  id="taxEnabled"
                  disabled={termsReadOnly}
                  checked={leaseData.taxEnabled}
                  onCheckedChange={(checked) =>
                    handleInputChange("taxEnabled", checked)
                  }
                />
                <Label htmlFor="taxEnabled" className="cursor-pointer">
                  {t("leases.contract.taxEnabled", {
                    defaultValue: "Apply tax to this contract",
                  })}
                </Label>
              </div>

              {leaseData.taxEnabled && (
                <div className="space-y-2 sm:w-40">
                  <Label htmlFor="taxRate">
                    {t("leases.contract.taxRate", {
                      defaultValue: "Tax rate (%)",
                    })}
                  </Label>
                  <Input
                    id="taxRate"
                    disabled={termsReadOnly}
                    type="number"
                    min="0"
                    max="100"
                    step="0.001"
                    value={leaseData.taxRate}
                    onChange={(event) =>
                      handleInputChange(
                        "taxRate",
                        parseFloat(event.target.value) || 0,
                      )
                    }
                  />
                </div>
              )}
            </div>

            {installmentPreview.count > 0 && (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <p className="mb-2 font-medium">
                  {t("leases.contract.previewTitle", {
                    defaultValue: "Installment schedule",
                  })}
                </p>
                <div className="grid gap-2 sm:grid-cols-4">
                  <div>
                    <span className="block text-muted-foreground">
                      {t("leases.contract.previewCount", {
                        defaultValue: "Installments",
                      })}
                    </span>
                    <span className="font-medium">
                      {installmentPreview.count}
                    </span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">
                      {t("leases.contract.previewRent", {
                        defaultValue: "Total rent",
                      })}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(installmentPreview.subtotal)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">
                      {t("leases.contract.previewTax", { defaultValue: "Tax" })}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(installmentPreview.taxAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">
                      {t("leases.contract.previewTotal", {
                        defaultValue: "Contract value",
                      })}
                    </span>
                    <span className="font-semibold">
                      {formatCurrency(installmentPreview.totalAmount)}
                    </span>
                  </div>
                </div>

                {/* Every installment the contract will bill, so the split of a
                    total — and where its remainder lands — is seen before
                    the contract is saved, not discovered on the invoices. */}
                <div className="mt-4 max-h-80 overflow-y-auto rounded-md border bg-background">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t("leases.installments.installment", {
                            defaultValue: "Installment",
                          })}
                        </TableHead>
                        <TableHead>
                          {t("leases.installments.dueDate", {
                            defaultValue: "Due date",
                          })}
                        </TableHead>
                        <TableHead className="text-end">
                          {t("leases.card.rent", { defaultValue: "Rent" })}
                        </TableHead>
                        <TableHead className="text-end">
                          {t("leases.installments.amount", {
                            defaultValue: "Amount",
                          })}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plannedInstallments.map((installment) => (
                        <TableRow key={installment.index}>
                          <TableCell className="whitespace-nowrap">
                            {t("leases.installments.numbered", {
                              defaultValue: "Installment {index}",
                              values: { index: installment.index },
                            })}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatDisplayDate(installment.dueDate)}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {formatCurrency(installment.rentAmount)}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            <span className="font-medium">
                              {formatCurrency(installment.totalAmount)}
                            </span>
                            {installment.taxAmount > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {t("leases.installments.inclTax", {
                                  defaultValue: "incl. {tax} tax",
                                  values: {
                                    tax: formatCurrency(installment.taxAmount),
                                  },
                                })}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Automation Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              {t("leases.new.form.sections.automation.title")}
            </CardTitle>
            <CardDescription>
              {t("leases.new.form.sections.automation.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* There is no switch for generating the invoices themselves any
                more: a contract in force always has its installments billed.
                Switched off, it used to leave an active contract with a
                schedule nobody could collect against. */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="autoEmailInvoices">
                  {t("leases.new.form.sections.automation.labels.autoEmail")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("leases.new.form.sections.automation.help.autoEmail")}
                </p>
              </div>
              <Switch
                id="autoEmailInvoices"
                checked={leaseData.autoEmailInvoices}
                onCheckedChange={(checked) =>
                  handleInputChange("autoEmailInvoices", checked)
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Summary & Submit */}
        <Card>
          <CardHeader>
            <CardTitle>{t("leases.new.form.sections.review.title")}</CardTitle>
            <CardDescription>
              {t("leases.new.form.sections.review.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* What creating the contract bills. Saving an edit bills
                nothing: a draft is billed when it becomes active. */}
            {!isEditMode && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  {t("leases.new.form.sections.review.invoicesSummary", {
                    values: {
                      depositPart:
                        leaseData.securityDeposit > 0
                          ? t(
                              "leases.new.form.sections.review.fragments.securityDeposit"
                            )
                          : "",
                      emailPart: leaseData.autoEmailInvoices
                        ? t(
                            "leases.new.form.sections.review.fragments.autoEmail"
                          )
                        : "",
                    },
                  })}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (isEditMode) {
                    setLeaseData({ ...originalLeaseData });
                  } else {
                    const resetState = createInitialLeaseState();
                    setLeaseData(resetState);
                    setOriginalLeaseData(createInitialLeaseState());
                  }
                }}
                disabled={submitting || (isEditMode && initializingLease)}
              >
                {resetLabel}
              </Button>

              <Button
                type="submit"
                disabled={submitting || (isEditMode && initializingLease)}
                className="flex-1"
              >
                {submitting ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {submitLoadingLabel}
                  </>
                ) : (
                  submitLabel
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {isEditMode && (leaseId || initialLease?._id) && (
        <LeaseAmendmentDialog
          leaseId={(leaseId ?? initialLease?._id)!}
          payload={amendPayload}
          onClose={() => setAmendPayload(null)}
          onAmended={({ cancelled, billed, errors }) => {
            setAmendPayload(null);
            toast.success(
              t("leases.amend.dialog.success", { values: { cancelled, billed } }),
            );
            if (errors.length > 0) {
              toast.warning(
                t("leases.new.form.toasts.invoiceWarnings", {
                  values: { warnings: errors.join(", ") },
                }),
              );
            }
            const id = leaseId ?? initialLease?._id;
            if (onSuccess) onSuccess(id);
            else if (id) window.location.href = `/dashboard/leases/${id}`;
          }}
        />
      )}
    </div>
  );
}
