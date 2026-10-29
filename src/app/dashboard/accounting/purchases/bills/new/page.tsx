"use client";

/**
 * PropertyPro - Entering a purchase bill
 *
 * A supplier's bill typed in line by line. It is saved waiting for approval;
 * once someone holding the approval right approves it, it is owed and on the
 * books. Opened for a supplier (`?supplierId=`, as the suppliers list does),
 * the bill starts with that supplier chosen.
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LedgerHeader, LedgerNotSetUp } from "../../../setup/_shared/ledger-parts";
import { useLedgerText, usePurchasesAccess } from "../../_shared/purchases-ui";
import { BILLS_HREF, BackToBills, BillForm, NoBillAccess, useBooksNotSetUp } from "../_parts/bill-form";

export default function NewPurchaseBillPage() {
  return (
    <Suspense fallback={null}>
      <NewPurchaseBill />
    </Suspense>
  );
}

function NewPurchaseBill() {
  const supplierId = useSearchParams().get("supplierId") ?? "";
  const access = usePurchasesAccess();
  const { tx } = useLedgerText();
  const notSetUp = useBooksNotSetUp(access.canCreate);
  const [refusedNotSetUp, setRefusedNotSetUp] = useState(false);

  if (access.loading) return null;
  if (!access.canView) return <NoBillAccess />;
  if (!access.canCreate) return <NoBillAccess action="create" />;
  if (notSetUp || refusedNotSetUp) return <LedgerNotSetUp canManage={access.canManageBooks} />;

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("purchases.bills.newTitle", "New purchase bill")}
        subtitle={tx(
          "purchases.bills.newSubtitle",
          "Enter the supplier's bill line by line. It waits for approval before it is owed and posted to the books.",
        )}
        actions={<BackToBills />}
      />
      <BillForm
        key={supplierId}
        mode="create"
        initialSupplierId={supplierId}
        cancelHref={BILLS_HREF}
        onNotSetUp={() => setRefusedNotSetUp(true)}
      />
    </div>
  );
}
