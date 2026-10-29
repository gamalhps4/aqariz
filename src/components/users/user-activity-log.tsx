/**
 * PropertyPro - User Activity Log Component
 * Display user activity and audit trail
 */

"use client";

import React, { useState, useEffect } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  User,
  Shield,
  LogIn,
  LogOut,
  Edit,
  Plus,
  Trash2,
  Clock,
} from "lucide-react";

interface ActivityEntry {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  action: ActivityAction;
  target?: string;
  targetId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

type ActivityAction =
  | "user_created"
  | "user_updated"
  | "user_deleted"
  | "user_activated"
  | "user_deactivated"
  | "role_changed"
  | "login"
  | "logout"
  | "password_changed"
  | "profile_updated"
  | "avatar_uploaded"
  | "bulk_operation";

interface UserActivityLogProps {
  userId?: string;
  limit?: number;
  showFilters?: boolean;
  className?: string;
}

const activityConfig: Record<
  ActivityAction,
  {
    label: string;
    icon: React.ReactNode;
    color: string;
    description: string;
  }
> = {
  user_created: {
    label: "User Created",
    icon: <Plus className="h-4 w-4" />,
    color: "bg-green-100 text-green-800 border-green-200",
    description: "New user account created",
  },
  user_updated: {
    label: "User Updated",
    icon: <Edit className="h-4 w-4" />,
    color: "bg-blue-100 text-blue-800 border-blue-200",
    description: "User information updated",
  },
  user_deleted: {
    label: "User Deleted",
    icon: <Trash2 className="h-4 w-4" />,
    color: "bg-red-100 text-red-800 border-red-200",
    description: "User account deleted",
  },
  user_activated: {
    label: "User Activated",
    icon: <User className="h-4 w-4" />,
    color: "bg-green-100 text-green-800 border-green-200",
    description: "User account activated",
  },
  user_deactivated: {
    label: "User Deactivated",
    icon: <User className="h-4 w-4" />,
    color: "bg-orange-100 text-orange-800 border-orange-200",
    description: "User account deactivated",
  },
  role_changed: {
    label: "Role Changed",
    icon: <Shield className="h-4 w-4" />,
    color: "bg-purple-100 text-purple-800 border-purple-200",
    description: "User role modified",
  },
  login: {
    label: "Login",
    icon: <LogIn className="h-4 w-4" />,
    color: "bg-blue-100 text-blue-800 border-blue-200",
    description: "User logged in",
  },
  logout: {
    label: "Logout",
    icon: <LogOut className="h-4 w-4" />,
    color: "bg-gray-100 text-gray-800 border-gray-200",
    description: "User logged out",
  },
  password_changed: {
    label: "Password Changed",
    icon: <Shield className="h-4 w-4" />,
    color: "bg-yellow-100 text-yellow-800 border-yellow-200",
    description: "Password updated",
  },
  profile_updated: {
    label: "Profile Updated",
    icon: <Edit className="h-4 w-4" />,
    color: "bg-blue-100 text-blue-800 border-blue-200",
    description: "Profile information updated",
  },
  avatar_uploaded: {
    label: "Avatar Uploaded",
    icon: <User className="h-4 w-4" />,
    color: "bg-green-100 text-green-800 border-green-200",
    description: "Profile picture updated",
  },
  bulk_operation: {
    label: "Bulk Operation",
    icon: <Activity className="h-4 w-4" />,
    color: "bg-purple-100 text-purple-800 border-purple-200",
    description: "Bulk operation performed",
  },
};

export function UserActivityLog({
  userId,
  limit = 50,
  showFilters = true,
  className,
}: UserActivityLogProps) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<ActivityAction | "all">(
    "all"
  );
  const [dateRange, setDateRange] = useState<string>("7d");
  const { t, formatDate } = useLocalizationContext();
  const labelOf = (action: ActivityAction) =>
    t(`admin.activity.${action}.label`, {
      defaultValue: activityConfig[action].label,
    });

  // Map API audit actions to local activity actions
  const mapAuditActionToActivity = (auditAction: string): ActivityAction => {
    switch (auditAction) {
      case "login":
        return "login";
      case "logout":
        return "logout";
      case "password_changed":
        return "password_changed";
      case "role_assigned":
        return "role_changed";
      case "create":
        return "user_created";
      case "update":
      case "settings_changed":
        return "user_updated";
      case "delete":
        return "user_deleted";
      case "bulk_create":
      case "bulk_update":
      case "bulk_delete":
      case "bulk_export":
      case "bulk_import":
        return "bulk_operation";
      default:
        return "profile_updated";
    }
  };

  // Map local selected action to API audit action
  const mapSelectedToAudit = (
    selected: ActivityAction | "all"
  ): string | null => {
    switch (selected) {
      case "login":
        return "login";
      case "logout":
        return "logout";
      case "password_changed":
        return "password_changed";
      case "role_changed":
        return "role_assigned";
      case "user_created":
        return "create";
      case "user_updated":
      case "profile_updated":
        return "update";
      case "user_deleted":
        return "delete";
      case "avatar_uploaded":
        return "document_upload";
      case "bulk_operation":
        return "bulk_update";
      case "all":
        return null;
      default:
        return null;
    }
  };

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        setIsLoading(true);

        const paramsActor = new URLSearchParams();
        paramsActor.set("limit", String(limit));
        if (userId) paramsActor.set("userId", userId);

