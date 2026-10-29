# Ledger posting hooks

Where the app's write paths call the ledger so the books follow the
documents. All of them are wired (2026-10-04); the nightly sweep
(`GET /api/cron/ledger-sweep` — schedule it daily, e.g. 02:30 Riyadh, with
`Authorization: Bearer $CRON_SECRET`) and the "Post documents now" button on
Accounting setup catch up anything a hook missed.

## The call

```ts
import { postAfterCommit } from "@/lib/accounting/hooks";

// AFTER the document's own transaction has committed — never inside it.
postAfterCommit("payment", paymentId, { userId: user.id });
postAfterCommit("invoice", [noteId, originalInvoiceId]);
```

- The kind is `"invoice"`, `"payment"`, `"expense"`, `"security_deposit"`,
  `"purchase_bill"` or `"payment_voucher"`.
  An invoice also posts what an owner or a customer paid on it (its
  settlements, `invoice_settlement`, sourceId `<invoice id>:<n>`); a payment
  its refund; a deposit its receipt and its settlement.
- It runs after the response has gone out (Next's `after`); outside a request
  (a script) it simply runs. It never throws: a failure is logged and the
  sweep retries. It does nothing until the office has set accounting up, or
  outside an organization context.
- Underneath it is `postDocumentSafely` → `postDocument`, which re-reads the
  document and posts, replaces in place (open period), reverses and reposts
  (closed period) or reverses (cancelled/deleted). Calling it on an unchanged
  document writes nothing, so a hook that fires too often is harmless.

What each document's posting reads (`*_POSTING_SELECT` and the
`*PostingSelect()` readers in `src/lib/accounting/documents.service.ts`), so
a write that touches none of it needs no hook:

