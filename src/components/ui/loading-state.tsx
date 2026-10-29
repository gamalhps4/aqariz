/**
 * PropertyPro - Loading State Components
 * Reusable loading components for better UX
 */

"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface LoadingStateProps {
  message?: string;
  size?: "sm" | "md" | "lg";
  variant?: "spinner" | "dots" | "pulse";
  className?: string;
}

export function LoadingSpinner({
  message = "Loading...",
  size = "md",
  variant = "spinner",
  className,
}: LoadingStateProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  };

  const textSizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  if (variant === "dots") {
    return (
      <div
        className={cn("flex items-center justify-center space-x-2", className)}
      >
        <div className="flex space-x-1">
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></div>
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></div>
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
        </div>
        {message && (
          <span className={cn("text-muted-foreground", textSizeClasses[size])}>
            {message}
          </span>
        )}
      </div>
    );
  }

  if (variant === "pulse") {
    return (
      <div
        className={cn("flex items-center justify-center space-x-3", className)}
      >
        <div
          className={cn(
            "bg-primary rounded-full animate-pulse",
            sizeClasses[size]
          )}
        ></div>
        {message && (
          <span className={cn("text-muted-foreground", textSizeClasses[size])}>
            {message}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-center justify-center space-x-3", className)}
    >
      <Loader2 className={cn("animate-spin text-primary", sizeClasses[size])} />
      {message && (
        <span className={cn("text-muted-foreground", textSizeClasses[size])}>
          {message}
        </span>
      )}
    </div>
  );
}

export interface LoadingCardProps {
  title?: string;
  message?: string;
  onCancel?: () => void;
  cancelText?: string;
  className?: string;
}

export function LoadingCard({
  title = "Loading",
  message = "Please wait while we process your request...",
  onCancel,
  cancelText = "Cancel",
  className,
}: LoadingCardProps) {
  return (
    <Card className={cn("border-blue-200 bg-blue-50", className)}>
      <CardContent className="flex flex-col items-center justify-center py-8 space-y-4">
        <LoadingSpinner size="lg" variant="spinner" />
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold text-blue-800">{title}</h3>
          <p className="text-blue-700 text-sm max-w-md">{message}</p>
        </div>
        {onCancel && (
          <Button
            onClick={onCancel}
            variant="outline"
            className="border-blue-300 text-blue-700 hover:bg-blue-100"
          >
            {cancelText}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export interface OperationLoadingProps {
  operation: string;
  entity?: string;
  progress?: number;
  onCancel?: () => void;
  className?: string;
}

export function OperationLoading({
  operation,
  entity = "item",
  progress,
  onCancel,
  className,
}: OperationLoadingProps) {
  const getOperationMessage = () => {
    switch (operation.toLowerCase()) {
      case "create":
      case "creating":
        return `Creating ${entity}...`;
      case "update":
      case "updating":
        return `Updating ${entity}...`;
      case "delete":
      case "deleting":
        return `Deleting ${entity}...`;
      case "save":
      case "saving":
        return `Saving ${entity}...`;
      case "load":
      case "loading":
        return `Loading ${entity}...`;
      case "fetch":
      case "fetching":
        return `Fetching ${entity}...`;
      default:
        return `Processing ${entity}...`;
    }
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center space-x-3 p-4",
        className
      )}
    >
      <div className="flex items-center space-x-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <div className="space-y-1">
          <p className="text-sm font-medium">{getOperationMessage()}</p>
          {progress !== undefined && (
            <div className="w-48 bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              ></div>
            </div>
          )}
        </div>
      </div>
      {onCancel && (
        <Button
          onClick={onCancel}
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Button>
      )}
    </div>
  );
}

// Skeleton loading components
export function TableSkeleton({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex space-x-4">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div
              key={colIndex}
              className="h-4 bg-gray-200 rounded animate-pulse flex-1"
            ></div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} className="animate-pulse">
          <CardContent className="p-6 space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            <div className="space-y-2">
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded w-5/6"></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Button loading state
export interface LoadingButtonProps {
  loading: boolean;
  children: React.ReactNode;
  loadingText?: string;
  className?: string;
  [key: string]: any;
}

export function LoadingButton({
  loading,
  children,
  loadingText,
  className,
  disabled,
  ...props
}: LoadingButtonProps) {
  return (
    <Button disabled={loading || disabled} className={className} {...props}>
      {loading && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
      {loading ? loadingText || "Loading..." : children}
    </Button>
  );
}
