"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Star,
  Home,
  Car,
  Shield,
  Wifi,
  Zap,
  Trees,
  Utensils,
  Bath,
  Bed,
  Building,
} from "lucide-react";
import { toast } from "sonner";
import { propertyService } from "@/lib/services/property.service";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface Amenity {
  name: string;
  description?: string;
  category: string;
}

interface PropertyAmenitiesProps {
  amenities: Amenity[];
  canEdit: boolean;
  onAmenitiesUpdate: (newAmenities: Amenity[]) => void;
  propertyId: string;
}

const amenityCategories = [
  "Kitchen",
  "Bathroom",
  "Living",
  "Bedroom",
  "Outdoor",
  "Parking",
  "Security",
  "Utilities",
  "Recreation",
  "Laundry",
  "Climate",
  "Other",
];

const categoryIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  Kitchen: Utensils,
  Bathroom: Bath,
  Living: Home,
  Bedroom: Bed,
  Outdoor: Trees,
  Parking: Car,
  Security: Shield,
  Utilities: Zap,
  Recreation: Star,
  Other: Building,
};

const categoryLabelKeyMap: Record<string, string> = {
  Kitchen: "properties.amenities.categories.kitchen",
  Bathroom: "properties.amenities.categories.bathroom",
  Living: "properties.amenities.categories.living",
  Bedroom: "properties.amenities.categories.bedroom",
  Outdoor: "properties.amenities.categories.outdoor",
  Parking: "properties.amenities.categories.parking",
  Security: "properties.amenities.categories.security",
  Utilities: "properties.amenities.categories.utilities",
  Recreation: "properties.amenities.categories.recreation",
  Laundry: "properties.amenities.categories.laundry",
  Climate: "properties.amenities.categories.climate",
  Other: "properties.amenities.categories.other",
};

