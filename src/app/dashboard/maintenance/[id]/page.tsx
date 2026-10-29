"use client";

import Link from "next/link";
import { toast } from "sonner";
import Image from "@/components/ui/app-image";
import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useParams, useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Edit,
  MoreHorizontal,
  Clock,
  DollarSign,
  User,
  Building2,
  Phone,
  Mail,
  AlertTriangle,
  CheckCircle,
  Play,
  X,
  Image as ImageIcon,
  MapPin,
  UserPlus,
  Loader2,
} from "lucide-react";
import {
  MaintenancePriority,
  MaintenanceStatus,
  IMaintenanceRequest,
} from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { maintenanceStatusText } from "@/lib/maintenance-labels";
import { MaintenanceDetailSkeleton } from "@/components/maintenance/maintenance-skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";

interface MaintenanceRequestDetailProps {
  request: IMaintenanceRequest & {
    property: {
      name: string;
      address: {
        street: string;
        city: string;
        state: string;
        zipCode: string;
      };
    };
    unit?: {
      _id: string;
      unitNumber: string;
      unitType: string;
      status: string;
    };
    tenant: {
      user: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        avatar?: string;
      };
    };
    assignedTo?: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      avatar?: string;
    };
  };
}

interface Technician {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export default function MaintenanceRequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { isTenant, isCompanyStaff } = useAuthorization();
  const {
    t,
    formatCurrency,
    formatDate: formatDateLocalized,
  } = useLocalizationContext();
  const [request, setRequest] = useState<
    MaintenanceRequestDetailProps["request"] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Dialog states
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  // const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);

