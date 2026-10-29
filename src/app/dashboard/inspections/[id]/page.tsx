"use client";

import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Edit,
  MoreHorizontal,
  Clock,
  User,
  Building2,
  Calendar,
  CheckCircle,
  Play,
  Ban,
  AlertCircle,
  Plus,
  Trash2,
  ClipboardCheck,
  FileText,
} from "lucide-react";
import { InspectionType } from "@/types";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { usePropertyTypeLabel } from "@/hooks/use-property-categories";

interface InspectionDetail {
  _id: string;
  type: string;
  status: string;
  scheduledDate: string;
  completedDate?: string;
  overallCondition?: string;
  notes?: string;
  items: Array<{
    _id?: string;
    room: string;
    item: string;
    condition: string;
    notes?: string;
    photos?: string[];
    requiresAttention: boolean;
  }>;
  photos: string[];
  tenantSignature?: {
    signedAt: string;
    signature: string;
  };
  inspectorSignature?: {
    signedAt: string;
    signature: string;
  };
  createdAt: string;
  updatedAt: string;
  property: {
    _id: string;
    name: string;
    address: {
      street: string;
      city: string;
      state: string;
      zipCode?: string;
    };
    type: string;
  };
  tenant?: {
    user: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      avatar?: string;
    };
  };
  inspector: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    avatar?: string;
  };
  lease?: {
    _id: string;
    startDate: string;
    endDate: string;
    status: string;
  };
}

