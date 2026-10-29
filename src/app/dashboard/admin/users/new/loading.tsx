import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewUserLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-4 md:p-6">
      <div className="container mx-auto max-w-5xl space-y-8">
        {/* Enhanced Header Skeleton */}
        <div className="flex items-center gap-6">
          <Skeleton className="h-10 w-32" />
          <div className="space-y-1">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-5 w-64" />
          </div>
        </div>

        {/* Form Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Avatar Upload Skeleton */}
          <div className="lg:col-span-4">
            <Card className="h-fit shadow-lg">
              <CardHeader className="text-center pb-4">
                <Skeleton className="h-6 w-32 mx-auto" />
                <Skeleton className="h-4 w-40 mx-auto" />
              </CardHeader>
              <CardContent className="flex justify-center pb-8">
                <Skeleton className="h-32 w-32 rounded-full" />
              </CardContent>
            </Card>
          </div>

          {/* Personal Information Skeleton */}
          <div className="lg:col-span-8">
            <Card className="h-fit shadow-lg">
              <CardHeader className="pb-6">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-64" />
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="space-y-3">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-11 w-full" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Account Setup Skeleton */}
          <div className="lg:col-span-6">
            <Card className="h-fit shadow-lg">
              <CardHeader className="pb-6">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent className="space-y-6">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="space-y-3">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* User Settings Skeleton */}
          <div className="lg:col-span-6">
            <Card className="h-fit shadow-lg">
              <CardHeader className="pb-6">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent className="space-y-6">
                {[...Array(2)].map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center space-x-3 rounded-md border p-4"
                  >
                    <Skeleton className="h-4 w-4" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Form Actions Skeleton */}
        <div className="flex items-center justify-between pt-8">
          <Skeleton className="h-4 w-24" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-24" />
            <Skeleton className="h-12 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}
