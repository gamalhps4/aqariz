/**
 * PropertyPro - Media Query Hook
 * Custom hook for responsive design and device detection
 */

import { useState, useEffect } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    // Check if we're in a browser environment
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia(query);

    // Set initial value
    setMatches(media.matches);

    // Create event listener
    const listener = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // Add listener
    if (media.addEventListener) {
      media.addEventListener("change", listener);
    } else {
      // Fallback for older browsers
      media.addListener(listener);
    }

    // Cleanup
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", listener);
      } else {
        // Fallback for older browsers
        media.removeListener(listener);
      }
    };
  }, [query]);

  return matches;
}

// Predefined breakpoint hooks
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 768px)");
}

export function useIsTablet(): boolean {
  return useMediaQuery("(min-width: 769px) and (max-width: 1024px)");
}

export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1025px)");
}

export function useIsLargeScreen(): boolean {
  return useMediaQuery("(min-width: 1440px)");
}

// Device orientation hooks
export function useIsPortrait(): boolean {
  return useMediaQuery("(orientation: portrait)");
}

export function useIsLandscape(): boolean {
  return useMediaQuery("(orientation: landscape)");
}

// Accessibility hooks
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

export function usePrefersDarkMode(): boolean {
  return useMediaQuery("(prefers-color-scheme: dark)");
}

// Touch device detection
export function useIsTouchDevice(): boolean {
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const checkTouchDevice = () => {
      return (
        "ontouchstart" in window ||
        navigator.maxTouchPoints > 0 ||
        // @ts-ignore
        navigator.msMaxTouchPoints > 0
      );
    };

    setIsTouchDevice(checkTouchDevice());
  }, []);

  return isTouchDevice;
}

// Network connection hook
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [connectionType, setConnectionType] = useState<string>("unknown");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateOnlineStatus = () => {
      setIsOnline(navigator.onLine);
    };

    const updateConnectionType = () => {
      const nav = navigator as any;
      const connection =
        nav.connection || nav.mozConnection || nav.webkitConnection;
      if (connection) {
        setConnectionType(connection.effectiveType || "unknown");
      }
    };

    // Set initial values
    updateOnlineStatus();
    updateConnectionType();

    // Add event listeners
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    const nav = navigator as any;
    const connection =
      nav.connection || nav.mozConnection || nav.webkitConnection;
    if (connection) {
      connection.addEventListener("change", updateConnectionType);
    }

    // Cleanup
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
      if (connection) {
        connection.removeEventListener("change", updateConnectionType);
      }
    };
  }, []);

  return { isOnline, connectionType };
}

// Viewport size hook
export function useViewportSize() {
  const [viewportSize, setViewportSize] = useState({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateViewportSize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    // Set initial value
    updateViewportSize();

    // Add event listener
    window.addEventListener("resize", updateViewportSize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", updateViewportSize);
    };
  }, []);

  return viewportSize;
}

// Safe area insets hook (for devices with notches, etc.)
export function useSafeAreaInsets() {
  const [safeAreaInsets, setSafeAreaInsets] = useState({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateSafeAreaInsets = () => {
      const computedStyle = getComputedStyle(document.documentElement);

      setSafeAreaInsets({
        top: parseInt(
          computedStyle.getPropertyValue("--safe-area-inset-top") || "0"
        ),
        right: parseInt(
          computedStyle.getPropertyValue("--safe-area-inset-right") || "0"
        ),
        bottom: parseInt(
          computedStyle.getPropertyValue("--safe-area-inset-bottom") || "0"
        ),
        left: parseInt(
          computedStyle.getPropertyValue("--safe-area-inset-left") || "0"
        ),
      });
    };

    // Set initial value
    updateSafeAreaInsets();

    // Add event listener for orientation changes
    window.addEventListener("orientationchange", updateSafeAreaInsets);
    window.addEventListener("resize", updateSafeAreaInsets);

    // Cleanup
    return () => {
      window.removeEventListener("orientationchange", updateSafeAreaInsets);
      window.removeEventListener("resize", updateSafeAreaInsets);
    };
  }, []);

  return safeAreaInsets;
}

// Device type detection
export function useDeviceType() {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const isDesktop = useIsDesktop();
  const isTouchDevice = useIsTouchDevice();

  return {
    isMobile,
    isTablet,
    isDesktop,
    isTouchDevice,
    deviceType: isMobile ? "mobile" : isTablet ? "tablet" : "desktop",
  };
}
