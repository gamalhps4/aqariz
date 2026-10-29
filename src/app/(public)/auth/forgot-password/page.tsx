"use client";

/**
 * Forgot password: ask for the address, send the reset link.
 *
 * The API existed (POST /api/auth/forgot-password) and the reset page existed,
 * but nothing in between — the sign-in form had no "forgot password" link and
 * the one on the auth error page pointed here, at a page that did not exist.
 * The answer is the same whether or not the address has an account, exactly
 * as the API's is, so this page cannot be used to learn who is registered.
 */

import { useState } from "react";
import Link from "next/link";
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
import { Loader2, MailCheck, KeyRound } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type Status = "idle" | "sending" | "sent";

export default function ForgotPasswordPage() {
  const { t, isRTL } = useLocalizationContext();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("sending");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(
          data?.error ||
            data?.message ||
            t("auth.forgot.failed", { defaultValue: "Could not send the link. Try again in a few minutes." }),
        );
      }
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setError(
        err instanceof Error && err.message
          ? err.message
          : t("auth.forgot.failed", {
              defaultValue: "Could not send the link. Try again in a few minutes.",
            }),
      );
    }
  };

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="flex flex-1 items-center justify-center px-4 py-20 sm:px-6 sm:py-28 lg:px-8"
    >
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {status === "sent" ? (
              <MailCheck className="h-6 w-6 text-green-600" />
            ) : (
              <KeyRound className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle>
            {status === "sent"
              ? t("auth.forgot.sentTitle", { defaultValue: "Check your email" })
              : t("auth.forgot.title", { defaultValue: "Forgot your password?" })}
          </CardTitle>
          <CardDescription>
            {status === "sent"
              ? t("auth.forgot.sentBody", { defaultValue: "If {email} belongs to an account, a link to choose a new password is on its way. It works for one hour.", values: { email } })
              : t("auth.forgot.hint", { defaultValue: "Enter the email you sign in with and we will send you a link to choose a new password." })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status !== "sent" ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.common.email", { defaultValue: "Email address" })}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  disabled={status === "sending"}
                  required
                  autoFocus
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={status === "sending" || !email.trim()}
              >
                {status === "sending" ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t("auth.forgot.sending", { defaultValue: "Sending…" })}
                  </>
                ) : (
                  t("auth.forgot.submit", { defaultValue: "Send the link" })
                )}
              </Button>
            </form>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setStatus("idle");
                setError("");
              }}
            >
              {t("auth.forgot.again", { defaultValue: "Use a different email" })}
            </Button>
          )}
          <Button asChild variant="ghost" className="w-full">
            <Link href="/auth/signin">
              {t("auth.common.backToSignIn", { defaultValue: "Back to sign in" })}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
