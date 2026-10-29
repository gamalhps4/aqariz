"use client";

import { ThemeProvider } from "next-themes";
import { SessionProvider } from "@/lib/auth-client";
import { LocalizationProvider } from "@/components/providers/LocalizationProvider";
import { SettingsProvider } from "@/components/providers/SettingsProvider";
import { UserAvatarProvider } from "@/components/providers/UserAvatarProvider";
import type { DisplayLocale } from "@/lib/i18n/locale-cookie";
import { localeCodeFor } from "@/lib/i18n/languages";

interface ProvidersProps {
  children: React.ReactNode;
  /**
   * The language, direction and currency the server drew this page in (the
   * root layout reads them from the request). The providers start from it so
   * the browser's first render matches the server's HTML exactly.
   */
  initialLocale?: DisplayLocale;
}

export function Providers({ children, initialLocale }: ProvidersProps) {
  return (
    <SessionProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <SettingsProvider initialLocale={initialLocale}>
          <LocalizationProvider
            initialLocale={
              initialLocale ? localeCodeFor(initialLocale.language) : undefined
            }
            initialCurrency={initialLocale?.currency}
          >
            <UserAvatarProvider>{children}</UserAvatarProvider>
          </LocalizationProvider>
        </SettingsProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
