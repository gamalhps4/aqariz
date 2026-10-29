"use client";

/**
 * PropertyPro SaaS - Platform admin profile (super-admin)
 *
 * The org dashboard's profile screen (`/dashboard/settings/profile`) talks to
 * org-scoped endpoints that refuse an org-less caller, so the console has its
 * own screen backed by `/api/admin/profile`. Kept in the console's plain
 * state + Card idiom to match `/admin/settings`.
 */

import Image from "@/components/ui/app-image";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  KeyRound,
  Loader2,
  Trash2,
  UserRound,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSession } from "@/lib/auth-client";
import { useUserAvatar } from "@/components/providers/UserAvatarProvider";
import { logClientError, logClientWarn } from "@/utils/logger";
import PlatformProfileLoading from "./loading";

interface PlatformProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatar: string | null;
  bio: string | null;
  location: string | null;
  city: string | null;
  website: string | null;
  role: string;
  emailVerified: string | null;
  twoFactorEnabled: boolean;
  lastLogin: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
}

type ProfileForm = {
  firstName: string;
  lastName: string;
  phone: string;
  location: string;
  city: string;
  website: string;
  bio: string;
};

const EMPTY_FORM: ProfileForm = {
  firstName: "",
  lastName: "",
  phone: "",
  location: "",
  city: "",
  website: "",
  bio: "",
};

