/**
 * PropertyPro - Switch Component
 * Toggle switch component for boolean settings
 */

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "checked" | "onCheckedChange"
  > {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
    return (
      <label
        className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
          checked
            ? "bg-primary border-primary"
            : "bg-muted-foreground/30 border-border",
          disabled && "cursor-not-allowed opacity-50",
          !disabled && "cursor-pointer",
          className
        )}
      >
        <input
          type="checkbox"
          ref={ref}
          className="sr-only"
          checked={checked}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          disabled={disabled}
          {...props}
        />
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-background transition-transform shadow-lg ring-0",
            // The thumb starts at the track's start edge, so right to left it
            // has to travel the other way.
            checked
              ? "translate-x-6 rtl:-translate-x-6"
              : "translate-x-1 rtl:-translate-x-1"
          )}
        />
      </label>
    );
  }
);
Switch.displayName = "Switch";

export { Switch };
