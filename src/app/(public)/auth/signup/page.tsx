"use client";

import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import Link from "next/link";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Building2,
  Mail,
  Lock,
  User as UserIcon,
  AlertCircle,
} from "lucide-react";

export default function SignUpPage() {
  const router = useRouter();
  const { t, isRTL } = useLocalizationContext();
  const [form, setForm] = useState({
    organizationName: "",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  // null = still checking; true/false = platform sign-up policy.
  const [signupsOpen, setSignupsOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/platform/status")
      .then((res) => res.json())
      .then((payload) => {
        if (active) setSignupsOpen(payload?.data?.allowSignups !== false);
      })
      .catch(() => {
        // On failure, fall back to showing the form (the API still gates).
        if (active) setSignupsOpen(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/signup-organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        setError(
          result.error ||
            result.message ||
            t("auth.signup.failed", { defaultValue: "Could not create the account" }),
        );
        setIsLoading(false);
        return;
      }

      // Auto sign-in the new owner, then land in the dashboard.
      const signInResult = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
        callbackUrl: "/dashboard",
      });

      if (signInResult?.ok) {
        router.replace(signInResult.url || "/dashboard");
        router.refresh();
      } else {
        // Account created but auto sign-in failed — send to sign-in.
        router.replace("/auth/signin");
      }
    } catch (err) {
      console.error("Sign up error:", err);
      setError(t("auth.signup.error", { defaultValue: "Something went wrong while creating your account" }));
      setIsLoading(false);
    }
  };

  return (
    <div dir={isRTL ? "rtl" : "ltr"} className="flex flex-1 items-center justify-center px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="max-w-lg w-full space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            {t("auth.signup.title", { defaultValue: "Create your organization" })}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("auth.signup.subtitle", { defaultValue: "Start managing your properties in minutes" })}
          </p>
        </div>

        {signupsOpen === false ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("auth.signup.closedTitle", { defaultValue: "Sign-ups are closed" })}</CardTitle>
              <CardDescription>
                {t("auth.signup.closedBody", { defaultValue: "New organizations cannot register right now. Check back later or contact support." })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <Link href="/auth/signin">
                  {t("auth.common.backToSignIn", { defaultValue: "Back to sign in" })}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t("auth.signup.cardTitle", { defaultValue: "Get started" })}</CardTitle>
            <CardDescription>
              {t("auth.signup.cardHint", { defaultValue: "Set up your company workspace and administrator account" })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="organizationName">
                  {t("auth.common.orgName", { defaultValue: "Company / organization name" })}
                </Label>
                <div className="relative">
                  <Building2 className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <Input
                    id="organizationName"
                    value={form.organizationName}
                    onChange={set("organizationName")}
                    placeholder={t("auth.common.orgPlaceholder", { defaultValue: "e.g. Al Noor Property Management" })}
                    className="ps-10"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">{t("auth.signup.firstName", { defaultValue: "First name" })}</Label>
                  <div className="relative">
                    <UserIcon className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                    <Input
                      id="firstName"
                      value={form.firstName}
                      onChange={set("firstName")}
                      placeholder={t("auth.signup.firstPlaceholder", { defaultValue: "Sarah" })}
                      className="ps-10"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">{t("auth.signup.lastName", { defaultValue: "Last name" })}</Label>
                  <Input
                    id="lastName"
                    value={form.lastName}
                    onChange={set("lastName")}
                    placeholder={t("auth.signup.lastPlaceholder", { defaultValue: "Al-Harbi" })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.signup.workEmail", { defaultValue: "Work email" })}</Label>
                <div className="relative">
                  <Mail className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    placeholder="you@company.com"
                    className="ps-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.common.password", { defaultValue: "Password" })}</Label>
                <div className="relative">
                  <Lock className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <Input
                    id="password"
                    type="password"
                    value={form.password}
                    onChange={set("password")}
                    placeholder={t("auth.signup.passwordPlaceholder", { defaultValue: "At least {count} characters", values: { count: PASSWORD_MIN_LENGTH } })}
                    className="ps-10"
                    minLength={PASSWORD_MIN_LENGTH}
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t("auth.common.creatingWorkspace", { defaultValue: "Creating your workspace…" })}
                  </>
                ) : (
                  t("auth.common.createOrg", { defaultValue: "Create organization" })
                )}
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
              {t("auth.signup.haveAccount", { defaultValue: "Already have an account?" })}{" "}
              <Link
                href="/auth/signin"
                className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
              >
                {t("auth.signin.submit", { defaultValue: "Sign in" })}
              </Link>
            </p>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}
