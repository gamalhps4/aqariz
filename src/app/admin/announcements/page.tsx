/**
 * Announcements moved under the console inbox, next to contact messages, so
 * everything the operator sends or receives lives in one place. Kept as a
 * redirect because the old path is bookmarked and linked from older emails.
 */

import { redirect } from "next/navigation";

export default function LegacyAnnouncementsPage() {
  redirect("/admin/inbox/announcements");
}
