/**
 * PropertyPro - Simple Loading Component
 * Alternative loading component without skeletons
 */

"use client";

import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useUiText } from "@/components/ui/use-ui-text";

export interface SimpleLoadingProps {
  title?: string;
  message?: string;
  showCards?: boolean;
  className?: string;
}

export function SimpleLoading({
  title: titleProp,
  message: messageProp,
  showCards = true,
  className,
}: SimpleLoadingProps) {
  const { text } = useUiText();
  const title = titleProp ?? text("ui.loading", "Loading…");
  const message = messageProp ?? text("ui.loadingMessage", "Please wait while the data loads.");
  return (
    <div className={cn("space-y-6", className)}>
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Loading Cards */}
      {showCards && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-1/3" />
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function TenantDetailSimpleLoading() {
  return <SimpleLoading showCards={true} />;
}

export function TenantEditSimpleLoading() {
  return <SimpleLoading showCards={true} />;
}

export function NewTenantSimpleLoading() {
  return <SimpleLoading showCards={true} />;
}
