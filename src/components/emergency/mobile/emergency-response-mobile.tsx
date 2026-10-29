/**
 * PropertyPro - Emergency Response Mobile
 * Mobile interface for emergency responders with quick actions and real-time updates
 */

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle,
  Phone,
  MapPin,
  Camera,
  Navigation,
  MessageSquare,
  User,
  Zap,
  Play,
  Pause,
  Square,
  Send,
  ArrowUp,
} from "lucide-react";
import { toast } from "sonner";

interface EmergencyRequest {
  _id: string;
  title: string;
  description: string;
  status: string;
  urgencyLevel: "normal" | "overdue" | "critical";
  property: {
    name: string;
    address: string;
    coordinates?: { lat: number; lng: number };
  };
  tenant: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
  };
  createdAt: string;
  hoursSinceCreation: number;
  estimatedCost?: number;
}

interface EmergencyResponseMobileProps {
  request: EmergencyRequest;
  onStatusUpdate: (status: string, data?: any) => void;
  onEscalate: (reason: string) => void;
}

export function EmergencyResponseMobile({
  request,
  onStatusUpdate,
  onEscalate,
}: EmergencyResponseMobileProps) {
  const [currentStatus, setCurrentStatus] = useState(request.status);
  const [timer, setTimer] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showEscalateDialog, setShowEscalateDialog] = useState(false);
  const [updateNotes, setUpdateNotes] = useState("");
  const [escalationReason, setEscalationReason] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [responseImages, setResponseImages] = useState<string[]>([]);

  // Timer for tracking work time
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStatusChange = (newStatus: string) => {
    setCurrentStatus(newStatus);

    if (newStatus === "in_progress") {
      setIsTimerRunning(true);
    } else if (newStatus === "completed") {
      setIsTimerRunning(false);
      setShowUpdateDialog(true);
      return;
    }

    onStatusUpdate(newStatus);
    toast.success(`Status updated to ${newStatus.replace("_", " ")}`);
  };

  const handleCompleteWork = () => {
    const data = {
      notes: updateNotes,
      workDuration: timer,
      images: responseImages,
      ...(estimatedCost && { estimatedCost: parseFloat(estimatedCost) }),
    };

    onStatusUpdate("completed", data);
    setShowUpdateDialog(false);
    toast.success("Emergency marked as completed");
  };

  const handleEscalate = () => {
    if (!escalationReason.trim()) {
      toast.error("Please provide an escalation reason");
      return;
    }

    onEscalate(escalationReason);
    setShowEscalateDialog(false);
    toast.success("Emergency escalated successfully");
  };

  const handleImageCapture = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newImages: string[] = [];
    for (const file of Array.from(files)) {
      const imageUrl = URL.createObjectURL(file);
      newImages.push(imageUrl);
    }

    setResponseImages((prev) => [...prev, ...newImages]);
  };

  const openMaps = () => {
    const address = encodeURIComponent(request.property.address);
    const mapsUrl = `https://maps.google.com/maps?q=${address}`;
    window.open(mapsUrl, "_blank");
  };

  const getUrgencyColor = (urgencyLevel: string) => {
    switch (urgencyLevel) {
      case "critical":
        return "bg-red-500 text-white animate-pulse";
      case "overdue":
        return "bg-orange-500 text-white";
      default:
        return "bg-yellow-500 text-white";
    }
  };

  const getStatusActions = () => {
    switch (currentStatus) {
      case "submitted":
        return [
          {
            label: "Accept Emergency",
            action: () => handleStatusChange("assigned"),
            variant: "destructive" as const,
            icon: CheckCircle,
          },
        ];
      case "assigned":
        return [
          {
            label: "Start Response",
            action: () => handleStatusChange("in_progress"),
            variant: "default" as const,
            icon: Play,
          },
        ];
      case "in_progress":
        return [
          {
            label: "Complete Work",
            action: () => handleStatusChange("completed"),
            variant: "default" as const,
            icon: CheckCircle,
          },
          {
            label: isTimerRunning ? "Pause Timer" : "Resume Timer",
            action: () => setIsTimerRunning(!isTimerRunning),
            variant: "outline" as const,
            icon: isTimerRunning ? Pause : Play,
          },
        ];
      default:
        return [];
    }
  };

  return (
    <div className="min-h-screen bg-red-50 p-4">
      {/* Header */}
      <Card className="border-red-200 mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-red-700 flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Emergency Response
            </CardTitle>
            <Badge className={getUrgencyColor(request.urgencyLevel)}>
              {request.urgencyLevel.toUpperCase()}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <h2 className="font-semibold text-lg">{request.title}</h2>
          <p className="text-sm text-gray-600">{request.description}</p>

          {/* Timer */}
          {currentStatus === "in_progress" && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {formatTime(timer)}
              </div>
              <div className="text-xs text-blue-700">Work Time</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Property & Contact Info */}
      <Card className="border-red-200 mb-4">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-red-600" />
              <div>
                <div className="font-medium">{request.property.name}</div>
                <div className="text-sm text-gray-600">
                  {request.property.address}
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={openMaps}>
              <Navigation className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-red-600" />
              <div>
                <div className="font-medium">
                  {request.tenant.firstName} {request.tenant.lastName}
                </div>
                <div className="text-sm text-gray-600">
                  {request.tenant.email}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={`tel:${request.tenant.phone}`}>
                  <Phone className="h-4 w-4" />
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`sms:${request.tenant.phone}`}>
                  <MessageSquare className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Actions */}
      <Card className="border-red-200 mb-4">
        <CardContent className="p-4">
          <div className="space-y-3">
            <h3 className="font-medium">Quick Actions</h3>
            <div className="grid gap-2">
              {getStatusActions().map((action, index) => {
                const Icon = action.icon;
                return (
                  <Button
                    key={index}
                    variant={action.variant}
                    className="w-full h-12 text-start justify-start"
                    onClick={action.action}
                  >
                    <Icon className="me-3 h-5 w-5" />
                    {action.label}
                  </Button>
                );
              })}

              <Button
                variant="outline"
                className="w-full h-12 text-start justify-start border-orange-300"
                onClick={() => setShowEscalateDialog(true)}
              >
                <ArrowUp className="me-3 h-5 w-5" />
                Escalate Emergency
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Photo Capture */}
      <Card className="border-red-200 mb-4">
        <CardContent className="p-4">
          <h3 className="font-medium mb-3">Document Progress</h3>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={handleImageCapture}
            className="hidden"
            id="response-camera"
          />
          <label htmlFor="response-camera">
            <Button variant="outline" className="w-full" asChild>
              <div className="cursor-pointer">
                <Camera className="me-2 h-4 w-4" />
                Take Progress Photos
              </div>
            </Button>
          </label>

          {responseImages.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              {responseImages.map((image, index) => (
                <img
                  key={index}
                  src={image}
                  alt={`Progress photo ${index + 1}`}
                  className="w-full h-20 object-cover rounded border"
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Emergency Info */}
      <Card className="border-red-200">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-lg font-bold text-red-600">
                {Math.round(request.hoursSinceCreation)}h
              </div>
              <div className="text-xs text-gray-600">Time Elapsed</div>
            </div>
            <div>
              <div className="text-lg font-bold text-blue-600">
                {new Date(request.createdAt).toLocaleTimeString()}
              </div>
              <div className="text-xs text-gray-600">Reported At</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Completion Dialog */}
      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Emergency</DialogTitle>
            <DialogDescription>
              Provide details about the completed work
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Work Completed</label>
              <Textarea
                placeholder="Describe the work completed..."
                value={updateNotes}
                onChange={(e) => setUpdateNotes(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Estimated Cost</label>
              <Input
                type="number"
                placeholder="0.00"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowUpdateDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCompleteWork}>Complete Emergency</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Escalation Dialog */}
      <Dialog open={showEscalateDialog} onOpenChange={setShowEscalateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escalate Emergency</DialogTitle>
            <DialogDescription>
              Provide a reason for escalating this emergency
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-sm font-medium">Escalation Reason</label>
            <Textarea
              placeholder="Why is this emergency being escalated?"
              value={escalationReason}
              onChange={(e) => setEscalationReason(e.target.value)}
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEscalateDialog(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleEscalate}>
              Escalate Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
