/**
 * PropertyPro - Catching the books up with the documents
 *
 * `postUnpostedSince(cutOver)` reads every installment, payment, expense,
 * security deposit, purchase bill and payment voucher dated from the cut-over
 * to today, works out the entry
 * each calls for, and brings the books in step: posting what is missing,
 * replacing what changed, reversing what was cancelled, deleted or refunded
 * away — including entries whose document no longer exists at all. An
 * unchanged document is skipped by its fingerprint before anything is
 * written, so a second run straight after the first writes nothing.
 *
 * It is the safety net under the write paths' hooks, and how an office's
 * history is posted the first time. It works in batches of a few dozen
 * documents per transaction and stops at its time budget; what is left is
 * reported and picked up by the next run, so a large office catches up over
 * a few runs instead of timing out on one.
 *
 * `dryRun` works out the same list and writes nothing: what a run would
 * post, replace and reverse (the posting backfill's first step).
 */

import { db } from "@/lib/db/prisma";
import { InvoiceStatus, PaymentStatus } from "@/types";
import { applyDocumentPlans, type DocumentPlanItem } from "./posting.service";
import {
  BILL_POSTING_SELECT,
  VOUCHER_POSTING_SELECT,
  DEPOSIT_POSTING_SELECT,
  expensePostingSelect,
  invoicePostingSelect,
  invoiceSettlementsPostable,
  paymentPostingSelect,
  WITH_ARCHIVED,
  allocatedInvoiceIds,
  billItems,
  depositItems,
  expenseItems,
  invoiceItems,
  invoiceSplitFor,
  loadPostingContext,
  paymentItems,
  voucherItems,
  withInvoiceLines,
  type BillRow,
  type DepositRow,
  type ExpenseRow,
  type InvoiceRow,
  type PaymentRow,
  type VoucherRow,
} from "./documents.service";
import { fingerprintPlan } from "./posting/fingerprint";
import { sourcesToReread } from "./document-sources";
import { paidDepositLeaseIds } from "./deposit-installment.service";
import { addDays, ledgerDay } from "./dates";
import { requireAccountingSettings } from "./settings.service";
import { DOCUMENT_SOURCE_TYPES } from "./types";
import { POSTED_EXPENSE_STATUSES } from "./posting/expense";
import { POSTED_BILL_STATUSES } from "./posting/purchase";
import { purchasesAvailable } from "./purchases/availability";
import { businessDay } from "@/lib/dates/business-day";

export interface SweepResult {
  since: string;
  examined: number;
  created: number;
  replaced: number;
  reversed: number;
  unchanged: number;
  failed: number;
  /** Documents left for the next run when the time budget ran out. */
  remaining: number;
  complete: boolean;
  errors: string[];
}

const BATCH_SIZE = 40;

const key = (sourceType: string, sourceId: string | null) => `${sourceType}:${sourceId ?? ""}`;

/**
 * Post everything dated from the cut-over to today that the books do not
 * yet agree with. `cutOver` is only read for an office that has none of its
 * own (setting up always gives it one).
 */
