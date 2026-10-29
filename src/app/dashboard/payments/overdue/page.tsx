import { redirect } from "next/navigation";

/**
 * PropertyPro - Overdue tenants, at their old address
 *
 * This page listed overdue invoices one row each, filtered on the stored
 * invoice status — which only a nightly job updates — and had no date filter,
 * no way to pick a tenant and no export, all three of which the review asks
 * of the Overdue Tenants report. The payments reports now carry that report,
 * one row per tenant, read from due dates, with every filter the others have;
 * links and bookmarks to the old address land there.
 */
export default function OverduePaymentsPage() {
  redirect("/dashboard/payments/reports?type=overdue-tenants");
}
