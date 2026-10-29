"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Building2, AlertCircle } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export default function OnboardingPage() {
  const router = useRouter();
  const { t, isRTL } = useLocalizationContext();
  const { data: session, status, update } = useSession();
  const [organizationName, setOrganizationName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth/signin");
    }
    // Already has an organization — no onboarding needed.
    if (status === "authenticated" && session?.user?.organizationId) {
      router.replace("/dashboard");
    }
  }, [status, session?.user?.organizationId, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationName }),
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        setError(
          result.error ||
            result.message ||
            t("auth.onboarding.failed", { defaultValue: "Could not create the organization" }),
        );
        setIsLoading(false);
        return;
      }

      // Refresh the session so it picks up the new organizationId, then enter.
      await update();
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      console.error("Onboarding error:", err);
      setError(t("auth.onboarding.error", { defaultValue: "Something went wrong while creating your organization" }));
      setIsLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div dir={isRTL ? "rtl" : "ltr"} className="flex flex-1 items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-lg w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center items-center">
            <Building2 className="h-14 w-14 text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            {t("auth.onboarding.title", { defaultValue: "Set up your organization" })}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {session?.user?.firstName
              ? t("auth.onboarding.welcomeNamed", { defaultValue: "Welcome, {name}! Create a workspace to get started.", values: { name: session.user.firstName } })
              : t("auth.onboarding.welcome", { defaultValue: "Welcome! Create a workspace to get started." })}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("auth.onboarding.cardTitle", { defaultValue: "Your organization" })}</CardTitle>
            <CardDescription>
              {t("auth.onboarding.cardHint", { defaultValue: "You will be the administrator of this workspace" })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="organizationName">
                  {t("auth.common.orgName", { defaultValue: "Company / organization name" })}
                </Label>
                <div className="relative">
                  <Building2 className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <Input
                    id="organizationName"
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder={t("auth.common.orgPlaceholder", { defaultValue: "e.g. Al Noor Property Management" })}
                    className="ps-10"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t("auth.common.creatingWorkspace", { defaultValue: "Creating your workspace…" })}
                  </>
                ) : (
                  t("auth.common.createOrg", { defaultValue: "Create organization" })
                )}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
            >
              {t("auth.verify.signOut", { defaultValue: "Sign out" })}
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
