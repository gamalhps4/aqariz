"use client";

/**
 * PropertyPro - Writing a purchase bill, and what the bill screens share
 *
 * The form that enters a supplier's bill and rewrites one that is waiting for
 * approval: the supplier, the bill's date and due date (the due date follows
 * the supplier's payment terms until it is typed by hand), the supplier's own
 * invoice number, a discount taken before VAT, and the lines — what was
 * bought, the account it is charged to, its VAT, and the building and unit it
 * belongs to. The figures are worked out as the person types with the same
 * arithmetic the server uses (lib/accounting/purchases/bill-math.ts), and the
 * form refuses what the route would refuse before anything is sent.
 *
 * Also here, because the list, the bill and the form all need them: who may
 * do what to a bill, the approve / send back / cancel actions with their
 * dialogs, and the "no access" and "not available yet" states.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Info, Lock, Plus, Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useReportFilterOptions } from "@/components/reports/use-report-filter-options";
import { parseAmount } from "@/lib/accounting/journal-validation";
import {
  MAX_BILL_LINES,
  computeBill,
  dueDateFor,
  type BillLineInput,
  type ComputedBill,
} from "@/lib/accounting/purchases/bill-math";
import type { BillView, CostAccountOption } from "@/lib/accounting/purchases/types";
import { STANDARD_VAT_RATE, VAT_CATEGORIES, VatInputError, type VatCategory } from "@/lib/invoice/vat";
import type { UnitOption } from "@/lib/report-filters/options";
import { cn } from "@/lib/utils";
import { AccountPicker, Money } from "../../../setup/_shared/ledger-parts";
import { ERROR_TEXT, type Text } from "../../../setup/_shared/ledger-ui";
import {
  SupplierPicker,
  VAT_CATEGORY_TEXT,
  purchasesRequest,
  todayInput,
  useLedgerError,
  useLedgerText,
  usePurchaseLookups,
  useSupplierOptions,
  type SupplierOption,
  type usePurchasesAccess,
} from "../../_shared/purchases-ui";
import { businessDay } from "@/lib/dates/business-day";

type PurchasesAccess = ReturnType<typeof usePurchasesAccess>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The "none" choice of a searchable picker (its value cannot be empty). */
const NONE = "__none__";
const PLACE_LISTS = ["buildings", "units"] as const;

export const BILLS_HREF = "/dashboard/accounting/purchases/bills";

export function billHref(id: string): string {
  return `${BILLS_HREF}/${encodeURIComponent(id)}`;
}

