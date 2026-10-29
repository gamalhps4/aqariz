"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertCircle,
  Shield,
  Key,
  UserX,
  Mail,
  RefreshCw,
  Home,
  ArrowLeft,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

/** The error codes the auth flow sends here, with their icon and colour. */
const ERROR_STYLES: Record<
  string,
  { icon: typeof AlertCircle; color: string }
> = {
  Configuration: { icon: AlertCircle, color: "red" },
  AccessDenied: { icon: UserX, color: "orange" },
  Verification: { icon: Mail, color: "blue" },
  OAuthSignin: { icon: Shield, color: "purple" },
  OAuthCallback: { icon: Shield, color: "purple" },
  OAuthCreateAccount: { icon: Shield, color: "purple" },
  EmailCreateAccount: { icon: Mail, color: "blue" },
  Callback: { icon: AlertCircle, color: "red" },
  OAuthAccountNotLinked: { icon: Shield, color: "orange" },
  EmailSignin: { icon: Mail, color: "blue" },
  CredentialsSignin: { icon: Key, color: "red" },
  SessionRequired: { icon: Shield, color: "orange" },
};

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLocalizationContext();
  const error = searchParams.get("error");

  // Each code's title, explanation and advice live in the catalogue
  // (`auth.error.<code>.*`); an unknown code reads as the generic one.
  const code = error && ERROR_STYLES[error] ? error : "default";
  const style = ERROR_STYLES[code] ?? { icon: AlertCircle, color: "red" };
  const errorDetails = {
    ...style,
    title: t(`auth.error.${code}.title`),
    description: t(`auth.error.${code}.description`),
    suggestion: t(`auth.error.${code}.suggestion`),
  };
  const ErrorIcon = errorDetails.icon;

  return (
    <div className="flex flex-1 items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/20">
      <Card className="max-w-lg w-full border-border/60 shadow-xl">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-4 relative">
            <div className={`absolute inset-0 bg-${errorDetails.color}-500/20 blur-2xl rounded-full`} />
            <div className={`relative bg-${errorDetails.color}-500/10 p-4 rounded-full inline-block`}>
              <ErrorIcon className={`size-12 text-${errorDetails.color}-600`} />
            </div>
          </div>
          <CardTitle className="text-2xl md:text-3xl font-bold">
            {errorDetails.title}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Error Alert */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("auth.error.whatHappened")}</AlertTitle>
            <AlertDescription className="mt-2">
              {errorDetails.description}
            </AlertDescription>
          </Alert>

          {/* Suggestion */}
          <div className="bg-muted/50 border border-border rounded-lg p-4">
            <p className="text-sm font-medium mb-2">{t("auth.error.whatToDo")}</p>
            <p className="text-sm text-muted-foreground">
              {errorDetails.suggestion}
            </p>
          </div>

          {/* Error Code (for debugging) */}
          {error && (
            <div className="text-center text-xs text-muted-foreground">
              <p>
                {t("auth.error.code", { values: { code: "" } })}
                <code className="font-mono bg-muted px-2 py-1 rounded" dir="ltr">
                  {error}
                </code>
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3">
            <Button
              onClick={() => router.push("/auth/signin")}
              className="w-full gap-2"
              size="lg"
            >
              <RefreshCw className="size-4" />
              {t("auth.error.retry")}
            </Button>

            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => router.back()}
                variant="outline"
                className="gap-2"
              >
                <ArrowLeft className="size-4 rtl:rotate-180" />
                {t("auth.error.back")}
              </Button>
              <Button
                onClick={() => router.push("/")}
                variant="outline"
                className="gap-2"
              >
                <Home className="size-4" />
                {t("auth.error.home")}
              </Button>
            </div>
          </div>

          {/* Additional Help */}
          <div className="pt-4 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground mb-3">
              {t("auth.error.moreHelp")}
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-xs"
              >
                <a href="/auth/forgot-password">{t("auth.error.resetPassword")}</a>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-xs"
              >
                <a href="/auth/signup">{t("auth.error.createAccount")}</a>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-xs"
              >
                <a href="mailto:support@propertypro.com">{t("auth.error.contactSupport")}</a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }
    >
      <AuthErrorContent />
    </Suspense>
  );
}

