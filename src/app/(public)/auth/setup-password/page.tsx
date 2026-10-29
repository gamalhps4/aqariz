"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { Loader2, CheckCircle2, XCircle, UserPlus } from "lucide-react";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type Status = "validating" | "ready" | "submitting" | "success" | "error";

function SetupPasswordInner() {
  const searchParams = useSearchParams();
  const { t, isRTL } = useLocalizationContext();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<Status>("validating");
  const [email, setEmail] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");

  // Validate the invitation token on load.
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage(t("auth.setup.noToken", { defaultValue: "The link is missing its invitation code. Open the link from the email again." }));
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `/api/auth/setup-password?token=${encodeURIComponent(token)}`
        );
        const data = await res.json();
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || t("auth.setup.invalid", { defaultValue: "This invitation is invalid or has expired." }));
        }
        setEmail(data?.data?.email || "");
        setTenantName(data?.data?.tenantName || "");
        setStatus("ready");
      } catch (err) {
        setStatus("error");
        setMessage(
          err instanceof Error
            ? err.message
            : t("auth.setup.invalid", { defaultValue: "This invitation is invalid or has expired." })
        );
      }
    })();
  }, [token, t]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");

    if (password.length < PASSWORD_MIN_LENGTH) {
      setFormError(t("auth.common.passwordTooShort", { defaultValue: "The password must be at least {count} characters long.", values: { count: PASSWORD_MIN_LENGTH } }));
      return;
    }
    if (password !== confirmPassword) {
      setFormError(t("auth.common.passwordMismatch", { defaultValue: "The passwords do not match." }));
      return;
    }

    setStatus("submitting");
    try {
      const res = await fetch("/api/auth/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || t("auth.setup.failed", { defaultValue: "Could not set up your account." }));
      }
      setStatus("success");
      setMessage(
        t("auth.setup.done", { defaultValue: "Your account is ready. Sign in with your email address and the password you just chose." })
      );
    } catch (err) {
      setStatus("ready");
      setFormError(
        err instanceof Error ? err.message : t("auth.setup.failed", { defaultValue: "Could not set up your account." })
      );
    }
  };

  return (
    <div dir={isRTL ? "rtl" : "ltr"} className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {status === "success" ? (
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            ) : status === "error" ? (
              <XCircle className="h-6 w-6 text-destructive" />
            ) : (
              <UserPlus className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle>
            {tenantName
              ? t("auth.setup.welcome", { defaultValue: "Welcome, {name}", values: { name: tenantName } })
              : t("auth.setup.title", { defaultValue: "Set up your account" })}
          </CardTitle>
          <CardDescription>
            {status === "validating"
              ? t("auth.setup.checking", { defaultValue: "Checking your invitation…" })
              : status === "error"
                ? t("auth.setup.unusable", { defaultValue: "This invitation can't be used" })
                : status === "success"
                  ? t("auth.common.allSet", { defaultValue: "All set" })
                  : email
                    ? t("auth.setup.chooseFor", { defaultValue: "Choose a password to activate your tenant account ({email})", values: { email } })
                    : t("auth.setup.choose", { defaultValue: "Choose a password to activate your tenant account" })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "validating" && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {(status === "ready" || status === "submitting") && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.common.password", { defaultValue: "Password" })}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={status === "submitting"}
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                />
                <p className="text-xs text-muted-foreground">
                  {t("auth.common.passwordMin", { defaultValue: "At least {count} characters.", values: { count: PASSWORD_MIN_LENGTH } })}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t("auth.setup.confirm", { defaultValue: "Confirm password" })}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={status === "submitting"}
                  required
                />
              </div>
              {formError && (
                <p className="text-sm text-destructive">{formError}</p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={status === "submitting"}
              >
                {status === "submitting" ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t("auth.setup.submitting", { defaultValue: "Creating your account…" })}
                  </>
                ) : (
                  t("auth.setup.submit", { defaultValue: "Activate account" })
                )}
              </Button>
            </form>
          )}

          {(status === "success" || status === "error") && (
            <>
              <p className="text-center text-sm text-muted-foreground">
                {message}
              </p>
              <Button asChild className="w-full">
                <Link href="/auth/signin">{t("auth.common.goToSignIn", { defaultValue: "Go to sign in" })}</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SetupPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SetupPasswordInner />
    </Suspense>
  );
}
