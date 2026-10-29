"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  Upload,
  Link,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface GoogleCalendarSyncProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSyncComplete: () => void;
}

interface SyncStatus {
  connected: boolean;
  lastSync: Date | null;
  syncEnabled: boolean;
  calendars: GoogleCalendar[];
  selectedCalendarId: string | null;
  syncDirection: "import" | "export" | "bidirectional";
}

interface GoogleCalendar {
  id: string;
  name: string;
  description?: string;
  primary: boolean;
  accessRole: string;
}

export function GoogleCalendarSync({
  open,
  onOpenChange,
  onSyncComplete,
}: GoogleCalendarSyncProps) {
  const { t, formatDate, formatTime } = useLocalizationContext();
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    connected: false,
    lastSync: null,
    syncEnabled: false,
    calendars: [],
    selectedCalendarId: null,
    syncDirection: "bidirectional",
  });

  // Load sync status on component mount
  useEffect(() => {
    if (open) {
      loadSyncStatus();
    }
  }, [open]);

  const loadSyncStatus = async () => {
    try {
      const response = await fetch("/api/calendar/google/status");
      if (response.ok) {
        const data = await response.json();
        setSyncStatus(data);
      }
    } catch (error) {
      console.error("Failed to load sync status:", error);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      // Redirect to Google OAuth
      const response = await fetch("/api/calendar/google/auth", {
        method: "POST",
      });

      const data = await response.json();

      if (response.ok && data?.success && data?.data?.authUrl) {
        window.location.href = data.data.authUrl;
      } else {
        // Handle specific error cases
        if (response.status === 503) {
          toast.error(
            t("calendar.google.notConfigured", { defaultValue: "Google Calendar is not set up on this server. Ask your administrator." }),
          );
        } else {
          toast.error(
            data?.message ||
              t("calendar.google.authFailed", { defaultValue: "Could not start the Google sign-in" }),
          );
        }
        throw new Error(
          data?.message || "Failed to initiate Google authentication",
        );
      }
    } catch (error) {
      console.error("Failed to connect to Google Calendar:", error);
      const errorMessage = error instanceof Error ? error.message : "";
      if (
        !errorMessage.includes("Google Calendar integration is not configured")
      ) {
        toast.error(t("calendar.google.connectFailed", { defaultValue: "Could not connect to Google Calendar" }));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/calendar/google/disconnect", {
        method: "POST",
      });

      if (response.ok) {
        setSyncStatus({
          connected: false,
          lastSync: null,
          syncEnabled: false,
          calendars: [],
          selectedCalendarId: null,
          syncDirection: "bidirectional",
        });
        toast.success(t("calendar.google.disconnected", { defaultValue: "Disconnected from Google Calendar" }));
      } else {
        throw new Error("Failed to disconnect");
      }
    } catch (error) {
      console.error("Failed to disconnect:", error);
      toast.error(t("calendar.google.disconnectFailed", { defaultValue: "Could not disconnect from Google Calendar" }));
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (
    direction: "import" | "export" | "bidirectional",
  ) => {
    if (!syncStatus.selectedCalendarId) {
      toast.error(t("calendar.google.pickFirst", { defaultValue: "Choose a calendar first" }));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/calendar/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendarId: syncStatus.selectedCalendarId,
          direction,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(
          t("calendar.google.synced", { defaultValue: "Sync finished: {imported} imported, {exported} exported", values: { imported: result?.imported ?? 0, exported: result?.exported ?? 0 } }),
        );
        setSyncStatus((prev) => ({ ...prev, lastSync: new Date() }));
        onSyncComplete();
      } else {
        throw new Error("Sync failed");
      }
    } catch (error) {
      console.error("Sync failed:", error);
      toast.error(t("calendar.google.syncFailed", { defaultValue: "Could not sync with Google Calendar" }));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAutoSync = async (enabled: boolean) => {
    try {
      const response = await fetch("/api/calendar/google/auto-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });

      if (response.ok) {
        setSyncStatus((prev) => ({ ...prev, syncEnabled: enabled }));
        toast.success(
          enabled
            ? t("calendar.google.autoOn", { defaultValue: "Automatic sync is on" })
            : t("calendar.google.autoOff", { defaultValue: "Automatic sync is off" }),
        );
      } else {
        throw new Error("Failed to update auto-sync setting");
      }
    } catch (error) {
      console.error("Failed to toggle auto-sync:", error);
      toast.error(t("calendar.google.autoFailed", { defaultValue: "Could not change automatic sync" }));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {t("calendar.google.title", { defaultValue: "Google Calendar" })}
          </DialogTitle>
          <DialogDescription>
            {t("calendar.google.subtitle", { defaultValue: "Keep your PropertyPro events and your Google Calendar in step." })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Connection Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Link className="h-4 w-4" />
                {t("calendar.google.connection", { defaultValue: "Connection" })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {syncStatus.connected ? (
                    <>
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      <span className="font-medium">
                        {t("calendar.google.connected", { defaultValue: "Connected to Google Calendar" })}
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 text-red-500" />
                      <span className="font-medium">
                        {t("calendar.google.notConnected", { defaultValue: "Not connected" })}
                      </span>
                    </>
                  )}
                </div>

                {syncStatus.connected ? (
                  <Button
                    variant="outline"
                    onClick={handleDisconnect}
                    disabled={loading}
                  >
                    <Unlink className="h-4 w-4 me-2" />
                    {t("calendar.google.disconnect", { defaultValue: "Disconnect" })}
                  </Button>
                ) : (
                  <Button onClick={handleConnect} disabled={loading}>
                    <Link className="h-4 w-4 me-2" />
                    {t("calendar.google.connect", { defaultValue: "Connect to Google" })}
                  </Button>
                )}
              </div>

              {syncStatus.lastSync && (
                <p className="text-sm text-muted-foreground mt-2">
                  {t("calendar.google.lastSync", { defaultValue: "Last sync: {when}", values: { when: `${formatDate(syncStatus.lastSync)} ${formatTime(syncStatus.lastSync)}` } })}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Calendar Selection */}
          {syncStatus.connected && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {t("calendar.google.which", { defaultValue: "Which calendar" })}
                </CardTitle>
                <CardDescription>
                  {t("calendar.google.whichHint", { defaultValue: "Choose the Google calendar PropertyPro syncs with." })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="calendar-select">
                    {t("calendar.google.calendar", { defaultValue: "Calendar" })}
                  </Label>
                  <Select
                    value={syncStatus.selectedCalendarId ?? ""}
                    onValueChange={(value) =>
                      setSyncStatus((prev) => ({
                        ...prev,
                        selectedCalendarId: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("calendar.google.choose", { defaultValue: "Choose a calendar" })} />
                    </SelectTrigger>
                    <SelectContent>
                      {syncStatus.calendars.map((calendar) => (
                        <SelectItem key={calendar.id} value={calendar.id}>
                          <div className="flex items-center gap-2">
                            {calendar.name}
                            {calendar.primary && (
                              <Badge variant="secondary" className="text-xs">
                                {t("calendar.google.primary", { defaultValue: "Main" })}
                              </Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sync-direction">
                    {t("calendar.google.direction", { defaultValue: "Direction" })}
                  </Label>
                  <Select
                    value={syncStatus.syncDirection}
                    onValueChange={(value: any) =>
                      setSyncStatus((prev) => ({
                        ...prev,
                        syncDirection: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="import">
                        {t("calendar.google.importOnly", { defaultValue: "Only bring events in from Google" })}
                      </SelectItem>
                      <SelectItem value="export">
                        {t("calendar.google.exportOnly", { defaultValue: "Only send events to Google" })}
                      </SelectItem>
                      <SelectItem value="bidirectional">
                        {t("calendar.google.twoWay", { defaultValue: "Both ways (recommended)" })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Sync Controls */}
          {syncStatus.connected && syncStatus.selectedCalendarId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {t("calendar.google.controls", { defaultValue: "Syncing" })}
                </CardTitle>
                <CardDescription>
                  {t("calendar.google.controlsHint", { defaultValue: "Sync now, or let it run on its own." })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="auto-sync">
                      {t("calendar.google.auto", { defaultValue: "Automatic sync" })}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("calendar.google.autoHint", { defaultValue: "Syncs changes every 15 minutes" })}
                    </p>
                  </div>
                  <Switch
                    id="auto-sync"
                    checked={syncStatus.syncEnabled}
                    onCheckedChange={handleToggleAutoSync}
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>{t("calendar.google.manual", { defaultValue: "Sync now" })}</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleSync("import")}
                      disabled={loading}
                      className="flex-1"
                    >
                      <Download className="h-4 w-4 me-2" />
                      {t("calendar.google.import", { defaultValue: "Bring in from Google" })}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleSync("export")}
                      disabled={loading}
                      className="flex-1"
                    >
                      <Upload className="h-4 w-4 me-2" />
                      {t("calendar.google.export", { defaultValue: "Send to Google" })}
                    </Button>
                    <Button
                      onClick={() => handleSync("bidirectional")}
                      disabled={loading}
                      className="flex-1"
                    >
                      <RefreshCw className="h-4 w-4 me-2" />
                      {t("calendar.google.full", { defaultValue: "Both ways" })}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Sync Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertTriangle className="h-4 w-4" />
                {t("calendar.google.notes", { defaultValue: "Good to know" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>• {t("calendar.google.note1", { defaultValue: "Events are matched by when they were created and last changed." })}</p>
              <p>• {t("calendar.google.note2", { defaultValue: "An event deleted in one calendar is marked cancelled in the other." })}</p>
              <p>• {t("calendar.google.note3", { defaultValue: "Repeating events are supported, with some limits." })}</p>
              <p>• {t("calendar.google.note4", { defaultValue: "Private events keep their privacy settings." })}</p>
              <p>• {t("calendar.google.note5", { defaultValue: "When both sides changed, the most recent change wins." })}</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close", { defaultValue: "Close" })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
