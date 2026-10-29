import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function UserManagementLoading() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-64 bg-muted rounded animate-pulse" />
          <div className="h-4 w-48 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-20 bg-muted rounded animate-pulse" />
          <div className="h-9 w-24 bg-muted rounded animate-pulse" />
        </div>
      </div>

      {/* Stats Cards Skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 w-20 bg-muted rounded animate-pulse" />
              <div className="h-4 w-4 bg-muted rounded animate-pulse" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 bg-muted rounded animate-pulse mb-2" />
              <div className="h-3 w-24 bg-muted rounded animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters Skeleton */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-5 w-5 bg-muted rounded animate-pulse" />
            <div className="h-5 w-32 bg-muted rounded animate-pulse" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="h-10 w-full bg-muted rounded animate-pulse" />
            </div>
            <div className="h-10 w-48 bg-muted rounded animate-pulse" />
            <div className="h-10 w-48 bg-muted rounded animate-pulse" />
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 bg-muted rounded animate-pulse" />
              <div className="h-10 w-10 bg-muted rounded animate-pulse" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User List Skeleton */}
      <Card>
        <CardHeader>
          <div className="h-6 w-32 bg-muted rounded animate-pulse mb-2" />
          <div className="h-4 w-48 bg-muted rounded animate-pulse" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Table Header Skeleton */}
            <div className="grid grid-cols-7 gap-4 pb-2 border-b">
              <div className="h-4 w-4 bg-muted rounded animate-pulse" />
              <div className="h-4 w-16 bg-muted rounded animate-pulse" />
              <div className="h-4 w-12 bg-muted rounded animate-pulse" />
              <div className="h-4 w-16 bg-muted rounded animate-pulse" />
              <div className="h-4 w-20 bg-muted rounded animate-pulse" />
              <div className="h-4 w-16 bg-muted rounded animate-pulse" />
              <div className="h-4 w-16 bg-muted rounded animate-pulse ms-auto" />
            </div>

            {/* Table Rows Skeleton */}
            {[...Array(8)].map((_, i) => (
              <div key={i} className="grid grid-cols-7 gap-4 py-3 items-center">
                <div className="h-4 w-4 bg-muted rounded animate-pulse" />
                <div className="flex items-center space-x-3">
                  <div className="h-8 w-8 bg-muted rounded-full animate-pulse" />
                  <div className="space-y-1">
                    <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                    <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                  </div>
                </div>
                <div className="h-6 w-20 bg-muted rounded-full animate-pulse" />
                <div className="h-6 w-16 bg-muted rounded-full animate-pulse" />
                <div className="space-y-1">
                  <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-28 bg-muted rounded animate-pulse" />
                </div>
                <div className="h-3 w-20 bg-muted rounded animate-pulse" />
                <div className="h-8 w-8 bg-muted rounded animate-pulse ms-auto" />
              </div>
            ))}

            {/* Pagination Skeleton */}
            <div className="flex items-center justify-between pt-4">
              <div className="h-4 w-48 bg-muted rounded animate-pulse" />
              <div className="flex items-center space-x-2">
                <div className="h-8 w-16 bg-muted rounded animate-pulse" />
                <div className="flex items-center space-x-1">
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="h-8 w-8 bg-muted rounded animate-pulse"
                    />
                  ))}
                </div>
                <div className="h-8 w-12 bg-muted rounded animate-pulse" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
