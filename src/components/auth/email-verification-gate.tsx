"use client";

/**
 * PropertyPro SaaS - Email verification gate
 *
 * When the platform requires verified emails, an unverified owner's API calls
 * are refused server-side with `EMAIL_NOT_VERIFIED` (see api-utils). Without
 * this screen the dashboard would simply render a wall of failed requests, so
 * the gate replaces the app with something actionable: what is blocked, and
 * the one button that fixes it.
 *
 * The real enforcement is the server gate — this is the user-facing half.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MailCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface GateState {
  required: boolean;
  verified: boolean;
  email: string;
}

export function EmailVerificationGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<GateState | null>(null);
  const [sending, setSending] = useState(false);
  // Bumped by the "I've confirmed it" button to re-run the probe below.
  const [probe, setProbe] = useState(0);
  const { t } = useLocalizationContext();

  useEffect(() => {
    let active = true;
    fetch("/api/auth/verification-status")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && payload?.data) setState(payload.data);
      })
      .catch(() => {
        // Never block the dashboard because this probe failed.
      });
    return () => {
      active = false;
    };
  }, [probe]);

  async function resend() {
    setSending(true);
    try {
      const response = await fetch("/api/user/send-verification-email", {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.error ||
            t("auth.verify.sendFailed", { defaultValue: "Could not send the email" }),
        );
      }
      toast.success(
        t("auth.verify.sent", { defaultValue: "Confirmation email sent" }),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("auth.verify.sendFailed", { defaultValue: "Could not send the email" }),
      );
    } finally {
      setSending(false);
    }
  }

  if (!state || !state.required || state.verified) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
          <MailCheck className="size-7" />
        </div>
        <h1 className="mt-5 text-xl font-semibold">
          {t("auth.verify.title", { defaultValue: "Confirm your email" })}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("auth.verify.body", { defaultValue: "A confirmation link was sent to {email}. Open it to unlock your workspace.", values: { email: state.email } })}
        </p>

        <div className="mt-7 grid gap-2">
          <Button onClick={resend} disabled={sending}>
            {sending ? (
              <>
                <RefreshCw className="me-2 size-4 animate-spin" />
                {t("admin.invites.sending", { defaultValue: "Sending…" })}
              </>
            ) : (
              t("auth.verify.resend", { defaultValue: "Send the email again" })
            )}
          </Button>
          <Button variant="ghost" onClick={() => setProbe((n) => n + 1)}>
            {t("auth.verify.done", { defaultValue: "I have confirmed it — refresh" })}
          </Button>
        </div>

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-6 text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("auth.verify.signOut", { defaultValue: "Sign out" })}
        </button>

        <p className="mt-6 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          {t("auth.verify.help", { defaultValue: "Not seeing it? Check your spam folder, and that {email} is the address you meant to use.", values: { email: state.email } })}
        </p>
      </div>
    </div>
  );
}
