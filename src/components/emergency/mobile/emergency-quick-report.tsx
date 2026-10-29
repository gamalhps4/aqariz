/**
 * PropertyPro - Emergency Quick Report (Mobile)
 * Mobile-optimized emergency reporting with one-tap actions
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Zap,
  Camera,
  Phone,
  MapPin,
  Clock,
  Send,
  Mic,
  X,
} from "lucide-react";
import { toast } from "sonner";

interface EmergencyQuickReportProps {
  onSubmit: (data: any) => Promise<void>;
  onCancel?: () => void;
  properties?: Array<{
    id: string;
    name: string;
    address: string;
  }>;
}

const EMERGENCY_TYPES = [
  { value: "water_leak", label: "💧 Water Leak", priority: "high" },
  {
    value: "electrical_hazard",
    label: "⚡ Electrical Hazard",
    priority: "critical",
  },
  { value: "gas_leak", label: "🔥 Gas Leak", priority: "critical" },
  { value: "security_breach", label: "🔒 Security Issue", priority: "high" },
  { value: "fire_hazard", label: "🔥 Fire Hazard", priority: "critical" },
  {
    value: "structural_damage",
    label: "🏗️ Structural Damage",
    priority: "high",
  },
  { value: "hvac_failure", label: "❄️ HVAC Failure", priority: "medium" },
  { value: "other", label: "⚠️ Other Emergency", priority: "medium" },
];

export function EmergencyQuickReport({
  onSubmit,
  onCancel,
  properties = [],
}: EmergencyQuickReportProps) {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    emergencyType: "",
    propertyId: "",
    title: "",
    description: "",
    contactPhone: "",
    images: [] as string[],
    location: "",
    immediateAction: "",
  });

  const [isRecording, setIsRecording] = useState(false);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);

  const handleQuickSelect = (emergencyType: string) => {
    const emergency = EMERGENCY_TYPES.find((e) => e.value === emergencyType);
    setFormData((prev) => ({
      ...prev,
      emergencyType,
      title: emergency?.label.split(" ").slice(1).join(" ") || "",
    }));
    setStep(2);
  };

  const handleImageCapture = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files) return;

    const newImages: string[] = [];
    for (const file of Array.from(files)) {
      // Create a preview URL
      const imageUrl = URL.createObjectURL(file);
      newImages.push(imageUrl);
    }

    setCapturedImages((prev) => [...prev, ...newImages]);
    setFormData((prev) => ({
      ...prev,
      images: [...prev.images, ...newImages],
    }));
  };

  const removeImage = (index: number) => {
    setCapturedImages((prev) => prev.filter((_, i) => i !== index));
    setFormData((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
  };

  const handleVoiceNote = () => {
    if (!isRecording) {
      // Start recording
      setIsRecording(true);
      toast.info("Voice recording started...");

      // Mock voice recording - in real app, implement actual voice recording
      setTimeout(() => {
        setIsRecording(false);
        setFormData((prev) => ({
          ...prev,
          description: prev.description + " [Voice note recorded]",
        }));
        toast.success("Voice note added");
      }, 3000);
    } else {
      // Stop recording
      setIsRecording(false);
      toast.success("Voice note saved");
    }
  };

  const handleSubmit = async () => {
    if (!formData.emergencyType || !formData.propertyId) {
      toast.error("Please fill in all required fields");
      return;
    }

    setLoading(true);
    try {
      await onSubmit({
        ...formData,
        priority: "emergency",
        category: "Emergency",
      });
      toast.success("Emergency reported successfully!");
    } catch (error) {
      toast.error("Failed to report emergency");
    } finally {
      setLoading(false);
    }
  };

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setFormData((prev) => ({
            ...prev,
            location: `${latitude}, ${longitude}`,
          }));
          toast.success("Location captured");
        },
        () => {
          toast.error("Unable to get location");
        }
      );
    }
  };

  if (step === 1) {
    return (
      <div className="min-h-screen bg-red-50 p-4">
        <Card className="border-red-200">
          <CardHeader className="text-center">
            <CardTitle className="text-red-700 flex items-center justify-center gap-2">
              <Zap className="h-6 w-6" />
              Report Emergency
            </CardTitle>
            <p className="text-sm text-red-600">
              Select the type of emergency you're reporting
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {EMERGENCY_TYPES.map((emergency) => (
              <Button
                key={emergency.value}
                variant="outline"
                className={`w-full h-16 text-start justify-start text-base ${
                  emergency.priority === "critical"
                    ? "border-red-300 hover:bg-red-50"
                    : emergency.priority === "high"
                    ? "border-orange-300 hover:bg-orange-50"
                    : "border-yellow-300 hover:bg-yellow-50"
                }`}
                onClick={() => handleQuickSelect(emergency.value)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">
                    {emergency.label.split(" ")[0]}
                  </span>
                  <div>
                    <div className="font-medium">
                      {emergency.label.split(" ").slice(1).join(" ")}
                    </div>
                    <div
                      className={`text-xs ${
                        emergency.priority === "critical"
                          ? "text-red-600"
                          : emergency.priority === "high"
                          ? "text-orange-600"
                          : "text-yellow-600"
                      }`}
                    >
                      {emergency.priority.toUpperCase()} PRIORITY
                    </div>
                  </div>
                </div>
              </Button>
            ))}

            {onCancel && (
              <Button
                variant="ghost"
                className="w-full mt-4"
                onClick={onCancel}
              >
                Cancel
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-red-50 p-4">
      <Card className="border-red-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              ← Back
            </Button>
            <CardTitle className="text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Emergency Details
            </CardTitle>
            {onCancel && (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Property Selection */}
          <div>
            <label className="text-sm font-medium text-red-700">
              Property *
            </label>
            <Select
              value={formData.propertyId}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, propertyId: value }))
              }
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select property" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    <div>
                      <div className="font-medium">{property.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {property.address}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quick Description */}
          <div>
            <label className="text-sm font-medium text-red-700">
              What's happening? *
            </label>
            <Textarea
              placeholder="Describe the emergency situation..."
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              className="mt-1 min-h-[80px]"
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={handleVoiceNote}
              disabled={isRecording}
            >
              <Mic
                className={`me-2 h-4 w-4 ${
                  isRecording ? "animate-pulse text-red-500" : ""
                }`}
              />
              {isRecording ? "Recording..." : "Add Voice Note"}
            </Button>
          </div>

          {/* Contact Phone */}
          <div>
            <label className="text-sm font-medium text-red-700">
              Contact Phone
            </label>
            <Input
              type="tel"
              placeholder="Your phone number"
              value={formData.contactPhone}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  contactPhone: e.target.value,
                }))
              }
              className="mt-1"
            />
          </div>

          {/* Location */}
          <div>
            <label className="text-sm font-medium text-red-700">Location</label>
            <div className="flex gap-2 mt-1">
              <Input
                placeholder="Specific location (e.g., Unit 204, Basement)"
                value={formData.location}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, location: e.target.value }))
                }
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={getCurrentLocation}>
                <MapPin className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Photo Capture */}
          <div>
            <label className="text-sm font-medium text-red-700">Photos</label>
            <div className="mt-1">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handleImageCapture}
                className="hidden"
                id="camera-input"
              />
              <label htmlFor="camera-input">
                <Button variant="outline" className="w-full" asChild>
                  <div className="cursor-pointer">
                    <Camera className="me-2 h-4 w-4" />
                    Take Photos
                  </div>
                </Button>
              </label>
            </div>

            {capturedImages.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {capturedImages.map((image, index) => (
                  <div key={index} className="relative">
                    <img
                      src={image}
                      alt={`Emergency photo ${index + 1}`}
                      className="w-full h-20 object-cover rounded border"
                    />
                    <button
                      onClick={() => removeImage(index)}
                      className="absolute -top-1 -end-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Immediate Action */}
          <div>
            <label className="text-sm font-medium text-red-700">
              Action Taken
            </label>
            <Textarea
              placeholder="What have you done so far? (e.g., turned off water, evacuated area)"
              value={formData.immediateAction}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  immediateAction: e.target.value,
                }))
              }
              className="mt-1 min-h-[60px]"
            />
          </div>

          {/* Submit Button */}
          <div className="space-y-2 pt-4">
            <Button
              onClick={handleSubmit}
              disabled={
                loading || !formData.emergencyType || !formData.propertyId
              }
              className="w-full bg-red-600 hover:bg-red-700 text-white h-12 text-lg"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white me-2" />
              ) : (
                <Send className="me-2 h-5 w-5" />
              )}
              {loading ? "Reporting..." : "Report Emergency"}
            </Button>

            <div className="text-center">
              <Button variant="ghost" size="sm" asChild>
                <a href="tel:911" className="text-red-600">
                  <Phone className="me-2 h-4 w-4" />
                  Call 911 for Life-Threatening Emergencies
                </a>
              </Button>
            </div>
          </div>

          {/* Emergency Timer */}
          <div className="bg-red-100 border border-red-200 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-2 text-red-700">
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">
                Emergency response team will be notified immediately
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