export async function postUnpostedSince(
  cutOver?: Date | null,
  options: { budgetMs?: number; userId?: string | null; dryRun?: boolean } = {},
): Promise<SweepResult> {
  const started = Date.now();
  const budget = options.budgetMs ?? 4 * 60_000;
  const settings = await requireAccountingSettings();
  // The office's own cut-over wins: the sweep always reconciles the whole of
  // the books, because "reverse what nothing asks for any more" is only true
  // over everything the books hold. A date is only used for an office that
  // has none.
  const since = settings.cutOverDate
    ? ledgerDay(settings.cutOverDate)
    : cutOver
      ? ledgerDay(cutOver)
      : null;

  const result: SweepResult = {
    since: since ? businessDay(since) : "",
    examined: 0,
    created: 0,
    replaced: 0,
    reversed: 0,
    unchanged: 0,
    failed: 0,
    remaining: 0,
    complete: true,
    errors: [],
  };
  if (!since) return result;

  // A day of slack each side: stored instants are read on the office's
  // calendar, and the exact cut is made per document.
  const from = addDays(since, -1);

  const [invoiceSelect, expenseSelect, paymentSelect, settlements, purchases] = await Promise.all([
    invoicePostingSelect(),
    expensePostingSelect(),
    paymentPostingSelect(),
    invoiceSettlementsPostable(),
    purchasesAvailable(),
  ]);
  const [invoices, payments, expenses, deposits, bills, vouchers, live] = await Promise.all([
    db.invoice.findMany({
      where: {
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
        // Due (or, for a custom invoice, issued — never after it is due)
        // since the cut-over, or paid since then: an owner's or a
        // customer's invoice posts what was received on it. Or written to
        // since then: a receipt or refund recorded on it, whatever its date.
        OR: [
          { dueDate: { gte: from } },
          { lastPaymentDate: { gte: from } },
          { updatedAt: { gte: from } },
        ],
      },
      select: invoiceSelect,
    }) as Promise<InvoiceRow[]>,
    db.payment.findMany({
      where: {
        deletedAt: null,
        status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL, PaymentStatus.REFUNDED] },
        OR: [
          { paidDate: { gte: from } },
          { paidDate: null, createdAt: { gte: from } },
          // Refunded after the cut-over, whenever it was received.
          { status: PaymentStatus.REFUNDED, updatedAt: { gte: from } },
        ],
      },
      select: paymentSelect,
    }) as Promise<PaymentRow[]>,
    db.expense.findMany({
      where: { deletedAt: null, date: { gte: from }, status: { in: [...POSTED_EXPENSE_STATUSES] } },
      select: expenseSelect,
    }) as Promise<ExpenseRow[]>,
    db.securityDeposit.findMany({
      where: {
        deletedAt: null,
        OR: [
          { collectedPaymentId: null, collectedDate: { gte: from } },
          { refundDate: { gte: from } },
        ],
      },
      select: DEPOSIT_POSTING_SELECT,
    }) as Promise<DepositRow[]>,
    // Purchase bills and payment vouchers exist once the purchases migration
    // is applied; before it there is nothing to read.
    (purchases
      ? db.purchaseBill.findMany({
          where: { status: { in: [...POSTED_BILL_STATUSES] }, billDate: { gte: from } },
          select: BILL_POSTING_SELECT,
        })
      : Promise.resolve([])) as Promise<BillRow[]>,
    (purchases
      ? db.paymentVoucher.findMany({
          where: { status: "posted", voucherDate: { gte: from } },
          select: VOUCHER_POSTING_SELECT,
        })
      : Promise.resolve([])) as Promise<VoucherRow[]>,
    db.journalEntry.findMany({
      where: {
        sourceType: { in: [...DOCUMENT_SOURCE_TYPES] },
        status: "posted",
        reversesId: null,
      },
      select: { sourceType: true, sourceId: true, fingerprint: true },
    }),
  ]);

  // The installments the payments paid, wherever their due dates fall.
  const known = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const missing = [
    ...new Set(payments.flatMap((payment) => allocatedInvoiceIds(payment)).filter((id) => !known.has(id))),
  ];
  const allocated = missing.length
    ? ((await db.invoice.findMany({
        where: { id: { in: missing }, ...WITH_ARCHIVED },
        select: invoiceSelect,
      })) as InvoiceRow[])
    : [];
  for (const invoice of allocated) known.set(invoice.id, invoice);
  // The deposits whose installment a payment paid: that payment posted them.
  const [, paidDeposits] = await Promise.all([
    withInvoiceLines([...known.values()]),
    paidDepositLeaseIds(deposits.map((deposit) => deposit.leaseId)),
  ]);

  const context = {
    ...(await loadPostingContext({ ...settings, cutOverDate: since })),
    settlements,
  };
  const splits = new Map([...known.values()].map((invoice) => [invoice.id, invoiceSplitFor(context, invoice)]));

  const wanted: DocumentPlanItem[] = [
    ...invoices.flatMap((invoice) => invoiceItems(context, invoice)),
    ...payments.flatMap((payment) => paymentItems(context, payment, splits)),
    ...expenses.flatMap((expense) => expenseItems(context, expense)),
    ...deposits.flatMap((deposit) =>
      depositItems(context, { ...deposit, installmentPaid: paidDeposits.has(deposit.leaseId) }),
    ),
    ...bills.flatMap((bill) => billItems(context, bill)),
    ...vouchers.flatMap((voucher) => voucherItems(context, voucher)),
  ];

  // The documents behind entries the books hold that the filters above did
  // not select are read again before anything is reversed: a legitimately
  // posted entry is never reversed because of how its document was dated
  // (lib/accounting/document-sources.ts `sourcesToReread`).
  const reread = sourcesToReread(live, new Set(wanted.map((item) => key(item.sourceType, item.sourceId))));
  wanted.push(
    ...(await rereadItems(reread, context, splits, {
      invoiceSelect,
      paymentSelect,
      expenseSelect,
      purchases,
    })),
  );

  // What the books hold now, by source. Anything held that nothing above
  // asks for any more — its document cancelled, deleted, gone — is reversed.
  const liveBySource = new Map(live.map((entry) => [key(entry.sourceType, entry.sourceId), entry]));
  const seen = new Set<string>();
  const work: DocumentPlanItem[] = [];
  for (const item of wanted) {
    const id = key(item.sourceType, item.sourceId);
    if (seen.has(id)) continue;
    seen.add(id);
    const held = liveBySource.get(id);
    if (!item.plan && !held) continue;
    if (item.plan && held && held.fingerprint === fingerprintPlan(item.plan)) {
      result.unchanged += 1;
      continue;
    }
    work.push(item);
  }
  for (const [id, entry] of liveBySource) {
    if (seen.has(id) || !entry.sourceId) continue;
    work.push({
      sourceType: entry.sourceType as DocumentPlanItem["sourceType"],
      sourceId: entry.sourceId,
      plan: null,
    });
  }
  result.examined = seen.size;

  if (options.dryRun) {
    // What a run would do, item by item, without writing: a document the
    // books lack is posted, one they hold differently is replaced (or, in a
    // closed period, reversed and reposted), one nothing asks for any more
    // is reversed.
    for (const item of work) {
      const held = liveBySource.has(key(item.sourceType, item.sourceId));
      if (item.plan && !held) result.created += 1;
      else if (item.plan) result.replaced += 1;
      else result.reversed += 1;
    }
    return result;
  }

  for (let index = 0; index < work.length; index += BATCH_SIZE) {
    if (Date.now() - started > budget) {
      result.remaining = work.length - index;
      result.complete = false;
      break;
    }
    const batch = work.slice(index, index + BATCH_SIZE);
    try {
      const applied = await applyDocumentPlans(batch, { userId: options.userId ?? null });
      result.created += applied.created;
      result.replaced += applied.replaced;
      result.reversed += applied.reversed;
      result.unchanged += applied.unchanged;
    } catch {
      // One bad document must not hold the batch back: retry it one by one
      // and report the ones that still fail.
      for (const item of batch) {
        try {
          const applied = await applyDocumentPlans([item], { userId: options.userId ?? null });
          result.created += applied.created;
          result.replaced += applied.replaced;
          result.reversed += applied.reversed;
          result.unchanged += applied.unchanged;
        } catch (error) {
          result.failed += 1;
          if (result.errors.length < 20) {
            result.errors.push(
              `${item.sourceType} ${item.sourceId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }
  }

  await db.accountingSettings.update({
    where: { id: settings.id },
    data: { lastSweepAt: new Date() },
  });
  return result;
}

/**
 * The entries documents not selected by date call for, read by id (archived
 * rows too, which then call for nothing and are reversed as before).
 */
async function rereadItems(
  reread: ReturnType<typeof sourcesToReread>,
  context: Parameters<typeof invoiceItems>[0],
  splits: Map<string, ReturnType<typeof invoiceSplitFor>>,
  selects: {
    invoiceSelect: Awaited<ReturnType<typeof invoicePostingSelect>>;
    paymentSelect: Awaited<ReturnType<typeof paymentPostingSelect>>;
    expenseSelect: Awaited<ReturnType<typeof expensePostingSelect>>;
    purchases: boolean;
  },
): Promise<DocumentPlanItem[]> {
  const ids = (kind: Parameters<typeof reread.get>[0]) => reread.get(kind) ?? [];
  const items: DocumentPlanItem[] = [];

  if (ids("invoice").length) {
    const rows = (await db.invoice.findMany({
      where: { id: { in: ids("invoice") }, ...WITH_ARCHIVED },
      select: selects.invoiceSelect,
    })) as InvoiceRow[];
    await withInvoiceLines(rows);
    items.push(...rows.flatMap((invoice) => invoiceItems(context, invoice)));
  }

  if (ids("payment").length) {
    const rows = (await db.payment.findMany({
      where: { id: { in: ids("payment") }, ...WITH_ARCHIVED },
      select: selects.paymentSelect,
    })) as PaymentRow[];
    const missing = [
      ...new Set(rows.flatMap((payment) => allocatedInvoiceIds(payment)).filter((id) => !splits.has(id))),
    ];
    if (missing.length) {
      const invoices = (await db.invoice.findMany({
        where: { id: { in: missing }, ...WITH_ARCHIVED },
        select: selects.invoiceSelect,
      })) as InvoiceRow[];
      await withInvoiceLines(invoices);
      for (const invoice of invoices) splits.set(invoice.id, invoiceSplitFor(context, invoice));
    }
    items.push(...rows.flatMap((payment) => paymentItems(context, payment, splits)));
  }

  if (ids("expense").length) {
    const rows = (await db.expense.findMany({
      where: { id: { in: ids("expense") }, ...WITH_ARCHIVED },
      select: selects.expenseSelect,
    })) as ExpenseRow[];
    items.push(...rows.flatMap((expense) => expenseItems(context, expense)));
  }

  if (ids("security_deposit").length) {
    const rows = (await db.securityDeposit.findMany({
      where: { id: { in: ids("security_deposit") }, ...WITH_ARCHIVED },
      select: DEPOSIT_POSTING_SELECT,
    })) as DepositRow[];
    const paid = await paidDepositLeaseIds(rows.map((deposit) => deposit.leaseId));
    items.push(
      ...rows.flatMap((deposit) => depositItems(context, { ...deposit, installmentPaid: paid.has(deposit.leaseId) })),
    );
  }

  if (selects.purchases && ids("purchase_bill").length) {
    const rows = (await db.purchaseBill.findMany({
      where: { id: { in: ids("purchase_bill") } },
      select: BILL_POSTING_SELECT,
    })) as BillRow[];
    items.push(...rows.flatMap((bill) => billItems(context, bill)));
  }

  if (selects.purchases && ids("payment_voucher").length) {
    const rows = (await db.paymentVoucher.findMany({
      where: { id: { in: ids("payment_voucher") } },
      select: VOUCHER_POSTING_SELECT,
    })) as VoucherRow[];
    items.push(...rows.flatMap((voucher) => voucherItems(context, voucher)));
  }
  return items;
}
