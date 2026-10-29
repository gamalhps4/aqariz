/**
 * PropertyPro - Checkbox Component
 * Simple checkbox component without external dependencies
 */

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "checked" | "onCheckedChange"
  > {
  checked?: boolean;
  /**
   * Some but not all of what this box stands for is ticked — a section
   * heading over a partly ticked list. Shown as a dash; a click ticks all.
   */
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, indeterminate = false, onCheckedChange, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const mixed = indeterminate && !checked;

    React.useEffect(() => {
      if (inputRef.current) inputRef.current.indeterminate = mixed;
    }, [mixed]);

    const setRefs = (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    };

    return (
      <div className="relative inline-flex items-center">
        <input
          type="checkbox"
          ref={setRefs}
          className="sr-only"
          checked={checked}
          aria-checked={mixed ? "mixed" : checked}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          {...props}
        />
        <div
          className={cn(
            "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            // The visible box is what gets clicked, so it has to know about
            // `disabled` itself: the attribute sits on the hidden input, and
            // a "disabled" box used to toggle all the same.
            props.disabled
              ? "cursor-not-allowed opacity-50"
              : "cursor-pointer",
            (checked || mixed) && "bg-primary text-primary-foreground",
            className
          )}
          onClick={() => {
            if (props.disabled) return;
            onCheckedChange?.(mixed ? true : !checked);
          }}
        >
          {checked ? (
            <div className="flex items-center justify-center text-current">
              <Check className="h-4 w-4" />
            </div>
          ) : mixed ? (
            <div className="flex items-center justify-center text-current">
              <Minus className="h-4 w-4" />
            </div>
          ) : null}
        </div>
      </div>
    );
  }
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
