"use client";

export default function PropertyDetailsLoading() {
  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {/* Back Button Skeleton */}
          <div className="animate-pulse h-10 w-32 bg-gray-200 dark:bg-gray-800 rounded-md" />

          <div className="space-y-2">
            {/* Property Name Skeleton */}
            <div className="animate-pulse h-9 w-64 bg-gray-200 dark:bg-gray-800 rounded-md" />

            {/* Badges Skeleton */}
            <div className="flex items-center space-x-2">
              <div className="animate-pulse h-6 w-20 bg-gray-200 dark:bg-gray-800 rounded-md" />
              <div className="animate-pulse h-6 w-24 bg-gray-200 dark:bg-gray-800 rounded-md" />
            </div>
          </div>
        </div>

        {/* Action Buttons Skeleton */}
        <div className="flex items-center space-x-2">
          <div className="animate-pulse h-10 w-32 bg-gray-200 dark:bg-gray-800 rounded-md" />
          <div className="animate-pulse h-10 w-10 bg-gray-200 dark:bg-gray-800 rounded-md" />
        </div>
      </div>

      {/* Tabs Navigation Skeleton */}
      <div className="space-y-6">
        <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <div className="animate-pulse h-10 w-24 bg-gray-200 dark:bg-gray-700 rounded-md" />
          <div className="animate-pulse h-10 w-20 bg-gray-200 dark:bg-gray-700 rounded-md" />
          <div className="animate-pulse h-10 w-20 bg-gray-200 dark:bg-gray-700 rounded-md" />
          <div className="animate-pulse h-10 w-24 bg-gray-200 dark:bg-gray-700 rounded-md" />
        </div>

        {/* Content Area Skeleton */}
        <div className="space-y-6">
          {/* Property Images Skeleton */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border shadow-sm p-6 space-y-6">
            <div className="flex items-center">
              <div className="animate-pulse h-5 w-5 me-2 bg-gray-200 dark:bg-gray-800 rounded-md" />
              <div className="animate-pulse h-6 w-32 bg-gray-200 dark:bg-gray-800 rounded-md" />
            </div>

            {/* Featured Image Skeleton */}
            <div className="space-y-4">
              <div className="animate-pulse w-full h-96 bg-gray-200 dark:bg-gray-800 rounded-lg" />

              {/* Thumbnail Grid Skeleton */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="animate-pulse h-24 bg-gray-200 dark:bg-gray-800 rounded-lg" />
                <div className="animate-pulse h-24 bg-gray-200 dark:bg-gray-800 rounded-lg" />
                <div className="animate-pulse h-24 bg-gray-200 dark:bg-gray-800 rounded-lg" />
                <div className="animate-pulse h-24 bg-gray-200 dark:bg-gray-800 rounded-lg" />
              </div>

              {/* View All Button Skeleton */}
              <div className="flex justify-center pt-2">
                <div className="animate-pulse h-10 w-40 bg-gray-200 dark:bg-gray-800 rounded-md" />
              </div>
            </div>
          </div>

          {/* Quick Stats Skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, index) => (
              <div
                key={index}
                className="bg-white dark:bg-gray-900 rounded-xl border shadow-sm p-6"
              >
                <div className="flex items-center">
                  <div className="animate-pulse h-8 w-8 me-3 bg-gray-200 dark:bg-gray-800 rounded-md" />
                  <div className="space-y-2">
                    <div className="animate-pulse h-8 w-16 bg-gray-200 dark:bg-gray-800 rounded-md" />
                    <div className="animate-pulse h-4 w-20 bg-gray-200 dark:bg-gray-800 rounded-md" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Address Skeleton */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border shadow-sm p-6 space-y-4">
            <div className="flex items-center">
              <div className="animate-pulse h-5 w-5 me-2 bg-gray-200 dark:bg-gray-800 rounded-md" />
              <div className="animate-pulse h-6 w-16 bg-gray-200 dark:bg-gray-800 rounded-md" />
            </div>
            <div className="space-y-2">
              <div className="animate-pulse h-5 w-48 bg-gray-200 dark:bg-gray-800 rounded-md" />
              <div className="animate-pulse h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded-md" />
            </div>
          </div>

          {/* Financial Details Skeleton */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border shadow-sm p-6 space-y-4">
            <div className="animate-pulse h-6 w-32 bg-gray-200 dark:bg-gray-800 rounded-md" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[...Array(3)].map((_, index) => (
                <div key={index} className="space-y-2">
                  <div className="animate-pulse h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded-md" />
                  <div className="animate-pulse h-5 w-20 bg-gray-200 dark:bg-gray-800 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
