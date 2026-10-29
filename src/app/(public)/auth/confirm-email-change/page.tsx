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

function ConfirmEmailChangeInner() {
  const searchParams = useSearchParams();
  const { t, isRTL } = useLocalizationContext();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<Status>("validating");
  const [newEmail, setNewEmail] = useState("");
  const [message, setMessage] = useState("");

  // Validate the token on load.
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage(t("auth.emailChange.noToken", { defaultValue: "The link is missing its confirmation code. Open the link from the email again." }));
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `/api/user/confirm-email-change?token=${encodeURIComponent(token)}`
        );
        const data = await res.json();
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || t("auth.common.linkInvalid", { defaultValue: "This link is invalid or has expired." }));
        }
        setNewEmail(data?.data?.newEmail || "");
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
      const res = await fetch("/api/user/confirm-email-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || t("auth.emailChange.failed", { defaultValue: "Could not confirm the email change." }));
      }
      setStatus("success");
      setMessage(
        t("auth.emailChange.done", { defaultValue: "Your email address has been updated. Sign in again with the new address." })
      );
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : t("auth.emailChange.failed", { defaultValue: "Could not confirm the email change." })
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
          <CardTitle>{t("auth.emailChange.title", { defaultValue: "Confirm email change" })}</CardTitle>
          <CardDescription>
            {status === "validating" &&
              t("auth.emailChange.checking", { defaultValue: "Checking your confirmation link…" })}
            {status === "ready" &&
              t("auth.emailChange.prompt", { defaultValue: "Confirm changing your account email to {email}.", values: { email: newEmail } })}
            {status === "confirming" &&
              t("auth.emailChange.updating", { defaultValue: "Updating your email…" })}
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
              {t("auth.emailChange.button", { defaultValue: "Change it to {email}", values: { email: newEmail } })}
            </Button>
          )}

          {status === "confirming" && (
            <Button className="w-full" disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("auth.emailChange.busy", { defaultValue: "Confirming…" })}
            </Button>
          )}

          {status === "success" && (
            <Button className="w-full" asChild>
              <Link href="/auth/signin">{t("auth.common.goToSignIn", { defaultValue: "Go to sign in" })}</Link>
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

export default function ConfirmEmailChangePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ConfirmEmailChangeInner />
    </Suspense>
  );
}