  // Data states
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedTechnician, setSelectedTechnician] = useState("");
  const [actualCost, setActualCost] = useState("");
  const backHref = isTenant
    ? "/dashboard/maintenance/my-requests"
    : "/dashboard/maintenance";

  useEffect(() => {
    if (params.id && session) {
      fetchMaintenanceRequest();
      if (isCompanyStaff) {
        fetchTechnicians();
      } else {
        setTechnicians([]);
      }
    }
  }, [params.id, session, isCompanyStaff]);

  const fetchMaintenanceRequest = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/maintenance/${params.id}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || t("maintenance.details.toasts.fetchError")
        );
      }

      const data = await response.json();
      const requestData = data?.data;

      if (!requestData) {
        throw new Error(t("maintenance.details.toasts.fetchError"));
      }

      setRequest(requestData);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("maintenance.details.toasts.fetchError")
      );
      router.push(backHref);
    } finally {
      setLoading(false);
    }
  };

  const fetchTechnicians = async () => {
    if (!session?.user || !isCompanyStaff) {
      setTechnicians([]);
      return;
    }

    try {
      // Fetch all active non-tenant users to ensure we capture all potential assignees
      // regardless of their specific role label (Manager, Property Manager, Technician, etc.)
      const response = await fetch(
        "/api/users?excludeTenant=true&companyStaffOnly=true&isActive=true&limit=100"
      );
      if (response.ok) {
        const data = await response.json();
        const usersArray = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.data?.users)
          ? data.data.users
          : Array.isArray(data?.users)
          ? data.users
          : [];

        const techniciansList = usersArray
          .filter((u: any) => {
            if (!u || (!u._id && !u.id)) return false;
            if (u.isActive === false) return false;
            return true;
          })
          .map((u: any) => ({
            _id: u._id || u.id,
            firstName: u.firstName || "",
            lastName: u.lastName || "",
            email: u.email || "",
            phone: u.phone || "",
            role: u.role, // Keep role for potential UI indication
          }));
        setTechnicians(techniciansList);
      } else {
        toast.error(t("maintenance.details.toasts.loadTechniciansError"), {
          description: `Request failed with status ${response.status}`,
        });
        setTechnicians([]);
      }
    } catch (error) {
      toast.error(t("maintenance.details.toasts.loadTechniciansError"), {
        description:
          error instanceof Error ? error.message : t("errors.ui.tryAgainSentence", { defaultValue: "Try again." }),
      });
      setTechnicians([]);
    }
  };

  const getPriorityColor = (priority: MaintenancePriority) => {
    switch (priority) {
      case MaintenancePriority.EMERGENCY:
        return "destructive";
      case MaintenancePriority.HIGH:
        return "destructive";
      case MaintenancePriority.MEDIUM:
        return "default";
      case MaintenancePriority.LOW:
        return "secondary";
      default:
        return "outline";
    }
  };

  const getStatusColor = (status: MaintenanceStatus) => {
    switch (status) {
      case MaintenanceStatus.SUBMITTED:
        return "default";
      case MaintenanceStatus.ASSIGNED:
        return "secondary";
      case MaintenanceStatus.IN_PROGRESS:
        return "default";
      case MaintenanceStatus.COMPLETED:
        return "secondary";
      case MaintenanceStatus.CANCELLED:
        return "outline";
      default:
        return "outline";
    }
  };

  const getStatusIcon = (status: MaintenanceStatus | undefined) => {
    if (!status) return Clock;

    switch (status) {
      case MaintenanceStatus.SUBMITTED:
        return Clock;
      case MaintenanceStatus.ASSIGNED:
        return User;
      case MaintenanceStatus.IN_PROGRESS:
        return Play;
      case MaintenanceStatus.COMPLETED:
        return CheckCircle;
      case MaintenanceStatus.CANCELLED:
        return X;
      default:
        return Clock;
    }
  };

  const formatCurrencyDisplay = (amount: number | undefined) => {
    if (!amount) return t("maintenance.details.labels.na");
    return formatCurrency(amount);
  };

  const formatDateDisplay = (date: string | Date | undefined) => {
    if (!date) return t("maintenance.details.labels.na");

    try {
      const dateObj = typeof date === "string" ? new Date(date) : date;
      if (isNaN(dateObj.getTime())) return t("maintenance.details.labels.na");

      return formatDateLocalized(dateObj, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return t("maintenance.details.labels.na");
    }
  };

  // Action handlers
  const handleAssignTechnician = async () => {
    if (!selectedTechnician) {
      toast.error(t("maintenance.details.toasts.selectTechnician"));
      return;
    }

    if (!params.id) {
      toast.error(t("maintenance.details.toasts.invalidId"));
      return;
    }

    try {
      setActionLoading(true);

      const requestBody = {
        action: "assign",
        assignedTo: selectedTechnician,
      };

      const response = await fetch(`/api/maintenance/${params.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ message: "Unknown error" }));
        throw new Error(
          errorData.message ||
            `HTTP ${response.status}: ${t(
              "maintenance.details.toasts.assignError"
            )}`
        );
      }

      await response.json();
      toast.success(t("maintenance.details.toasts.assignSuccess"));
      setAssignDialogOpen(false);
      setSelectedTechnician("");

      // Refresh the maintenance request data
      await fetchMaintenanceRequest();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("maintenance.details.toasts.assignError")
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartWork = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/maintenance/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "startWork" }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || t("maintenance.details.toasts.startError")
        );
      }

      toast.success(t("maintenance.details.toasts.startSuccess"));
      await fetchMaintenanceRequest();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("maintenance.details.toasts.startError")
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompleteWork = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/maintenance/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          actualCost: actualCost ? parseFloat(actualCost) : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || t("maintenance.details.toasts.completeError")
        );
      }

      toast.success(t("maintenance.details.toasts.completeSuccess"));
      setCompleteDialogOpen(false);
      setActualCost("");
      await fetchMaintenanceRequest();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("maintenance.details.toasts.completeError")
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelRequest = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/maintenance/${params.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || t("maintenance.details.toasts.cancelError")
        );
      }

      toast.success(t("maintenance.details.toasts.cancelSuccess"));
      await fetchMaintenanceRequest();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("maintenance.details.toasts.cancelError")
      );
    } finally {
      setActionLoading(false);
    }
  };

  // DISABLED: Delete functionality temporarily disabled
  // const handleDeleteRequest = async () => {
  //   if (!params.id) {
  //     toast.error("Invalid maintenance request ID");
  //     return;
  //   }

  //   try {
  //     setActionLoading(true);

  //     const response = await fetch(`/api/maintenance/${params.id}`, {
  //       method: "DELETE",
  //       headers: {
  //         "Content-Type": "application/json",
  //       },
  //     });

  //     if (!response.ok) {
  //       const errorData = await response
  //         .json()
  //         .catch(() => ({ message: "Unknown error" }));
  //       throw new Error(
  //         errorData.message ||
  //           `HTTP ${response.status}: Failed to delete request`
  //       );
  //     }

  //     const result = await response.json();
  //     toast.success("Maintenance request deleted successfully");

  //     // Navigate back to maintenance list based on user role
  //     const redirectPath =
  //       session?.user?.role === UserRole.TENANT
  //         ? "/dashboard/maintenance/my-requests"
  //         : "/dashboard/maintenance";
  //     router.push(redirectPath);
  //   } catch (error) {
  //     toast.error(
  //       error instanceof Error ? error.message : "Failed to delete request"
  //     );
  //   } finally {
  //     setActionLoading(false);
  //     setDeleteDialogOpen(false);
  //   }
  // };

  // Show loading skeleton while data is being fetched
  if (loading) {
    return <MaintenanceDetailSkeleton />;
  }

  // Show not found message if request doesn't exist after loading
  if (!request) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">
          {t("maintenance.details.header.notFound")}
        </h2>
        <p className="text-muted-foreground text-center">
          {t("maintenance.details.header.notFoundDescription")}
        </p>
        <Link
          href={backHref}
        >
          <Button size="sm" variant="outline">
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            {t("maintenance.details.header.backToMaintenance")}
          </Button>
        </Link>
      </div>
    );
  }

  const StatusIcon = getStatusIcon(request?.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {request?.title || t("maintenance.details.labels.na")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("maintenance.details.header.requestNumber")}
              {request?._id?.toString().slice(-8).toUpperCase() ||
                t("maintenance.details.labels.na")}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {/* Hide edit button when cancelled; otherwise preserve existing role rules */}
          {request?.status !== MaintenanceStatus.CANCELLED &&
            (isCompanyStaff ||
              (isTenant && request?.status !== MaintenanceStatus.COMPLETED)) && (
              <Link href={`/dashboard/maintenance/${request?._id || ""}/edit`}>
                <Button variant="outline" size="sm">
                  <Edit className="h-4 w-4 me-1" />
                  {t("maintenance.details.header.edit")}
                </Button>
              </Link>
            )}
          {request?.status !== MaintenanceStatus.CANCELLED && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button  variant="outline" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {t("maintenance.details.header.actions")}
                </DropdownMenuLabel>
                {isCompanyStaff && (
                    <>
                      {(!request?.assignedTo ||
                        request.status === MaintenanceStatus.SUBMITTED) && (
                        <DropdownMenuItem
                          onClick={() => setAssignDialogOpen(true)}
                        >
                          <UserPlus className="me-2 h-4 w-4" />
                          {t("maintenance.actions.assignTechnician")}
                        </DropdownMenuItem>
                      )}
                      {request?.status === MaintenanceStatus.ASSIGNED && (
                        <>
                          <DropdownMenuItem
                            onClick={handleStartWork}
                            disabled={actionLoading}
                          >
                            <Play className="me-2 h-4 w-4" />
                            {t("maintenance.actions.startWork")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setAssignDialogOpen(true)}
                          >
                            <UserPlus className="me-2 h-4 w-4" />
                            {t("maintenance.actions.reassign")}
                          </DropdownMenuItem>
                        </>
                      )}
                      {request?.status === MaintenanceStatus.IN_PROGRESS && (
                        <DropdownMenuItem
                          onClick={() => setCompleteDialogOpen(true)}
                        >
                          <CheckCircle className="me-2 h-4 w-4" />
                          {t("maintenance.actions.markComplete")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      {request?.status !== MaintenanceStatus.COMPLETED && (
                        <DropdownMenuItem
                          onClick={handleCancelRequest}
                          disabled={actionLoading}
                          className="text-orange-600"
                        >
                          <X className="me-2 h-4 w-4" />
                          {t("maintenance.actions.cancelRequest")}
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                {/* <DropdownMenuItem
                  className="text-red-600"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={request?.status === MaintenanceStatus.COMPLETED}
                >
                  <Trash2 className="me-2 h-4 w-4" />
                  Delete Request
                </DropdownMenuItem> */}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Link
            href={backHref}
          >
            <Button variant="outline" size="sm" >
              <ArrowLeft className="h-4 w-4 me-1 rtl:-scale-x-100" />
              {t("maintenance.details.header.back")}
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        {/* Main Content */}
        <div className="md:col-span-1 lg:col-span-3 space-y-6">
          {/* Request Details */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  {t("maintenance.details.card.requestDetails")}
                </CardTitle>
                <div className="flex items-center space-x-2">
                  <Badge
                    variant={getPriorityColor(request?.priority) as any}
                    className="capitalize"
                  >
                    {request?.priority === MaintenancePriority.EMERGENCY && (
                      <AlertTriangle className="h-3 w-3 me-1" />
                    )}
                    {request?.priority || t("maintenance.details.labels.na")}
                  </Badge>
                  <Badge
                    variant={getStatusColor(request?.status) as any}
                    className="flex items-center gap-1"
                  >
                    <StatusIcon className="h-3 w-3" />
                    {(request?.status &&
                      maintenanceStatusText(request.status, (key, english) =>
                        t(key, { defaultValue: english }),
                      )) ||
                      t("maintenance.details.labels.na")}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">
                  {t("maintenance.details.card.description")}
                </h4>
                <p className="text-muted-foreground">
                  {request?.description || t("maintenance.details.labels.na")}
                </p>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-1">
                    {t("maintenance.details.card.category")}
                  </h4>
                  <p className="text-muted-foreground">
                    {request?.category || t("maintenance.details.labels.na")}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">
                    {t("maintenance.details.card.created")}
                  </h4>
                  <p className="text-muted-foreground">
                    {formatDateDisplay(request?.createdAt)}
                  </p>
                </div>
              </div>
              {request?.scheduledDate && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-1">
                      {t("maintenance.details.card.scheduledDate")}
                    </h4>
                    <p className="text-muted-foreground">
                      {formatDateDisplay(request.scheduledDate)}
                    </p>
                  </div>
                </>
              )}
              {request.completedDate && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-1">
                      {t("maintenance.details.card.completedDate")}
                    </h4>
                    <p className="text-muted-foreground">
                      {formatDateDisplay(request.completedDate)}
                    </p>
                  </div>
                </>
              )}
              {request.notes && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-2">
                      {t("maintenance.details.card.notes")}
                    </h4>
                    <p className="text-muted-foreground">{request.notes}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Images */}
          {request.images && request.images.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5" />
                  {t("maintenance.details.card.photos")} (
                  {request?.images.length})
                </CardTitle>
                <CardDescription>
                  {t("maintenance.details.card.photosDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {request?.images.map((image, index) => (
                    <div
                      key={index}
                      className="aspect-square bg-gray-100 rounded-lg overflow-hidden"
                    >
                      <Image
                        src={image}
                        alt={`Maintenance request image ${index + 1}`}
                        className="w-full h-full object-cover hover:scale-105 transition-transform cursor-pointer"
                        onClick={() => window.open(image, "_blank")}
                        width={200}
                        height={200}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="md:col-span-1 lg:col-span-2 space-y-6">
          {/* Property Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {t("maintenance.details.card.property")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium">
                  {request?.property?.name ||
                    t("maintenance.details.labels.na")}
                </h4>
                {request?.unit && (
                  <div className="mt-2">
                    <Badge
                      variant="outline"
                      className="text-blue-600 border-blue-200"
                    >
                      {t("maintenance.details.labels.unit")}{" "}
                      {request.unit.unitNumber} - {request.unit.unitType}
                    </Badge>
                  </div>
                )}
                <div className="flex items-start gap-2 mt-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p>
                      {request?.property?.address?.street ||
                        t("maintenance.details.labels.na")}
                    </p>
                    <p>
                      {request?.property?.address?.city ||
                        t("maintenance.details.labels.na")}
                      ,{" "}
                      {request?.property?.address?.state ||
                        t("maintenance.details.labels.na")}{" "}
                      {request?.property?.address?.zipCode ||
                        t("maintenance.details.labels.na")}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tenant Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {t("maintenance.details.card.tenant")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-3">
                <Avatar>
                  <AvatarImage src={request?.tenant?.user?.avatar} />
                  <AvatarFallback>
                    {request?.tenant?.user?.firstName?.[0] || "N"}
                    {request?.tenant?.user?.lastName?.[0] || "A"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h4 className="font-medium">
                    {request?.tenant?.user?.firstName ||
                      t("maintenance.details.labels.na")}{" "}
                    {request?.tenant?.user?.lastName || ""}
                  </h4>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Mail className="h-3 w-3" />
                      <span>
                        {request?.tenant?.user?.email ||
                          t("maintenance.details.labels.na")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-3 w-3" />
                      <span>
                        {request?.tenant?.user?.phone ||
                          t("maintenance.details.labels.na")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Assigned Technician */}
          {request?.assignedTo ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  {t("maintenance.details.card.assignedTo")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-3">
                  <Avatar>
                    <AvatarImage src={request?.assignedTo?.avatar} />
                    <AvatarFallback>
                      {request?.assignedTo?.firstName?.[0] || "N"}
                      {request?.assignedTo?.lastName?.[0] || "A"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h4 className="font-medium">
                      {request?.assignedTo?.firstName ||
                        t("maintenance.details.labels.na")}{" "}
                      {request?.assignedTo?.lastName || ""}
                    </h4>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3 w-3" />
                        <span>
                          {request?.assignedTo?.email ||
                            t("maintenance.details.labels.na")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Phone className="h-3 w-3" />
                        <span>
                          {request?.assignedTo?.phone ||
                            t("maintenance.details.labels.na")}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  {t("maintenance.details.card.assignment")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-4">
                  <UserPlus className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-3">
                    {t("maintenance.details.card.noTechnicianAssigned")}
                  </p>
                  {isCompanyStaff && (
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => setAssignDialogOpen(true)}
                      >
                        {t("maintenance.details.card.assignTechnician")}
                      </Button>
                    )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cost Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                {t("maintenance.details.card.costInformation")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {request?.estimatedCost && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    {t("maintenance.details.card.estimatedCost")}
                  </span>
                  <span className="font-medium">
                    {formatCurrencyDisplay(request.estimatedCost)}
                  </span>
                </div>
              )}
              {request?.actualCost && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    {t("maintenance.details.card.actualCost")}
                  </span>
                  <span className="font-medium">
                    {formatCurrencyDisplay(request.actualCost)}
                  </span>
                </div>
              )}
              {!request?.estimatedCost && !request?.actualCost && (
                <div className="text-center py-4">
                  <DollarSign className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {t("maintenance.details.card.noCostInformation")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Assign Technician Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("maintenance.details.dialogs.assignTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("maintenance.details.dialogs.assignDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="technician">
                {t("maintenance.details.dialogs.technicianLabel")}
              </Label>
              <Select
                value={selectedTechnician}
                onValueChange={setSelectedTechnician}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      "maintenance.details.dialogs.selectTechnicianPlaceholder"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {Array.isArray(technicians) && technicians.length > 0 ? (
                    technicians.map((tech) => (
                      <SelectItem key={tech._id} value={tech._id}>
                        {tech.firstName} {tech.lastName} - {tech.email}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="p-2 text-sm text-muted-foreground">
                      {t("maintenance.details.dialogs.noTechniciansAvailable")}
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAssignDialogOpen(false);
                setSelectedTechnician("");
              }}
            >
              {t("maintenance.details.dialogs.cancel")}
            </Button>
            <Button
              onClick={handleAssignTechnician}
              disabled={
                actionLoading || !selectedTechnician || technicians.length === 0
              }
            >
              {actionLoading && (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              )}
              {t("maintenance.details.dialogs.assign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Work Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("maintenance.details.dialogs.completeTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("maintenance.details.dialogs.completeDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="actualCost">
                {t("maintenance.details.dialogs.actualCostLabel")}
              </Label>
              <Input
                id="actualCost"
                type="number"
                placeholder={t(
                  "maintenance.details.dialogs.actualCostPlaceholder"
                )}
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCompleteDialogOpen(false);
                setActualCost("");
              }}
            >
              {t("maintenance.details.dialogs.cancel")}
            </Button>
            <Button onClick={handleCompleteWork} disabled={actionLoading}>
              {actionLoading && (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              )}
              {t("maintenance.details.dialogs.complete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      {/* <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Maintenance Request</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this maintenance request? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteRequest}
              disabled={actionLoading}
            >
              {actionLoading && (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog> */}
    </div>
  );
}