| Document | Fields that change the books |
|---|---|
| Invoice | number, tenant, property, lease, unit, category, issueDate (custom invoices and credit notes post on it), dueDate (installments post on it), `status` (only CANCELLED matters), totalAmount, taxAmount, lineItems, its invoice_lines, customer type/owner/name/VAT number, metadata.settlements, deletedAt |
| Payment | amount, amountPaid, type, status, paymentMethod, paidDate, allocations, paymentHistory (a `credit` entry: money held as the tenant's credit), deletedAt, invoiceId, gateway ids, `recordedById` (a person wins over a gateway id: POS, not gateway clearing), payment number (RCP-…) or receipt number; `updatedAt` for a refund without a `refunded` history entry |
| Expense | every field, VAT amount/category and supplier included |
| Purchase bill | status (approved, part paid and paid post; pending and cancelled do not), billDate, supplier, each line's account, net, VAT, VAT category, building and unit (a cost centre), and the office's VAT registration. What is paid on it changes the status, not the entry |
| Payment voucher | status (posted posts, cancelled does not), voucherDate, supplier, amount, reference, the account it is drawn on. Its allocations to bills change the bills' status, not the entry |
| SecurityDeposit | amount, status, collectedDate, collectedPaymentId, refundAmount/Date/Method, deletedAt |

Function names are the anchors; line numbers are as of 2026-10-03 and drift.

## 1. Services that own the transaction (every route inherits these)

`src/lib/services/payment-invoice-linking.service.ts`
- `recordInstallmentPayment` — desk payment, mark-as-paid, bulk mark paid, the
  tenant card intent. After its transaction: post `paymentId`.
- `deleteRecordedPayment` — post `paymentId`.
- `refundRecordedPayment` — post `paymentId`.
- `restoreRecordedPayment` (archive restore) — post `paymentId`.
- `PaymentInvoiceLinkingService.applyPaymentToInvoices` (allocation change) —
  only when `result.success`: post `paymentId` **and** each
  `applicationsApplied[].invoiceId` (it rewrites the invoices' totals).
- `PaymentInvoiceLinkingService.reversePaymentApplication` — only when
  `success`: post `paymentId` and `affectedInvoices`. It now writes the
  `refunded` history entry, so the refund is dated by it.
- `applyPaymentToSingleInvoice` and `recordManualPayment` — the payment and
  the installments they applied it to.
- `applyPaymentToInvoice` (wrapper with its own transaction around
  `applyPaymentToInvoiceTx`) — post the invoice id.

`src/lib/payments/settlement.ts`
- `settleGatewayPayment` — the one path for every gateway capture (Stripe and
  PayPal webhooks, `/api/payments/status/[paymentIntentId]`, create-intent,
  stripe-payment, PayPal capture). After its transaction, when
  `result.applied`: post `paymentId`.

`src/lib/payments/gateway-review.ts`
- `holdGatewayMoneyAsCredit` — gateway money its payment could not take (paid
  at the desk meanwhile, settled or closed already) becomes a payment held as
  the tenant's credit (Dr gateway clearing / Cr tenant receivable): post its
  id.

`src/lib/invoice/custom-invoice.service.ts` (accounting phase 0)
- `createCustomInvoice` → the invoice; `createCreditNote` /
  `creditWholeInvoice` → the note **and** the invoice it corrects;
  `recordCustomerSettlement` and `recordInvoiceRefund` (a negative
  settlement: the refund paid back) → the invoice (its settlements).

`src/lib/accounting/owners.service.ts`
- `closeSettlement` issues (or links) the owner's tax invoice for the
  commission and pays it from the owner's balance (an `owner_balance`
  settlement on it): post the invoice. `reverseSettlement` puts the deduction
  back (a negative settlement) and credits an invoice the settlement issued:
  post the invoice (the credit note posts itself).

`src/lib/services/auto-invoice-generation.service.ts`
- `createInvoiceRecord` — every generated installment, whichever path
  generated it (covers `billLeaseInstallments` below).

`src/lib/services/lease-amendment.service.ts`
- `amendLease` — after its transaction: the installments it cancelled (their
  postings reverse), then every id `billLeaseInstallments` billed in their
  place.

`src/lib/services/expense.service.ts` (no transactions)
- `createExpense` → `expense.id`; `updateExpense` (approve, pay and cancel all
  arrive here as `status`) → `id`; `deleteExpense` → `id`.

`src/lib/services/lease-lifecycle.service.ts`
- `billLeaseInstallments` (schedule generation, via
  `autoInvoiceGenerationService.generateInvoicesForLease`) — post every id in
  the returned `invoiceIds`. Callers: generate-invoices, renew, lease create,
  lease PUT/PATCH status, sign, the check-leases cron.

`src/lib/accounting/purchases/bills.service.ts` and `vouchers.service.ts`
(purchases, migration 20261004190000_purchases; they own their transactions)
- `approveBill`, `reopenBill`, `cancelBill` → `postAfterCommit("purchase_bill",
  id)`: approving posts it, sending it back or cancelling reverses it.
  `createBill` and `updateBill` only touch a bill waiting for approval, which
  posts nothing, so they need no hook.
- `createVoucher` and `cancelVoucher` → `postAfterCommit("payment_voucher",
  id)`. `allocateVoucher` moves nothing in the books (the supplier's account
  already went down by the whole voucher) and needs none.
- A bill dated in the future posts when its day arrives (the sweep), like any
  other document.

## 2. Routes that write directly

Invoices
- `api/invoices/route.ts` POST (manual invoice) → `invoice.id`; PATCH bulk edit
  (`updateMany`, dueDate) → each of `ids`; DELETE bulk soft delete → each of `ids`.
- `api/invoices/bulk/route.ts` POST — `bulkUpdateStatus` and `bulkDelete`
  (per-row update in a loop) → `invoice.id`; `bulkMarkAsPaid` is covered by
  `recordInstallmentPayment`.
- `api/invoices/[id]/route.ts` PUT `updateInvoice` and DELETE `deleteInvoice` → `id`.
- `api/leases/[id]/installments/route.ts` POST (`createManualInstallment`) → `invoice.id`.
- `api/leases/[id]/installments/[invoiceId]/route.ts` PATCH (edit) and DELETE
  (cancel) → `invoiceId`.
- `api/leases/[id]/terminate/route.ts` POST — `tx.invoice.updateMany` cancels
  the unpaid installments inside `changeLeaseStatus`'s transaction; the ids are
  not collected. Collect them with a `findMany` on the same `where` first (or
  post every invoice of the lease) and post after the route's call returns.
- `archive.service.ts restoreArchived` (invoice restore) → `id`.

Payments
- `api/payments/route.ts` DELETE — loops `deleteRecordedPayment` (covered).
- `api/payments/[id]/route.ts` PUT (edit amount/type/method on a PARTIAL or
  REFUNDED row) → `payment.id`; PATCH generic update (`markAsPaid` without an
  invoice sets PAID directly, `markAsFailed`, `updateAmount`, `updateDueDate`)
  → `payment.id`. `refund` and `markAsPaid` with an invoice are covered.
- `api/payments/record/route.ts` PATCH / DELETE — covered by
  `applyPaymentToInvoices` / `reversePaymentApplication`.
- `api/leases/[id]/payment-sync/route.ts` PUT is retired (410): it marked a
  payment paid with an unchecked amount and never touched the installment.
  `markAsFailed` on PATCH `api/payments/[id]` refuses a payment with money on
  it (delete or refund it instead).
- `api/invoices/[id]/checkout-session/reconcile/route.ts` and
  `api/invoices/[id]/stripe-payment/route.ts` are retired (410): nothing to
  hook.
- `api/tenant/receipts/route.ts` POST — creates the `PaymentReceipt` whose
  number is the payment entry's reference; post `paymentId` after it.
- `demo-data.service.ts createDemoPayments` (PAID rows) → `createdPayments`.

Security deposits
- `api/security-deposits/[id]/route.ts` PUT — one hook after the action switch
  (`collect`, `refund` incl. partial refund and forfeit) → `id`; DELETE → `id`.

## 3. Left to the sweep

- The archive refuses to purge an invoice or a payment that has ever been
  posted (`archive.service.ts postedEntryCount`): the books keep its history.
  The other hard deletes (`lib/demo-data-purge.ts`, `api/seed/invoices`
  DELETE) still destroy rows: the sweep reverses entries whose document is
  gone. Clearing demo data does not clear the books.
- A document becoming due (dueDate/paidDate/date reaching today) with no write
  — only the daily sweep posts it, so schedule `api/cron/ledger-sweep` (daily,
  e.g. 02:30 Riyadh) with `Authorization: Bearer $CRON_SECRET`.
- Ownership changes (a building's owner, an investment agreement starting or
  ending) and lease tax settings change what documents post; the sweep
  re-posts them.
- Writes that change nothing the ledger reads need no hook: invoice-status
  cron (SCHEDULED/ISSUED/OVERDUE), reminders, PDF flags, PENDING charges,
  deposit deductions and notes.
- The sweep reads again, by id, the document behind every live entry its
  date filters did not select (`sourcesToReread`), so an entry is reversed
  only when its document no longer calls for it.
- Gateway refunds made in a gateway's dashboard (`charge.refunded`, PayPal
  `CAPTURE.REFUNDED`) are not recorded when they happen. "Refund" in the app
  asks the gateway how much went back already, refunds only the rest, and
  records both parts on the refund (`gateway-refund-plan.ts`).
