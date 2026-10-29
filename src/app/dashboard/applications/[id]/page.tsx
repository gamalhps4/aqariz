"use client";

import {
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  FileText,
  Mail,
  MapPin,
  Phone,
  User,
  X,
  Building2,
  Briefcase,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { displayCountry } from "@/lib/regional/region";

interface ApplicationDetails {
  _id: string;
  status: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  personalInfo?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    dateOfBirth?: string;
  };
  employmentInfo?: {
    employer?: string;
    position?: string;
    income?: number;
    startDate?: string;
    employerContact?: string;
  };
  emergencyContacts?: Array<{
    name?: string;
    relationship?: string;
    phone?: string;
    email?: string;
  }>;
  previousAddresses?: Array<{
    address?: string;
    landlordName?: string;
    landlordContact?: string;
    moveInDate?: string;
    moveOutDate?: string;
    reasonForLeaving?: string;
  }>;
  documents?: Array<{
    type?: string;
    fileName?: string;
    fileUrl?: string;
    uploadedAt?: string;
    verified?: boolean;
  }>;
  additionalInfo?: {
    pets?: string;
    vehicles?: string;
    reasonForMoving?: string;
    additionalNotes?: string;
  };
  applicationFee?: {
    amount?: number;
    status?: string;
    paymentMethod?: string;
    paidAt?: string;
  };
  propertyId?: {
    _id?: string;
    name?: string;
    type?: string;
    rentAmount?: number;
    securityDeposit?: number;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      country?: string;
    };
  };
  applicantId?: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
  reviewedBy?: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  createdAt?: string;
}

function getStatusBadgeClass(status?: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "approved") {
    return "bg-green-100 text-green-800 border-green-200";
  }
  if (normalized === "rejected" || normalized === "withdrawn") {
    return "bg-red-100 text-red-800 border-red-200";
  }
  if (normalized === "under_review") {
    return "bg-blue-100 text-blue-800 border-blue-200";
  }
  if (normalized === "draft") {
    return "bg-gray-100 text-gray-800 border-gray-200";
  }
  return "bg-yellow-100 text-yellow-800 border-yellow-200";
}

