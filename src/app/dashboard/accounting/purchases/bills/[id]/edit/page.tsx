"use client";

/**
 * PropertyPro - Changing a purchase bill
 *
 * Only a bill waiting for approval can be rewritten; an approved bill nobody
 * has paid on is sent back first (it can be, from here). The form is the one
 * a new bill is entered with, opened on the bill as it was read; saving sends
 * the version read, so a change someone else made meanwhile is refused rather
 * than overwritten.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Lock, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BillView } from "@/lib/accounting/purchases/types";
import { LedgerHeader, LedgerNotSetUp } from "../../../../setup/_shared/ledger-parts";
import { purchasesRequest, useLedgerError, useLedgerText, usePurchasesAccess } from "../../../_shared/purchases-ui";
import {
  BackToBills,
  BillForm,
  NoBillAccess,
  PurchasesUnavailable,
  StateCard,
  allowedBillActions,
  billHref,
  billToFormValues,
  useBillActions,
  useBooksNotSetUp,
} from "../../_parts/bill-form";

export default function EditPurchaseBillPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const access = usePurchasesAccess();
  const { tx } = useLedgerText();
  const describeError = useLedgerError();
  const notSetUp = useBooksNotSetUp(access.canEdit);
  const [bill, setBill] = useState<BillView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ code: string | null; message: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [refusedNotSetUp, setRefusedNotSetUp] = useState(false);
  const actions = useBillActions((updated) => {
    if (updated?.lines) setBill(updated);
    else setVersion((value) => value + 1);
  });

  useEffect(() => {
    if (!access.canView || !id) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      const response = await purchasesRequest<BillView>(`/bills/${encodeURIComponent(id)}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.ok && response.data) {
        setBill(response.data);
        setFailure(null);
      } else {
        setBill(null);
        setFailure({ code: response.code, message: response.message });
      }
      setLoading(false);
    })();
    return () => controller.abort();
  }, [access.canView, id, version]);

  if (access.loading) return null;
  if (!access.canView) return <NoBillAccess />;
  if (failure?.code === "PURCHASES_UNAVAILABLE") return <PurchasesUnavailable />;
  if (notSetUp || refusedNotSetUp) return <LedgerNotSetUp canManage={access.canManageBooks} />;

  if (!bill) {
    return (
      <div className="space-y-4">
        <LedgerHeader title={tx("purchases.bills.editTitle", "Change a purchase bill")} actions={<BackToBills />} />
        <StateCard
          body={
            loading || !failure ? tx("ledger.common.loading", "Loading…") : describeError(failure)
          }
        />
      </div>
    );
  }

  const title = tx("purchases.bills.editTitleNumber", "Change bill {number}", { number: bill.displayNumber });
  const backToBill = (
    <Button asChild variant="outline" size="sm">
      <Link href={billHref(bill.id)}>
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {tx("purchases.bills.backToBill", "Back to the bill")}
      </Link>
    </Button>
  );

  if (!(bill.can.edit && access.canEdit)) {
    const allowed = allowedBillActions(bill, access);
    const message = !access.canEdit
      ? tx("purchases.bills.editNoRight", "You do not have the right to change purchase bills.")
      : bill.can.reopen
        ? describeError({ code: "PURCHASE_BILL_NOT_EDITABLE", message: null })
        : tx(
            "purchases.bills.editLocked",
            "Only a bill waiting for approval can be changed, and this one can no longer be sent back.",
          );
    return (
      <div className="space-y-4">
        <LedgerHeader title={title} actions={backToBill} />
        <StateCard
          icon={Lock}
          body={message}
          action={
            allowed.reopen ? (
              <Button size="sm" onClick={() => actions.requestReopen(bill)} disabled={actions.busyId !== null}>
                <Undo2 className="h-4 w-4" />
                {tx("purchases.bills.sendBack", "Send back")}
              </Button>
            ) : undefined
          }
        />
        {actions.dialogs}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={title}
        subtitle={tx(
          "purchases.bills.editSubtitle",
          "The bill is waiting for approval, so every part of it can still change.",
        )}
        actions={backToBill}
      />
      <BillForm
        key={`${bill.id}:${bill.version}`}
        mode="edit"
        initial={billToFormValues(bill)}
        billId={bill.id}
        version={bill.version}
        currentSupplier={bill.supplier}
        cancelHref={billHref(bill.id)}
        onNotSetUp={() => setRefusedNotSetUp(true)}
      />
    </div>
  );
}