export default function InspectionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const inspectionId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { data: session } = useSession();
  const { isCompanyStaff } = useAuthorization();
  const {
    t,
    formatDate: formatLocalizedDate,
    formatTime: formatLocalizedTime,
  } = useLocalizationContext();
  const propertyTypeLabel = usePropertyTypeLabel();
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showAddItemDialog, setShowAddItemDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Complete form
  const [completeCondition, setCompleteCondition] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");

  // Cancel form
  const [cancelReason, setCancelReason] = useState("");

  // Add item form
  const [newItemRoom, setNewItemRoom] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemCondition, setNewItemCondition] = useState("");
  const [newItemNotes, setNewItemNotes] = useState("");

  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (session && inspectionId) {
      fetchInspection();
    }
  }, [session, inspectionId]);

  const fetchInspection = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/inspections/${inspectionId}`);
      if (!response.ok) {
        throw new Error(t("inspections.details.toasts.failedToFetchInspection"));
      }

      const data = await response.json();
      setInspection(data?.data ?? null);
    } catch (error: any) {
      const errorMessage =
        error?.message || t("inspections.details.toasts.failedToLoadInspection");
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (
    action: string,
    data: Record<string, unknown> = {},
  ) => {
    try {
      setActionLoading(true);

      const response = await fetch(`/api/inspections/${inspectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...data }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error || t("inspections.details.toasts.actionFailed"),
        );
      }

      toast.success(t("inspections.details.toasts.actionSuccess"));
      fetchInspection();
    } catch (error: any) {
      toast.error(error?.message || t("inspections.details.toasts.actionFailed"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleStart = () => handleAction("start");

  const handleComplete = () => {
    if (!completeCondition) {
      toast.error(t("inspections.details.toasts.selectOverallCondition"));
      return;
    }
    handleAction("complete", {
      overallCondition: completeCondition,
      notes: completeNotes || undefined,
    });
    setShowCompleteDialog(false);
    setCompleteCondition("");
    setCompleteNotes("");
  };

  const handleCancel = () => {
    handleAction("cancel", { reason: cancelReason || undefined });
    setShowCancelDialog(false);
    setCancelReason("");
  };

  const handleAddItem = () => {
    if (!newItemRoom || !newItemName || !newItemCondition) {
      toast.error(t("inspections.details.toasts.fillRoomItemCondition"));
      return;
    }
    handleAction("addItem", {
      room: newItemRoom,
      item: newItemName,
      condition: newItemCondition,
      notes: newItemNotes || undefined,
    });
    setShowAddItemDialog(false);
    setNewItemRoom("");
    setNewItemName("");
    setNewItemCondition("");
    setNewItemNotes("");
  };

  const handleDelete = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/inspections/${inspectionId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t("inspections.details.toasts.deleteFailed"));
      }

      toast.success(t("inspections.details.toasts.deleteSuccess"));
      router.push("/dashboard/inspections");
    } catch (error: any) {
      toast.error(error?.message || t("inspections.details.toasts.deleteFailed"));
    } finally {
      setActionLoading(false);
      setShowDeleteDialog(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled":
        return "default";
      case "in_progress":
        return "secondary";
      case "completed":
        return "secondary";
      case "cancelled":
        return "outline";
      default:
        return "outline";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "scheduled":
        return Clock;
      case "in_progress":
        return Play;
      case "completed":
        return CheckCircle;
      case "cancelled":
        return Ban;
      default:
        return Clock;
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case "excellent":
        return "secondary";
      case "good":
        return "default";
      case "fair":
        return "secondary";
      case "poor":
        return "destructive";
      case "damaged":
        return "destructive";
      default:
        return "outline";
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case InspectionType.MOVE_IN:
        return t("inspections.types.moveIn");
      case InspectionType.MOVE_OUT:
        return t("inspections.types.moveOut");
      case InspectionType.ROUTINE:
        return t("inspections.types.routine");
      case InspectionType.MAINTENANCE:
        return t("inspections.types.maintenance");
      default:
        return type;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "scheduled":
        return t("inspections.status.scheduled");
      case "in_progress":
        return t("inspections.status.inProgress");
      case "completed":
        return t("inspections.status.completed");
      case "cancelled":
        return t("inspections.status.cancelled");
      default:
        return status || t("inspections.labels.naLower");
    }
  };

  const getConditionLabel = (condition: string) => {
    switch (condition) {
      case "excellent":
        return t("inspections.conditions.excellent");
      case "good":
        return t("inspections.conditions.good");
      case "fair":
        return t("inspections.conditions.fair");
      case "poor":
        return t("inspections.conditions.poor");
      case "damaged":
        return t("inspections.conditions.damaged");
      default:
        return condition || t("inspections.labels.na");
    }
  };

  const getLeaseStatusLabel = (status: string | undefined) => {
    if (!status) return t("inspections.labels.na");

    const normalized = status.toLowerCase();
    const fallback = status
      .split("_")
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ");

    return t(`leases.status.${normalized}`, { defaultValue: fallback });
  };

  const formatDateTime = (date: string | undefined) => {
    if (!date) return t("inspections.labels.na");
    try {
      return t("inspections.details.labels.dateTimeWithAt", {
        values: {
          date: formatLocalizedDate(date, { format: "long" }),
          time: formatLocalizedTime(date),
        },
      });
    } catch {
      return t("inspections.labels.na");
    }
  };

  const formatDateOnly = (date: string | undefined) => {
    if (!date) return t("inspections.labels.na");
    try {
      return formatLocalizedDate(date, { format: "medium" });
    } catch {
      return t("inspections.labels.na");
    }
  };

  const isAdmin = isCompanyStaff;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("inspections.details.actions.back")}
          </Button>
        </div>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-muted-foreground">
            {t("inspections.details.loading")}
          </div>
        </div>
      </div>
    );
  }

  if (error || !inspection) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("inspections.details.actions.back")}
          </Button>
        </div>
        <div className="flex flex-col items-center justify-center min-h-100 space-y-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">
            {t("inspections.details.notFoundTitle")}
          </h2>
          <p className="text-muted-foreground">{error}</p>
          <Button onClick={fetchInspection}>
            {t("inspections.actions.tryAgain")}
          </Button>
        </div>
      </div>
    );
  }

  const StatusIcon = getStatusIcon(inspection.status);
  const inspectionItems = inspection?.items ?? [];
  const attentionItems = inspectionItems.filter((i) => i?.requiresAttention);

  // Group items by room
  const itemsByRoom = inspectionItems.reduce(
    (acc, item) => {
      if (!acc[item.room]) acc[item.room] = [];
      acc[item.room].push(item);
      return acc;
    },
    {} as Record<string, typeof inspection.items>,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("inspections.labels.typeInspection", {
                  values: { type: getTypeLabel(inspection.type) },
                })}
              </h1>
              <Badge
                variant={getStatusColor(inspection.status) as any}
                className="flex items-center gap-1 capitalize"
              >
                <StatusIcon className="h-3 w-3" />
                {getStatusLabel(inspection.status)}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              {inspection.property?.name} &mdash;{" "}
              {formatDateTime(inspection.scheduledDate)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <div className="flex items-center gap-2">
              {/* Status action buttons */}
              {inspection.status === "scheduled" && (
                <Button
                  size="sm"
                  onClick={handleStart}
                  disabled={actionLoading}
                >
                  <Play className="h-4 w-4 me-1" />
                  {t("inspections.details.actions.startInspection")}
                </Button>
              )}
              {inspection.status === "in_progress" && (
                <Button
                  size="sm"
                  onClick={() => setShowCompleteDialog(true)}
                  disabled={actionLoading}
                >
                  <CheckCircle className="h-4 w-4 me-1" />
                  {t("inspections.details.actions.complete")}
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>
                    {t("inspections.table.headers.actions")}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {inspection.status !== "completed" &&
                    inspection.status !== "cancelled" && (
                      <DropdownMenuItem
                        onClick={() =>
                          router.push(
                            `/dashboard/inspections/${inspection._id}/edit`,
                          )
                        }
                      >
                        <Edit className="h-4 w-4 me-2" />
                        {t("inspections.details.actions.editInspection")}
                      </DropdownMenuItem>
                    )}
                  {(inspection.status === "in_progress" ||
                    inspection.status === "completed") && (
                    <DropdownMenuItem
                      onClick={() => setShowAddItemDialog(true)}
                    >
                      <Plus className="h-4 w-4 me-2" />
                      {t("inspections.details.actions.addItem")}
                    </DropdownMenuItem>
                  )}
                  {inspection.status !== "completed" &&
                    inspection.status !== "cancelled" && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setShowCancelDialog(true)}
                          className="text-orange-600"
                        >
                          <Ban className="h-4 w-4 me-2" />
                          {t("inspections.details.actions.cancelInspection")}
                        </DropdownMenuItem>
                      </>
                    )}
                  {inspection.status !== "completed" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setShowDeleteDialog(true)}
                        className="text-red-600"
                      >
                        <Trash2 className="h-4 w-4 me-2" />
                        {t("inspections.details.actions.deleteInspection")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("inspections.details.actions.back")}
          </Button>
        </div>
      </div>

      {/* Attention Alert */}
      {attentionItems.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-400">
                {t("inspections.details.alert.itemsRequireAttention", {
                  values: { count: attentionItems.length },
                })}
              </p>
              <p className="text-sm text-red-600 dark:text-red-500">
                {t("inspections.details.alert.followUpRequired")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Inspection Items by Room */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t("inspections.details.sections.items")}</CardTitle>
                  <CardDescription>
                    {t("inspections.details.sections.itemsDescription", {
                      values: {
                        items: inspection.items.length,
                        rooms: Object.keys(itemsByRoom).length,
                      },
                    })}
                  </CardDescription>
                </div>
                {isAdmin && inspection.status !== "cancelled" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddItemDialog(true)}
                  >
                    <Plus className="h-4 w-4 me-1" />
                    {t("inspections.details.actions.addItem")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {Object.keys(itemsByRoom).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ClipboardCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>{t("inspections.details.empty.noItems")}</p>
                  {isAdmin && inspection.status === "in_progress" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => setShowAddItemDialog(true)}
                    >
                      <Plus className="h-4 w-4 me-1" />
                      {t("inspections.details.actions.addFirstItem")}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.entries(itemsByRoom).map(([room, items]) => (
                    <div key={room}>
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">
                        {room}
                      </h3>
                      <div className="space-y-3">
                        {items.map((item, index) => (
                          <div
                            key={index}
                            className={`flex items-start justify-between p-3 rounded-lg border ${
                              item.requiresAttention
                                ? "border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800"
                                : "border-gray-200 dark:border-gray-700"
                            }`}
                          >
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">
                                  {item.item}
                                </span>
                                {item.requiresAttention && (
                                  <AlertCircle className="h-3 w-3 text-red-600" />
                                )}
                              </div>
                              {item.notes && (
                                <p className="text-xs text-muted-foreground">
                                  {item.notes}
                                </p>
                              )}
                            </div>
                            <Badge
                              variant={getConditionColor(item.condition) as any}
                              className="capitalize text-xs ms-2"
                            >
                              {getConditionLabel(item.condition)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          {inspection.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {t("inspections.details.sections.notes")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">
                  {inspection.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Signatures */}
          {(inspection.inspectorSignature || inspection.tenantSignature) && (
            <Card>
              <CardHeader>
                <CardTitle>{t("inspections.details.sections.signatures")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {inspection.inspectorSignature && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {t("inspections.details.sections.inspectorSignature")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("inspections.details.labels.signedOn", {
                        values: {
                          date: formatDateTime(inspection.inspectorSignature.signedAt),
                        },
                      })}
                    </p>
                  </div>
                )}
                {inspection.tenantSignature && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {t("inspections.details.sections.tenantSignature")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("inspections.details.labels.signedOn", {
                        values: {
                          date: formatDateTime(inspection.tenantSignature.signedAt),
                        },
                      })}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Overall Condition */}
          {inspection.overallCondition && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  {t("inspections.details.sections.overallCondition")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge
                  variant={
                    getConditionColor(inspection.overallCondition) as any
                  }
                  className="capitalize text-lg px-4 py-1"
                >
                  {getConditionLabel(inspection.overallCondition)}
                </Badge>
              </CardContent>
            </Card>
          )}

          {/* Property Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {t("inspections.table.headers.property")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="font-medium">{inspection.property?.name}</p>
              <p className="text-sm text-muted-foreground">
                {inspection.property?.address?.street}
                <br />
                {inspection.property?.address?.city},{" "}
                {inspection.property?.address?.state}{" "}
                {inspection.property?.address?.zipCode}
              </p>
              <Badge variant="outline" className="capitalize text-xs">
                {propertyTypeLabel(inspection.property?.type)}
              </Badge>
            </CardContent>
          </Card>

          {/* Inspector */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="h-4 w-4" />
                {t("inspections.table.headers.inspector")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="font-medium">
                {inspection.inspector?.firstName}{" "}
                {inspection.inspector?.lastName}
              </p>
              <p className="text-sm text-muted-foreground">
                {inspection.inspector?.email}
              </p>
              {inspection.inspector?.phone && (
                <p className="text-sm text-muted-foreground">
                  {inspection.inspector.phone}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Tenant */}
          {inspection.tenant && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4" />
                  {t("inspections.table.headers.tenant")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="font-medium">
                  {inspection.tenant.user.firstName}{" "}
                  {inspection.tenant.user.lastName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {inspection.tenant.user.email}
                </p>
                {inspection.tenant.user.phone && (
                  <p className="text-sm text-muted-foreground">
                    {inspection.tenant.user.phone}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Lease */}
          {inspection.lease && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {t("inspections.details.sections.linkedLease")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <Badge variant="outline" className="capitalize text-xs">
                  {getLeaseStatusLabel(inspection.lease.status)}
                </Badge>
                <p className="text-sm text-muted-foreground">
                  {formatDateOnly(inspection.lease.startDate)} -{" "}
                  {formatDateOnly(inspection.lease.endDate)}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {t("inspections.details.sections.timeline")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {t("inspections.details.timeline.created")}
                </p>
                <p className="text-sm">{formatDateTime(inspection.createdAt)}</p>
              </div>
              <Separator />
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {t("inspections.details.timeline.scheduled")}
                </p>
                <p className="text-sm">
                  {formatDateTime(inspection.scheduledDate)}
                </p>
              </div>
              {inspection.completedDate && (
                <>
                  <Separator />
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("inspections.details.timeline.completed")}
                    </p>
                    <p className="text-sm">
                      {formatDateTime(inspection.completedDate)}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Complete Inspection Dialog */}
      <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("inspections.details.dialogs.complete.title")}
            </DialogTitle>
            <DialogDescription>
              {t("inspections.details.dialogs.complete.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("inspections.details.dialogs.complete.conditionLabel")}</Label>
              <Select
                value={completeCondition}
                onValueChange={setCompleteCondition}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      "inspections.details.dialogs.complete.conditionPlaceholder",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">
                    {t("inspections.conditions.excellent")}
                  </SelectItem>
                  <SelectItem value="good">
                    {t("inspections.conditions.good")}
                  </SelectItem>
                  <SelectItem value="fair">
                    {t("inspections.conditions.fair")}
                  </SelectItem>
                  <SelectItem value="poor">
                    {t("inspections.conditions.poor")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("inspections.details.dialogs.complete.finalNotesLabel")}</Label>
              <Textarea
                value={completeNotes}
                onChange={(e) => setCompleteNotes(e.target.value)}
                placeholder={t(
                  "inspections.details.dialogs.complete.finalNotesPlaceholder",
                )}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCompleteDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleComplete} disabled={actionLoading}>
              {actionLoading
                ? t("inspections.details.dialogs.complete.loading")
                : t("inspections.details.dialogs.complete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Inspection Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inspections.details.dialogs.cancel.title")}</DialogTitle>
            <DialogDescription>
              {t("inspections.details.dialogs.cancel.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("inspections.details.dialogs.cancel.reasonLabel")}</Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t(
                  "inspections.details.dialogs.cancel.reasonPlaceholder",
                )}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(false)}
            >
              {t("inspections.details.dialogs.cancel.keep")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={actionLoading}
            >
              {actionLoading
                ? t("inspections.details.dialogs.cancel.loading")
                : t("inspections.details.dialogs.cancel.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Item Dialog */}
      <Dialog open={showAddItemDialog} onOpenChange={setShowAddItemDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inspections.details.dialogs.addItem.title")}</DialogTitle>
            <DialogDescription>
              {t("inspections.details.dialogs.addItem.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("inspections.details.dialogs.addItem.roomLabel")}</Label>
              <Input
                value={newItemRoom}
                onChange={(e) => setNewItemRoom(e.target.value)}
                placeholder={t("inspections.details.dialogs.addItem.roomPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("inspections.details.dialogs.addItem.itemLabel")}</Label>
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder={t("inspections.details.dialogs.addItem.itemPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("inspections.details.dialogs.addItem.conditionLabel")}</Label>
              <Select
                value={newItemCondition}
                onValueChange={setNewItemCondition}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      "inspections.details.dialogs.addItem.conditionPlaceholder",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">
                    {t("inspections.conditions.excellent")}
                  </SelectItem>
                  <SelectItem value="good">
                    {t("inspections.conditions.good")}
                  </SelectItem>
                  <SelectItem value="fair">
                    {t("inspections.conditions.fair")}
                  </SelectItem>
                  <SelectItem value="poor">
                    {t("inspections.conditions.poor")}
                  </SelectItem>
                  <SelectItem value="damaged">
                    {t("inspections.conditions.damaged")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("inspections.details.dialogs.addItem.notesLabel")}</Label>
              <Textarea
                value={newItemNotes}
                onChange={(e) => setNewItemNotes(e.target.value)}
                placeholder={t("inspections.details.dialogs.addItem.notesPlaceholder")}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddItemDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleAddItem} disabled={actionLoading}>
              {actionLoading
                ? t("inspections.details.dialogs.addItem.loading")
                : t("inspections.details.dialogs.addItem.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inspections.details.dialogs.delete.title")}</DialogTitle>
            <DialogDescription>
              {t("inspections.details.dialogs.delete.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={actionLoading}
            >
              {actionLoading
                ? t("inspections.details.dialogs.delete.loading")
                : t("inspections.details.dialogs.delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
