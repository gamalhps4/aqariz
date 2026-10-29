/**
 * PropertyPro - Global Search Component
 * A reusable search component with debouncing, loading states, and error handling
 */

"use client";

import * as React from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDebouncedState } from "@/hooks/useDebounce";
import { useUiText } from "@/components/ui/use-ui-text";

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface GlobalSearchProps {
  /** Placeholder text for the search input */
  placeholder?: string;
  /** Initial search value */
  initialValue?: string;
  /** Debounce delay in milliseconds (default: 300ms) */
  debounceDelay?: number;
  /** Callback fired when the debounced search value changes */
  onSearch: (value: string) => void;
  /** Callback fired immediately on input change (optional) */
  onImmediateChange?: (value: string) => void;
  /** Whether the search is currently loading results */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Whether the search input is disabled */
  disabled?: boolean;
  /** Additional CSS classes for the container */
  className?: string;
  /** Additional CSS classes for the input */
  inputClassName?: string;
  /** Size variant of the search input */
  size?: "sm" | "md" | "lg";
  /** Whether to show the clear button */
  showClearButton?: boolean;
  /** Minimum characters required before triggering search */
  minCharacters?: number;
  /** Accessible label for the search input */
  ariaLabel?: string;
  /** Callback fired when the search is cleared */
  onClear?: () => void;
}

export interface GlobalSearchState {
  value: string;
  debouncedValue: string;
  isDebouncing: boolean;
  hasSearched: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function GlobalSearch({
  placeholder: placeholderProp,
  initialValue = "",
  debounceDelay = 300,
  onSearch,
  onImmediateChange,
  isLoading = false,
  error = null,
  disabled = false,
  className,
  inputClassName,
  size = "md",
  showClearButton = true,
  minCharacters = 0,
  ariaLabel: ariaLabelProp,
  onClear,
}: GlobalSearchProps) {
  const { text } = useUiText();
  const placeholder = placeholderProp ?? text("ui.search", "Search…");
  const ariaLabel = ariaLabelProp ?? text("ui.searchLabel", "Search");
  // Pass initialValue as externalValue to sync when parent resets the search
  const { value, debouncedValue, setValue, isDebouncing } = useDebouncedState(
    initialValue,
    debounceDelay,
    initialValue // Pass as externalValue to enable controlled reset
  );

  const hasSearchedRef = React.useRef(false);
  const previousDebouncedValueRef = React.useRef(debouncedValue);

  // Trigger search when debounced value changes
  React.useEffect(() => {
    if (previousDebouncedValueRef.current !== debouncedValue) {
      previousDebouncedValueRef.current = debouncedValue;

      // Check minimum characters requirement
      if (debouncedValue.length >= minCharacters || debouncedValue === "") {
        hasSearchedRef.current = true;
        onSearch(debouncedValue);
      }
    }
  }, [debouncedValue, onSearch, minCharacters]);

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setValue(newValue);
      onImmediateChange?.(newValue);
    },
    [setValue, onImmediateChange]
  );

  const handleClear = React.useCallback(() => {
    setValue("");
    onImmediateChange?.("");
    onSearch("");
    onClear?.();
  }, [setValue, onImmediateChange, onSearch, onClear]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape" && value) {
        handleClear();
      }
    },
    [value, handleClear]
  );

  // Size variants
  const sizeClasses = {
    sm: "h-8 text-sm",
    md: "h-10 text-sm",
    lg: "h-12 text-base",
  };

  const iconSizeClasses = {
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  const showSpinner = isLoading || isDebouncing;
  const showClear = showClearButton && value && !showSpinner;

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        {/* Search Icon or Loading Spinner */}
        <div className="absolute start-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
          {showSpinner ? (
            <Loader2
              className={cn(
                iconSizeClasses[size],
                "animate-spin text-muted-foreground"
              )}
            />
          ) : (
            <Search
              className={cn(iconSizeClasses[size], "text-muted-foreground")}
            />
          )}
        </div>

        {/* Search Input */}
        <Input
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-busy={showSpinner}
          aria-invalid={!!error}
          className={cn(
            "ps-10",
            showClear && "pe-10",
            sizeClasses[size],
            inputClassName
          )}
        />

        {/* Clear Button */}
        {showClear && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="absolute end-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0 hover:bg-transparent"
            aria-label={text("ui.clearSearch", "Clear search")}
          >
            <X className={iconSizeClasses[size]} />
          </Button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-sm text-red-600 mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default GlobalSearch;
