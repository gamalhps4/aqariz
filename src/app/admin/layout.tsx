/**
 * PropertyPro SaaS - Platform admin layout
 *
 * Its own route subtree (separate from the org dashboard) but reuses the same
 * dashboard chrome via AdminShell for visual consistency. Guards the entire
 * /admin area server-side: only platform super-admins (role=super_admin,
 * organizationId=null) may enter; everyone else is redirected. Login itself
 * still happens at the shared /auth/signin.
 */

import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminShell } from "./_components/admin-shell";
import { AppShellSkeleton } from "@/components/layout/app-shell-skeleton";
import { getPlatformSettings } from "@/lib/platform/settings";

/**
 * The guard and the branding read are the only async work in this subtree, and
 * both are runtime data — which is precisely what stops `loading.tsx` from
 * showing a fallback: a layout that awaits uncached data blocks navigation
 * until it resolves, so nothing at all renders in the meantime. Landing on the
 * console therefore meant a white screen for the length of a session lookup
 * plus a settings read.
 *
 * Keeping the layout itself synchronous and putting the awaiting part behind
 * its own Suspense boundary lets the shell paint immediately and the real
 * chrome stream in behind it. `AdminGate` still runs before any console markup
 * exists, so the guard is unchanged; only the paint order is.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/signin?callbackUrl=/admin");
  }
  if (session.user.isActive === false) {
    redirect("/auth/signin?error=AccountDeactivated");
  }
  // Only platform super-admins (no organization) may access the console. This
  // is UX routing layered on top of the real boundary: every /api/admin route
  // re-checks the role via withPlatformAdmin, and the proxy already turns a
  // cookie-less request away at the edge.
  if (session.user.role !== "super_admin" || session.user.organizationId) {
    redirect("/dashboard");
  }

  // The console cannot use the org-scoped display settings the dashboard
  // reads (`/api/settings/display` refuses an org-less caller), so the
  // platform's own branding is resolved here and handed to the shell — which
  // is why uploaded platform logos never appeared in the console before.
  const { general } = await getPlatformSettings();

  return (
    <AdminShell
      branding={{
        platformName: general.platformName,
        logoLight: general.logoLight,
        logoDark: general.logoDark,
        favicon: general.favicon,
      }}
    >
      {children}
    </AdminShell>
  );
}