const toForm = (profile: PlatformProfile): ProfileForm => ({
  firstName: profile.firstName || "",
  lastName: profile.lastName || "",
  phone: profile.phone || "",
  location: profile.location || "",
  city: profile.city || "",
  website: profile.website || "",
  bio: profile.bio || "",
});

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

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

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function PlatformProfilePage() {
  const { t } = useLocalizationContext();
  const { update: updateSession } = useSession();
  const { avatarUrl, setAvatarUrl } = useUserAvatar();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<PlatformProfile | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [changingPassword, setChangingPassword] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/profile", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load profile");
      }
      const user = payload.data.user as PlatformProfile;
      setProfile(user);
      setForm(toForm(user));
      setDirty(false);
      setError("");
      if (user.avatar) setAvatarUrl(user.avatar);
    } catch (loadError) {
      logClientError("Platform profile load error:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("platform.profile.loadError", { defaultValue: "Unable to load profile" }),
      );
    }
  }, [setAvatarUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  // The header/sidebar read name + avatar from the session, so refresh it
  // after a write instead of leaving stale chrome behind.
  const refreshSession = async () => {
    try {
      await updateSession();
    } catch (sessionError) {
      logClientWarn("Failed to refresh session after profile update:", sessionError);
    }
  };

  function patch(value: Partial<ProfileForm>) {
    setForm((prev) => ({ ...prev, ...value }));
    setDirty(true);
  }

  async function save() {
    if (!profile) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to save profile");
      }
      const user = result.data.user as PlatformProfile;
      setProfile(user);
      setForm(toForm(user));
      setDirty(false);
      toast.success(t("platform.profile.updated", { defaultValue: "Profile updated" }));
      await refreshSession();
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : t("platform.profile.saveFailed", { defaultValue: "Failed to save profile" }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error(t("platform.profile.selectImage", { defaultValue: "Please select an image file" }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("platform.profile.imageTooLarge", { defaultValue: "Image must be smaller than 5MB" }));
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/admin/profile/avatar", {
        method: "POST",
        body,
        credentials: "include",
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to upload avatar");
      }

      const uploaded = result.data.avatar as string;
      setProfile((prev) => (prev ? { ...prev, avatar: uploaded } : prev));
      setAvatarUrl(uploaded);
      toast.success(t("platform.profile.photoUpdated", { defaultValue: "Profile photo updated" }));
      await refreshSession();
    } catch (uploadError) {
      toast.error(
        uploadError instanceof Error
          ? uploadError.message
          : t("platform.profile.uploadFailed", { defaultValue: "Failed to upload avatar" }),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeAvatar() {
    setUploading(true);
    try {
      const response = await fetch("/api/admin/profile/avatar", {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to remove avatar");
      }
      setProfile((prev) => (prev ? { ...prev, avatar: null } : prev));
      setAvatarUrl(null);
      toast.success(t("platform.profile.photoRemoved", { defaultValue: "Profile photo removed" }));
      await refreshSession();
    } catch (removeError) {
      toast.error(
        removeError instanceof Error
          ? removeError.message
          : t("platform.profile.removeFailed", { defaultValue: "Failed to remove avatar" }),
      );
    } finally {
      setUploading(false);
    }
  }

  async function changePassword() {
    setChangingPassword(true);
    try {
      const response = await fetch("/api/admin/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwords),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to change password");
      }
      setPasswords({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      toast.success(t("platform.profile.passwordChanged", { defaultValue: "Password changed. Other sessions were signed out." }));
      void load();
    } catch (passwordError) {
      toast.error(
        passwordError instanceof Error
          ? passwordError.message
          : t("platform.profile.passwordFailed", { defaultValue: "Failed to change password" }),
      );
    } finally {
      setChangingPassword(false);
    }
  }

  if (!profile) {
    return error ? (
      <ResponsiveLayout className="space-y-6" padding="none">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </ResponsiveLayout>
    ) : (
      <PlatformProfileLoading />
    );
  }

  const displayAvatar = profile.avatar || avatarUrl || "";
  const initials =
    `${profile.firstName?.[0] ?? ""}${profile.lastName?.[0] ?? ""}`.toUpperCase() ||
    "PA";
  const passwordReady =
    passwords.currentPassword.length > 0 &&
    passwords.newPassword.length > 0 &&
    passwords.confirmPassword.length > 0;

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("platform.profile.title", { defaultValue: "My profile" })}</h1>
          <p className="text-muted-foreground">
            Your platform administrator account — name, photo, contact details,
            and password.
          </p>
        </div>
        <Button onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {dirty ? t("platform.common.saveChanges", { defaultValue: "Save changes" }) : t("platform.common.allSaved", { defaultValue: "All changes saved" })}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Identity */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="h-4 w-4" /> {t("platform.profile.account", { defaultValue: "Account" })}
            </CardTitle>
            <CardDescription>
              {t("platform.profile.accountHint", { defaultValue: "How you appear across the platform console." })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="relative">
                {displayAvatar ? (
                  <Image
                    src={displayAvatar}
                    alt={`${profile.firstName} ${profile.lastName}`}
                    width={96}
                    height={96}
                    unoptimized
                    className="h-24 w-24 rounded-full border object-cover"
                  />
                ) : (
                  <Avatar className="h-24 w-24 border">
                    <AvatarFallback className="text-xl font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                )}
                {uploading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                )}
              </div>
              <div>
                <p className="font-semibold">
                  {profile.firstName} {profile.lastName}
                </p>
                <p className="text-sm text-muted-foreground">{profile.email}</p>
              </div>
              <Badge variant="secondary" className="capitalize">
                {profile.role.replace("_", " ")}
              </Badge>
              <div className="flex flex-wrap justify-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadAvatar(file);
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="me-1.5 h-4 w-4" />
                  {profile.avatar ? t("platform.profile.changePhoto", { defaultValue: "Change photo" }) : t("platform.profile.uploadPhoto", { defaultValue: "Upload photo" })}
                </Button>
                {profile.avatar && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={uploading}
                    onClick={() => void removeAvatar()}
                  >
                    <Trash2 className="me-1.5 h-4 w-4" /> {t("platform.common.remove", { defaultValue: "Remove" })}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("platform.profile.photoHint", { defaultValue: "PNG, JPEG, or WebP up to 5MB." })}
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <MetaRow
                label={t("platform.profile.emailVerified", { defaultValue: "Email verified" })}
                value={profile.emailVerified ? "Yes" : "No"}
              />
              <MetaRow
                label={t("platform.profile.twoFactor", { defaultValue: "Two-factor" })}
                value={profile.twoFactorEnabled ? t("platform.profile.enabled", { defaultValue: "Enabled" }) : t("platform.profile.disabled", { defaultValue: "Disabled" })}
              />
              <MetaRow label={t("platform.profile.lastSignIn", { defaultValue: "Last sign-in" })} value={formatDate(profile.lastLogin)} />
              <MetaRow
                label={t("platform.profile.passwordChangedOn", { defaultValue: "Password changed" })}
                value={formatDate(profile.passwordChangedAt)}
              />
              <MetaRow label={t("platform.profile.memberSince", { defaultValue: "Member since" })} value={formatDate(profile.createdAt)} />
            </div>
          </CardContent>
        </Card>

        {/* Details + password */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("platform.profile.personalDetails", { defaultValue: "Personal details" })}</CardTitle>
              <CardDescription>
                {t("platform.profile.personalHint", { defaultValue: "Used across the console and on platform notifications you send." })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <FieldRow label={t("platform.profile.firstName", { defaultValue: "First name" })}>
                  <Input
                    value={form.firstName}
                    onChange={(e) => patch({ firstName: e.target.value })}
                    placeholder="Platform"
                  />
                </FieldRow>
                <FieldRow label={t("platform.profile.lastName", { defaultValue: "Last name" })}>
                  <Input
                    value={form.lastName}
                    onChange={(e) => patch({ lastName: e.target.value })}
                    placeholder="Admin"
                  />
                </FieldRow>
                <FieldRow
                  label={t("platform.profile.email", { defaultValue: "Email" })}
                  hint={t("platform.profile.emailHint", { defaultValue: "Your sign-in address. Changing it requires re-verification, so it is managed outside this form." })}
                >
                  <Input value={profile.email} disabled readOnly />
                </FieldRow>
                <FieldRow label={t("platform.profile.phone", { defaultValue: "Phone" })}>
                  <Input
                    value={form.phone}
                    onChange={(e) => patch({ phone: e.target.value })}
                    placeholder="+1 555 000 1234"
                  />
                </FieldRow>
                <FieldRow label={t("platform.profile.city", { defaultValue: "City" })}>
                  <Input
                    value={form.city}
                    onChange={(e) => patch({ city: e.target.value })}
                    placeholder="Dhaka"
                  />
                </FieldRow>
                <FieldRow label={t("platform.profile.location", { defaultValue: "Location" })}>
                  <Input
                    value={form.location}
                    onChange={(e) => patch({ location: e.target.value })}
                    placeholder="Bangladesh"
                  />
                </FieldRow>
                <FieldRow
                  label={t("platform.profile.website", { defaultValue: "Website" })}
                  hint={t("platform.profile.websiteHint", { defaultValue: "Include the full URL, e.g. https://example.com" })}
                >
                  <Input
                    value={form.website}
                    onChange={(e) => patch({ website: e.target.value })}
                    placeholder="https://example.com"
                  />
                </FieldRow>
              </div>
              <FieldRow label={t("platform.profile.bio", { defaultValue: "Bio" })} hint={t("platform.profile.bioHint", { defaultValue: "Up to 500 characters." })}>
                <Textarea
                  rows={4}
                  value={form.bio}
                  onChange={(e) => patch({ bio: e.target.value })}
                  placeholder={t("platform.profile.bioPlaceholder", { defaultValue: "A short description of your role on the platform." })}
                />
              </FieldRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> {t("platform.profile.password", { defaultValue: "Password" })}
              </CardTitle>
              <CardDescription>
                {t("platform.profile.passwordHint", { defaultValue: "Changing your password signs out every other active session." })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <FieldRow label="Current password">
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={passwords.currentPassword}
                    onChange={(e) =>
                      setPasswords((prev) => ({
                        ...prev,
                        currentPassword: e.target.value,
                      }))
                    }
                  />
                </FieldRow>
                <div className="hidden md:block" />
                <FieldRow label="New password">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={passwords.newPassword}
                    onChange={(e) =>
                      setPasswords((prev) => ({
                        ...prev,
                        newPassword: e.target.value,
                      }))
                    }
                  />
                </FieldRow>
                <FieldRow label="Confirm new password">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={passwords.confirmPassword}
                    onChange={(e) =>
                      setPasswords((prev) => ({
                        ...prev,
                        confirmPassword: e.target.value,
                      }))
                    }
                  />
                </FieldRow>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  disabled={!passwordReady || changingPassword}
                  onClick={() => void changePassword()}
                >
                  {changingPassword && (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  )}
                  Change password
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ResponsiveLayout>
  );
}
