import { redirect } from "next/navigation";

/**
 * The applications list lives at Clients (Tenants) → Applications. This was
 * an older copy of it, English only and linked from nowhere; it now sends
 * anyone with the old address to the one that is maintained.
 */
export default function ApplicationsPage() {
  redirect("/dashboard/tenants/applications");
}
