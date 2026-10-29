import { Zap } from "lucide-react";

export default function NewEmergencyRequestLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-9 w-20 bg-gray-200 rounded animate-pulse" />
        <div>
          <div className="flex items-center gap-2 text-red-600">
            <Zap className="h-8 w-8" />
            <div className="h-9 w-64 bg-gray-200 rounded animate-pulse" />
          </div>
          <div className="mt-2 h-5 w-96 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Emergency Alert */}
        <div className="border border-red-200 bg-red-50 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 bg-red-200 rounded animate-pulse" />
            <div className="h-4 bg-red-200 rounded w-3/4 animate-pulse" />
          </div>
        </div>

        {/* Emergency Classification */}
        <div className="border border-red-200 rounded-lg">
          <div className="p-6 border-b">
            <div className="h-6 bg-gray-200 rounded w-1/3 animate-pulse" />
          </div>
          <div className="p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/4 animate-pulse" />
                <div className="h-10 bg-gray-200 rounded animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/4 animate-pulse" />
                <div className="h-10 bg-gray-200 rounded animate-pulse" />
              </div>
            </div>
            <div className="h-16 bg-red-50 border border-red-200 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* Request Details */}
        <div className="border rounded-lg">
          <div className="p-6 border-b">
            <div className="h-6 bg-gray-200 rounded w-1/4 animate-pulse" />
          </div>
          <div className="p-6 space-y-4">
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/6 animate-pulse" />
              <div className="h-10 bg-gray-200 rounded animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/5 animate-pulse" />
              <div className="h-32 bg-gray-200 rounded animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/4 animate-pulse" />
              <div className="h-20 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
        </div>

        {/* Property and Contact */}
        <div className="border rounded-lg">
          <div className="p-6 border-b">
            <div className="h-6 bg-gray-200 rounded w-1/3 animate-pulse" />
          </div>
          <div className="p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/4 animate-pulse" />
                <div className="h-10 bg-gray-200 rounded animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/4 animate-pulse" />
                <div className="h-10 bg-gray-200 rounded animate-pulse" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/3 animate-pulse" />
              <div className="h-10 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
        </div>

        {/* Image Upload */}
        <div className="border rounded-lg">
          <div className="p-6 border-b">
            <div className="h-6 bg-gray-200 rounded w-1/4 animate-pulse" />
          </div>
          <div className="p-6">
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-6">
              <div className="flex flex-col items-center gap-2">
                <div className="h-8 w-8 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 bg-gray-200 rounded w-32 animate-pulse" />
                <div className="h-3 bg-gray-200 rounded w-24 animate-pulse" />
              </div>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="border border-red-200 bg-red-50 rounded-lg">
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 bg-red-200 rounded animate-pulse" />
                <div className="space-y-1">
                  <div className="h-4 bg-red-200 rounded w-32 animate-pulse" />
                  <div className="h-3 bg-red-200 rounded w-48 animate-pulse" />
                </div>
              </div>
              <div className="h-10 w-48 bg-red-200 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