/** A payment voucher started for this bill, its supplier chosen. */
export function payBillHref(bill: Pick<BillView, "id" | "supplier">): string {
  const query = new URLSearchParams({ supplierId: bill.supplier?.id ?? "", billId: bill.id });
  return `/dashboard/accounting/purchases/vouchers/new?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// Who may do what to a bill
// ---------------------------------------------------------------------------

/**
 * What the reader can do to this bill now: what its state allows
 * (`BillView.can`) and what their rights allow, together.
 */
export function allowedBillActions(bill: BillView, access: PurchasesAccess) {
  return {
    edit: bill.can.edit && access.canEdit,
    approve: bill.can.approve && access.canApprove,
    reopen: bill.can.reopen && access.canEdit,
    cancel: bill.can.cancel && access.canDelete,
    pay: bill.can.pay && access.canPay && bill.balance > 0 && Boolean(bill.supplier),
  };
}

/**
 * Approve, send back and cancel, with the dialogs the last two ask through.
 * `onChanged` receives the bill as it is now, or null when it should be read
 * again (a refusal: someone else may have changed it meanwhile).
 */
export function useBillActions(onChanged: (bill: BillView | null) => void) {
  const { tx } = useLedgerText();
  const describeError = useLedgerError();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reopenTarget, setReopenTarget] = useState<BillView | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BillView | null>(null);
  const [reason, setReason] = useState("");

  async function post(bill: BillView, action: "approve" | "reopen" | "cancel", extra: Record<string, unknown> = {}) {
    setBusyId(bill.id);
    const response = await purchasesRequest<BillView>(`/bills/${encodeURIComponent(bill.id)}/${action}`, {
      method: "POST",
      body: { ...extra, version: bill.version },
    });
    setBusyId(null);
    if (!response.ok) {
      toast.error(describeError(response));
      onChanged(null);
      return;
    }
    const number = response.data?.displayNumber ?? bill.displayNumber;
    toast.success(
      action === "approve"
        ? tx("purchases.bills.approvedToast", "Bill {number} approved", { number })
        : action === "reopen"
          ? tx("purchases.bills.sentBackToast", "Bill {number} sent back. It is waiting for approval again.", { number })
          : tx("purchases.bills.cancelledToast", "Bill {number} cancelled", { number }),
    );
    onChanged(response.data);
  }

  async function confirmReopen() {
    if (!reopenTarget) return;
    await post(reopenTarget, "reopen");
    setReopenTarget(null);
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    await post(cancelTarget, "cancel", { reason: reason.trim() || null });
    setCancelTarget(null);
  }

  const working = busyId !== null;

  const dialogs = (
    <>
      <Dialog
        open={reopenTarget !== null}
        onOpenChange={(open) => {
          if (!open && !working) setReopenTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {tx("purchases.bills.sendBackTitle", "Send bill {number} back?", {
                number: reopenTarget?.displayNumber ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {tx(
                "purchases.bills.sendBackBody",
                "It goes back to waiting for approval and its entry in the books is reversed, so it can be corrected and approved again.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenTarget(null)} disabled={working}>
              {tx("ledger.common.cancel", "Cancel")}
            </Button>
            <Button onClick={() => void confirmReopen()} disabled={working}>
              {working ? tx("ledger.common.working", "Working…") : tx("purchases.bills.sendBack", "Send back")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !working) setCancelTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {tx("purchases.bills.cancelTitle", "Cancel bill {number}?", {
                number: cancelTarget?.displayNumber ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {tx(
                "purchases.bills.cancelBody",
                "A cancelled bill keeps its number and stays in the list. If it was approved, its entry in the books is reversed.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bill-cancel-reason">{tx("purchases.bills.cancelReason", "Reason (optional)")}</Label>
            <Textarea
              id="bill-cancel-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={working}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={working}>
              {tx("purchases.bills.keepBill", "Keep the bill")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmCancel()} disabled={working}>
              {working ? tx("ledger.common.working", "Working…") : tx("purchases.bills.cancelConfirm", "Cancel the bill")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return {
    busyId,
    approve: (bill: BillView) => void post(bill, "approve"),
    requestReopen: (bill: BillView) => setReopenTarget(bill),
    requestCancel: (bill: BillView) => {
      setReason("");
      setCancelTarget(bill);
    },
    dialogs,
  };
}

// ---------------------------------------------------------------------------
// States the bill screens share
// ---------------------------------------------------------------------------

export function StateCard({
  icon: Icon = Info,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title?: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Icon className="h-8 w-8 text-muted-foreground" />
        {title && <p className="font-medium">{title}</p>}
        <div className="max-w-md text-sm text-muted-foreground">{body}</div>
        {action}
      </CardContent>
    </Card>
  );
}

export function BackToBills() {
  const { tx } = useLedgerText();
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={BILLS_HREF}>
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {tx("purchases.bills.back", "All bills")}
      </Link>
    </Button>
  );
}

/** The reader may not see purchase bills, or may not enter one. */
export function NoBillAccess({ action = "view" }: { action?: "view" | "create" }) {
  const { tx } = useLedgerText();
  if (action === "create") {
    return (
      <StateCard
        icon={Lock}
        title={tx("purchases.bills.noCreate.title", "You cannot enter purchase bills")}
        body={tx(
          "purchases.bills.noCreate.body",
          "Ask an administrator to give your permission group the right to add in Purchases & payments.",
        )}
        action={<BackToBills />}
      />
    );
  }
  return (
    <StateCard
      icon={Lock}
      title={tx("purchases.bills.noAccess.title", "You do not have access to purchase bills")}
      body={tx(
        "purchases.bills.noAccess.body",
        "Ask an administrator to give your permission group the right to view Purchases & payments.",
      )}
    />
  );
}

/** The purchases tables are not in this database yet. */
export function PurchasesUnavailable() {
  const { tx } = useLedgerText();
  const describeError = useLedgerError();
  return (
    <StateCard
      title={tx("purchases.bills.unavailable.title", "Purchases are not available yet")}
      body={describeError({ code: "PURCHASES_UNAVAILABLE", message: null })}
    />
  );
}

/** Whether accounting is known not to be set up (the purchases lookups say so for every purchases right). */
export function useBooksNotSetUp(enabled: boolean): boolean {
  return usePurchaseLookups({}, { enabled }).notSetUp;
}

// ---------------------------------------------------------------------------
// The form's values
// ---------------------------------------------------------------------------

export interface BillLineDraft {
  key: string;
  description: string;
  accountId: string;
  /** As typed; blank is one. */
  quantity: string;
  unitPrice: string;
  vatCategory: VatCategory;
  /** As typed, for a standard-rated line; blank is the standard rate. */
  vatRate: string;
  propertyId: string;
  unitId: string;
  /** A saved line's building and unit names, for when the pickers no longer list them. */
  propertyLabel?: string;
  unitLabel?: string;
}

export interface BillFormValues {
  supplierId: string;
  billDate: string;
  /** The due date as typed, used while `dueDateManual` holds. */
  dueDate: string;
  /**
   * false: the due date follows the supplier's payment terms; true: typed by
   * hand; null: an existing bill's stored date, judged against the terms the
   * first time the bill date or the supplier changes.
   */
  dueDateManual: boolean | null;
  supplierInvoiceNumber: string;
  notes: string;
  discountAmount: string;
  lines: BillLineDraft[];
}

let lineSequence = 0;

function lineKey(): string {
  lineSequence += 1;
  return `bill-line-${lineSequence}`;
}

export function emptyBillLine(): BillLineDraft {
  return {
    key: lineKey(),
    description: "",
    accountId: "",
    quantity: "1",
    unitPrice: "",
    vatCategory: "S",
    vatRate: String(STANDARD_VAT_RATE),
    propertyId: "",
    unitId: "",
  };
}

/** A new bill: dated today, for `supplierId` when the page was opened for one. */
export function emptyBillForm(supplierId = ""): BillFormValues {
  return {
    supplierId,
    billDate: todayInput(),
    dueDate: "",
    dueDateManual: false,
    supplierInvoiceNumber: "",
    notes: "",
    discountAmount: "",
    lines: [emptyBillLine()],
  };
}

/** A bill waiting for approval, as the form edits it. */
export function billToFormValues(bill: BillView): BillFormValues {
  const lines: BillLineDraft[] = (bill.lines ?? []).map((line) => ({
    key: lineKey(),
    description: line.description,
    accountId: line.accountId,
    quantity: String(line.quantity),
    unitPrice: String(line.unitPrice),
    vatCategory: line.vatCategory,
    vatRate: String(line.vatCategory === "S" && line.vatRate > 0 ? line.vatRate : STANDARD_VAT_RATE),
    propertyId: line.propertyId ?? "",
    unitId: line.unitId ?? "",
    propertyLabel: line.propertyName ?? undefined,
    unitLabel: line.unitName ?? undefined,
  }));
  return {
    supplierId: bill.supplier?.id ?? "",
    billDate: bill.billDate,
    dueDate: bill.dueDate,
    dueDateManual: null,
    supplierInvoiceNumber: bill.supplierInvoiceNumber ?? "",
    notes: bill.notes ?? "",
    discountAmount: bill.discountAmount > 0 ? String(bill.discountAmount) : "",
    lines: lines.length ? lines : [emptyBillLine()],
  };
}

// ---------------------------------------------------------------------------
// Reading what was typed
// ---------------------------------------------------------------------------

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/** A number as typed — Arabic-Indic digits and separators included — in plain ASCII. */
function plainNumber(value: string): string {
  return value
    .trim()
    .replace(ARABIC_INDIC, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/٫/g, ".")
    .replace(/[,٬\s]/g, "");
}

/** A quantity: blank is one; NaN unless above zero with at most three decimals. */
function readQuantity(value: string): number {
  const text = plainNumber(value);
  if (!text) return 1;
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return Number.NaN;
  const quantity = Number(text);
  return quantity > 0 && quantity <= 1_000_000_000 ? quantity : Number.NaN;
}

/** A standard-rated line's rate: blank is the standard rate; NaN unless above zero and at most 100. */
function readRate(value: string): number {
  const text = plainNumber(value);
  if (!text) return STANDARD_VAT_RATE;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return Number.NaN;
  const rate = Number(text);
  return rate > 0 && rate <= 100 ? rate : Number.NaN;
}

/** A spare row nobody has typed in; left out when the bill is saved. */
function isBlankLine(line: BillLineDraft): boolean {
  return !line.description.trim() && !line.accountId && !line.unitPrice.trim() && !line.propertyId && !line.unitId;
}

/** The day the supplier's terms make a bill of `billDate` due; empty while the bill date is not a day. */
function termsDueDate(billDate: string, terms: number | null): string {
  if (!DAY.test(billDate)) return "";
  const day = new Date(`${billDate}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) return "";
  return businessDay(dueDateFor(day, terms));
}

