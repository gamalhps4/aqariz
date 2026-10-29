/**
 * PropertyPro - Debounce Hook
 * Custom hook for debouncing values with configurable delay
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Hook that debounces a value
 * @param value - The value to debounce
 * @param delay - The delay in milliseconds (default: 300ms)
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook that returns a debounced callback function
 * @param callback - The callback function to debounce
 * @param delay - The delay in milliseconds (default: 300ms)
 * @returns A debounced version of the callback
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef<T>(callback);

  // Keep callback ref updated
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  );

  return debouncedCallback;
}

/**
 * Hook that provides both immediate and debounced values
 * Useful when you need to show immediate UI feedback while debouncing API calls
 * @param initialValue - The initial value
 * @param delay - The delay in milliseconds (default: 300ms)
 * @param externalValue - Optional external value to sync with (for controlled components)
 */
export function useDebouncedState<T>(
  initialValue: T,
  delay: number = 300,
  externalValue?: T
): {
  value: T;
  debouncedValue: T;
  setValue: (value: T) => void;
  isDebouncing: boolean;
} {
  const [value, setValue] = useState<T>(initialValue);
  const [debouncedValue, setDebouncedValue] = useState<T>(initialValue);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevExternalValueRef = useRef<T | undefined>(externalValue);

  // Sync with external value when it changes (for controlled reset scenarios)
  useEffect(() => {
    if (
      externalValue !== undefined &&
      externalValue !== prevExternalValueRef.current
    ) {
      prevExternalValueRef.current = externalValue;
      // Only update if the external value is different from current value
      // This prevents resetting while user is typing
      if (externalValue !== value) {
        setValue(externalValue);
        setDebouncedValue(externalValue);
        setIsDebouncing(false);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      }
    }
  }, [externalValue, value]);

  useEffect(() => {
    if (value !== debouncedValue) {
      setIsDebouncing(true);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setDebouncedValue(value);
        setIsDebouncing(false);
      }, delay);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay, debouncedValue]);

  return {
    value,
    debouncedValue,
    setValue,
    isDebouncing,
  };
}
