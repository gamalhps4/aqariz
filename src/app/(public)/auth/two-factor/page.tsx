"use client";

/**
 * Two-factor challenge.
 *
 * Reached only from the sign-in form, after a correct password, while Better
 * Auth holds a short-lived challenge cookie. Nobody is signed in until a code
 * is accepted here, so landing on this page directly simply fails to verify.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { landingPathForUser } from "@/lib/auth-landing";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

function TwoFactorForm() {
  const router = useRouter();
  const { t } = useLocalizationContext();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { data, error: verifyError } = useBackupCode
        ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
        : await authClient.twoFactor.verifyTotp({
            code: code.trim(),
            trustDevice,
          });

      if (verifyError) {
        setError(
          verifyError.message ||
            (useBackupCode
              ? t("auth.twoFactor.badBackup", { defaultValue: "That backup code isn't valid" })
              : t("auth.twoFactor.badCode", { defaultValue: "That code isn't valid — check your authenticator and try again" })),
        );
        setLoading(false);
        return;
      }

      // Same routing rule as the password form: the verified user decides
      // where they land, so a super-admin goes straight to the console instead
      // of loading the org dashboard only to be bounced out of it. Falls back
      // to the requested target when the response carries no user.
      const verifiedUser = (data as { user?: { role?: string; organizationId?: string | null } } | null)
        ?.user;
      router.replace(
        verifiedUser ? landingPathForUser(verifiedUser, callbackUrl) : callbackUrl,
      );
      router.refresh();
    } catch {
      setError(t("auth.twoFactor.failed", { defaultValue: "Could not verify the code. Try again." }));
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="size-6" />
        </div>
        <CardTitle className="mt-3">
          {t("auth.twoFactor.title", { defaultValue: "Two-factor verification" })}
        </CardTitle>
        <CardDescription>
          {useBackupCode
            ? t("auth.twoFactor.backupHint", { defaultValue: "Enter one of the backup codes you saved when you turned on two-factor authentication." })
            : t("auth.twoFactor.appHint", { defaultValue: "Enter the 6-digit code from your authenticator app." })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="code">
              {useBackupCode
                ? t("auth.twoFactor.backupLabel", { defaultValue: "Backup code" })
                : t("auth.twoFactor.codeLabel", { defaultValue: "Authentication code" })}
            </Label>
            <Input
              id="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode={useBackupCode ? "text" : "numeric"}
              placeholder={useBackupCode ? "xxxxx-xxxxx" : "123456"}
              autoFocus
              required
            />
          </div>

          {!useBackupCode && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(event) => setTrustDevice(event.target.checked)}
                className="size-4"
              />
              {t("auth.twoFactor.trust", { defaultValue: "Don't ask again on this device for 60 days" })}
            </label>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading || !code.trim()}>
            {loading ? (
              <>
                <Loader2 className="me-2 size-4 animate-spin" />
                {t("auth.twoFactor.verifying", { defaultValue: "Verifying…" })}
              </>
            ) : (
              t("auth.twoFactor.submit", { defaultValue: "Verify and sign in" })
            )}
          </Button>

          <button
            type="button"
            onClick={() => {
              setUseBackupCode((current) => !current);
              setCode("");
              setError("");
            }}
            className="inline-flex items-center justify-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <KeyRound className="size-3.5" />
            {useBackupCode
              ? t("auth.twoFactor.useApp", { defaultValue: "Use my authenticator app instead" })
              : t("auth.twoFactor.useBackup", { defaultValue: "I don't have my authenticator — use a backup code" })}
          </button>

          <p className="text-center text-xs text-muted-foreground">
            {t("auth.twoFactor.lockedOut", { defaultValue: "Locked out?" })}{" "}
            <Link href="/contact" className="underline underline-offset-4">
              {t("auth.twoFactor.contact", { defaultValue: "Contact support" })}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function TwoFactorPage() {
  const { t, isRTL } = useLocalizationContext();
  return (
    <div dir={isRTL ? "rtl" : "ltr"} className="flex min-h-screen items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="text-sm text-muted-foreground">
            {t("common.loading", { defaultValue: "Loading…" })}
          </div>
        }
      >
        <TwoFactorForm />
      </Suspense>
    </div>
  );
}