/** Whether the due date stands as typed. `terms` is undefined while the supplier's terms are unknown. */
function dueIsManual(values: BillFormValues, terms: number | null | undefined): boolean {
  if (values.dueDateManual !== null) return values.dueDateManual;
  if (terms === undefined) return true;
  return values.dueDate !== termsDueDate(values.billDate, terms);
}

type LineProblem = "description" | "account" | "quantity" | "price" | "rate";

interface BillReview {
  blank: boolean[];
  problems: LineProblem[][];
  /** Each line's figures; null where they cannot be worked out yet. */
  figures: Array<ComputedBill["lines"][number] | null>;
  totals: ComputedBill["totals"] | null;
  discountProblem: "invalid" | "tooLarge" | null;
  /** What the arithmetic refused, should it refuse anything the checks let through. */
  arithmetic: string | null;
  /** Lines that are not blank. */
  filled: number;
}

function tryCompute(inputs: BillLineInput[], discount: number): { bill: ComputedBill | null; error: string | null } {
  try {
    return { bill: computeBill(inputs, discount), error: null };
  } catch (error) {
    if (error instanceof VatInputError) return { bill: null, error: error.message };
    throw error;
  }
}

/** The lines checked as the server checks them, and the bill worked out as it will be saved. */
function reviewBill(values: BillFormValues): BillReview {
  const blank = values.lines.map(isBlankLine);
  const problems: LineProblem[][] = [];
  const counted: number[] = [];
  const inputs: BillLineInput[] = [];
  values.lines.forEach((line, index) => {
    const quantity = readQuantity(line.quantity);
    const price = parseAmount(line.unitPrice);
    const rate = line.vatCategory === "S" ? readRate(line.vatRate) : 0;
    const list: LineProblem[] = [];
    if (!blank[index]) {
      if (!line.description.trim()) list.push("description");
      if (!line.accountId) list.push("account");
      if (Number.isNaN(quantity)) list.push("quantity");
      if (price === null || Number.isNaN(price)) list.push("price");
      if (Number.isNaN(rate)) list.push("rate");
    }
    problems.push(list);
    if (blank[index] || Number.isNaN(quantity) || Number.isNaN(rate) || (price !== null && Number.isNaN(price))) {
      return;
    }
    counted.push(index);
    inputs.push({
      description: line.description,
      accountId: line.accountId,
      quantity,
      unitPrice: (price ?? 0) / 100,
      vatCategory: line.vatCategory,
      vatRate: line.vatCategory === "S" ? rate : null,
    });
  });

  const typedDiscount = parseAmount(values.discountAmount);
  let discountProblem: BillReview["discountProblem"] =
    typedDiscount !== null && Number.isNaN(typedDiscount) ? "invalid" : null;
  const discount = discountProblem || typedDiscount === null ? 0 : typedDiscount / 100;
  let attempt = tryCompute(inputs, discount);
  if (attempt.error && discount > 0) {
    // The one figure the checks above leave to the arithmetic: a discount
    // above what the lines add up to. Show the lines without it meanwhile.
    discountProblem = "tooLarge";
    attempt = tryCompute(inputs, 0);
  }

  return {
    blank,
    problems,
    figures: values.lines.map((_, index) => {
      const position = counted.indexOf(index);
      return position >= 0 ? (attempt.bill?.lines[position] ?? null) : null;
    }),
    totals: attempt.bill?.totals ?? null,
    discountProblem,
    arithmetic: attempt.error,
    filled: blank.filter((value) => !value).length,
  };
}

