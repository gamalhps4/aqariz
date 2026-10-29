"use client";

import {
  AlertTriangle,
  Bell,
  Clock,
  X,
  CheckCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EmergencyNotification {
  id: string;
  type: "emergency" | "escalation" | "overdue" | "completed";
  title: string;
  message: string;
  priority: "low" | "medium" | "high" | "critical";
  requestId: string;
  propertyName: string;
  emergencyType: string;
  timeElapsed: string;
  createdAt: string;
  read: boolean;
  actions?: {
    label: string;
    href: string;
    variant: "default" | "destructive" | "outline";
  }[];
}

interface EmergencyNotificationsProps {
  className?: string;
  maxNotifications?: number;
  autoRefresh?: boolean;
}

export function EmergencyNotifications({
  className = "",
  maxNotifications = 5,
  autoRefresh = true,
}: EmergencyNotificationsProps) {
  const [notifications, setNotifications] = useState<EmergencyNotification[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = async () => {
    try {
      const mockNotifications: EmergencyNotification[] = [
        {
          id: "notif1",
          type: "emergency",
          title: "🚨 New Emergency: Water Leak",
          message: "Major water leak reported at Sunset Apartments - Unit 204",
          priority: "critical",
          requestId: "req1",
          propertyName: "Sunset Apartments",
          emergencyType: "Water Leak",
          timeElapsed: "5 minutes ago",
          createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          read: false,
          actions: [
            {
              label: "View Details",
              href: "/dashboard/maintenance/req1",
              variant: "default",
            },
            {
              label: "Assign",
              href: "/dashboard/maintenance/req1/assign",
              variant: "destructive",
            },
          ],
        },
        {
          id: "notif2",
          type: "overdue",
          title: "⚠️ Emergency Overdue",
          message: "Electrical hazard at Oak Plaza - 3 hours without response",
          priority: "critical",
          requestId: "req2",
          propertyName: "Oak Plaza",
          emergencyType: "Electrical Hazard",
          timeElapsed: "3 hours ago",
          createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          read: false,
          actions: [
            {
              label: "Escalate",
              href: "/dashboard/maintenance/emergency/escalate?id=req2",
              variant: "destructive",
            },
            {
              label: "View",
              href: "/dashboard/maintenance/req2",
              variant: "outline",
            },
          ],
        },
        {
          id: "notif3",
          type: "escalation",
          title: "🚨 Emergency Escalated",
          message: "HVAC failure escalated to you - immediate action required",
          priority: "high",
          requestId: "req3",
          propertyName: "Pine Heights",
          emergencyType: "HVAC Failure",
          timeElapsed: "1 hour ago",
          createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          read: true,
          actions: [
            {
              label: "Accept",
              href: "/dashboard/maintenance/req3/accept",
              variant: "destructive",
            },
            {
              label: "View",
              href: "/dashboard/maintenance/req3",
              variant: "outline",
            },
          ],
        },
      ];

      setNotifications(mockNotifications.slice(0, maxNotifications));
      setUnreadCount(mockNotifications.filter((n) => !n.read).length);
      setLoading(false);
    } catch (error) {
      toast.error("Failed to load emergency notifications");
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    try {
      await fetch(`/api/notifications/${notificationId}/read`, {
        method: "PATCH",
      });
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const dismissNotification = (notificationId: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    setUnreadCount((prev) => {
      const notification = notifications.find((n) => n.id === notificationId);
      return notification && !notification.read ? Math.max(0, prev - 1) : prev;
    });
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical":
        return "text-red-600 bg-red-50 border-red-200";
      case "high":
        return "text-orange-600 bg-orange-50 border-orange-200";
      case "medium":
        return "text-yellow-600 bg-yellow-50 border-yellow-200";
      default:
        return "text-blue-600 bg-blue-50 border-blue-200";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "emergency":
        return <Zap className="h-4 w-4 text-red-600" />;
      case "escalation":
        return <AlertTriangle className="h-4 w-4 text-orange-600" />;
      case "overdue":
        return <Clock className="h-4 w-4 text-red-600" />;
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      default:
        return <Bell className="h-4 w-4 text-blue-600" />;
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  // Auto-refresh notifications
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchNotifications();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Show browser notification for critical emergencies
  useEffect(() => {
    const criticalNotifications = notifications.filter(
      (n) => n.priority === "critical" && !n.read
    );

    criticalNotifications.forEach((notification) => {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(notification.title, {
          body: notification.message,
          icon: "/favicon.ico",
          tag: notification.id,
          requireInteraction: true,
        });
      }
    });
  }, [notifications]);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Emergency Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="p-3 border rounded-lg animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Emergency Notifications
            {unreadCount > 0 && (
              <Badge variant="destructive" className="animate-pulse">
                {unreadCount}
              </Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={fetchNotifications}>
            Refresh
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {notifications.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-green-700">All Clear!</h3>
            <p className="text-muted-foreground">
              No emergency notifications at this time.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-4 border rounded-lg transition-all ${
                  notification.read ? "opacity-60" : ""
                } ${getPriorityColor(notification.priority)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {getTypeIcon(notification.type)}
                      <h4 className="font-semibold text-sm">
                        {notification.title}
                      </h4>
                      {!notification.read && (
                        <Badge variant="secondary" className="text-xs">
                          New
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm mb-2">{notification.message}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{notification.propertyName}</span>
                      <span>•</span>
                      <span>{notification.timeElapsed}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dismissNotification(notification.id)}
                    className="ms-2"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {notification.actions && notification.actions.length > 0 && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                    {notification.actions.map((action, index) => (
                      <Link key={index} href={action.href}>
                        <Button
                          variant={action.variant}
                          size="sm"
                          onClick={() => markAsRead(notification.id)}
                        >
                          {action.label}
                        </Button>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {notifications.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <Link href="/dashboard/maintenance/emergency">
              <Button variant="outline" className="w-full">
                View All Emergency Requests
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
