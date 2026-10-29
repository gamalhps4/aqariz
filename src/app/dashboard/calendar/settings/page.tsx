"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Calendar,
  Bell,
  Palette,
  Clock,
  Eye,
  Save,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface CalendarSettings {
  // Display preferences
  defaultView: string;
  weekends: boolean;
  firstDay: number;
  timezone: string;

  // Time settings
  businessHours: {
    enabled: boolean;
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
  };

  slotDuration: string;
  snapDuration: string;
  defaultEventDuration: string;

  // Event preferences
  defaultEventType: string;
  defaultEventPriority: string;
  defaultReminders: number[];

  // Notification preferences
  emailNotifications: {
    invitations: boolean;
    reminders: boolean;
    updates: boolean;
    cancellations: boolean;
  };

  // View preferences
  showWeekNumbers: boolean;
  showDeclinedEvents: boolean;
  eventLimit: number;

  // Color preferences
  eventColors: Record<string, string>;
}

const defaultSettings: CalendarSettings = {
  defaultView: "dayGridMonth",
  weekends: true,
  firstDay: 0,
  timezone: "local",
  businessHours: {
    enabled: true,
    startTime: "09:00",
    endTime: "17:00",
    daysOfWeek: [1, 2, 3, 4, 5],
  },
  slotDuration: "00:30",
  snapDuration: "00:15",
  defaultEventDuration: "01:00",
  defaultEventType: "GENERAL",
  defaultEventPriority: "MEDIUM",
  defaultReminders: [15],
  emailNotifications: {
    invitations: true,
    reminders: true,
    updates: true,
    cancellations: true,
  },
  showWeekNumbers: false,
  showDeclinedEvents: false,
  eventLimit: 3,
  eventColors: {
    LEASE_RENEWAL: "#3b82f6",
    PROPERTY_INSPECTION: "#10b981",
    MAINTENANCE_APPOINTMENT: "#f59e0b",
    PROPERTY_SHOWING: "#8b5cf6",
    TENANT_MEETING: "#6366f1",
    RENT_COLLECTION: "#059669",
    MOVE_IN: "#06b6d4",
    MOVE_OUT: "#ef4444",
    GENERAL: "#6b7280",
  },
};

/** An event type (as the colour settings store it) → its label's key. */
const EVENT_TYPE_LABEL_KEYS: Record<string, string> = {
  general: "calendar.settings.events.typeGeneral",
  property_showing: "calendar.settings.events.typePropertyShowing",
  property_inspection: "calendar.settings.events.typePropertyInspection",
  maintenance_appointment: "calendar.settings.events.typeMaintenance",
  maintenance: "calendar.settings.events.typeMaintenance",
  tenant_meeting: "calendar.settings.events.typeTenantMeeting",
  lease_renewal: "calendar.settings.events.typeLeaseRenewal",
  rent_collection: "calendar.settings.events.typeRentCollection",
  move_in: "calendar.settings.events.typeMoveIn",
  move_out: "calendar.settings.events.typeMoveOut",
};