const PropertyAmenities: React.FC<PropertyAmenitiesProps> = ({
  amenities,
  canEdit,
  onAmenitiesUpdate,
  propertyId,
}) => {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [amenityToDelete, setAmenityToDelete] = useState<string | null>(null);
  const [newAmenity, setNewAmenity] = useState({
    name: "",
    description: "",
    category: "",
  });
  const [loading, setLoading] = useState(false);
  const { t } = useLocalizationContext();

  const handleAddAmenity = async () => {
    if (!newAmenity.name.trim() || !newAmenity.category) {
      toast.error(t("properties.amenities.validation.requiredFields"));
      return;
    }

    try {
      setLoading(true);
      const amenityData = {
        name: newAmenity.name.trim(),
        description: newAmenity.description.trim() || undefined,
        category: newAmenity.category,
      };

      const response = await propertyService.addPropertyAmenities(propertyId, [
        amenityData,
      ]);
      onAmenitiesUpdate(response.amenities);
      setNewAmenity({ name: "", description: "", category: "" });
      setShowAddDialog(false);
      toast.success(t("properties.amenities.toasts.addSuccess"));
    } catch (error: any) {
      toast.error(error.message || t("properties.amenities.toasts.addError"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAmenity = async () => {
    if (!amenityToDelete) return;

    try {
      setLoading(true);
      const response = await propertyService.removePropertyAmenities(
        propertyId,
        [amenityToDelete]
      );
      onAmenitiesUpdate(response.amenities);
      setAmenityToDelete(null);
      setShowDeleteDialog(false);
      toast.success(t("properties.amenities.toasts.removeSuccess"));
    } catch (error: any) {
      toast.error(
        error.message || t("properties.amenities.toasts.removeError")
      );
    } finally {
      setLoading(false);
    }
  };

  const openDeleteDialog = (amenityName: string) => {
    setAmenityToDelete(amenityName);
    setShowDeleteDialog(true);
  };

  const handleDeleteCancel = () => {
    setShowDeleteDialog(false);
    setAmenityToDelete(null);
  };

  const groupedAmenities = amenities.reduce((acc, amenity) => {
    if (!acc[amenity.category]) {
      acc[amenity.category] = [];
    }
    acc[amenity.category].push(amenity);
    return acc;
  }, {} as Record<string, Amenity[]>);

  if (amenities.length === 0 && !canEdit) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Star className="h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {t("properties.amenities.empty.title")}
          </h3>
          <p className="text-gray-600 text-center">
            {t("properties.amenities.empty.description")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {t("properties.amenities.header.title")}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("properties.amenities.header.summary", {
              values: { count: amenities.length.toString() },
            })}
          </p>
        </div>
        {canEdit && (
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 me-2" />
                {t("properties.amenities.actions.add")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {t("properties.amenities.dialog.addTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t("properties.amenities.dialog.addDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="amenityName">
                    {t("properties.amenities.form.name.label")}
                  </Label>
                  <Input
                    id="amenityName"
                    placeholder={t(
                      "properties.amenities.form.name.placeholder"
                    )}
                    value={newAmenity.name}
                    onChange={(e) =>
                      setNewAmenity({ ...newAmenity, name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="amenityCategory">
                    {t("properties.amenities.form.category.label")}
                  </Label>
                  <Select
                    value={newAmenity.category}
                    onValueChange={(value) =>
                      setNewAmenity({ ...newAmenity, category: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t(
                          "properties.amenities.form.category.placeholder"
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {amenityCategories.map((category) => (
                        <SelectItem key={category} value={category}>
                          {t(categoryLabelKeyMap[category] || category)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="amenityDescription">
                    {t("properties.amenities.form.description.label")}
                  </Label>
                  <Textarea
                    id="amenityDescription"
                    placeholder={t(
                      "properties.amenities.form.description.placeholder"
                    )}
                    value={newAmenity.description}
                    onChange={(e) =>
                      setNewAmenity({
                        ...newAmenity,
                        description: e.target.value,
                      })
                    }
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setNewAmenity({ name: "", description: "", category: "" });
                    setShowAddDialog(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleAddAmenity}
                  disabled={
                    loading || !newAmenity.name.trim() || !newAmenity.category
                  }
                >
                  {loading
                    ? t("properties.amenities.actions.adding")
                    : t("properties.amenities.actions.add")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Amenities Display */}
      {amenities.length > 0 ? (
        <div className="space-y-6">
          {Object.entries(groupedAmenities).map(
            ([category, categoryAmenities]) => {
              const IconComponent = categoryIcons[category] || Building;

              return (
                <Card key={category}>
                  <CardHeader>
                    <CardTitle className="flex items-center text-lg">
                      <IconComponent className="h-5 w-5 me-2" />
                      {t(categoryLabelKeyMap[category] || category)}
                      <Badge variant="secondary" className="ms-2">
                        {categoryAmenities.length}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {categoryAmenities.map((amenity, index) => (
                        <div
                          key={index}
                          className="flex items-start justify-between p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <div className="flex-1">
                            <h4 className="font-medium text-gray-900 dark:text-gray-100">
                              {amenity.name}
                            </h4>
                            {amenity.description && (
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                {amenity.description}
                              </p>
                            )}
                          </div>
                          {/* DISABLED: Delete functionality temporarily disabled */}
                          {/* {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDeleteDialog(amenity.name)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )} */}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            }
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Star className="h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t("properties.amenities.empty.title")}
            </h3>
            <p className="text-gray-600 text-center mb-4">
              {t("properties.amenities.empty.description")}
            </p>
            {canEdit && (
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 me-2" />
                {t("properties.amenities.empty.addFirst")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* DISABLED: Delete functionality temporarily disabled */}
      {/* <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Amenity</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove &quot;{amenityToDelete}&quot; from
              the property amenities? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeleteCancel} disabled={loading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAmenity}
              disabled={loading}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {loading ? "Removing..." : "Remove Amenity"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog> */}
    </div>
  );
};

export default PropertyAmenities;
