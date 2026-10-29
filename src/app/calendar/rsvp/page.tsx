"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Calendar,
  Clock,
  MapPin,
  User,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Mail,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface EventDetails {
  _id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  location?: {
    type: string;
    address?: string;
    platform?: string;
    meetingLink?: string;
    meetingId?: string;
    passcode?: string;
  };
  type: string;
  allDay: boolean;
  organizer: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

interface AttendeeDetails {
  _id?: string;
  firstName: string;
  lastName: string;
  email: string;
  isExternal?: boolean;
}

interface RSVPData {
  event: EventDetails;
  attendee?: AttendeeDetails; // Optional for external users
  currentResponse?: string;
  respondedAt?: string;
  isExternal?: boolean;
  email?: string; // For external users
}

// Helper function to format location for display
function formatEventLocation(location?: EventDetails["location"]): string {
  if (!location) return "";

  if (location.type === "physical" && location.address) {
    return location.address;
  }

  if (location.type === "online") {
    if (location.meetingLink) {
      return location.meetingLink;
    }
    if (location.platform) {
      return `${location.platform}${
        location.meetingId ? ` (ID: ${location.meetingId})` : ""
      }`;
    }
  }

  return "";
}

function RSVPContent() {
  const searchParams = useSearchParams();
  const { t, formatDate, formatTime, isRTL } = useLocalizationContext();
  const responseLabel = (response: string) =>
    t(`calendar.rsvp.response.${response}`, { defaultValue: response });
  const token = searchParams.get("token");
  const quickResponse = searchParams.get("response") as
    | "accepted"
    | "declined"
    | "tentative"
    | null;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rsvpData, setRsvpData] = useState<RSVPData | null>(null);
  const [selectedResponse, setSelectedResponse] = useState<
    "accepted" | "declined" | "tentative" | null
  >(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (token) {
      if (quickResponse) {
        // Process quick response from email
        handleQuickResponse(quickResponse);
      } else {
        // Load RSVP details
        loadRSVPDetails();
      }
    } else {
      setError(t("calendar.rsvp.invalidLink", { defaultValue: "This invitation link is not valid" }));
      setLoading(false);
    }
  }, [token, quickResponse]);

  const loadRSVPDetails = async () => {
    try {
      const response = await fetch(`/api/calendar/rsvp?token=${token}`);
      const result = await response.json();

      if (response.ok) {
        setRsvpData(result.data);
        setSelectedResponse(result.data.currentResponse || null);
      } else {
        setError(result.error || t("calendar.rsvp.loadFailed", { defaultValue: "Could not load the invitation" }));
      }
    } catch (error) {
      console.error("Error loading RSVP details:", error);
      setError(t("calendar.rsvp.loadFailed", { defaultValue: "Could not load the invitation" }));
    } finally {
      setLoading(false);
    }
  };

  const handleQuickResponse = async (
    response: "accepted" | "declined" | "tentative"
  ) => {
    setSubmitting(true);
    try {
      const apiResponse = await fetch(
        `/api/calendar/rsvp?token=${token}&response=${response}`
      );
      const result = await apiResponse.json();

      if (apiResponse.ok) {
        setRsvpData(result.data);
        setSelectedResponse(response);
        setSuccess(true);
        toast.success(t("calendar.rsvp.recorded", { defaultValue: "Your reply has been recorded" }));
      } else {
        setError(result.error || t("calendar.rsvp.sendFailed", { defaultValue: "Could not send your reply" }));
      }
    } catch (error) {
      console.error("Error processing quick response:", error);
      setError(t("calendar.rsvp.sendFailed", { defaultValue: "Could not send your reply" }));
    } finally {
      setLoading(false);
      setSubmitting(false);
    }
  };

  const handleSubmitResponse = async () => {
    if (!selectedResponse) {
      toast.error(t("calendar.rsvp.pick", { defaultValue: "Choose a reply first" }));
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/calendar/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          response: selectedResponse,
          message: message.trim() || undefined,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setSuccess(true);
        toast.success(t("calendar.rsvp.recorded", { defaultValue: "Your reply has been recorded" }));
      } else {
        setError(result.error || t("calendar.rsvp.sendFailed", { defaultValue: "Could not send your reply" }));
        toast.error(t("calendar.rsvp.sendFailed", { defaultValue: "Could not send your reply" }));
      }
    } catch (error) {
      console.error("Error submitting RSVP:", error);
      setError(t("calendar.rsvp.sendFailed", { defaultValue: "Could not send your reply" }));
      toast.error(t("calendar.rsvp.sendFailed", { defaultValue: "Could not send your reply" }));
    } finally {
      setSubmitting(false);
    }
  };

  const formatEventTime = (event: EventDetails) => {
    if (event.allDay)
      return t("calendar.rsvp.allDay", { defaultValue: "All day" });
    const start = formatTime(event.startDate);
    const end = event.endDate ? formatTime(event.endDate) : "";
    return end ? `${start} – ${end}` : start;
  };

  const getResponseIcon = (response: string) => {
    switch (response) {
      case "accepted":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "declined":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "tentative":
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getResponseColor = (response: string) => {
    switch (response) {
      case "accepted":
        return "bg-green-100 text-green-800 border-green-200";
      case "declined":
        return "bg-red-100 text-red-800 border-red-200";
      case "tentative":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">
            {t("calendar.rsvp.loading", { defaultValue: "Loading the invitation…" })}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div dir={isRTL ? "rtl" : "ltr"} className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">
                {t("calendar.rsvp.errorTitle", { defaultValue: "Something went wrong" })}
              </h2>
              <p className="text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success && rsvpData) {
    return (
      <div dir={isRTL ? "rtl" : "ltr"} className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-2xl">
          <CardContent className="pt-6">
            <div className="text-center mb-6">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">
                {t("calendar.rsvp.doneTitle", { defaultValue: "Reply recorded" })}
              </h2>
              <p className="text-muted-foreground">
                {t("calendar.rsvp.doneBody", { defaultValue: "Thank you for replying to the invitation." })}
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">{rsvpData.event.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(rsvpData.event.startDate, { format: "full" })} ·{" "}
                    {formatEventTime(rsvpData.event)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {getResponseIcon(selectedResponse!)}
                  <Badge className={getResponseColor(selectedResponse!)}>
                    {responseLabel(selectedResponse!)}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">
                {(rsvpData.isExternal
                  ? rsvpData.email
                  : rsvpData.attendee?.email || rsvpData.email)
                  ? t("calendar.rsvp.confirmationTo", { defaultValue: "A confirmation was sent to {email}", values: { email: (rsvpData.isExternal ? rsvpData.email : rsvpData.attendee?.email || rsvpData.email) as string } })
                  : t("calendar.rsvp.confirmationSent", { defaultValue: "A confirmation was sent to your email" })}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!rsvpData) {
    return null;
  }

  return (
    <div dir={isRTL ? "rtl" : "ltr"} className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {t("calendar.rsvp.title", { defaultValue: "Invitation" })}
            </CardTitle>
            <CardDescription>
              {t("calendar.rsvp.subtitle", { defaultValue: "You have been invited to this event. Reply below." })}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Event Details */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-blue-900 mb-3">
                {rsvpData.event.title}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-600" />
                  <span>{formatDate(rsvpData.event.startDate, { format: "full" })}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span>{formatEventTime(rsvpData.event)}</span>
                </div>

                {rsvpData.event.location &&
                  formatEventLocation(rsvpData.event.location) && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-blue-600" />
                      <span>
                        {formatEventLocation(rsvpData.event.location)}
                      </span>
                    </div>
                  )}

                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-blue-600" />
                  <span>
                    {rsvpData.event.organizer.firstName}{" "}
                    {rsvpData.event.organizer.lastName}
                  </span>
                </div>
              </div>

              {rsvpData.event.description && (
                <div className="mt-4">
                  <p className="text-sm text-blue-800">
                    {rsvpData.event.description}
                  </p>
                </div>
              )}
            </div>

            {/* Current Response */}
            {rsvpData.currentResponse && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t("calendar.rsvp.current", { defaultValue: "Your current reply:" })}
                </span>
                <div className="flex items-center gap-1">
                  {getResponseIcon(rsvpData.currentResponse)}
                  <Badge className={getResponseColor(rsvpData.currentResponse)}>
                    {responseLabel(rsvpData.currentResponse)}
                  </Badge>
                </div>
                {rsvpData.respondedAt && (
                  <span className="text-muted-foreground">
                    {t("calendar.rsvp.on", { defaultValue: "on {date}", values: { date: formatDate(rsvpData.respondedAt) } })}
                  </span>
                )}
              </div>
            )}

            <Separator />

            {/* Response Options */}
            <div className="space-y-4">
              <Label className="text-base font-medium">
                {t("calendar.rsvp.yours", { defaultValue: "Your reply" })}
              </Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Button
                  variant={
                    selectedResponse === "accepted" ? "default" : "outline"
                  }
                  onClick={() => setSelectedResponse("accepted")}
                  className="flex items-center gap-2 h-auto py-3"
                >
                  <CheckCircle className="h-4 w-4" />
                  {t("calendar.rsvp.accept", { defaultValue: "Accept" })}
                </Button>
                <Button
                  variant={
                    selectedResponse === "tentative" ? "default" : "outline"
                  }
                  onClick={() => setSelectedResponse("tentative")}
                  className="flex items-center gap-2 h-auto py-3"
                >
                  <AlertTriangle className="h-4 w-4" />
                  {t("calendar.rsvp.maybe", { defaultValue: "Maybe" })}
                </Button>
                <Button
                  variant={
                    selectedResponse === "declined" ? "default" : "outline"
                  }
                  onClick={() => setSelectedResponse("declined")}
                  className="flex items-center gap-2 h-auto py-3"
                >
                  <XCircle className="h-4 w-4" />
                  {t("calendar.rsvp.decline", { defaultValue: "Decline" })}
                </Button>
              </div>
            </div>

            {/* Optional Message */}
            <div className="space-y-2">
              <Label htmlFor="message" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                {t("calendar.rsvp.message", { defaultValue: "Message (optional)" })}
              </Label>
              <Textarea
                id="message"
                placeholder={t("calendar.rsvp.messagePlaceholder", { defaultValue: "A note for the organizer…" })}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
              />
            </div>

            {/* Submit Button */}
            <div className="flex justify-end">
              <Button
                onClick={handleSubmitResponse}
                disabled={!selectedResponse || submitting}
                className="min-w-32"
              >
                {submitting
                  ? t("calendar.rsvp.sending", { defaultValue: "Sending…" })
                  : t("calendar.rsvp.send", { defaultValue: "Send reply" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function RSVPPage() {
  const { t } = useLocalizationContext();
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">
              {t("calendar.rsvp.loading", { defaultValue: "Loading the invitation…" })}
            </p>
          </div>
        </div>
      }
    >
      <RSVPContent />
    </Suspense>
  );
}
