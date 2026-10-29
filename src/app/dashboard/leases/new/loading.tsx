import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, DollarSign, Calendar, Settings, Upload } from "lucide-react";

export default function NewLeaseLoading() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-80" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Form Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            <Skeleton className="h-5 w-44" />
          </CardTitle>
          <CardDescription><Skeleton className="h-4 w-72" /></CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Basic Information Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  <Skeleton className="h-5 w-44" />
                </CardTitle>
                <CardDescription><Skeleton className="h-4 w-72" /></CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Property Field */}
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  {/* Tenant Field */}
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-14" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Start Date */}
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  {/* End Date */}
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-18" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  {/* Status */}
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Financial Terms Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  <Skeleton className="h-5 w-44" />
                </CardTitle>
                <CardDescription><Skeleton className="h-4 w-72" /></CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Monthly Rent */}
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  {/* Security Deposit */}
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  {/* Pet Deposit */}
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Utilities & Restrictions Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  <Skeleton className="h-5 w-44" />
                </CardTitle>
                <CardDescription><Skeleton className="h-4 w-72" /></CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Utilities */}
                <div className="space-y-3">
                  <Skeleton className="h-5 w-32" />
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[...Array(9)].map((_, i) => (
                      <div key={i} className="flex items-center space-x-2">
                        <Skeleton className="h-4 w-4 rounded" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-9 flex-1" />
                    <Skeleton className="h-9 w-16" />
                  </div>
                </div>

                {/* Restrictions */}
                <div className="space-y-3">
                  <Skeleton className="h-5 w-28" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="flex items-center space-x-2">
                        <Skeleton className="h-4 w-4 rounded" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-9 flex-1" />
                    <Skeleton className="h-9 w-16" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Documents Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  <Skeleton className="h-5 w-44" />
                </CardTitle>
                <CardDescription><Skeleton className="h-4 w-72" /></CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6">
                    <div className="text-center space-y-2">
                      <Skeleton className="h-8 w-8 mx-auto rounded" />
                      <Skeleton className="h-4 w-48 mx-auto" />
                      <Skeleton className="h-3 w-64 mx-auto" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Renewal Options Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  <Skeleton className="h-5 w-44" />
                </CardTitle>
                <CardDescription><Skeleton className="h-4 w-72" /></CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-20 w-full" />
                </div>
              </CardContent>
            </Card>

            {/* Notes Section */}
            <Card>
              <CardHeader>
                <CardTitle><Skeleton className="h-5 w-44" /></CardTitle>
                <CardDescription><Skeleton className="h-4 w-72" /></CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-24 w-full" />
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-4 pt-6">
              <Skeleton className="h-10 w-20" />
              <Skeleton className="h-10 w-28" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