/** What stops the bill being saved, as the reader will read it. */
function billIssues(values: BillFormValues, review: BillReview, supplierChosen: boolean, dueDate: string): Text[] {
  const issues: Text[] = [];
  const anyLine = (problem: LineProblem) => review.problems.some((list) => list.includes(problem));
  if (!supplierChosen) issues.push(["purchases.billForm.issue.supplier", "Choose the supplier."]);
  if (!DAY.test(values.billDate)) {
    issues.push(["purchases.billForm.issue.billDate", "Choose the bill's date."]);
  } else if (dueDate && dueDate < values.billDate) {
    issues.push(ERROR_TEXT.PURCHASE_DUE_BEFORE_BILL);
  }
  if (review.filled === 0) issues.push(["purchases.billForm.issue.noLines", "Add at least one line."]);
  if (anyLine("description")) {
    issues.push(["purchases.billForm.issue.description", "Describe what was bought on every line."]);
  }
  if (anyLine("account")) issues.push(ERROR_TEXT.LEDGER_LINE_NO_ACCOUNT);
  if (anyLine("quantity")) {
    issues.push(["purchases.billForm.issue.quantity", "A quantity is a number above zero, with at most three decimals."]);
  }
  if (anyLine("price")) {
    issues.push([
      "purchases.billForm.issue.price",
      "Every line needs a unit price of zero or more, with at most two decimals.",
    ]);
  }
  if (anyLine("rate")) issues.push(["purchases.billForm.issue.rate", "A VAT rate is a number above zero, up to 100."]);
  if (review.discountProblem === "invalid") {
    issues.push([
      "purchases.billForm.issue.discount",
      "The discount is an amount of zero or more, with at most two decimals.",
    ]);
  }
  if (review.discountProblem === "tooLarge") {
    issues.push(["purchases.billForm.issue.discountTooLarge", "The discount cannot be more than the lines add up to."]);
  }
  if (review.arithmetic) {
    issues.push([
      "purchases.billForm.issue.arithmetic",
      "The figures could not be worked out. Check the quantities, prices and discount.",
    ]);
  }
  if (
    review.filled > 0 &&
    !anyLine("price") &&
    !anyLine("quantity") &&
    review.totals &&
    Math.round(review.totals.totalAmount * 100) <= 0
  ) {
    issues.push(ERROR_TEXT.PURCHASE_BILL_EMPTY);
  }
  return issues;
}

