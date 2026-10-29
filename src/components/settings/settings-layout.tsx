"use client";

import { useState, useEffect, ReactNode } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { logClientError, logClientWarn } from "@/utils/logger";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { SettingsFieldsSkeleton } from "@/components/settings/settings-skeleton";
import { ProfileSettingsSkeleton } from "@/components/settings/profile-skeleton";

interface UserSettings {
  _id?: string;
  userId?: string;
  profile?: any;
  notifications?: any;
  security?: any;
  display?: any;
  privacy?: any;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

interface UserProfile {
  _id?: string;
  id?: string;
  email: string;
  firstName: string;
  lastName: string;
  image?: string;
  phone?: string;
  role: string;
  avatar?: string;
  bio?: string;
  location?: string;
  city?: string;
  website?: string;
  isActive: boolean;
  emailVerified?: string | Date | null;
  createdAt?: string;
  updatedAt?: string;
}

interface SettingsLayoutProps {
  title: string;
  description: string;
  children:
    | ReactNode
    | ((props: {
        userSettings: UserSettings | null;
        userProfile: UserProfile | null;
        onUpdate: (data: any) => Promise<void>;
        onAlert: (type: "success" | "error" | "info", message: string) => void;
        isLoading: boolean;
      }) => ReactNode);
  section: string;
  showRefresh?: boolean;
  adminOnly?: boolean;
}

export function SettingsLayout({
  title,
  description,
  children,
  section,
  showRefresh = false,
  adminOnly = false,
}: SettingsLayoutProps) {
  const { t } = useLocalizationContext();
  const { data: session, status } = useSession();
  const { settings: globalSettings, isLoading: settingsLoading } =
    useSettings();
  const { isAdmin, isManager } = useAuthorization();
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [alert, setAlert] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const hasAdminAccess = isAdmin || isManager;
  // Evaluated here but rendered AFTER every hook below: hasAdminAccess flips
  // from false to true once the session resolves for an admin, and an early
  // return above the effects would change the hook count between renders —
  // a hard React crash. Gated on "authenticated" so an admin does not see a
  // flash of "access denied" while the session is still loading.
  const accessDenied =
    adminOnly && status === "authenticated" && !hasAdminAccess;

  useEffect(() => {
    // Only fetch data when session is loaded and authenticated.
    // Depend on the stable user id (not the whole session object) so a
    // the session provider window-focus refetch does not re-trigger a full reload.
    if (status === "authenticated" && session?.user?.id) {
      fetchUserData();
      setAlert(null);
    } else if (status === "unauthenticated") {
      setIsLoading(false);
      showAlert("error", "Authentication required");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session?.user?.id]);

  const fetchUserData = async () => {
    try {
      setIsLoading(true);

      // Check if user is authenticated
      if (!session?.user?.id) {
        throw new Error("Authentication required");
      }

      // For profile section, we need to merge user profile data with profile settings
      if (section === "profile") {
        try {
          // Start with session data as fallback
          let mergedUserData: any = session?.user ? { ...session.user } : null;

          // Try to fetch user profile data
          try {
            const profileResponse = await fetch("/api/user/profile", {
              cache: "no-store",
              headers: {
                "Cache-Control": "no-cache",
              },
            });

            if (profileResponse.ok) {
              const profileData = await profileResponse.json();
              const fetchedUser =
                profileData?.data?.user ?? profileData?.user ?? null;
              if (fetchedUser) {
                mergedUserData = { ...fetchedUser };
              }
            }
          } catch (profileError) {
            logClientWarn("Failed to fetch user profile:", profileError);
          }

          // Try to fetch profile settings and merge if they exist
          try {
            const settingsResponse = await fetch("/api/settings/profile", {
              cache: "no-store",
              headers: {
                "Cache-Control": "no-cache",
              },
            });

            if (settingsResponse.ok) {
              const settingsData = await settingsResponse.json();
              const profileSettings =
                settingsData?.data?.settings ?? settingsData?.settings;

              if (profileSettings && mergedUserData) {
                // Merge profile settings into user data, giving priority to profile settings for extended fields
                // but preserving critical user data like avatar, email, role, etc.
                mergedUserData = {
                  ...mergedUserData,
                  ...profileSettings,
                  // Always keep the original user ID, email, role, and avatar from user profile
                  _id: mergedUserData._id ?? mergedUserData.id,
                  email: mergedUserData.email,
                  role: mergedUserData.role,
                  isActive: mergedUserData.isActive,
                  avatar: mergedUserData.avatar, // Preserve avatar from user profile
                  image: mergedUserData.image, // Preserve image from user profile
                  createdAt: mergedUserData.createdAt,
                  updatedAt: mergedUserData.updatedAt,
                };
              }
            }
          } catch (settingsError) {
            logClientWarn("Failed to fetch profile settings:", settingsError);
          }

          // Ensure we have some user data
          if (!mergedUserData && session?.user) {
            mergedUserData = { ...session.user };
          }

          setUserProfile(mergedUserData as UserProfile | null);
          setUserSettings({ profile: mergedUserData });
        } catch (profileError) {
          logClientError("Profile section error:", profileError);
          // Fallback to session data
          if (session?.user) {
            setUserProfile({ ...(session.user as any) });
            setUserSettings({ profile: { ...session.user } });
          } else {
            throw profileError;
          }
        }
      } else {
        // For other sections, fetch user profile and section-specific settings separately
        const profileResponse = await fetch("/api/user/profile", {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
          },
        });

        if (!profileResponse.ok) {
          throw new Error("Failed to fetch profile");
        }

        const profileData = await profileResponse.json();
        // Our API helper wraps payloads under `data`, so prefer data.user
        // and fall back to a top-level user for older shapes.
        const fetchedUser =
          profileData?.data?.user ?? profileData?.user ?? null;
        setUserProfile(fetchedUser as UserProfile | null);

        // Non-profile sections keep their data on User / dedicated stores;
        // the legacy per-section settings endpoints were removed in the
        // settings consolidation.
      }
    } catch (error) {
      logClientError("Fetch user data error:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("settings.layout.loadFailed", { defaultValue: "Could not load your settings" });
      showAlert("error", errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const showAlert = (type: "success" | "error" | "info", message: string) => {
    if (type === "success") {
      toast.success(message);
      setAlert(null);
      return;
    } else if (type === "error") {
      toast.error(message);
    } else {
      toast(message);
    }

    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  const clearAlert = () => {
    setAlert(null);
  };

  const handleSettingsUpdate = async (data: any) => {
    // Update local state optimistically without causing form reload
    if (section === "profile" && userProfile) {
      const updatedProfile = {
        ...userProfile,
        ...data,
        updatedAt: new Date().toISOString(),
      };
      setUserProfile(updatedProfile);
      setUserSettings({ profile: updatedProfile });
    } else if (userSettings) {
      // For other settings, update the specific section without full reload
      setUserSettings((prevSettings) => ({
        ...prevSettings,
        [section]: {
          ...prevSettings?.[section as keyof UserSettings],
          ...data,
        },
        updatedAt: new Date().toISOString(),
      }));
    }

    // No need to refetch - optimistic updates are sufficient
    // The form components handle their own state management
  };

  // The page header is static, so it renders immediately. Only the dynamic
  // content area shows an inline skeleton while data loads — no full-screen
  // spinner that makes the whole app look like it is reloading.
  const isContentLoading =
    isLoading ||
    status === "loading" ||
    (section === "display" && settingsLoading);

  // The content skeleton must match whatever this route's `loading.tsx` already
  // painted, or the mount jumps twice: route-chunk skeleton -> layout skeleton
  // -> real form. Profile is the only section whose route fallback is a
  // shape-matched stack (ProfileSettingsSkeleton); the others still use the
  // generic field card on both stages, so they stay on it here.
  const contentSkeleton =
    section === "profile" ? (
      <ProfileSettingsSkeleton />
    ) : (
      <SettingsFieldsSkeleton />
    );

  // For the display section, surface the global SettingsProvider value so the
  // form stays in sync with live (same-tab/cross-tab) changes.
  const effectiveUserSettings =
    section === "display"
      ? { ...userSettings, display: globalSettings }
      : userSettings;

  // Below every hook — see the accessDenied comment where it is computed.
  if (accessDenied) {
    return (
      <div className="container mx-auto max-w-5xl p-6">
        <Alert className="border-red-500 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            {t("settings.layout.denied", { defaultValue: "This section is for administrators and managers only." })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {showRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUserData}
            disabled={isLoading}
            className="text-xs"
          >
            <RefreshCw
              className={`h-3 w-3 me-1 ${isLoading ? "animate-spin" : ""}`}
            />
            {t("settings.refreshButton")}
          </Button>
        )}
      </div>

      {alert && (
        <Alert
          className={`${
            alert.type === "success"
              ? "border-green-500 bg-green-50"
              : alert.type === "error"
                ? "border-red-500 bg-red-50"
                : "border-blue-500 bg-blue-50"
          }`}
        >
          {alert.type === "success" && (
            <CheckCircle className="h-4 w-4 text-green-600" />
          )}
          {alert.type === "error" && (
            <AlertCircle className="h-4 w-4 text-red-600" />
          )}
          {alert.type === "info" && <Info className="h-4 w-4 text-blue-600" />}
          <AlertDescription
            className={`flex items-center justify-between ${
              alert.type === "success"
                ? "text-green-800"
                : alert.type === "error"
                  ? "text-red-800"
                  : "text-blue-800"
            }`}
          >
            <span>{alert.message}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAlert}
              className="h-6 w-6 p-0 ms-2"
            >
              ×
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Static header renders instantly; only the data-bound content suspends. */}
      {isContentLoading
        ? contentSkeleton
        : typeof children === "function"
          ? children({
              userSettings: effectiveUserSettings,
              userProfile: userProfile || ((session?.user as any) ?? null),
              onUpdate: handleSettingsUpdate,
              onAlert: showAlert,
              isLoading,
            })
          : children}
    </div>
  );
}