function formatStatusLabel(status?: string) {
  if (!status) return "—";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** "under_review" → the "underReview" status key. */
function statusKey(status?: string) {
  return (status || "").toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

type PropertyAddress = NonNullable<
  NonNullable<ApplicationDetails["propertyId"]>["address"]
>;

function formatAddress(address: PropertyAddress | undefined, language: string) {
  if (!address) return "";
  const parts = [
    address.street,
    address.city,
    address.state,
    address.zipCode,
    displayCountry(address.country, language),
  ].filter(Boolean);
  return parts.join(", ");
}

export default function ApplicationDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { t, formatCurrency, formatDate, language } = useLocalizationContext();
  const applicationId = params.id as string;

  const [application, setApplication] = useState<ApplicationDetails | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<
    "approve" | "reject" | null
  >(null);

  const isStaff = useMemo(() => {
    const role = String(session?.user?.role || "").toLowerCase();
    return role !== "tenant";
  }, [session?.user?.role]);

  const canProcess = useMemo(() => {
    const status = (application?.status || "").toLowerCase();
    return (
      isStaff &&
      (status === "submitted" || status === "under_review") &&
      !!application
    );
  }, [application, isStaff]);

  const fetchApplication = useCallback(async () => {
    if (!applicationId) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/applications/${applicationId}`);
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || t("tenants.applicationDetail.loadFailed", { defaultValue: "Could not load the application" }));
      }

      setApplication(payload.data?.application || null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("tenants.applicationDetail.loadFailed", { defaultValue: "Could not load the application" });
      toast.error(message);
      router.push("/dashboard/tenants/applications");
    } finally {
      setLoading(false);
    }
  }, [applicationId, router]);

  useEffect(() => {
    fetchApplication();
  }, [fetchApplication]);

  const handleStatusChange = useCallback(
    async (action: "approve" | "reject") => {
      if (!application) return;
      try {
        setActionLoading(action);
        const response = await fetch(
          `/api/applications/${application._id}/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              notes:
                action === "approve"
                  ? t("tenants.applicationDetail.approvedBy", { defaultValue: "Approved by {name}", values: { name: session?.user?.name || "" } })
                  : t("tenants.applicationDetail.rejectedBy", { defaultValue: "Rejected by {name}", values: { name: session?.user?.name || "" } }),
            }),
          },
        );
        const payload = await response.json();

        if (!response.ok || !payload.success) {
          throw new Error(
            payload.error ||
              t("tenants.applicationDetail.actionFailed", { defaultValue: "Could not update the application" }),
          );
        }

        toast.success(
          action === "approve"
            ? t("tenants.applicationDetail.approved", { defaultValue: "Application approved" })
            : t("tenants.applicationDetail.rejected", { defaultValue: "Application rejected" }),
        );
        fetchApplication();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("tenants.applicationDetail.actionFailed", { defaultValue: "Could not update the application" });
        toast.error(message);
      } finally {
        setActionLoading(null);
      }
    },
    [application, fetchApplication, session?.user?.name],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!application) {
    return (
      <div className="rounded-lg border bg-card p-12 text-center">
        <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="mb-2 text-lg font-semibold">
          {t("tenants.applicationDetail.notFound", { defaultValue: "Application not found" })}
        </h3>
        <p className="mb-4 text-muted-foreground">
          {t("tenants.applicationDetail.notFoundHint", { defaultValue: "It may have been withdrawn or removed." })}
        </p>
        <Button onClick={() => router.push("/dashboard/tenants/applications")}>
          {t("tenants.applicationDetail.backToList", { defaultValue: "Back to applications" })}
        </Button>
      </div>
    );
  }

  const applicantName =
    [
      application.personalInfo?.firstName || application.applicantId?.firstName,
      application.personalInfo?.lastName || application.applicantId?.lastName,
    ]
      .filter(Boolean)
      .join(" ") ||
    t("tenants.applicationDetail.unknownApplicant", { defaultValue: "Unknown applicant" });

  const applicantEmail =
    application.personalInfo?.email ||
    application.applicantId?.email ||
    t("tenants.applicationDetail.notAvailable", { defaultValue: "Not available" });

  const applicantPhone =
    application.personalInfo?.phone ||
    application.applicantId?.phone ||
    t("tenants.applicationDetail.notAvailable", { defaultValue: "Not available" });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("tenants.applicationDetail.title", { defaultValue: "Application" })}
            </h1>
            <Badge className={getStatusBadgeClass(application.status)}>
              {t(`tenants.applications.status.${statusKey(application.status)}`, {
                defaultValue: formatStatusLabel(application.status),
              })}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">ID: {application._id}</p>
        </div>
        <div className="flex items-center gap-2">
          {canProcess && (
            <>
              <Button
                size="sm"
                onClick={() => handleStatusChange("approve")}
                disabled={actionLoading !== null}
              >
                <Check className="me-2 h-4 w-4" />
                {actionLoading === "approve"
                  ? t("tenants.applicationDetail.approving", { defaultValue: "Approving…" })
                  : t("tenants.applicationDetail.approve", { defaultValue: "Approve" })}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleStatusChange("reject")}
                disabled={actionLoading !== null}
              >
                <X className="me-2 h-4 w-4" />
                {actionLoading === "reject"
                  ? t("tenants.applicationDetail.rejecting", { defaultValue: "Rejecting…" })
                  : t("tenants.applicationDetail.reject", { defaultValue: "Reject" })}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/dashboard/tenants/applications")}
          >
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            {t("errors.dashboard.back", { defaultValue: "Go back" })}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tenants.applicationDetail.submitted", { defaultValue: "Submitted" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>
                {application.submittedAt
                  ? formatDate(application.submittedAt)
                  : t("tenants.applicationDetail.notSubmitted", { defaultValue: "Not submitted" })}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tenants.applicationDetail.fee", { defaultValue: "Application fee" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-lg font-semibold">
              {formatCurrency(application.applicationFee?.amount || 0)}
            </p>
            <Badge variant="outline" className="capitalize">
              {t(`exports.value.${application.applicationFee?.status || "pending"}`, {
                defaultValue: application.applicationFee?.status || "pending",
              })}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tenants.applicationDetail.reviewed", { defaultValue: "Reviewed" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>
                {application.reviewedAt
                  ? formatDate(application.reviewedAt)
                  : t("tenants.applicationDetail.notReviewed", { defaultValue: "Not reviewed yet" })}
              </span>
            </div>
            <p className="text-muted-foreground">
              {application.reviewedBy
                ? `${application.reviewedBy.firstName || ""} ${application.reviewedBy.lastName || ""}`.trim()
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {t("tenants.applicationDetail.applicant", { defaultValue: "Applicant" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">{t("tenants.applicationDetail.name", { defaultValue: "Name" })}</p>
              <p className="font-medium">{applicantName}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("tenants.applicationDetail.email", { defaultValue: "Email" })}</p>
              <p className="font-medium flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                {applicantEmail}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("tenants.applicationDetail.phone", { defaultValue: "Phone" })}</p>
              <p className="font-medium flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {applicantPhone}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {t("tenants.applicationDetail.property", { defaultValue: "Property" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">{t("tenants.applicationDetail.name", { defaultValue: "Name" })}</p>
              <p className="font-medium">
                {application.propertyId?.name || t("tenants.applicationDetail.notAvailable", { defaultValue: "Not available" })}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">
                {t("tenants.applicationDetail.address", { defaultValue: "Address" })}
              </p>
              <p className="font-medium flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                <span>{formatAddress(application.propertyId?.address, language) || t("tenants.applicationDetail.notAvailable", { defaultValue: "Not available" })}</span>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-muted-foreground">
                  {t("tenants.applicationDetail.rent", { defaultValue: "Rent" })}
                </p>
                <p className="font-medium">
                  {formatCurrency(application.propertyId?.rentAmount || 0)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  {t("tenants.applicationDetail.deposit", { defaultValue: "Security deposit" })}
                </p>
                <p className="font-medium">
                  {formatCurrency(application.propertyId?.securityDeposit || 0)}
                </p>
              </div>
            </div>
            {application.propertyId?._id && (
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/dashboard/properties/${application.propertyId._id}`}
                >
                  {t("tenants.applicationDetail.viewProperty", { defaultValue: "View property" })}
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            {t("tenants.applicationDetail.employment", { defaultValue: "Employment" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 text-sm">
          <div>
            <p className="text-muted-foreground">
              {t("tenants.applicationDetail.employer", { defaultValue: "Employer" })}
            </p>
            <p className="font-medium">
              {application.employmentInfo?.employer || t("tenants.applicationDetail.notProvided", { defaultValue: "Not provided" })}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">
              {t("tenants.applicationDetail.position", { defaultValue: "Position" })}
            </p>
            <p className="font-medium">
              {application.employmentInfo?.position || t("tenants.applicationDetail.notProvided", { defaultValue: "Not provided" })}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">
              {t("tenants.applicationDetail.income", { defaultValue: "Income" })}
            </p>
            <p className="font-medium">
              {application.employmentInfo?.income
                ? formatCurrency(application.employmentInfo.income)
                : t("tenants.applicationDetail.notProvided", { defaultValue: "Not provided" })}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">
              {t("tenants.applicationDetail.startDate", { defaultValue: "Start date" })}
            </p>
            <p className="font-medium">
              {application.employmentInfo?.startDate
                ? formatDate(application.employmentInfo.startDate)
                : t("tenants.applicationDetail.notProvided", { defaultValue: "Not provided" })}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t("tenants.applicationDetail.emergencyContacts", { defaultValue: "Emergency contacts" })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!application.emergencyContacts?.length ? (
            <p className="text-sm text-muted-foreground">
              {t("tenants.applicationDetail.noContacts", { defaultValue: "No emergency contacts." })}
            </p>
          ) : (
            <div className="space-y-3">
              {application.emergencyContacts.map((contact, index) => (
                <div key={`${contact.name || "contact"}-${index}`}>
                  <div className="grid gap-2 md:grid-cols-2 text-sm">
                    <p>
                      <span className="text-muted-foreground">{t("tenants.applicationDetail.name", { defaultValue: "Name" })}: </span>
                      <span className="font-medium">
                        {contact.name || t("tenants.applicationDetail.notProvided", { defaultValue: "Not provided" })}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        {t("tenants.applicationDetail.relationship", { defaultValue: "Relationship" })}:{" "}
                      </span>
                      <span className="font-medium">
                        {contact.relationship || t("tenants.applicationDetail.notProvided", { defaultValue: "Not provided" })}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">{t("tenants.applicationDetail.phone", { defaultValue: "Phone" })}: </span>
                      <span className="font-medium">
                        {contact.phone || t("tenants.applicationDetail.notProvided", { defaultValue: "Not provided" })}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">{t("tenants.applicationDetail.email", { defaultValue: "Email" })}: </span>
                      <span className="font-medium">
                        {contact.email || t("tenants.applicationDetail.notProvided", { defaultValue: "Not provided" })}
                      </span>
                    </p>
                  </div>
                  {index < (application.emergencyContacts?.length || 0) - 1 && (
                    <Separator className="mt-3" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t("tenants.applicationDetail.documents", { defaultValue: "Documents" })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!application.documents?.length ? (
            <p className="text-sm text-muted-foreground">
              {t("tenants.applicationDetail.noDocuments", { defaultValue: "No documents uploaded." })}
            </p>
          ) : (
            <div className="space-y-2">
              {application.documents.map((doc, index) => (
                <div
                  key={`${doc.fileName || "document"}-${index}`}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-md border p-3"
                >
                  <div className="text-sm">
                    <p className="font-medium">
                      {doc.fileName || t("tenants.applicationDetail.unnamed", { defaultValue: "Unnamed file" })}
                    </p>
                    <p className="text-muted-foreground capitalize">
                      {t(`tenants.applicationDetail.docType.${doc.type || "other"}`, {
                        defaultValue: (doc.type || "other").replace(/_/g, " "),
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={doc.verified ? "default" : "outline"}>
                      {doc.verified
                        ? t("tenants.applicationDetail.verified", { defaultValue: "Verified" })
                        : t("tenants.applicationDetail.pending", { defaultValue: "Pending" })}
                    </Badge>
                    {doc.fileUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                          {t("tenants.applicationDetail.open", { defaultValue: "Open" })}
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(application.additionalInfo?.pets ||
        application.additionalInfo?.vehicles ||
        application.additionalInfo?.reasonForMoving ||
        application.additionalInfo?.additionalNotes ||
        application.reviewNotes) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("tenants.applicationDetail.notes", { defaultValue: "Notes" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {application.additionalInfo?.pets && (
              <p>
                <span className="text-muted-foreground">
                  {t("tenants.applicationDetail.pets", { defaultValue: "Pets" })}:{" "}
                </span>
                <span className="font-medium">
                  {application.additionalInfo.pets}
                </span>
              </p>
            )}
            {application.additionalInfo?.vehicles && (
              <p>
                <span className="text-muted-foreground">
                  {t("tenants.applicationDetail.vehicles", { defaultValue: "Vehicles" })}:{" "}
                </span>
                <span className="font-medium">
                  {application.additionalInfo.vehicles}
                </span>
              </p>
            )}
            {application.additionalInfo?.reasonForMoving && (
              <p>
                <span className="text-muted-foreground">
                  {t("tenants.applicationDetail.reason", { defaultValue: "Reason for moving" })}:{" "}
                </span>
                <span className="font-medium">
                  {application.additionalInfo.reasonForMoving}
                </span>
              </p>
            )}
            {application.additionalInfo?.additionalNotes && (
              <p>
                <span className="text-muted-foreground">
                  {t("tenants.applicationDetail.applicantNotes", { defaultValue: "Applicant's notes" })}:{" "}
                </span>
                <span className="font-medium">
                  {application.additionalInfo.additionalNotes}
                </span>
              </p>
            )}
            {application.reviewNotes && (
              <p>
                <span className="text-muted-foreground">
                  {t("tenants.applicationDetail.reviewNotes", { defaultValue: "Review notes" })}:{" "}
                </span>
                <span className="font-medium">{application.reviewNotes}</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
