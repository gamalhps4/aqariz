"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";

interface ResponsiveLayoutProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  padding?: "none" | "sm" | "md" | "lg";
  spacing?: "none" | "sm" | "md" | "lg";
}

export function ResponsiveLayout({
  children,
  className,
  maxWidth = "full",
  padding = "md",
  spacing = "md",
}: ResponsiveLayoutProps) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const isTablet = useMediaQuery("(max-width: 1024px)");

  const maxWidthClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
    full: "max-w-full",
  };

  const paddingClasses = {
    none: "",
    sm: "p-2 sm:p-3",
    md: "p-4 sm:p-6",
    lg: "p-6 sm:p-8",
  };

  const spacingClasses = {
    none: "",
    sm: "space-y-2 sm:space-y-3",
    md: "space-y-4 sm:space-y-6",
    lg: "space-y-6 sm:space-y-8",
  };

  return (
    <div
      className={cn(
        "w-full mx-auto",
        maxWidthClasses[maxWidth],
        paddingClasses[padding],
        spacingClasses[spacing],
        className
      )}
    >
      {children}
    </div>
  );
}

interface ResponsiveGridProps {
  children: React.ReactNode;
  className?: string;
  cols?: {
    mobile?: number;
    tablet?: number;
    desktop?: number;
  };
  gap?: "none" | "sm" | "md" | "lg";
}

export function ResponsiveGrid({
  children,
  className,
  cols = { mobile: 1, tablet: 2, desktop: 3 },
  gap = "md",
}: ResponsiveGridProps) {
  const { mobile = 1, tablet = 2, desktop = 3 } = cols;

  const gapClasses = {
    none: "",
    sm: "gap-2 sm:gap-3",
    md: "gap-4 sm:gap-6",
    lg: "gap-6 sm:gap-8",
  };

  const gridColsClasses = `grid-cols-${mobile} sm:grid-cols-${tablet} lg:grid-cols-${desktop}`;

  return (
    <div className={cn("grid", gridColsClasses, gapClasses[gap], className)}>
      {children}
    </div>
  );
}

interface ResponsiveStackProps {
  children: React.ReactNode;
  className?: string;
  direction?: {
    mobile?: "row" | "col";
    tablet?: "row" | "col";
    desktop?: "row" | "col";
  };
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  gap?: "none" | "sm" | "md" | "lg";
  wrap?: boolean;
}

export function ResponsiveStack({
  children,
  className,
  direction = { mobile: "col", tablet: "col", desktop: "row" },
  align = "start",
  justify = "start",
  gap = "md",
  wrap = false,
}: ResponsiveStackProps) {
  const { mobile = "col", tablet = "col", desktop = "row" } = direction;

  const directionClasses = `flex-${mobile} sm:flex-${tablet} lg:flex-${desktop}`;

  const alignClasses = {
    start: "items-start",
    center: "items-center",
    end: "items-end",
    stretch: "items-stretch",
  };

  const justifyClasses = {
    start: "justify-start",
    center: "justify-center",
    end: "justify-end",
    between: "justify-between",
    around: "justify-around",
    evenly: "justify-evenly",
  };

  const gapClasses = {
    none: "",
    sm: "gap-2 sm:gap-3",
    md: "gap-4 sm:gap-6",
    lg: "gap-6 sm:gap-8",
  };

  return (
    <div
      className={cn(
        "flex",
        directionClasses,
        alignClasses[align],
        justifyClasses[justify],
        gapClasses[gap],
        wrap && "flex-wrap",
        className
      )}
    >
      {children}
    </div>
  );
}

interface MobileFirstCardProps {
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  shadow?: "none" | "sm" | "md" | "lg";
  rounded?: "none" | "sm" | "md" | "lg" | "xl";
}

export function MobileFirstCard({
  children,
  className,
  padding = "md",
  shadow = "sm",
  rounded = "lg",
}: MobileFirstCardProps) {
  const paddingClasses = {
    none: "",
    sm: "p-3 sm:p-4",
    md: "p-4 sm:p-6",
    lg: "p-6 sm:p-8",
  };

  const shadowClasses = {
    none: "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_18px_rgba(15,23,42,0.025)] dark:shadow-none",
    sm: "shadow-sm",
    md: "shadow-md",
    lg: "shadow-lg",
  };

  const roundedClasses = {
    none: "",
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-xl",
  };

  return (
    <div
      className={cn(
        "bg-card text-card-foreground",
        paddingClasses[padding],
        shadowClasses[shadow],
        roundedClasses[rounded],
        className
      )}
    >
      {children}
    </div>
  );
}

interface TouchOptimizedButtonProps {
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "default" | "secondary" | "outline" | "ghost";
  fullWidth?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

export function TouchOptimizedButton({
  children,
  className,
  size = "md",
  variant = "default",
  fullWidth = false,
  onClick,
  disabled = false,
  type = "button",
}: TouchOptimizedButtonProps) {
  const sizeClasses = {
    sm: "h-10 px-4 text-sm", // Minimum 44px touch target
    md: "h-12 px-6 text-base", // Comfortable touch target
    lg: "h-14 px-8 text-lg", // Large touch target
    xl: "h-16 px-10 text-xl", // Extra large touch target
  };

  const variantClasses = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    outline:
      "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        "active:scale-95 transition-transform duration-100", // Touch feedback
        sizeClasses[size],
        variantClasses[variant],
        fullWidth && "w-full",
        className
      )}
    >
      {children}
    </button>
  );
}

interface SwipeableCardProps {
  children: React.ReactNode;
  className?: string;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  swipeThreshold?: number;
}

export function SwipeableCard({
  children,
  className,
  onSwipeLeft,
  onSwipeRight,
  swipeThreshold = 100,
}: SwipeableCardProps) {
  const [startX, setStartX] = useState<number | null>(null);
  const [currentX, setCurrentX] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartX(e.touches[0].clientX);
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!startX) return;
    setCurrentX(e.touches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!startX || !currentX) {
      setStartX(null);
      setCurrentX(null);
      setIsDragging(false);
      return;
    }

    const diffX = currentX - startX;

    if (Math.abs(diffX) > swipeThreshold) {
      if (diffX > 0 && onSwipeRight) {
        onSwipeRight();
      } else if (diffX < 0 && onSwipeLeft) {
        onSwipeLeft();
      }
    }

    setStartX(null);
    setCurrentX(null);
    setIsDragging(false);
  };

  const translateX = isDragging && startX && currentX ? currentX - startX : 0;

  return (
    <div
      className={cn(
        "transition-transform duration-200 ease-out",
        "touch-pan-y", // Allow vertical scrolling
        className
      )}
      style={{
        transform: `translateX(${Math.max(-50, Math.min(50, translateX))}px)`,
        opacity: isDragging ? 0.8 : 1,
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </div>
  );
}
