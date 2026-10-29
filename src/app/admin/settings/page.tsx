"use client";

import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  AlertCircle,
  Loader2,
  Mail,
  MessageSquare,
  Palette,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCallback, useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LogoUpload } from "@/components/settings/logo-upload";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { PlatformMessagingSettings } from "@/components/admin/platform-messaging-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APP_CURRENCY } from "@/lib/regional/region";

// Client-safe mirror of `PublicPlatformSettings` (`@/lib/platform/settings`):
// the SMTP password is never sent down, only a boolean.
interface PlatformSettings {
  general: {
    platformName: string;
    supportEmail: string;
    logoLight: string;
    logoDark: string;
    favicon: string;
    defaultCurrency: string;
    defaultTimezone: string;
    defaultLanguage: string;
  };
  registration: {
    allowSignups: boolean;
    requireEmailVerification: boolean;
    defaultTrialDays: number;
  };
  maintenance: { enabled: boolean; message: string };
  email: {
    fromName: string;
    fromEmail: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPasswordSet: boolean;
  };
}

type Group = keyof PlatformSettings;

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export default function PlatformSettingsPage() {
  const { t } = useLocalizationContext();
  const [data, setData] = useState<PlatformSettings | null>(null);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [tab, setTab] = useState("general");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/settings");
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load settings");
      }
      setData(payload.data.settings as PlatformSettings);
      setSmtpPassword("");
      setDirty(false);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("platform.settings.loadError", { defaultValue: "Unable to load settings" }),
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function patch<G extends Group>(
    group: G,
    value: Partial<PlatformSettings[G]>,
  ) {
    setData((prev) =>
      prev ? { ...prev, [group]: { ...prev[group], ...value } } : prev,
    );
    setDirty(true);
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const payload = {
        general: data.general,
        registration: data.registration,
        maintenance: data.maintenance,
        email: {
          fromName: data.email.fromName,
          fromEmail: data.email.fromEmail,
          smtpHost: data.email.smtpHost,
          smtpPort: data.email.smtpPort,
          smtpSecure: data.email.smtpSecure,
          smtpUser: data.email.smtpUser,
          // Omit unless the admin typed a new password (write-only).
          ...(smtpPassword ? { smtpPassword } : {}),
        },
      };
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to save");
      }
      setData(result.data.settings as PlatformSettings);
      setSmtpPassword("");
      setDirty(false);
      toast.success(t("platform.settings.saved", { defaultValue: "Platform settings saved" }));
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : t("platform.settings.saveFailed", { defaultValue: "Failed to save" }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function sendTestEmail() {
    setTesting(true);
    try {
      const response = await fetch("/api/admin/settings/test-email", {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to send test email");
      }
      toast.success(result.message || "Test email sent");
    } catch (testError) {
      toast.error(
        testError instanceof Error
          ? testError.message
          : t("platform.settings.testEmailFailed", { defaultValue: "Failed to send test email" }),
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("platform.settings.title", { defaultValue: "Platform settings" })}
          </h1>
          <p className="text-muted-foreground">
            {t("platform.settings.subtitle", { defaultValue: "Manage platform-wide identity, signups, maintenance, and email." })}
          </p>
        </div>
        {/* The Messaging tab saves on its own. */}
        {tab !== "messaging" && (
          <Button onClick={save} disabled={!dirty || saving || !data}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {dirty ? "Save changes" : "All changes saved"}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {data && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="general">
              <Palette className="me-1.5 h-4 w-4" /> {t("platform.settings.tab.general", { defaultValue: "General" })}
            </TabsTrigger>
            <TabsTrigger value="registration">
              <UserPlus className="me-1.5 h-4 w-4" /> {t("platform.settings.tab.registration", { defaultValue: "Registration" })}
            </TabsTrigger>
            <TabsTrigger value="maintenance">
              <ShieldAlert className="me-1.5 h-4 w-4" /> {t("platform.settings.tab.maintenance", { defaultValue: "Maintenance" })}
            </TabsTrigger>
            <TabsTrigger value="email">
              <Mail className="me-1.5 h-4 w-4" /> {t("platform.settings.tab.email", { defaultValue: "Email" })}
            </TabsTrigger>
            <TabsTrigger value="messaging">
              <MessageSquare className="me-1.5 h-4 w-4" /> {t("platform.settings.tab.messaging", { defaultValue: "SMS & WhatsApp" })}
            </TabsTrigger>
          </TabsList>

          {/* General & Branding */}
          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>{t("platform.settings.generalHeading", { defaultValue: "General &amp; branding" })}</CardTitle>
                <CardDescription>
                  Platform identity and the defaults applied to new
                  organizations.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-5 md:grid-cols-2">
                  <FieldRow label={t("platform.settings.platformName", { defaultValue: "Platform name" })}>
                    <Input
                      value={data.general.platformName}
                      onChange={(e) =>
                        patch("general", { platformName: e.target.value })
                      }
                      placeholder="PropertyPro"
                    />
                  </FieldRow>
                  <FieldRow
                    label={t("platform.settings.supportEmail", { defaultValue: "Support email" })}
                    hint={t("platform.settings.supportEmailHint", { defaultValue: "Shown to customers for help requests." })}
                  >
                    <Input
                      type="email"
                      value={data.general.supportEmail}
                      onChange={(e) =>
                        patch("general", { supportEmail: e.target.value })
                      }
                      placeholder="support@example.com"
                    />
                  </FieldRow>
                  <FieldRow label={t("platform.settings.defaultCurrency", { defaultValue: "Default currency" })}>
                    {/* Shown, not chosen: the platform works in riyal only
                        (lib/regional/region), offices and subscriptions alike. */}
                    <div className="flex h-10 items-center rounded-md border border-input bg-muted/50 px-3 text-sm font-medium" dir="ltr">
                      {APP_CURRENCY}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("platform.settings.currencyFixed", {
                        defaultValue:
                          "The platform works in Saudi riyal only: subscription prices, offices and every amount.",
                      })}
                    </p>
                  </FieldRow>
                  <FieldRow label={t("platform.settings.defaultLanguage", { defaultValue: "Default language" })}>
                    <Select
                      value={data.general.defaultLanguage}
                      onValueChange={(v) =>
                        patch("general", { defaultLanguage: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((l) => (
                          <SelectItem key={l.value} value={l.value}>
                            {l.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow
                    label={t("platform.settings.defaultTimezone", { defaultValue: "Default timezone" })}
                    hint={t("platform.settings.timezoneHint", { defaultValue: "IANA name, e.g. America/New_York." })}
                  >
                    <Input
                      value={data.general.defaultTimezone}
                      onChange={(e) =>
                        patch("general", { defaultTimezone: e.target.value })
                      }
                      placeholder="America/New_York"
                    />
                  </FieldRow>
                </div>

                <div className="space-y-4 border-t pt-6">
                  <div>
                    <h3 className="text-sm font-medium">{t("platform.settings.brandingAssets", { defaultValue: "Branding assets" })}</h3>
                    <p className="text-xs text-muted-foreground">
                      Logos and favicon shown across the platform. PNG, JPEG,
                      WebP, or ICO, up to 2MB.
                    </p>
                  </div>
                  <div className="grid gap-5 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">
                        {t("platform.settings.logoLight", { defaultValue: "Logo (light background)" })}
                      </Label>
                      <LogoUpload
                        type="logo"
                        variant="light"
                        endpoint="/api/admin/settings/upload"
                        currentUrl={data.general.logoLight}
                        onUpload={(result) =>
                          patch("general", { logoLight: result.url })
                        }
                        onRemove={() => patch("general", { logoLight: "" })}
                        onError={(message) => toast.error(message)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">
                        {t("platform.settings.logoDark", { defaultValue: "Logo (dark background)" })}
                      </Label>
                      <LogoUpload
                        type="logo"
                        variant="dark"
                        endpoint="/api/admin/settings/upload"
                        currentUrl={data.general.logoDark}
                        onUpload={(result) =>
                          patch("general", { logoDark: result.url })
                        }
                        onRemove={() => patch("general", { logoDark: "" })}
                        onError={(message) => toast.error(message)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">{t("platform.settings.favicon", { defaultValue: "Favicon" })}</Label>
                      <LogoUpload
                        type="favicon"
                        variant="favicon"
                        endpoint="/api/admin/settings/upload"
                        currentUrl={data.general.favicon}
                        onUpload={(result) =>
                          patch("general", { favicon: result.url })
                        }
                        onRemove={() => patch("general", { favicon: "" })}
                        onError={(message) => toast.error(message)}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Registration & Onboarding */}
          <TabsContent value="registration">
            <Card>
              <CardHeader>
                <CardTitle>{t("platform.settings.registrationHeading", { defaultValue: "Registration &amp; onboarding" })}</CardTitle>
                <CardDescription>
                  {t("platform.settings.registrationHint", { defaultValue: "Control who can create new organizations." })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ToggleRow
                  label={t("platform.settings.allowSignups", { defaultValue: "Allow new sign-ups" })}
                  hint={t("platform.settings.allowSignupsHint", { defaultValue: "When off, the public organization signup is closed." })}
                  checked={data.registration.allowSignups}
                  onCheckedChange={(v) =>
                    patch("registration", { allowSignups: v })
                  }
                />
                <ToggleRow
                  label={t("platform.settings.requireVerification", { defaultValue: "Require email verification" })}
                  hint={t("platform.settings.requireVerificationHint", { defaultValue: "New owners must verify their email before full access." })}
                  checked={data.registration.requireEmailVerification}
                  onCheckedChange={(v) =>
                    patch("registration", { requireEmailVerification: v })
                  }
                />
                <FieldRow
                  label={t("platform.settings.trialLength", { defaultValue: "Default trial length (days)" })}
                  hint={t("platform.settings.trialLengthHint", { defaultValue: "Trial granted to a brand-new organization. 0 disables the trial." })}
                >
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={data.registration.defaultTrialDays}
                    onChange={(e) =>
                      patch("registration", {
                        defaultTrialDays: Number(e.target.value) || 0,
                      })
                    }
                    className="max-w-40"
                  />
                </FieldRow>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Maintenance */}
          <TabsContent value="maintenance">
            <Card>
              <CardHeader>
                <CardTitle>{t("platform.settings.maintenanceHeading", { defaultValue: "Maintenance mode" })}</CardTitle>
                <CardDescription>
                  Temporarily lock the app for tenants while you make changes.
                  Super-admins keep access.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ToggleRow
                  label={t("platform.settings.enableMaintenance", { defaultValue: "Enable maintenance mode" })}
                  hint={t("platform.settings.enableMaintenanceHint", { defaultValue: "Non-admin users see a maintenance screen instead of the dashboard." })}
                  checked={data.maintenance.enabled}
                  onCheckedChange={(v) => patch("maintenance", { enabled: v })}
                />
                <FieldRow
                  label={t("platform.settings.maintenanceMessage", { defaultValue: "Maintenance message" })}
                  hint={t("platform.settings.maintenanceMessageHint", { defaultValue: "Shown on the maintenance screen." })}
                >
                  <Textarea
                    rows={3}
                    value={data.maintenance.message}
                    onChange={(e) =>
                      patch("maintenance", { message: e.target.value })
                    }
                    placeholder={t("platform.settings.maintenancePlaceholder", { defaultValue: "We'll be back shortly." })}
                  />
                </FieldRow>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Email / SMTP */}
          <TabsContent value="email">
            <Card>
              <CardHeader>
                <CardTitle>{t("platform.settings.emailHeading", { defaultValue: "Email (SMTP)" })}</CardTitle>
                <CardDescription>
                  Transactional email configuration. Falls back to environment
                  variables when blank.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 md:grid-cols-2">
                <FieldRow label={t("platform.settings.fromName", { defaultValue: "From name" })}>
                  <Input
                    value={data.email.fromName}
                    onChange={(e) =>
                      patch("email", { fromName: e.target.value })
                    }
                    placeholder="PropertyPro"
                  />
                </FieldRow>
                <FieldRow label={t("platform.settings.fromEmail", { defaultValue: "From email" })}>
                  <Input
                    type="email"
                    value={data.email.fromEmail}
                    onChange={(e) =>
                      patch("email", { fromEmail: e.target.value })
                    }
                    placeholder="noreply@example.com"
                  />
                </FieldRow>
                <FieldRow label={t("platform.settings.smtpHost", { defaultValue: "SMTP host" })}>
                  <Input
                    value={data.email.smtpHost}
                    onChange={(e) =>
                      patch("email", { smtpHost: e.target.value })
                    }
                    placeholder="smtp.example.com"
                  />
                </FieldRow>
                <FieldRow label={t("platform.settings.smtpPort", { defaultValue: "SMTP port" })}>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={data.email.smtpPort}
                    onChange={(e) =>
                      patch("email", {
                        smtpPort: Number(e.target.value) || 587,
                      })
                    }
                  />
                </FieldRow>
                <FieldRow label={t("platform.settings.smtpUser", { defaultValue: "SMTP username" })}>
                  <Input
                    value={data.email.smtpUser}
                    onChange={(e) =>
                      patch("email", { smtpUser: e.target.value })
                    }
                    placeholder="apikey"
                  />
                </FieldRow>
                <FieldRow
                  label={t("platform.settings.smtpPassword", { defaultValue: "SMTP password" })}
                  hint={
                    data.email.smtpPasswordSet
                      ? t("platform.settings.passwordStored", { defaultValue: "A password is stored. Type a new one to replace it; leave blank to keep." })
                      : t("platform.settings.noPasswordStored", { defaultValue: "No password stored yet." })
                  }
                >
                  <Input
                    type="password"
                    value={smtpPassword}
                    onChange={(e) => {
                      setSmtpPassword(e.target.value);
                      setDirty(true);
                    }}
                    placeholder={
                      data.email.smtpPasswordSet
                        ? "•••••••• (set)"
                        : t("platform.settings.enterPassword", { defaultValue: "Enter password" })
                    }
                    autoComplete="new-password"
                  />
                </FieldRow>
                <div className="md:col-span-2">
                  <ToggleRow
                    label="Use TLS/SSL (secure)"
                    hint="Enable for port 465; usually off for 587 (STARTTLS)."
                    checked={data.email.smtpSecure}
                    onCheckedChange={(v) => patch("email", { smtpSecure: v })}
                  />
                </div>
                <div className="flex items-center gap-3 md:col-span-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={sendTestEmail}
                    disabled={testing || dirty}
                  >
                    {testing && (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    )}
                    Send test email
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {dirty
                      ? "Save changes first to test."
                      : "Sends a test message to your account email."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SMS & WhatsApp default gateway */}
          <TabsContent value="messaging">
            <PlatformMessagingSettings />
          </TabsContent>
        </Tabs>
      )}
    </ResponsiveLayout>
  );
}
