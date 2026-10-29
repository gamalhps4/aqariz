"use client";

/**
 * PropertyPro - Notification Test Component
 * Test and demonstrate notification functionality
 */

import React, { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast as sonnerToast } from "sonner";

/**
 * The shadcn `useToast` hook no longer exists in this codebase (the app uses
 * sonner). This shim keeps the original call shape and messages.
 */
const toast = (options: {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}) => {
  const { title, description, variant } = options;
  if (variant === "destructive") {
    sonnerToast.error(title, { description });
  } else {
    sonnerToast(title, { description });
  }
};
import {
  Send,
  Bell,
  Clock,
  AlertTriangle,
  Info,
} from "lucide-react";

interface TestNotification {
  type: string;
  priority: string;
  userId: string;
  title: string;
  message: string;
  scheduledFor?: string;
}

export default function NotificationTest() {
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<TestNotification>({
    type: "payment_reminder",
    priority: "normal",
    userId: "",
    title: "Test Notification",
    message: "This is a test notification message.",
  });

  const notificationTypes = [
    { value: "payment_reminder", label: "Payment Reminder" },
    { value: "payment_overdue", label: "Payment Overdue" },
    { value: "lease_expiry", label: "Lease Expiry" },
    { value: "maintenance_update", label: "Maintenance Update" },
    { value: "maintenance_emergency", label: "Maintenance Emergency" },
    { value: "welcome", label: "Welcome Message" },
    { value: "system_announcement", label: "System Announcement" },
  ];

  const priorityLevels = [
    { value: "low", label: "Low", color: "bg-gray-500" },
    { value: "normal", label: "Normal", color: "bg-blue-500" },
    { value: "high", label: "High", color: "bg-orange-500" },
    { value: "critical", label: "Critical", color: "bg-red-500" },
  ];

  const handleInputChange = (field: keyof TestNotification, value: string) => {
    setNotification((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const sendTestNotification = async () => {
    if (!notification.userId || !notification.title || !notification.message) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send-notification",
          ...notification,
          notificationData: {
            userEmail: "test@example.com",
            userName: "Test User",
            propertyName: "Test Property",
            rentAmount: 1500,
            dueDate: new Date().toISOString(),
          },
        }),
      });

      if (response.ok) {
        toast({
          title: "Notification Sent",
          description: "Test notification has been sent successfully.",
        });
      } else {
        throw new Error("Failed to send notification");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send test notification.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const scheduleTestNotification = async () => {
    if (
      !notification.userId ||
      !notification.title ||
      !notification.message ||
      !notification.scheduledFor
    ) {
      toast({
        title: "Validation Error",
        description:
          "Please fill in all required fields including scheduled time.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "schedule-notification",
          type: notification.type,
          userId: notification.userId,
          scheduledFor: notification.scheduledFor,
          notificationData: {
            title: notification.title,
            message: notification.message,
            userEmail: "test@example.com",
            userName: "Test User",
          },
        }),
      });

      if (response.ok) {
        toast({
          title: "Notification Scheduled",
          description: "Test notification has been scheduled successfully.",
        });
      } else {
        throw new Error("Failed to schedule notification");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to schedule test notification.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case "low":
        return <Info className="h-4 w-4" />;
      case "normal":
        return <Bell className="h-4 w-4" />;
      case "high":
        return <AlertTriangle className="h-4 w-4" />;
      case "critical":
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Notification Testing
        </h2>
        <p className="text-muted-foreground">
          Test the notification system with different types and priorities.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Send Test Notification
          </CardTitle>
          <CardDescription>
            Configure and send a test notification to verify the system is
            working.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="notification-type">Notification Type</Label>
              <Select
                value={notification.type}
                onValueChange={(value) => handleInputChange("type", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select notification type" />
                </SelectTrigger>
                <SelectContent>
                  {notificationTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority Level</Label>
              <Select
                value={notification.priority}
                onValueChange={(value) => handleInputChange("priority", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {priorityLevels.map((priority) => (
                    <SelectItem key={priority.value} value={priority.value}>
                      <div className="flex items-center gap-2">
                        {getPriorityIcon(priority.value)}
                        {priority.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-id">User ID</Label>
            <Input
              id="user-id"
              placeholder="Enter user ID to send notification to"
              value={notification.userId}
              onChange={(e) => handleInputChange("userId", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Notification Title</Label>
            <Input
              id="title"
              placeholder="Enter notification title"
              value={notification.title}
              onChange={(e) => handleInputChange("title", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              placeholder="Enter notification message"
              value={notification.message}
              onChange={(e) => handleInputChange("message", e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="scheduled-for">Schedule For (Optional)</Label>
            <Input
              id="scheduled-for"
              type="datetime-local"
              value={notification.scheduledFor || ""}
              onChange={(e) =>
                handleInputChange("scheduledFor", e.target.value)
              }
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={sendTestNotification} disabled={loading}>
              <Send className="h-4 w-4 me-2" />
              {loading ? "Sending..." : "Send Now"}
            </Button>

            {notification.scheduledFor && (
              <Button
                variant="outline"
                onClick={scheduleTestNotification}
                disabled={loading}
              >
                <Clock className="h-4 w-4 me-2" />
                Schedule
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification Preview</CardTitle>
          <CardDescription>
            Preview how your notification will appear.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className={`${
                  priorityLevels.find((p) => p.value === notification.priority)
                    ?.color
                } text-white`}
              >
                {getPriorityIcon(notification.priority)}
                <span className="ms-1">
                  {notification.priority.toUpperCase()}
                </span>
              </Badge>
              <Badge variant="outline">
                {
                  notificationTypes.find((t) => t.value === notification.type)
                    ?.label
                }
              </Badge>
            </div>
            <h4 className="font-semibold">{notification.title}</h4>
            <p className="text-sm text-muted-foreground">
              {notification.message}
            </p>
            {notification.scheduledFor && (
              <p className="text-xs text-muted-foreground">
                Scheduled for:{" "}
                {new Date(notification.scheduledFor).toLocaleString()}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
