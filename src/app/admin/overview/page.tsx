/**
 * The platform overview now lives at the console root (`/admin`), so the
 * organization list can own `/admin/organizations`. This stub keeps old
 * bookmarks and any external links to `/admin/overview` working.
 */

import { permanentRedirect } from "next/navigation";

export default function AdminOverviewRedirect(): never {
  permanentRedirect("/admin");
}
