"use client";

/**
 * PropertyPro SaaS - Two-factor authentication
 *
 * Enrolment is a three-step flow because each step has a distinct failure the
 * user must be able to recover from:
 *   1. confirm the password (so a hijacked open session cannot enrol),
 *   2. scan the secret and prove a working code (so nobody locks themselves
 *      out with a mis-scanned QR),
 *   3. save the backup codes — shown exactly once, since they are stored
 *      hashed and cannot be re-displayed.
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type Step = "password" | "verify" | "codes";

export function TwoFactorSettings() {
  const { data: session, update } = useSession();
  const { t } = useLocalizationContext();
  const enabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)
      ?.twoFactorEnabled,
  );

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");

  function reset() {
    setStep("password");
    setPassword("");
    setCode("");
    setTotpUri("");
    setBackupCodes([]);
    setBusy(false);
  }

  /** The shared secret, for anyone who cannot scan a QR code. */
  const manualSecret = totpUri
    ? new URL(totpUri.replace("otpauth://", "https://")).searchParams.get(
        "secret",
      )
    : null;

  async function startEnrolment() {
    setBusy(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error) throw new Error(error.message || t("settings.twoFactor.startFailed", { defaultValue: "Could not start the setup" }));
      // `data` is a union; only the TOTP variant carries the URI/backup codes.
      const totpData = data && "totpURI" in data ? data : null;
      setTotpUri(totpData?.totpURI ?? "");
      setBackupCodes(totpData?.backupCodes ?? []);
      setStep("verify");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : t("settings.twoFactor.startFailed", { defaultValue: "Could not start the setup" }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    setBusy(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: code.trim(),
      });
      if (error) {
        throw new Error(
          error.message || t("settings.twoFactor.verifyFailed", { defaultValue: "That code is not valid — check the time on your phone" }),
        );
      }
      // Only now is 2FA actually on, so this is the moment to hand over the
      // backup codes.
      setStep("codes");
      update();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : t("settings.twoFactor.verifyFailed", { defaultValue: "That code is not valid — check the time on your phone" }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const { error } = await authClient.twoFactor.disable({
        password: disablePassword,
      });
      if (error) throw new Error(error.message || t("settings.twoFactor.offFailed", { defaultValue: "Could not turn it off" }));
      toast.success(t("settings.twoFactor.isOff", { defaultValue: "Two-step sign-in is off" }));
      setDisableOpen(false);
      setDisablePassword("");
      update();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : t("settings.twoFactor.offFailed", { defaultValue: "Could not turn it off" }),
      );
    } finally {
      setBusy(false);
    }
  }

  function copyCodes() {
    void navigator.clipboard.writeText(backupCodes.join("\n"));
    toast.success(t("settings.twoFactor.copied", { defaultValue: "Backup codes copied" }));
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {enabled ? (
                <ShieldCheck className="size-4 text-emerald-600" />
              ) : (
                <ShieldAlert className="size-4 text-muted-foreground" />
              )}
              {t("settings.twoFactor.title", { defaultValue: "Two-step sign-in" })}
              {enabled && (
                <Badge variant="secondary">
                  {t("settings.twoFactor.on", { defaultValue: "On" })}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {enabled
                ? t("settings.twoFactor.onDescription", { defaultValue: "Signing in asks for a code from your authenticator app as well as your password." })
                : t("settings.twoFactor.offDescription", { defaultValue: "Add a second step to signing in, so a stolen password is not enough on its own." })}
            </CardDescription>
          </div>
          {enabled ? (
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => setDisableOpen(true)}
            >
              <ShieldOff className="me-2 size-4" />
              {t("settings.twoFactor.turnOff", { defaultValue: "Turn off" })}
            </Button>
          ) : (
            <Button
              className="shrink-0"
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              {t("settings.twoFactor.setUp", { defaultValue: "Set up" })}
            </Button>
          )}
        </CardHeader>
        {enabled && (
          <CardContent className="text-sm text-muted-foreground">
            {t("settings.twoFactor.lostDevice", { defaultValue: "Lost your phone? Sign in with a backup code, then turn two-step sign-in off and set it up again." })}
          </CardContent>
        )}
      </Card>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Closing mid-enrolment leaves 2FA off; the codes are only real once
          // a TOTP code has been verified.
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent>
          {step === "password" && (
            <>
              <DialogHeader>
                <DialogTitle>{t("settings.twoFactor.confirmPassword", { defaultValue: "Confirm your password" })}</DialogTitle>
                <DialogDescription>
                  {t("settings.twoFactor.whyPassword", { defaultValue: "Asked again so that a session left open on a shared computer cannot change how you sign in." })}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2 py-2">
                <Label htmlFor="tfa-password">
                  {t("settings.twoFactor.password", { defaultValue: "Password" })}
                </Label>
                <Input
                  id="tfa-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </Button>
                <Button onClick={startEnrolment} disabled={busy || !password}>
                  {busy ? (
                    <>
                      <Loader2 className="me-2 size-4 animate-spin" />
                      {t("settings.twoFactor.checking", { defaultValue: "Checking…" })}
                    </>
                  ) : (
                    t("settings.twoFactor.continue", { defaultValue: "Continue" })
                  )}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "verify" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("settings.twoFactor.addTitle", { defaultValue: "Add it to your authenticator app" })}
                </DialogTitle>
                <DialogDescription>
                  {/* No QR image is drawn here, so the copy no longer says
                      "scan this" — the key below is what gets added. */}
                  {t("settings.twoFactor.addDescription", { defaultValue: "In Google Authenticator, Microsoft Authenticator, Authy or any TOTP app, add an account with the key below, then enter the code it shows." })}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                {manualSecret && (
                  <div className="rounded-lg border bg-muted/40 p-4 text-center">
                    <p className="text-xs text-muted-foreground">
                      {t("settings.twoFactor.key", { defaultValue: "Setup key" })}
                    </p>
                    <code className="mt-1 block break-all text-sm font-medium">
                      {manualSecret}
                    </code>
                  </div>
                )}
                {totpUri && (
                  <p className="break-all text-center text-xs text-muted-foreground">
                    {totpUri}
                  </p>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="tfa-code">
                    {t("settings.twoFactor.code", { defaultValue: "6-digit code" })}
                  </Label>
                  <Input
                    id="tfa-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    inputMode="numeric"
                    placeholder="123456"
                    autoComplete="one-time-code"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </Button>
                <Button onClick={confirmCode} disabled={busy || !code.trim()}>
                  {busy ? (
                    <>
                      <Loader2 className="me-2 size-4 animate-spin" />
                      {t("settings.twoFactor.verifying", { defaultValue: "Verifying…" })}
                    </>
                  ) : (
                    t("settings.twoFactor.verify", { defaultValue: "Verify and turn on" })
                  )}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "codes" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("settings.twoFactor.saveCodes", { defaultValue: "Save your backup codes" })}
                </DialogTitle>
                <DialogDescription>
                  {t("settings.twoFactor.saveCodesHint", { defaultValue: "Each code works once, and they are shown only now. Keep them where you can reach them without your phone." })}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-4 font-mono text-sm">
                {backupCodes.map((backupCode) => (
                  <span key={backupCode}>{backupCode}</span>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={copyCodes}>
                  <Copy className="me-2 size-4" />
                  {t("settings.twoFactor.copyCodes", { defaultValue: "Copy codes" })}
                </Button>
                <Button
                  onClick={() => {
                    setOpen(false);
                    reset();
                    toast.success(
                      t("settings.twoFactor.isOn", { defaultValue: "Two-step sign-in is on" }),
                    );
                  }}
                >
                  <Check className="me-2 size-4" />
                  {t("settings.twoFactor.saved", { defaultValue: "I have saved them" })}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.twoFactor.offTitle", { defaultValue: "Turn off two-step sign-in" })}
            </DialogTitle>
            <DialogDescription>
              {t("settings.twoFactor.offHint", { defaultValue: "Your password alone will protect the account, and your backup codes stop working." })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="tfa-disable-password">{t("settings.twoFactor.confirmPassword", { defaultValue: "Confirm your password" })}</Label>
            <Input
              id="tfa-disable-password"
              type="password"
              value={disablePassword}
              onChange={(event) => setDisablePassword(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableOpen(false)}>
              {t("settings.twoFactor.keepOn", { defaultValue: "Keep it on" })}
            </Button>
            <Button
              variant="destructive"
              onClick={disable}
              disabled={busy || !disablePassword}
            >
              {busy
                ? t("settings.twoFactor.turningOff", { defaultValue: "Turning off…" })
                : t("settings.twoFactor.turnOff", { defaultValue: "Turn off" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
