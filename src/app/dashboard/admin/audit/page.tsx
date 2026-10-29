/**
 * Audit trail. The dashboard component was fully built but had no page and
 * pointed at two endpoints that did not exist — it has never been reachable
 * until now. Access is gated on the `audit_logs` permission, matching the API.
 */

import type { Metadata } from "next";
import AuditDashboard from "@/components/audit/audit-dashboard";

export const metadata: Metadata = {
  title: "Audit trail",
};

export default function AuditPage() {
  return <AuditDashboard />;
}
