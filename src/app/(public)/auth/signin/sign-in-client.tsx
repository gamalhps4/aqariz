"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { signIn } from "@/lib/auth-client";
import { DEMO_LOGINS } from "@/lib/demo-credentials";
import { roleDisplayName } from "@/lib/role-display";
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
  Mail,
  Lock,
  AlertCircle,
  Copy,
} from "lucide-react";

export function SignInClient() {
  const router = useRouter();
  const { t, isRTL } = useLocalizationContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [socialProviders, setSocialProviders] = useState<string[]>([]);
  const [error, setError] = useState("");
  // Lazy initialiser rather than an effect: the query string is available on
  // first render, so setting it afterwards only caused an extra pass.
  const [callbackUrl] = useState(
    () =>
      (typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("callbackUrl")) ||
      "/dashboard",
  );

  useEffect(() => {
    let active = true;
    fetch("/api/platform/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const providers = payload?.data?.socialProviders;
        if (active && Array.isArray(providers)) setSocialProviders(providers);
      })
      .catch(() => {
        // No buttons is the correct fallback when we can't tell.
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        // Better Auth distinguishes refusals (locked account, suspended
        // organization, rate limit) from a bad credential — show its message.
        setError(result.error || t("auth.signin.invalid", { defaultValue: "Wrong email or password" }));
        setIsLoading(false);
      } else if (result?.twoFactorRequired) {
        // Password accepted, but nobody is signed in yet — the challenge
        // cookie is spent on the code screen.
        router.replace(
          `/auth/two-factor?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        );
      } else if (result?.ok) {
        router.replace(result.url || callbackUrl);
        router.refresh();
      }
    } catch (error) {
      console.error("Sign in error:", error);
      setError(t("auth.signin.failed", { defaultValue: "Could not sign you in. Try again." }));
      setIsLoading(false);
    }
  };

  const handleDemoCredentials = (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
  };

  return (
    <div dir={isRTL ? "rtl" : "ltr"} className="flex flex-1 items-center justify-center px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="max-w-lg w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            {t("auth.signin.title", { defaultValue: "Sign in to your account" })}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("auth.signin.subtitle", { defaultValue: "Manage your properties with ease" })}
          </p>
        </div>

        {/* Sign In Form */}
        <Card>
          <CardHeader>
            <CardTitle>{t("auth.signin.welcome", { defaultValue: "Welcome back" })}</CardTitle>
            <CardDescription>
              {t("auth.signin.welcomeHint", { defaultValue: "Enter your email and password to continue" })}
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
                <Label htmlFor="email">{t("auth.common.email", { defaultValue: "Email address" })}</Label>
                <div className="relative">
                  <Mail className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="ps-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password">{t("auth.common.password", { defaultValue: "Password" })}</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
                  >
                    {t("auth.signin.forgot", { defaultValue: "Forgot your password?" })}
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="ps-10"
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t("auth.signin.submitting", { defaultValue: "Signing in…" })}
                  </>
                ) : (
                  t("auth.signin.submit", { defaultValue: "Sign in" })
                )}
              </Button>
            </form>

            {/* Rendered only for providers whose credentials are configured —
                a button that cannot work is worse than no button. */}
            {socialProviders.length > 0 && (
              <div className="mt-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      {t("auth.signin.or", { defaultValue: "or continue with" })}
                    </span>
                  </div>
                </div>
                <div className="mt-4 grid gap-2">
                  {socialProviders.includes("google") && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={isLoading}
                      onClick={() =>
                        void signIn("google", { callbackUrl })
                      }
                    >
                      {t("auth.signin.google", { defaultValue: "Continue with Google" })}
                    </Button>
                  )}
                  {socialProviders.includes("github") && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={isLoading}
                      onClick={() =>
                        void signIn("github", { callbackUrl })
                      }
                    >
                      {t("auth.signin.github", { defaultValue: "Continue with GitHub" })}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Demo Credentials */}
        <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
          <CardContent>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
              {t("auth.signin.demo", { defaultValue: "Demo accounts" })}
            </h3>
            <div className="space-y-2">
              {DEMO_LOGINS.map((login) => (
                <div
                  key={login.email}
                  className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg px-3 py-1 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors gap-2"
                >
                  <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0 overflow-hidden">
                    <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 w-16 sm:w-24 shrink-0">
                      {login.isPlatformAdmin
                        ? t("admin.usersPage.filters.superAdmin", {
                            defaultValue: login.label,
                          })
                        : roleDisplayName(login.label.toLowerCase(), { t })}
                    </span>
                    <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">
                      {login.email}
                    </span>
                    <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 hidden sm:inline shrink-0">
                      {login.password}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      handleDemoCredentials(login.email, login.password)
                    }
                    className="h-8 w-8 p-0 hover:bg-blue-100 dark:hover:bg-blue-900/30 shrink-0"
                    aria-label={t("auth.signin.useDemo", { defaultValue: "Fill in this account" })}
                  >
                    <Copy className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