/** The body the bills route takes (lib/accounting/purchases/schemas.ts). */
function billRequestBody(values: BillFormValues, dueDate: string) {
  const discount = parseAmount(values.discountAmount);
  return {
    supplierId: values.supplierId,
    billDate: values.billDate,
    dueDate: dueDate || null,
    supplierInvoiceNumber: values.supplierInvoiceNumber.trim() || null,
    discountAmount: discount !== null && !Number.isNaN(discount) ? discount / 100 : 0,
    notes: values.notes.trim() || null,
    lines: values.lines
      .filter((line) => !isBlankLine(line))
      .map((line) => ({
        description: line.description.trim(),
        accountId: line.accountId,
        quantity: readQuantity(line.quantity),
        unitPrice: (parseAmount(line.unitPrice) ?? 0) / 100,
        vatCategory: line.vatCategory,
        ...(line.vatCategory === "S" ? { vatRate: readRate(line.vatRate) } : {}),
        propertyId: line.propertyId || null,
        unitId: line.unitId || null,
      })),
  };
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export interface BillFormProps {
  mode: "create" | "edit";
  /** The values it opens with; a new bill starts from `emptyBillForm(initialSupplierId)`. */
  initial?: BillFormValues;
  initialSupplierId?: string;
  /** Edit: the bill being rewritten and the version that was read. */
  billId?: string;
  version?: number;
  /** Edit: the bill's supplier, offered even when the active list no longer holds it. */
  currentSupplier?: { id: string; name: string; vatNumber: string | null; paymentTermsDays: number | null } | null;
  /** Where Cancel goes. */
  cancelHref: string;
  /** The server answered that accounting is not set up. */
  onNotSetUp?: () => void;
}

export function BillForm({
  mode,
  initial,
  initialSupplierId = "",
  billId,
  version,
  currentSupplier,
  cancelHref,
  onNotSetUp,
}: BillFormProps) {
  const router = useRouter();
  const { tx, text } = useLedgerText();
  const describeError = useLedgerError();
  const [values, setValues] = useState<BillFormValues>(() => initial ?? emptyBillForm(initialSupplierId));
  const [openingSupplierId] = useState(() => (initial ?? { supplierId: initialSupplierId }).supplierId);
  // A saved bill's own accounts, so each still shows when it no longer qualifies.
  const [openingAccountIds] = useState(() => (initial?.lines ?? []).map((line) => line.accountId));
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const supplierList = useSupplierOptions(true, mode === "edit");
  const chart = usePurchaseLookups({ accounts: true }, { alsoAccountIds: openingAccountIds });
  const places = useReportFilterOptions(PLACE_LISTS);

  // Suppliers: the active ones, and the one the bill opened with even if it
  // is no longer active (an edit), so its name still shows.
  const loaded = supplierList.suppliers;
  // The bill's own supplier counts too (an edit): beyond the picker's cap its terms are known only from here.
  const termsById = new Map<string, number | null>([
    ...(currentSupplier ? [[currentSupplier.id, currentSupplier.paymentTermsDays] as const] : []),
    ...loaded.map((supplier) => [supplier.id, supplier.paymentTermsDays] as const),
  ]);
  const termsOf = (supplierId: string): number | null | undefined =>
    termsById.has(supplierId) ? (termsById.get(supplierId) ?? null) : undefined;
  const activeChoices = loaded.filter((supplier) => supplier.isActive || supplier.id === openingSupplierId);
  const supplierChoices: SupplierOption[] =
    currentSupplier && !activeChoices.some((supplier) => supplier.id === currentSupplier.id)
      ? [...activeChoices, { ...currentSupplier, isActive: true }]
      : activeChoices;
  const selected = loaded.find((supplier) => supplier.id === values.supplierId) ?? null;
  const supplierChosen = Boolean(values.supplierId) && supplierChoices.some((supplier) => supplier.id === values.supplierId);

  // The due date: the supplier's terms until it is typed by hand.
  const terms = termsOf(values.supplierId);
  const manual = dueIsManual(values, terms);
  const termsDue = terms === undefined ? "" : termsDueDate(values.billDate, terms);
  const dueDate = manual ? values.dueDate : termsDue;

  // Accounts a purchase can be charged to — and a saved line's own account,
  // so it still shows when it no longer qualifies (the server then says why).
  const costAccounts = chart.accounts.filter((account) => account.qualifies);
  const costIds = new Set(costAccounts.map((account) => account.id));
  const accountsFor = (accountId: string): CostAccountOption[] =>
    !accountId || costIds.has(accountId)
      ? costAccounts
      : [...costAccounts, ...chart.accounts.filter((account) => account.id === accountId)];

  // Cost centres: buildings, and units narrowed to the building chosen.
  const buildings = places.options?.buildings ?? [];
  const units = places.options?.units ?? [];
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const unitsByBuilding = new Map<string, UnitOption[]>();
  for (const unit of units) {
    const list = unitsByBuilding.get(unit.propertyId);
    if (list) list.push(unit);
    else unitsByBuilding.set(unit.propertyId, [unit]);
  }
  const buildingIds = new Set(buildings.map((building) => building.id));
  const noBuilding: SearchableSelectOption = { value: NONE, label: tx("purchases.billForm.noBuilding", "No building") };
  const noUnit: SearchableSelectOption = { value: NONE, label: tx("purchases.billForm.noUnit", "No unit") };
  const buildingOptionsFor = (line: BillLineDraft): SearchableSelectOption[] => [
    noBuilding,
    ...buildings.map((building) => ({ value: building.id, label: building.label, subtitle: building.hint ?? undefined })),
    ...(line.propertyId && !buildingIds.has(line.propertyId)
      ? [{ value: line.propertyId, label: line.propertyLabel || line.propertyId }]
      : []),
  ];
  const unitOptionsFor = (line: BillLineDraft): SearchableSelectOption[] => {
    const offered = line.propertyId ? (unitsByBuilding.get(line.propertyId) ?? []) : units;
    return [
      noUnit,
      ...offered.map((unit) => ({ value: unit.id, label: unit.label, subtitle: unit.hint ?? undefined })),
      ...(line.unitId && !offered.some((unit) => unit.id === line.unitId)
        ? [{ value: line.unitId, label: line.unitLabel || line.unitId }]
        : []),
    ];
  };

  const review = reviewBill(values);
  const issues = billIssues(values, review, supplierChosen, dueDate);

  function chooseSupplier(supplierId: string) {
    setValues((current) => ({
      ...current,
      supplierId,
      dueDateManual: dueIsManual(current, termsOf(current.supplierId)),
    }));
  }

  function changeBillDate(billDate: string) {
    setValues((current) => ({
      ...current,
      billDate,
      dueDateManual: dueIsManual(current, termsOf(current.supplierId)),
    }));
  }

  function changeDueDate(next: string) {
    // Clearing the date hands it back to the payment terms.
    setValues((current) => ({ ...current, dueDate: next, dueDateManual: next !== "" }));
  }

  function updateLine(key: string, change: Partial<BillLineDraft>) {
    setValues((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...change } : line)),
    }));
  }

  function addLine() {
    const line = emptyBillLine();
    setValues((current) =>
      current.lines.length >= MAX_BILL_LINES ? current : { ...current, lines: [...current.lines, line] },
    );
  }

  function removeLine(key: string) {
    setValues((current) =>
      current.lines.length <= 1 ? current : { ...current, lines: current.lines.filter((line) => line.key !== key) },
    );
  }

  function chooseBuilding(line: BillLineDraft, propertyId: string) {
    const unit = line.unitId ? unitById.get(line.unitId) : undefined;
    const keepUnit = Boolean(propertyId) && unit?.propertyId === propertyId;
    updateLine(line.key, {
      propertyId,
      propertyLabel: undefined,
      unitId: keepUnit ? line.unitId : "",
      unitLabel: keepUnit ? line.unitLabel : undefined,
    });
  }

  function chooseUnit(line: BillLineDraft, unitId: string) {
    const unit = unitId ? unitById.get(unitId) : undefined;
    updateLine(line.key, {
      unitId,
      unitLabel: undefined,
      ...(unit ? { propertyId: unit.propertyId, propertyLabel: undefined } : {}),
    });
  }

  async function submit() {
    setAttempted(true);
    setServerError(null);
    if (issues.length > 0) {
      toast.error(text(issues[0]));
      return;
    }
    setBusy(true);
    const body = billRequestBody(values, dueDate);
    const response =
      mode === "edit" && billId
        ? await purchasesRequest<BillView>(`/bills/${encodeURIComponent(billId)}`, {
            method: "PUT",
            body: { ...body, version },
          })
        : await purchasesRequest<BillView>("/bills", { method: "POST", body });
    if (!response.ok || !response.data) {
      setBusy(false);
      if (response.code === "LEDGER_NOT_SET_UP" && onNotSetUp) {
        onNotSetUp();
        return;
      }
      const message = describeError(response);
      setServerError(message);
      toast.error(message);
      return;
    }
    const number = response.data.displayNumber;
    toast.success(
      mode === "edit"
        ? tx("purchases.billForm.saved", "Bill {number} saved", { number })
        : tx("purchases.billForm.entered", "Bill {number} entered, waiting for approval", { number }),
    );
    router.push(billHref(response.data.id));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="bill-supplier">{tx("purchases.billForm.supplier", "Supplier")}</Label>
            <SupplierPicker
              id="bill-supplier"
              suppliers={supplierChoices}
              value={values.supplierId}
              onChange={chooseSupplier}
              disabled={busy}
              className={cn(attempted && !supplierChosen && "border-destructive")}
            />
            {selected && !selected.isActive ? (
              <p className="text-xs text-destructive">{text(ERROR_TEXT.PURCHASE_SUPPLIER_INACTIVE)}</p>
            ) : values.supplierId && terms !== undefined ? (
              <p className="text-xs text-muted-foreground">
                {terms === null || terms <= 0
                  ? tx("purchases.billForm.termsNone", "Payment terms: due on the bill's date.")
                  : tx("purchases.billForm.termsDays", "Payment terms: {days} days.", { days: terms })}
              </p>
            ) : !supplierList.loading && supplierChoices.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {tx("purchases.billForm.noSuppliers", "There is no active supplier yet.")}{" "}
                <Link href="/dashboard/accounting/purchases/suppliers" className="font-medium text-primary hover:underline">
                  {tx("purchases.billForm.addSupplier", "Add a supplier")}
                </Link>
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="bill-date">{tx("purchases.billForm.billDate", "Bill date")}</Label>
            <Input
              id="bill-date"
              type="date"
              value={values.billDate}
              onChange={(event) => changeBillDate(event.target.value)}
              disabled={busy}
              aria-invalid={attempted && !DAY.test(values.billDate)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bill-due-date">{tx("purchases.billForm.dueDate", "Due date")}</Label>
            <Input
              id="bill-due-date"
              type="date"
              value={dueDate}
              min={DAY.test(values.billDate) ? values.billDate : undefined}
              onChange={(event) => changeDueDate(event.target.value)}
              disabled={busy}
              aria-describedby="bill-due-date-hint"
            />
            <div id="bill-due-date-hint">
              {manual && termsDue && termsDue !== dueDate ? (
                <button
                  type="button"
                  className="text-start text-xs font-medium text-primary hover:underline"
                  onClick={() => setValues((current) => ({ ...current, dueDateManual: false }))}
                  disabled={busy}
                >
                  {tx("purchases.billForm.useTerms", "Follow the supplier's payment terms again")}
                </button>
              ) : !manual && values.supplierId ? (
                <p className="text-xs text-muted-foreground">
                  {tx("purchases.billForm.dueFromTerms", "Set by the supplier's payment terms until you change it.")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2 md:col-span-2 lg:col-span-1">
            <Label htmlFor="bill-invoice-number">
              {tx("purchases.billForm.supplierInvoiceNumber", "Supplier's invoice number")}
            </Label>
            <Input
              id="bill-invoice-number"
              dir="auto"
              maxLength={100}
              value={values.supplierInvoiceNumber}
              onChange={(event) => setValues((current) => ({ ...current, supplierInvoiceNumber: event.target.value }))}
              disabled={busy}
            />
          </div>
          <div className="space-y-2 md:col-span-2 lg:col-span-3">
            <Label htmlFor="bill-notes">{tx("purchases.billForm.notes", "Notes")}</Label>
            <Textarea
              id="bill-notes"
              rows={2}
              maxLength={2000}
              value={values.notes}
              onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
              disabled={busy}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">{tx("purchases.billForm.linesTitle", "What was bought")}</CardTitle>
          {/* A bill is the office's own purchase whatever building its lines
              name: the building is a cost centre, never a charge to its owner. */}
          <p className="text-xs text-muted-foreground">
            {tx(
              "purchases.billForm.costCentreHint",
              "The building and unit are a cost centre for the office's own reports. A cost that the building's owner bears is entered as an expense, which the owner's statement deducts.",
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {chart.error ? (
            <Notice>{describeError(chart.error)}</Notice>
          ) : !chart.loading && costAccounts.length === 0 ? (
            <Notice>
              {tx(
                "purchases.billForm.noCostAccounts",
                "No account in the chart can take a purchase. Add an expense account in the chart of accounts first.",
              )}
            </Notice>
          ) : null}

          {values.lines.map((line, index) => (
            <BillLineFields
              key={line.key}
              line={line}
              index={index}
              figures={review.figures[index]}
              problems={attempted ? review.problems[index] : []}
              accounts={accountsFor(line.accountId)}
              buildingOptions={buildingOptionsFor(line)}
              unitOptions={unitOptionsFor(line)}
              onChange={(change) => updateLine(line.key, change)}
              onChooseBuilding={(propertyId) => chooseBuilding(line, propertyId)}
              onChooseUnit={(unitId) => chooseUnit(line, unitId)}
              onRemove={() => removeLine(line.key)}
              canRemove={values.lines.length > 1}
              disabled={busy}
            />
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLine}
              disabled={busy || values.lines.length >= MAX_BILL_LINES}
            >
              <Plus className="h-4 w-4" />
              {tx("ledger.lines.add", "Add line")}
            </Button>
            {values.lines.length >= MAX_BILL_LINES && (
              <span className="text-xs text-muted-foreground">
                {tx("purchases.billForm.maxLines", "A bill holds at most {max} lines.", { max: MAX_BILL_LINES })}
              </span>
            )}
          </div>

          <BillTotals
            totals={review.totals}
            discount={values.discountAmount}
            onDiscount={(discountAmount) => setValues((current) => ({ ...current, discountAmount }))}
            discountProblem={review.discountProblem}
            disabled={busy}
          />
        </CardContent>
      </Card>

      {attempted && issues.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">
            {tx("purchases.billForm.fixFirst", "Before the bill can be saved:")}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-destructive">
            {issues.map((issue) => (
              <li key={issue[0]}>{text(issue)}</li>
            ))}
          </ul>
        </div>
      )}
      {serverError && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {serverError}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline">
          <Link href={cancelHref}>{tx("ledger.common.cancel", "Cancel")}</Link>
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={busy}>
          {busy
            ? tx("ledger.common.working", "Working…")
            : mode === "edit"
              ? tx("purchases.billForm.save", "Save changes")
              : tx("purchases.billForm.enter", "Enter bill")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces of the form
// ---------------------------------------------------------------------------

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div>{children}</div>
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: number | undefined; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      {value === undefined ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <Money value={value} className={cn("tabular-nums", strong && "font-semibold")} />
      )}
    </div>
  );
}

const INVALID = "border-destructive focus:border-destructive";

function BillLineFields({
  line,
  index,
  figures,
  problems,
  accounts,
  buildingOptions,
  unitOptions,
  onChange,
  onChooseBuilding,
  onChooseUnit,
  onRemove,
  canRemove,
  disabled,
}: {
  line: BillLineDraft;
  index: number;
  figures: ComputedBill["lines"][number] | null;
  problems: LineProblem[];
  accounts: readonly CostAccountOption[];
  buildingOptions: SearchableSelectOption[];
  unitOptions: SearchableSelectOption[];
  onChange: (change: Partial<BillLineDraft>) => void;
  onChooseBuilding: (propertyId: string) => void;
  onChooseUnit: (unitId: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  disabled: boolean;
}) {
  const { tx, text } = useLedgerText();
  const id = (field: string) => `${line.key}-${field}`;
  const flagged = (problem: LineProblem) => problems.includes(problem);
  const standard = line.vatCategory === "S";

  return (
    <div
      role="group"
      aria-label={tx("purchases.billForm.lineLabel", "Line {number}", { number: index + 1 })}
      className={cn(
        "grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-12",
        problems.length > 0 && "border-destructive/50",
      )}
    >
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-5">
        <Label htmlFor={id("description")} className="text-xs text-muted-foreground">
          {tx("purchases.billForm.description", "Description")}
        </Label>
        <Input
          id={id("description")}
          value={line.description}
          maxLength={200}
          placeholder={tx("purchases.billForm.descriptionPlaceholder", "What was bought or done")}
          onChange={(event) => onChange({ description: event.target.value })}
          aria-invalid={flagged("description")}
          className={cn(flagged("description") && INVALID)}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
        <span id={id("account-label")} className="block text-xs font-medium text-muted-foreground">
          {tx("purchases.billForm.account", "Account")}
        </span>
        <div
          role="group"
          aria-labelledby={id("account-label")}
          className={cn(flagged("account") && "rounded-md ring-2 ring-destructive/60")}
        >
          <AccountPicker
            accounts={accounts}
            value={line.accountId}
            onChange={(accountId) => onChange({ accountId })}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="space-y-1.5 lg:col-span-1">
        <Label htmlFor={id("quantity")} className="text-xs text-muted-foreground">
          {tx("purchases.billForm.quantity", "Quantity")}
        </Label>
        <Input
          id={id("quantity")}
          value={line.quantity}
          inputMode="decimal"
          dir="ltr"
          onChange={(event) => onChange({ quantity: event.target.value })}
          aria-invalid={flagged("quantity")}
          className={cn(flagged("quantity") && INVALID)}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1.5 lg:col-span-2">
        <Label htmlFor={id("price")} className="text-xs text-muted-foreground">
          {tx("purchases.billForm.unitPrice", "Unit price")}
        </Label>
        <Input
          id={id("price")}
          value={line.unitPrice}
          inputMode="decimal"
          dir="ltr"
          placeholder="0.00"
          onChange={(event) => onChange({ unitPrice: event.target.value })}
          aria-invalid={flagged("price")}
          className={cn(flagged("price") && INVALID)}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1.5 lg:col-span-2">
        <Label htmlFor={id("vat")} className="text-xs text-muted-foreground">
          {tx("purchases.billForm.vatCategory", "VAT treatment")}
        </Label>
        <Select
          value={line.vatCategory}
          onValueChange={(value) => onChange({ vatCategory: value as VatCategory })}
          disabled={disabled}
        >
          <SelectTrigger id={id("vat")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VAT_CATEGORIES.map((code) => (
              <SelectItem key={code} value={code}>
                {text(VAT_CATEGORY_TEXT[code])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 lg:col-span-1">
        <Label htmlFor={id("rate")} className="text-xs text-muted-foreground">
          {tx("purchases.billForm.vatRate", "Rate")}
        </Label>
        <div className="relative" dir="ltr">
          <Input
            id={id("rate")}
            value={standard ? line.vatRate : "0"}
            inputMode="decimal"
            onChange={(event) => onChange({ vatRate: event.target.value })}
            aria-invalid={flagged("rate")}
            className={cn("pe-7", flagged("rate") && INVALID)}
            disabled={disabled || !standard}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
          >
            %
          </span>
        </div>
      </div>
      <div className="space-y-1.5 lg:col-span-3">
        <Label htmlFor={id("building")} className="text-xs text-muted-foreground">
          {tx("purchases.billForm.building", "Building (cost centre)")}
        </Label>
        <SearchableSelect
          id={id("building")}
          value={line.propertyId || NONE}
          onValueChange={(value) => onChooseBuilding(value === NONE ? "" : value)}
          options={buildingOptions}
          placeholder={tx("purchases.billForm.noBuilding", "No building")}
          searchPlaceholder={tx("purchases.billForm.searchBuilding", "Search buildings")}
          emptyMessage={tx("purchases.billForm.noBuildingMatch", "No matching building")}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1.5 lg:col-span-2">
        <Label htmlFor={id("unit")} className="text-xs text-muted-foreground">
          {tx("purchases.billForm.unit", "Unit")}
        </Label>
        <SearchableSelect
          id={id("unit")}
          value={line.unitId || NONE}
          onValueChange={(value) => onChooseUnit(value === NONE ? "" : value)}
          options={unitOptions}
          placeholder={tx("purchases.billForm.noUnit", "No unit")}
          searchPlaceholder={tx("purchases.billForm.searchUnit", "Search units")}
          emptyMessage={tx("purchases.billForm.noUnitMatch", "No matching unit")}
          disabled={disabled}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 self-end rounded-md bg-muted/40 p-2 text-xs sm:col-span-2 lg:col-span-3">
        <Figure label={tx("purchases.billForm.net", "Net")} value={figures?.netAmount} />
        <Figure label={tx("purchases.billForm.vatAmount", "VAT")} value={figures?.vatAmount} />
        <Figure label={tx("purchases.billForm.lineTotal", "Total")} value={figures?.totalAmount} strong />
      </div>
      <div className="flex items-end justify-end sm:col-span-2 lg:col-span-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-10 w-10 p-0"
          aria-label={tx("ledger.lines.remove", "Remove line")}
          onClick={onRemove}
          disabled={disabled || !canRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function BillTotals({
  totals,
  discount,
  onDiscount,
  discountProblem,
  disabled,
}: {
  totals: ComputedBill["totals"] | null;
  discount: string;
  onDiscount: (discount: string) => void;
  discountProblem: BillReview["discountProblem"];
  disabled: boolean;
}) {
  const { tx } = useLedgerText();
  const row = (label: string, value: number | undefined) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <Money value={value ?? 0} className="tabular-nums" />
    </div>
  );
  return (
    <div className="flex justify-end">
      <div className="w-full max-w-sm space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
        {row(tx("purchases.billForm.subtotal", "Subtotal"), totals?.subtotal)}
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="bill-discount" className="text-sm font-normal text-muted-foreground">
            {tx("purchases.billForm.discount", "Discount (before VAT)")}
          </Label>
          <Input
            id="bill-discount"
            value={discount}
            onChange={(event) => onDiscount(event.target.value)}
            inputMode="decimal"
            dir="ltr"
            placeholder="0.00"
            aria-invalid={discountProblem !== null}
            aria-describedby={discountProblem ? "bill-discount-problem" : undefined}
            className={cn("h-8 w-32 text-end", discountProblem && INVALID)}
            disabled={disabled}
          />
        </div>
        {discountProblem && (
          <p id="bill-discount-problem" className="text-xs text-destructive">
            {discountProblem === "tooLarge"
              ? tx("purchases.billForm.issue.discountTooLarge", "The discount cannot be more than the lines add up to.")
              : tx(
                  "purchases.billForm.issue.discount",
                  "The discount is an amount of zero or more, with at most two decimals.",
                )}
          </p>
        )}
        {row(tx("purchases.billForm.netTotal", "Total before VAT"), totals?.netAmount)}
        {row(tx("purchases.billForm.vatTotal", "VAT"), totals?.taxAmount)}
        <div className="flex items-center justify-between gap-3 border-t pt-2 font-semibold">
          <span>{tx("purchases.billForm.total", "Total")}</span>
          <Money value={totals?.totalAmount ?? 0} className="text-base tabular-nums" />
        </div>
      </div>
    </div>
  );
}