        const now = new Date();
        let startDate: Date | null = null;
        switch (dateRange) {
          case "1d":
            startDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
            break;
          case "7d":
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case "30d":
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case "90d":
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
        }
        if (startDate) paramsActor.set("startDate", startDate.toISOString());
        paramsActor.set("endDate", now.toISOString());

        const auditAction = mapSelectedToAudit(selectedAction);
        if (auditAction) paramsActor.set("action", auditAction);

        const requests: Promise<Response>[] = [];

        requests.push(fetch(`/api/audit?${paramsActor.toString()}`));

        if (userId) {
          const paramsResource = new URLSearchParams();
          paramsResource.set("limit", String(limit));
          paramsResource.set("resourceType", "user");
          paramsResource.set("resourceId", userId);
          if (startDate)
            paramsResource.set("startDate", startDate.toISOString());
          paramsResource.set("endDate", now.toISOString());
          if (auditAction) paramsResource.set("action", auditAction);
          requests.push(fetch(`/api/audit?${paramsResource.toString()}`));
        }

        const responses = await Promise.all(requests);
        const logsCombined: any[] = [];
        for (const r of responses) {
          if (!r.ok) continue;
          const j = await r.json();
          const logs = j?.data?.logs ?? j?.logs ?? [];
          logsCombined.push(...logs);
        }

        const mapped: ActivityEntry[] = logsCombined.map((log: any) => {
          const userObj = log.userId;
          const userName =
            (userObj?.firstName && userObj?.lastName
              ? `${userObj.firstName} ${userObj.lastName}`
              : log.userEmail) || "System";
          const uid =
            typeof userObj?._id === "string"
              ? userObj._id
              : userObj?._id?.toString() || log.userId?.toString() || "";
          return {
            id: log._id?.toString() || "",
            userId: uid,
            userName,
            userAvatar: undefined,
            action: mapAuditActionToActivity(log.action),
            target: log.resourceName,
            targetId:
              typeof log.resourceId === "string"
                ? log.resourceId
                : log.resourceId?.toString(),
            details: log.details || log.newValues || log.oldValues || undefined,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            timestamp: new Date(log.timestamp || log.createdAt),
          };
        });

        setActivities(mapped);
      } catch {
        setActivities([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchActivities();
  }, [userId, selectedAction, dateRange, limit]);

  const formatActivityDetails = (activity: ActivityEntry) => {
    const config = activityConfig[activity.action];
    let details = t(`admin.activity.${activity.action}.description`, {
      defaultValue: config.description,
    });

    if (activity.target) {
      details += ` — ${activity.target}`;
    }

    if (activity.details) {
      switch (activity.action) {
        case "role_changed":
          details += ` (${t("admin.activity.roleChange", { defaultValue: "{from} → {to}", values: { from: activity.details.oldRole?.replace(/_/g, " ") ?? "—", to: activity.details.newRole?.replace(/_/g, " ") ?? "—" } })})`;
          break;
        case "bulk_operation":
          details += ` (${t("admin.activity.bulkCount", { defaultValue: "{count} users", values: { count: activity.details.userCount ?? 0 } })})`;
          break;
        case "profile_updated":
          details += ` (${activity.details.fields?.join(", ")})`;
          break;
      }
    }

    return details;
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          {t("admin.activity.title", { defaultValue: "Activity log" })}
        </CardTitle>
        <CardDescription>
          {userId
            ? t("admin.activity.subtitleUser", { defaultValue: "What this user has done" })
            : t("admin.activity.subtitleAll", { defaultValue: "Recent activity" })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {showFilters && (
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <Select
              value={selectedAction}
              onValueChange={(value) =>
                setSelectedAction(value as ActivityAction | "all")
              }
            >
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("admin.activity.allActions", { defaultValue: "All actions" })}
                </SelectItem>
                {Object.entries(activityConfig).map(([action, config]) => (
                  <SelectItem key={action} value={action}>
                    <div className="flex items-center gap-2">
                      {config.icon}
                      {labelOf(action as ActivityAction)}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-full sm:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">
                  {t("admin.activity.range.today", { defaultValue: "Today" })}
                </SelectItem>
                <SelectItem value="7d">{t("dashboard.trendRange.7d", { defaultValue: "7 days" })}</SelectItem>
                <SelectItem value="30d">{t("dashboard.trendRange.30d", { defaultValue: "30 days" })}</SelectItem>
                <SelectItem value="90d">
                  {t("admin.activity.range.90d", { defaultValue: "90 days" })}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="flex items-start space-x-3 p-3 border rounded-lg"
              >
                <div className="h-8 w-8 bg-muted rounded-full animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
                </div>
                <div className="h-6 w-16 bg-muted rounded animate-pulse" />
              </div>
            ))
          ) : activities.length === 0 ? (
            <div className="text-center py-8">
              <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">
                {t("admin.activity.empty", { defaultValue: "No activity in this period" })}
              </p>
            </div>
          ) : (
            activities.map((activity) => {
              const config = activityConfig[activity.action];
              return (
                <div
                  key={activity.id}
                  className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={activity.userAvatar} />
                    <AvatarFallback>
                      {activity.userName
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{activity.userName}</span>
                      <Badge className={`text-xs ${config.color}`}>
                        <span className="flex items-center gap-1">
                          {config.icon}
                          {labelOf(activity.action)}
                        </span>
                      </Badge>
                    </div>

                    <p className="text-sm text-muted-foreground mb-1">
                      {formatActivityDetails(activity)}
                    </p>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(activity.timestamp, { format: "medium" })}{" "}
                        {activity.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {activity.ipAddress && (
                        <span>IP: {activity.ipAddress}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
