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
import { Loader2, CheckCircle2, XCircle, Mail } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type Status = "validating" | "ready" | "confirming" | "success" | "error";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const { t, isRTL } = useLocalizationContext();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<Status>("validating");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  // Validate the token on load.
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage(t("auth.verifyEmail.noToken", { defaultValue: "The link is missing its verification code. Open the link from the email again." }));
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `/api/user/confirm-email-verification?token=${encodeURIComponent(token)}`
        );
        const data = await res.json();
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || t("auth.common.linkInvalid", { defaultValue: "This link is invalid or has expired." }));
        }
        setEmail(data?.data?.email || "");
        setStatus("ready");
      } catch (err) {
        setStatus("error");
        setMessage(
          err instanceof Error ? err.message : t("auth.common.linkInvalid", { defaultValue: "This link is invalid or has expired." })
        );
      }
    })();
  }, [token, t]);

  const handleConfirm = async () => {
    setStatus("confirming");
    try {
      const res = await fetch("/api/user/confirm-email-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || t("auth.verifyEmail.failed", { defaultValue: "Could not verify your email." }));
      }
      setStatus("success");
      setMessage(t("auth.verifyEmail.done", { defaultValue: "Your email address is verified. Thank you!" }));
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : t("auth.verifyEmail.failed", { defaultValue: "Could not verify your email." })
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
              <XCircle className="h-6 w-6 text-red-600" />
            ) : (
              <Mail className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle>{t("auth.verifyEmail.title", { defaultValue: "Verify your email" })}</CardTitle>
          <CardDescription>
            {status === "validating" &&
              t("auth.verifyEmail.checking", { defaultValue: "Checking your verification link…" })}
            {status === "ready" &&
              t("auth.verifyEmail.prompt", { defaultValue: "Confirm that {email} is your email address.", values: { email } })}
            {status === "confirming" &&
              t("auth.verifyEmail.verifying", { defaultValue: "Verifying your email…" })}
            {(status === "success" || status === "error") && message}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "validating" && (
            <div className="flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {status === "ready" && (
            <Button className="w-full" onClick={handleConfirm}>
              {t("auth.verifyEmail.button", { defaultValue: "Verify {email}", values: { email } })}
            </Button>
          )}

          {status === "confirming" && (
            <Button className="w-full" disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("auth.verifyEmail.busy", { defaultValue: "Verifying…" })}
            </Button>
          )}

          {status === "success" && (
            <Button className="w-full" asChild>
              <Link href="/dashboard/settings/security">
                {t("auth.common.backToSecurity", { defaultValue: "Back to security settings" })}
              </Link>
            </Button>
          )}

          {status === "error" && (
            <Button variant="outline" className="w-full" asChild>
              <Link href="/dashboard/settings/security">
                {t("auth.common.backToSecurity", { defaultValue: "Back to security settings" })}
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
