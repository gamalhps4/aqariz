import { redirect } from "next/navigation";

/**
 * PropertyPro - A contract's payments, at their old address
 *
 * This page ran its own copy of the contract's payment screens: totals added
 * up from whatever payment rows existed, a "create payment" button that wrote
 * rows tied to no installment, and a "process" button that called the
 * tenant's payment portal and so failed for every member of staff. The
 * contract page's Payments tab now does this job properly, so the old address
 * leads there.
 */
export default async function LeasePaymentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/leases/${encodeURIComponent(id)}?tab=payments`);
}