export default function CalendarSettingsPage() {
  const { t } = useLocalizationContext();
  const [settings, setSettings] = useState<CalendarSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState("display");

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/calendar/settings");
      if (response.ok) {
        const result = await response.json();
        setSettings({ ...defaultSettings, ...(result?.data ?? {}) });
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      toast.error(t("calendar.settings.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = (path: string, value: unknown) => {
    setSettings((prev) => {
      const newSettings = { ...prev };
      const keys = path.split(".");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let current: any = newSettings;

      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i] as keyof typeof current];
      }

      current[keys[keys.length - 1] as keyof typeof current] = value;
      return newSettings;
    });
    setHasChanges(true);
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/calendar/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        toast.success(t("calendar.settings.saveSuccess"));
        setHasChanges(false);
      } else {
        const result = await response.json();
        toast.error(result?.error || t("calendar.settings.saveFailed"));
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(t("calendar.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const resetSettings = async () => {
    try {
      const response = await fetch("/api/calendar/settings", {
        method: "DELETE",
      });

      if (response.ok) {
        setSettings(defaultSettings);
        setHasChanges(false);
        toast.success(t("calendar.settings.resetSuccess"));
      } else {
        toast.error(t("calendar.settings.resetFailed"));
      }
    } catch (error) {
      console.error("Failed to reset settings:", error);
      toast.error(t("calendar.settings.resetFailed"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">
            {t("calendar.settings.loading")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("calendar.settings.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("calendar.settings.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resetSettings} disabled={saving}>
            <RotateCcw className="h-4 w-4 me-2" />
            {t("calendar.settings.resetToDefaults")}
          </Button>
          <Button
            onClick={saveSettings}
            disabled={!hasChanges || saving}
            className="bg-primary hover:bg-primary/90"
          >
            <Save className="h-4 w-4 me-2" />
            {saving
              ? t("calendar.settings.saving")
              : t("calendar.settings.saveChanges")}
          </Button>
        </div>
      </div>

      {/* Unsaved Changes Alert */}
      {hasChanges && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("calendar.settings.unsavedChanges")}</AlertTitle>
          <AlertDescription>
            {t("calendar.settings.unsavedChangesDesc")}
          </AlertDescription>
        </Alert>
      )}

      {/* Settings Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="display" className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            {t("calendar.settings.tabs.display")}
          </TabsTrigger>
          <TabsTrigger value="time" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t("calendar.settings.tabs.time")}
          </TabsTrigger>
          <TabsTrigger value="events" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t("calendar.settings.tabs.events")}
          </TabsTrigger>
          <TabsTrigger
            value="notifications"
            className="flex items-center gap-2"
          >
            <Bell className="h-4 w-4" />
            {t("calendar.settings.tabs.notifications")}
          </TabsTrigger>
          <TabsTrigger value="colors" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            {t("calendar.settings.tabs.colors")}
          </TabsTrigger>
        </TabsList>

        {/* Display Settings */}
        <TabsContent value="display" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                {t("calendar.settings.display.title")}
              </CardTitle>
              <CardDescription>
                {t("calendar.settings.display.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="defaultView">
                    {t("calendar.settings.display.defaultView")}
                  </Label>
                  <Select
                    value={settings.defaultView}
                    onValueChange={(value) =>
                      updateSetting("defaultView", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dayGridMonth">
                        {t("calendar.settings.display.viewMonth")}
                      </SelectItem>
                      <SelectItem value="timeGridWeek">
                        {t("calendar.settings.display.viewWeek")}
                      </SelectItem>
                      <SelectItem value="timeGridDay">
                        {t("calendar.settings.display.viewDay")}
                      </SelectItem>
                      <SelectItem value="listWeek">
                        {t("calendar.settings.display.viewAgenda")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="firstDay">
                    {t("calendar.settings.display.weekStartsOn")}
                  </Label>
                  <Select
                    value={settings.firstDay.toString()}
                    onValueChange={(value) =>
                      updateSetting("firstDay", parseInt(value))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">
                        {t("calendar.settings.display.sunday")}
                      </SelectItem>
                      <SelectItem value="1">
                        {t("calendar.settings.display.monday")}
                      </SelectItem>
                      <SelectItem value="2">
                        {t("calendar.settings.display.tuesday")}
                      </SelectItem>
                      <SelectItem value="3">
                        {t("calendar.settings.display.wednesday")}
                      </SelectItem>
                      <SelectItem value="4">
                        {t("calendar.settings.display.thursday")}
                      </SelectItem>
                      <SelectItem value="5">
                        {t("calendar.settings.display.friday")}
                      </SelectItem>
                      <SelectItem value="6">
                        {t("calendar.settings.display.saturday")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="weekends">
                    {t("calendar.settings.display.showWeekends")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("calendar.settings.display.showWeekendsDesc")}
                  </p>
                </div>
                <Switch
                  id="weekends"
                  checked={settings.weekends}
                  onCheckedChange={(checked) =>
                    updateSetting("weekends", checked)
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="showWeekNumbers">
                    {t("calendar.settings.display.showWeekNumbers")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("calendar.settings.display.showWeekNumbersDesc")}
                  </p>
                </div>
                <Switch
                  id="showWeekNumbers"
                  checked={settings.showWeekNumbers}
                  onCheckedChange={(checked) =>
                    updateSetting("showWeekNumbers", checked)
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="showDeclinedEvents">
                    {t("calendar.settings.display.showDeclinedEvents")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("calendar.settings.display.showDeclinedEventsDesc")}
                  </p>
                </div>
                <Switch
                  id="showDeclinedEvents"
                  checked={settings.showDeclinedEvents}
                  onCheckedChange={(checked) =>
                    updateSetting("showDeclinedEvents", checked)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="eventLimit">
                  {t("calendar.settings.display.eventsPerDay")}
                </Label>
                <Input
                  id="eventLimit"
                  type="number"
                  min="1"
                  max="10"
                  value={settings.eventLimit}
                  onChange={(e) =>
                    updateSetting("eventLimit", parseInt(e.target.value))
                  }
                  className="w-32"
                />
                <p className="text-sm text-muted-foreground">
                  {t("calendar.settings.display.eventsPerDayDesc")}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Time Settings */}
        <TabsContent value="time" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                {t("calendar.settings.time.title")}
              </CardTitle>
              <CardDescription>
                {t("calendar.settings.time.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="businessHours">
                    {t("calendar.settings.time.businessHours")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("calendar.settings.time.businessHoursDesc")}
                  </p>
                </div>
                <Switch
                  id="businessHours"
                  checked={settings.businessHours.enabled}
                  onCheckedChange={(checked) =>
                    updateSetting("businessHours.enabled", checked)
                  }
                />
              </div>

              {settings.businessHours.enabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 ps-6 border-s-2 border-muted">
                  <div className="space-y-2">
                    <Label htmlFor="startTime">
                      {t("calendar.settings.time.startTime")}
                    </Label>
                    <Input
                      id="startTime"
                      type="time"
                      value={settings.businessHours.startTime}
                      onChange={(e) =>
                        updateSetting("businessHours.startTime", e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="endTime">
                      {t("calendar.settings.time.endTime")}
                    </Label>
                    <Input
                      id="endTime"
                      type="time"
                      value={settings.businessHours.endTime}
                      onChange={(e) =>
                        updateSetting("businessHours.endTime", e.target.value)
                      }
                    />
                  </div>
                </div>
              )}

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="slotDuration">
                    {t("calendar.settings.time.slotDuration")}
                  </Label>
                  <Select
                    value={settings.slotDuration}
                    onValueChange={(value) =>
                      updateSetting("slotDuration", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="00:15">
                        {t("calendar.settings.time.15min")}
                      </SelectItem>
                      <SelectItem value="00:30">
                        {t("calendar.settings.time.30min")}
                      </SelectItem>
                      <SelectItem value="01:00">
                        {t("calendar.settings.time.1hour")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="snapDuration">
                    {t("calendar.settings.time.snapDuration")}
                  </Label>
                  <Select
                    value={settings.snapDuration}
                    onValueChange={(value) =>
                      updateSetting("snapDuration", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="00:15">
                        {t("calendar.settings.time.15min")}
                      </SelectItem>
                      <SelectItem value="00:30">
                        {t("calendar.settings.time.30min")}
                      </SelectItem>
                      <SelectItem value="01:00">
                        {t("calendar.settings.time.1hour")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultDuration">
                    {t("calendar.settings.time.defaultEventDuration")}
                  </Label>
                  <Select
                    value={settings.defaultEventDuration}
                    onValueChange={(value) =>
                      updateSetting("defaultEventDuration", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="00:30">
                        {t("calendar.settings.time.30min")}
                      </SelectItem>
                      <SelectItem value="01:00">
                        {t("calendar.settings.time.1hour")}
                      </SelectItem>
                      <SelectItem value="02:00">
                        {t("calendar.settings.time.2hours")}
                      </SelectItem>
                      <SelectItem value="04:00">
                        {t("calendar.settings.time.4hours")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Event Settings */}
        <TabsContent value="events" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                {t("calendar.settings.events.title")}
              </CardTitle>
              <CardDescription>
                {t("calendar.settings.events.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="defaultEventType">
                    {t("calendar.settings.events.defaultType")}
                  </Label>
                  <Select
                    value={settings.defaultEventType}
                    onValueChange={(value) =>
                      updateSetting("defaultEventType", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GENERAL">
                        {t("calendar.settings.events.typeGeneral")}
                      </SelectItem>
                      <SelectItem value="PROPERTY_SHOWING">
                        {t("calendar.settings.events.typePropertyShowing")}
                      </SelectItem>
                      <SelectItem value="PROPERTY_INSPECTION">
                        {t("calendar.settings.events.typePropertyInspection")}
                      </SelectItem>
                      <SelectItem value="MAINTENANCE_APPOINTMENT">
                        {t("calendar.settings.events.typeMaintenance")}
                      </SelectItem>
                      <SelectItem value="TENANT_MEETING">
                        {t("calendar.settings.events.typeTenantMeeting")}
                      </SelectItem>
                      <SelectItem value="LEASE_RENEWAL">
                        {t("calendar.settings.events.typeLeaseRenewal")}
                      </SelectItem>
                      <SelectItem value="RENT_COLLECTION">
                        {t("calendar.settings.events.typeRentCollection")}
                      </SelectItem>
                      <SelectItem value="MOVE_IN">
                        {t("calendar.settings.events.typeMoveIn")}
                      </SelectItem>
                      <SelectItem value="MOVE_OUT">
                        {t("calendar.settings.events.typeMoveOut")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultEventPriority">
                    {t("calendar.settings.events.defaultPriority")}
                  </Label>
                  <Select
                    value={settings.defaultEventPriority}
                    onValueChange={(value) =>
                      updateSetting("defaultEventPriority", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">
                        {t("calendar.settings.events.priorityLow")}
                      </SelectItem>
                      <SelectItem value="MEDIUM">
                        {t("calendar.settings.events.priorityMedium")}
                      </SelectItem>
                      <SelectItem value="HIGH">
                        {t("calendar.settings.events.priorityHigh")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("calendar.settings.events.defaultReminders")}</Label>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 15, 30, 60, 120, 1440].map((minutes) => {
                    const isSelected =
                      settings.defaultReminders.includes(minutes);
                    const label =
                      minutes === 5
                        ? t("calendar.settings.events.reminder5min")
                        : minutes === 10
                          ? t("calendar.settings.events.reminder10min")
                          : minutes === 15
                            ? t("calendar.settings.events.reminder15min")
                            : minutes === 30
                              ? t("calendar.settings.events.reminder30min")
                              : minutes === 60
                                ? t("calendar.settings.events.reminder1hour")
                                : minutes === 120
                                  ? t("calendar.settings.events.reminder2hours")
                                  : t("calendar.settings.events.reminder1day");

                    return (
                      <Badge
                        key={minutes}
                        variant={isSelected ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => {
                          const newReminders = isSelected
                            ? settings.defaultReminders.filter(
                                (r) => r !== minutes,
                              )
                            : [...settings.defaultReminders, minutes].sort(
                                (a, b) => a - b,
                              );
                          updateSetting("defaultReminders", newReminders);
                        }}
                      >
                        {label}
                      </Badge>
                    );
                  })}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("calendar.settings.events.remindersDesc")}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notification Settings */}
        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                {t("calendar.settings.notifications.title")}
              </CardTitle>
              <CardDescription>
                {t("calendar.settings.notifications.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="invitations">
                      {t("calendar.settings.notifications.invitations")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("calendar.settings.notifications.invitationsDesc")}
                    </p>
                  </div>
                  <Switch
                    id="invitations"
                    checked={settings.emailNotifications.invitations}
                    onCheckedChange={(checked) =>
                      updateSetting("emailNotifications.invitations", checked)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="reminders">
                      {t("calendar.settings.notifications.reminders")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("calendar.settings.notifications.remindersDesc")}
                    </p>
                  </div>
                  <Switch
                    id="reminders"
                    checked={settings.emailNotifications.reminders}
                    onCheckedChange={(checked) =>
                      updateSetting("emailNotifications.reminders", checked)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="updates">
                      {t("calendar.settings.notifications.updates")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("calendar.settings.notifications.updatesDesc")}
                    </p>
                  </div>
                  <Switch
                    id="updates"
                    checked={settings.emailNotifications.updates}
                    onCheckedChange={(checked) =>
                      updateSetting("emailNotifications.updates", checked)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="cancellations">
                      {t("calendar.settings.notifications.cancellations")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("calendar.settings.notifications.cancellationsDesc")}
                    </p>
                  </div>
                  <Switch
                    id="cancellations"
                    checked={settings.emailNotifications.cancellations}
                    onCheckedChange={(checked) =>
                      updateSetting("emailNotifications.cancellations", checked)
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Color Settings */}
        <TabsContent value="colors" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                {t("calendar.settings.colors.title")}
              </CardTitle>
              <CardDescription>
                {t("calendar.settings.colors.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {Object.entries(settings.eventColors).map(([type, color]) => (
                <div key={type} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-6 h-6 rounded border"
                      style={{ backgroundColor: color }}
                    />
                    <Label className="font-medium">
                      {t(
                        EVENT_TYPE_LABEL_KEYS[type.toLowerCase()] ??
                          "calendar.settings.events.typeGeneral",
                        { defaultValue: type.replace(/_/g, " ") },
                      )}
                    </Label>
                  </div>
                  <Input
                    type="color"
                    value={color}
                    onChange={(e) =>
                      updateSetting(`eventColors.${type}`, e.target.value)
                    }
                    className="w-16 h-8 p-1 border rounded"
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
