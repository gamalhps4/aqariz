/**
 * PropertyPro - User Session Management Component
 * Manage active user sessions and force logout capabilities
 */

"use client";

import React, { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Monitor,
  Smartphone,
  Tablet,
  Globe,
  LogOut,
  Shield,
  Clock,
  MapPin,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { UserRole } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { dateFnsLocale } from "@/lib/utils/date-fns-locale";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";

interface UserSession {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: UserRole;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  browser: string;
  os: string;
  ipAddress: string;
  lastActivity: Date;
  createdAt: Date;
  isCurrentSession: boolean;
}

interface UserSessionManagementProps {
  userId?: string;
  className?: string;
}

export function UserSessionManagement({
  userId,
  className,
}: UserSessionManagementProps) {
  const { t, language } = useLocalizationContext();
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showTerminateDialog, setShowTerminateDialog] = useState(false);
  const [sessionToTerminate, setSessionToTerminate] =
    useState<UserSession | null>(null);
  const [isTerminating, setIsTerminating] = useState(false);

  useEffect(() => {
    fetchSessions();
  }, [userId]);

  const fetchSessions = async () => {
    try {
      setIsLoading(true);

      const params = new URLSearchParams();
      params.set("limit", "50");
      if (userId) params.set("userId", userId);

      const response = await fetch(`/api/sessions?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch sessions");
      }

      const json = await response.json();
      const list = json?.data?.sessions ?? [];

      const mapped: UserSession[] = list.map((s: any) => ({
        id: s.id,
        userId: s.userId,
        userName: s.userName,
        userEmail: s.userEmail,
        userRole: s.userRole as UserRole,
        deviceType: s.deviceType ?? "unknown",
        browser: s.browser ?? "Unknown",
        os: s.os ?? "Unknown",
        ipAddress: s.ipAddress ?? "Unknown",
        lastActivity: new Date(s.lastActivity),
        createdAt: new Date(s.createdAt),
        isCurrentSession: !!s.isCurrentSession,
      }));

      setSessions(mapped);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      toast.error(t("settings.sessions.loadFailed", { defaultValue: "Could not load the sessions" }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleTerminateSession = async (session: UserSession) => {
    try {
      setIsTerminating(true);

      // In a real app, this would call an API to terminate the session
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(t("settings.sessions.endFailed", { defaultValue: "Could not end the session" }));
      }

      // Remove the session from the list
      setSessions((prev) => prev.filter((s) => s.id !== session.id));

      toast.success(
        session.isCurrentSession
          ? t("settings.sessions.endingCurrent", { defaultValue: "You are being signed out of this session" })
          : t("settings.sessions.ended", { defaultValue: "Session signed out" })
      );

      setShowTerminateDialog(false);
      setSessionToTerminate(null);
    } catch (error) {
      console.error("Error terminating session:", error);
      toast.error(t("settings.sessions.endFailed", { defaultValue: "Could not end the session" }));
    } finally {
      setIsTerminating(false);
    }
  };

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType) {
      case "mobile":
        return <Smartphone className="h-4 w-4" />;
      case "tablet":
        return <Tablet className="h-4 w-4" />;
      case "desktop":
        return <Monitor className="h-4 w-4" />;
      default:
        return <Globe className="h-4 w-4" />;
    }
  };

  const getActivityStatus = (lastActivity: Date) => {
    // lastActivity is the session row's updatedAt, which Better Auth rewrites
    // at most once per day (session.updateAge) — it moves in day-sized steps,
    // so minute-scale labels here would report every real session as idle.
    // Mirrors the API's 24h boundary.
    const hoursAgo = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);

    if (hoursAgo < 24) {
      return {
        label: t("settings.sessions.activeToday", { defaultValue: "Active today" }),
        variant: "default" as const,
      };
    }
    return {
      label: t("settings.sessions.idle", { defaultValue: "Idle" }),
      variant: "outline" as const,
    };
  };

  const sort = useTableSort(sessions, {
    device: (session) => session.browser,
    user: (session) => session.userName,
    ip: (session) => session.ipAddress,
    lastActivity: (session) => session.lastActivity,
    status: (session) => getActivityStatus(session.lastActivity).label,
  });

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {t("settings.sessions.title", { defaultValue: "Signed-in sessions" })}
            </CardTitle>
            <CardDescription>
              {t("settings.sessions.subtitle", { defaultValue: "Devices where this account is signed in" })}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchSessions}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 me-2 ${isLoading ? "animate-spin" : ""}`}
            />
            {t("admin.invites.refresh", { defaultValue: "Refresh" })}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center space-x-4 p-3 rounded-lg shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_18px_rgba(15,23,42,0.025)] dark:shadow-none"
              >
                <div className="h-8 w-8 bg-muted rounded animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
                </div>
                <div className="h-6 w-16 bg-muted rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8">
            <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">
              {t("settings.sessions.empty", { defaultValue: "No signed-in sessions" })}
            </p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sort={sort} column="device">
                    {t("settings.sessions.device", { defaultValue: "Device and browser" })}
                  </SortableTableHead>
                  <SortableTableHead sort={sort} column="user">
                    {t("settings.sessions.user", { defaultValue: "User" })}
                  </SortableTableHead>
                  <SortableTableHead sort={sort} column="ip">
                    {t("settings.sessions.ip", { defaultValue: "IP address" })}
                  </SortableTableHead>
                  <SortableTableHead sort={sort} column="lastActivity">
                    {t("settings.sessions.lastActivity", { defaultValue: "Last activity" })}
                  </SortableTableHead>
                  <SortableTableHead sort={sort} column="status">
                    {t("settings.sessions.status", { defaultValue: "Status" })}
                  </SortableTableHead>
                  <TableHead className="text-end">{t("settings.sessions.actions", { defaultValue: "Actions" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sort.rows.map((session) => {
                  const activityStatus = getActivityStatus(
                    session.lastActivity
                  );
                  return (
                    <TableRow key={session.id}>
                      <TableCell>
                        <div className="flex items-center space-x-3">
                          {getDeviceIcon(session.deviceType)}
                          <div>
                            <p className="font-medium">{session.browser}</p>
                            <p className="text-sm text-muted-foreground">
                              {session.os}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{session.userName}</p>
                          <p className="text-sm text-muted-foreground">
                            {session.userEmail}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          <p className="text-sm">{session.ipAddress}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">
                            {formatDistanceToNow(session.lastActivity, {
                              addSuffix: true,
                              locale: dateFnsLocale(language),
                            })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge
                            variant={
                              activityStatus.variant === "default"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {activityStatus.label}
                          </Badge>
                          {session.isCurrentSession && (
                            <Badge variant="outline" className="text-xs">
                              {t("settings.sessions.current", { defaultValue: "This device" })}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSessionToTerminate(session);
                            setShowTerminateDialog(true);
                          }}
                          className="text-red-600 hover:text-red-700"
                        >
                          <LogOut className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Terminate Session Dialog */}
      <Dialog open={showTerminateDialog} onOpenChange={setShowTerminateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              {t("settings.sessions.end", { defaultValue: "Sign out this session" })}
            </DialogTitle>
            <DialogDescription>
              {t("settings.sessions.endConfirm", { defaultValue: "That device will have to sign in again." })}
            </DialogDescription>
          </DialogHeader>

          {sessionToTerminate && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center space-x-3 mb-2">
                  {getDeviceIcon(sessionToTerminate.deviceType)}
                  <div>
                    <p className="font-medium">{sessionToTerminate.browser}</p>
                    <p className="text-sm text-muted-foreground">
                      {sessionToTerminate.os}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {sessionToTerminate.userName} ({sessionToTerminate.userEmail})
                </p>
                <p className="text-sm text-muted-foreground">
                  IP: {sessionToTerminate.ipAddress}
                </p>
              </div>

              {sessionToTerminate.isCurrentSession && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {t("settings.sessions.currentWarning", { defaultValue: "This is the session you are using now — you will be signed out straight away." })}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowTerminateDialog(false)}
              disabled={isTerminating}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                sessionToTerminate && handleTerminateSession(sessionToTerminate)
              }
              disabled={isTerminating}
            >
              {isTerminating ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  {t("settings.sessions.ending", { defaultValue: "Signing out…" })}
                </>
              ) : (
                <>
                  <LogOut className="me-2 h-4 w-4" />
                  {t("settings.sessions.end", { defaultValue: "Sign out this session" })}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
