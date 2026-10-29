import { Building2 } from "lucide-react";

/**
 * A public page that is not there: an office with no page, a listing that
 * was never published, has been taken down, whose licence has run out or
 * whose unit has been let. All of them read the same on purpose — nothing
 * about a hidden listing is confirmed to a stranger. Both languages, since
 * a missing page has no language to ask.
 *
 * Served with a 404 because the pages look the office and listing up before
 * anything streams. A loading.tsx on the way here would send its fallback
 * first and turn every one of these into a 200 (lib/listings/public-status.test.ts).
 */
export default function PublicNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="max-w-md space-y-4 rounded-2xl border bg-background p-8 text-center shadow-sm">
        <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold" dir="rtl" lang="ar">
          هذه الصفحة غير متاحة
        </h1>
        <p className="text-sm text-muted-foreground" dir="rtl" lang="ar">
          قد يكون الإعلان قد انتهى أو لم يعد متاحًا.
        </p>
        <hr />
        <h2 className="text-lg font-medium" dir="ltr" lang="en">
          This page is not available
        </h2>
        <p className="text-sm text-muted-foreground" dir="ltr" lang="en">
          The listing may have ended or is no longer available.
        </p>
      </div>
    </div>
  );
}
