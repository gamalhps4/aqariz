"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useUiText } from "@/components/ui/use-ui-text";

// This provider sits outside the localization provider (see the root layout),
// but the toast it raises is rendered by the Toaster, which sits inside — so
// the words are components that read the language there, and follow it if it
// loads after the notice appears.
function UpdateAvailableText() {
  const { text } = useUiText();
  return <>{text("app.update.available", "A new version is available")}</>;
}

function ReloadText() {
  const { text } = useUiText();
  return <>{text("app.update.reload", "Reload")}</>;
}

export function ServiceWorkerProvider() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const unregisterAll = async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));

      if ("caches" in window) {
        const cacheKeys = await window.caches.keys();
        await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
      }
    };

    if (process.env.NODE_ENV !== "production") {
      void unregisterAll();
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "activated" &&
              navigator.serviceWorker.controller
            ) {
              toast(<UpdateAvailableText />, {
                action: {
                  label: <ReloadText />,
                  onClick: () => window.location.reload(),
                },
                duration: Infinity,
              });
            }
          });
        });
      } catch (error) {
        console.error("Service worker registration failed", error);
      }
    };

    void register();
  }, []);

  return null;
}
