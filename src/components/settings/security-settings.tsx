"use client";

import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Lock,
  Mail,
  BadgeCheck,
  ShieldAlert,
} from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface SecuritySettingsProps {
  user:
    | { email?: string; emailVerified?: string | Date | null }
    | null;
  onAlert: (type: "success" | "error" | "info", message: string) => void;
}

export function SecuritySettings({ user, onAlert }: SecuritySettingsProps) {
  const { t } = useLocalizationContext();

  // ---- Password change state ----
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  // ---- Email change state ----
  const [emailPassword, setEmailPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  // ---- Email verification state ----
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const isEmailVerified = Boolean(user?.emailVerified);

  const handleSendVerification = async () => {
    setVerifyLoading(true);
    try {
      const res = await fetch("/api/user/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(
          data?.error ||
            data?.message ||
            t("settings.security.verifyEmail.failed")
        );
      }
      setVerificationSent(true);
      onAlert(
        "success",
        data?.message || t("settings.security.verifyEmail.sent")
      );
    } catch (err) {
      onAlert(
        "error",
        err instanceof Error
          ? err.message
          : t("settings.security.verifyEmail.failed")
      );
    } finally {
      setVerifyLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      onAlert("error", t("settings.security.toast.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      onAlert("error", t("settings.security.toast.passwordMismatch"));
      return;
    }

    setPwLoading(true);
    try {
      const res = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(
          data?.error ||
            data?.message ||
            t("settings.security.toast.passwordFailed")
        );
      }
      onAlert("success", t("settings.security.toast.passwordSuccess"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      onAlert(
        "error",
        err instanceof Error
          ? err.message
          : t("settings.security.toast.passwordFailed")
      );
    } finally {
      setPwLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newEmail.trim()) {
      onAlert("error", t("settings.security.toast.emailRequired"));
      return;
    }

    setEmailLoading(true);
    try {
      const res = await fetch("/api/user/change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: emailPassword, newEmail }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(
          data?.error ||
            data?.message ||
            t("settings.security.toast.emailFailed")
        );
      }
      onAlert(
        "success",
        data?.message ||
          t("settings.security.toast.emailSent", { values: { email: newEmail } })
      );
      setEmailPassword("");
      setNewEmail("");
    } catch (err) {
      onAlert(
        "error",
        err instanceof Error
          ? err.message
          : t("settings.security.toast.emailFailed")
      );
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Email Verification */}
      <Card id="verification">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {isEmailVerified ? (
              <BadgeCheck className="h-5 w-5 text-green-600" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-amber-600" />
            )}
            {t("settings.security.verifyEmail.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.security.verifyEmail.currentEmail", {
              values: { email: user?.email || "—" },
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t("settings.security.verifyEmail.status")}
              </span>
              {isEmailVerified ? (
                <Badge variant="default" className="bg-green-600">
                  {t("settings.security.verifyEmail.verified")}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {t("settings.security.verifyEmail.notVerified")}
                </Badge>
              )}
            </div>
            {!isEmailVerified && (
              <Button
                type="button"
                variant="outline"
                onClick={handleSendVerification}
                disabled={verifyLoading}
              >
                {verifyLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {verifyLoading
                  ? t("settings.security.verifyEmail.sending")
                  : verificationSent
                    ? t("settings.security.verifyEmail.resend")
                    : t("settings.security.verifyEmail.send")}
              </Button>
            )}
          </div>
          {!isEmailVerified && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("settings.security.verifyEmail.description")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card id="password">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-5 w-5" />
            {t("settings.security.password.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.security.password.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">
                {t("settings.security.password.currentPassword")}
              </Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">
                {t("settings.security.password.newPassword")}
              </Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
                {t("settings.security.password.confirmPassword")}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={pwLoading}>
              {pwLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {pwLoading
                ? t("settings.security.password.submitting")
                : t("settings.security.password.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Change Email */}
      <Card id="email">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="h-5 w-5" />
            {t("settings.security.email.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.security.email.currentEmail", {
              values: { email: user?.email || "—" },
            })}
            <br />
            {t("settings.security.email.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleEmailSubmit} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="newEmail">
                {t("settings.security.email.newEmail")}
              </Label>
              <Input
                id="newEmail"
                type="email"
                autoComplete="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emailPassword">
                {t("settings.security.email.currentPassword")}
              </Label>
              <Input
                id="emailPassword"
                type="password"
                autoComplete="current-password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={emailLoading}>
              {emailLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {emailLoading
                ? t("settings.security.email.submitting")
                : t("settings.security.email.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
