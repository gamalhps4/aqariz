/**
 * PropertyPro - Retired: the standalone "Record payment" page
 *
 * It failed on every attempt — it posted an empty installment id and read a
 * contract list in a shape the API no longer sent — had no reference field,
 * and with a tenant picked by hand offered installments from every one of
 * their contracts. Money is recorded through the installment dialog now, on
 * the payments page and on each contract's Payments tab.
 *
 * Old links and bookmarks land on that dialog instead, on the payment or
 * contract they named, rather than on a page that cannot save.
 */

import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RecordPaymentPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const paymentId = first(params.paymentId);
  const leaseId = first(params.leaseId);

  const query = new URLSearchParams();
  if (leaseId) query.set("leaseId", leaseId);
  query.set("record", paymentId || "new");
  redirect(`/dashboard/payments?${query.toString()}`);
}
