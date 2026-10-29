"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  Settings,
} from "lucide-react";
import { PropertyStatus } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface PropertyStatusManagerProps {
  currentStatus: PropertyStatus;
  onStatusUpdate: (newStatus: PropertyStatus) => Promise<void>;
}

const PropertyStatusManager: React.FC<PropertyStatusManagerProps> = ({
  currentStatus,
  onStatusUpdate,
}) => {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<PropertyStatus | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const { t } = useLocalizationContext();

  const statusConfig = {
    [PropertyStatus.AVAILABLE]: {
      label: t("properties.status.available"),
      icon: CheckCircle,
      color: "bg-green-100 text-green-800 border-green-200",
      description: t("properties.status.description.available"),
    },
    [PropertyStatus.OCCUPIED]: {
      label: t("properties.status.occupied"),
      icon: Clock,
      color: "bg-blue-100 text-blue-800 border-blue-200",
      description: t("properties.status.description.occupied"),
    },
    [PropertyStatus.MAINTENANCE]: {
      label: t("properties.status.maintenance"),
      icon: AlertTriangle,
      color: "bg-yellow-100 text-yellow-800 border-yellow-200",
      description: t("properties.status.description.maintenance"),
    },
    [PropertyStatus.UNAVAILABLE]: {
      label: t("properties.status.unavailable"),
      icon: XCircle,
      color: "bg-red-100 text-red-800 border-red-200",
      description: t("properties.status.description.unavailable"),
    },
  };

  const handleStatusSelect = (status: PropertyStatus) => {
    if (status === currentStatus) return;

    setSelectedStatus(status);
    setShowConfirmDialog(true);
  };

  const handleConfirmStatusChange = async () => {
    if (!selectedStatus) return;

    try {
      setLoading(true);
      await onStatusUpdate(selectedStatus);
      setShowConfirmDialog(false);
      setSelectedStatus(null);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const handleCancelStatusChange = () => {
    setShowConfirmDialog(false);
    setSelectedStatus(null);
  };

  const currentConfig = statusConfig[currentStatus];
  const CurrentIcon = currentConfig.icon;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 me-2" />
            {t("properties.statusManager.button.changeStatus")}
            <ChevronDown className="h-4 w-4 ms-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            {t("properties.statusManager.menu.label")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {Object.entries(statusConfig).map(([status, config]) => {
            const Icon = config.icon;
            const isCurrentStatus = status === currentStatus;

            return (
              <DropdownMenuItem
                key={status}
                onClick={() => handleStatusSelect(status as PropertyStatus)}
                disabled={isCurrentStatus}
                className={`flex items-center space-x-2 ${
                  isCurrentStatus
                    ? "opacity-50 cursor-not-allowed"
                    : "cursor-pointer"
                }`}
              >
                <Icon className="h-4 w-4" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{config.label}</span>
                    {isCurrentStatus && (
                      <Badge variant="secondary" className="text-xs">
                        {t("properties.statusManager.badge.current")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {config.description}
                  </p>
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Status Change Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("properties.statusManager.confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("properties.statusManager.confirm.description", {
                values: {
                  status:
                    selectedStatus && statusConfig[selectedStatus]?.label
                      ? statusConfig[selectedStatus]?.label
                      : "",
                },
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleCancelStatusChange}
              disabled={loading}
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmStatusChange}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 focus:ring-blue-600"
            >
              {loading
                ? t("properties.statusManager.confirm.updating")
                : t("properties.statusManager.confirm.update")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PropertyStatusManager;
