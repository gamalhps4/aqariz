"use client";

import Image from "@/components/ui/app-image";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Eye,
  ExternalLink,
  ImageIcon,
  Upload,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { propertyService } from "@/lib/services/property.service";
import { ImageUpload, UploadedImage } from "@/components/ui/image-upload";
import { ImageErrorBoundary } from "@/components/ui/error-boundary";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface PropertyImageGalleryProps {
  images: string[];
  propertyName: string;
  canEdit: boolean;
  onImagesUpdate: (newImages: string[]) => void;
  propertyId: string;
}

const PropertyImageGallery: React.FC<PropertyImageGalleryProps> = ({
  images,
  propertyName,
  canEdit,
  onImagesUpdate,
  propertyId,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  // const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // const [imageToDelete, setImageToDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useLocalizationContext();

  const handleImagesUploaded = async (uploadedImages: UploadedImage[]) => {
    try {
      setLoading(true);
      const imageUrls = uploadedImages.map((img) => img.url);
      const updatedProperty = await propertyService.addPropertyImages(
        propertyId,
        imageUrls
      );

      // Safe access to images with fallback
      const newImages = updatedProperty?.images || [];

      onImagesUpdate(newImages);
      // Don't close modal automatically - let user review and close manually
      toast.success(
        t("properties.images.toasts.addSuccess", {
          values: { count: uploadedImages.length.toString() },
        })
      );
    } catch (error: any) {
      toast.error(error.message || t("properties.images.toasts.addError"));
    } finally {
      setLoading(false);
    }
  };

  // DISABLED: Delete functionality temporarily disabled
  // const handleDeleteImage = async () => {
  //   if (!imageToDelete) return;

  //   try {
  //     setLoading(true);
  //     const updatedProperty = await propertyService.removePropertyImages(
  //       propertyId,
  //       [imageToDelete]
  //     );

  //     // Safe access to images with fallback
  //     const newImages = updatedProperty?.images || [];

  //     onImagesUpdate(newImages);
  //     setImageToDelete(null);
  //     setShowDeleteDialog(false);
  //     toast.success("Image removed successfully");
  //   } catch (error: any) {
  //     toast.error(error.message || "Failed to remove image");
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  // const openDeleteDialog = (imageUrl: string) => {
  //   setImageToDelete(imageUrl);
  //   setShowDeleteDialog(true);
  // };

  // const handleDeleteCancel = () => {
  //   setShowDeleteDialog(false);
  //   setImageToDelete(null);
  // };

  return (
    <ImageErrorBoundary>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t("properties.images.header.title")}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {images?.length > 0
                ? t("properties.images.header.summary", {
                    values: { count: images.length.toString() },
                  })
                : t("properties.images.empty.description")}
            </p>
          </div>
          {canEdit && (
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 me-2" />
                  {t("properties.images.actions.add")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-950/30 rounded-full flex items-center justify-center">
                      <Upload className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <DialogTitle className="text-xl font-semibold text-gray-900 dark:text-white">
                        {t("properties.images.dialog.addTitle")}
                      </DialogTitle>
                      <DialogDescription className="text-sm text-gray-600 dark:text-gray-400">
                        {t("properties.images.dialog.addDescription")}
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className="py-4">
                  <ImageUpload
                    onImagesUploaded={handleImagesUploaded}
                    maxFiles={10}
                    folder="PropertyPro/properties"
                    quality="auto"
                    disabled={loading}
                  />
                </div>

                <DialogFooter className="flex items-center justify-between pt-4 border-t">
                  <div className="flex items-center text-sm text-gray-500">
                    <AlertCircle className="h-4 w-4 me-2" />
                    <span>{t("properties.images.dialog.helper")}</span>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      onClick={() => setShowAddDialog(false)}
                      disabled={loading}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      onClick={() => setShowAddDialog(false)}
                      disabled={loading}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 me-2 animate-spin" />
                          {t("properties.images.dialog.processing")}
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-4 w-4 me-2" />
                          {t("properties.images.dialog.done")}
                        </>
                      )}
                    </Button>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Image Grid */}
        {images.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {images.map((imageUrl, index) => (
              <Card key={index} className="overflow-hidden py-0">
                <div className="relative group">
                  <div className="relative w-full h-58 bg-gray-100 dark:bg-gray-800">
                    <Image
                      src={imageUrl}
                      alt={t("properties.images.alt.thumbnail", {
                        values: {
                          index: (index + 1).toString(),
                          name: propertyName,
                        },
                      })}
                      fill
                      className="object-cover transition-transform group-hover:scale-105"
                      unoptimized
                    />
                  </div>
                  {/* Image Number Badge */}
                  <Badge className="absolute top-2 start-2 bg-black bg-opacity-70 text-white">
                    {index + 1}
                  </Badge>

                  {/* Action Buttons - Show on hover */}
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all duration-200 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedImage(imageUrl)}
                      className="bg-white/90 hover:bg-white text-gray-900"
                    >
                      <Eye className="h-4 w-4 me-1" />
                      {t("properties.images.actions.view")}
                    </Button>
                    {/* DISABLED: Delete functionality temporarily disabled */}
                    {/* {canEdit && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => openDeleteDialog(imageUrl)}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        <Trash2 className="h-4 w-4 me-1" />
                        Delete
                      </Button>
                    )} */}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <ImageIcon className="h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t("properties.images.empty.title")}
              </h3>
              <p className="text-gray-600 text-center mb-4">
                {t("properties.images.empty.description")}
              </p>
              {canEdit && (
                <Button onClick={() => setShowAddDialog(true)}>
                  <Plus className="h-4 w-4 me-2" />
                  {t("properties.images.empty.addFirst")}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Image Viewer Dialog */}
        {selectedImage && (
          <Dialog
            open={!!selectedImage}
            onOpenChange={() => setSelectedImage(null)}
          >
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>{t("properties.images.viewer.title")}</DialogTitle>
              </DialogHeader>
              <div className="relative w-full h-96">
                <Image
                  src={selectedImage}
                  alt={t("properties.images.alt.main", {
                    values: { name: propertyName },
                  })}
                  fill
                  className="object-contain"
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSelectedImage(null)}
                >
                  {t("properties.images.viewer.close")}
                </Button>
                <Button onClick={() => window.open(selectedImage, "_blank")}>
                  <ExternalLink className="h-4 w-4 me-2" />
                  {t("properties.images.viewer.openInNewTab")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* DISABLED: Delete functionality temporarily disabled */}
        {/* <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Image</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove this image from the property
                gallery? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={handleDeleteCancel}
                disabled={loading}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteImage}
                disabled={loading}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              >
                {loading ? "Removing..." : "Remove Image"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog> */}
      </div>
    </ImageErrorBoundary>
  );
};

export default PropertyImageGallery;
