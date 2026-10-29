/**
 * PropertyPro - Tenant Ledger Service
 * Service for generating comprehensive tenant ledgers with running balances
 *
 * Converted from Mongoose to Prisma/Postgres. The entries and their rules —
 * documents by their own dates, an opening balance, VAT in the charges, only
 * money received in the credits — are in tenant-ledger-entries.ts.
 */

import { db } from "@/lib/db/prisma";
import { InvoiceStatus, PaymentStatus } from "@/types";
import { invoicePhase0Omit } from "@/lib/invoice/phase0-columns";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import { receiptNumberFor } from "@/lib/payments/receipt-number";
import {
  buildLedgerEntries,
  invoiceBalanceEffect,
  invoiceEntries,
  receivedAmount,
  type LedgerEntry,
  type LedgerInvoiceRow,
  type LedgerPaymentRow,
} from "@/lib/services/tenant-ledger-entries";

export type { LedgerEntry };

export interface LedgerSummary {
  tenantId: string;
  tenantName: string;
  propertyName: string;
  leaseId?: string;
  periodStart: Date;
  periodEnd: Date;

  /** What was owed when the period began: every charge before it less every receipt. */
  openingBalance: number;

  // Financial Summary — the period's own charges (VAT included) and receipts
  totalDebits: number;
  totalCredits: number;
  /** The balance at the period's end: opening + debits − credits. */
  currentBalance: number;

  // Breakdown by Category
  breakdown: {
    rent: { debits: number; credits: number };
    securityDeposit: { debits: number; credits: number };
    lateFees: { debits: number; credits: number };
    utilities: { debits: number; credits: number };
    maintenance: { debits: number; credits: number };
    vat: { debits: number; credits: number };
    other: { debits: number; credits: number };
  };

  // Status Counts
  statusCounts: {
    paidInvoices: number;
    unpaidInvoices: number;
    overdueInvoices: number;
    totalPayments: number;
  };
}

export interface LedgerReport {
  summary: LedgerSummary;
  entries: LedgerEntry[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

/** Money received: a paid or part-paid payment, and nothing else. */
const RECEIVED_STATUSES = [PaymentStatus.PAID, PaymentStatus.PARTIAL];

const round = (value: number) => Math.round(value * 100) / 100;

export class TenantLedgerService {
  /**
   * Generate comprehensive tenant ledger
   */
  async generateTenantLedger(
    tenantId: string,
    options: {
      leaseId?: string;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      limit?: number;
      includeZeroBalanceEntries?: boolean;
    } = {}
  ): Promise<LedgerReport> {
    const {
      leaseId,
      startDate = new Date(new Date().getFullYear(), 0, 1), // Start of current year
      endDate = new Date(),
      page = 1,
      limit = 100,
      includeZeroBalanceEntries = true,
    } = options;

    const owner = { tenantId, ...(leaseId ? { leaseId } : {}) };
    const [omit, withNumbers] = await Promise.all([
      invoicePhase0Omit(),
      paymentNumbersAvailable(),
    ]);

    // Charges up to the period's end by their issue date; a cancelled
    // invoice charges nothing. Receipts up to the end by the day the money
    // came in. What falls before the start is the opening balance.
    const [invoiceRows, paymentRows, tenant] = await Promise.all([
      db.invoice.findMany({
        where: {
          ...owner,
          status: { not: InvoiceStatus.CANCELLED },
          issueDate: { lte: endDate },
        },
        omit,
        include: { property: { select: { id: true, name: true } } },
        orderBy: { issueDate: "asc" },
      }),
      db.payment.findMany({
        where: {
          ...owner,
          status: { in: RECEIVED_STATUSES },
          paidDate: { not: null, lte: endDate },
        },
        include: { property: { select: { id: true, name: true } } },
        omit: { number: !withNumbers },
        orderBy: { paidDate: "asc" },
      }),
      db.user.findFirst({
        where: { id: tenantId, deletedAt: undefined },
        select: { firstName: true, lastName: true },
      }),
    ]);

    const invoices: Array<LedgerInvoiceRow & { propertyName: string | null }> =
      invoiceRows.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        issueDate: row.issueDate,
        category: row.category,
        status: row.status,
        documentType: (row as { documentType?: string | null }).documentType ?? "invoice",
        discountAmount: Number(row.discountAmount),
        taxAmount: Number(row.taxAmount),
        totalAmount: Number(row.totalAmount),
        lineItems: row.lineItems,
        propertyName: row.property?.name ?? null,
      }));
    const payments: Array<LedgerPaymentRow & { propertyName: string | null }> =
      paymentRows.map((row) => ({
        id: row.id,
        paidDate: row.paidDate as Date,
        amount: Number(row.amount),
        amountPaid: Number(row.amountPaid),
        status: row.status,
        paymentMethod: row.paymentMethod,
        description: row.description,
        reference: receiptNumberFor(
          row.id,
          null,
          (row as { number?: number | null }).number ?? null,
        ),
        propertyName: row.property?.name ?? null,
      }));

    const before = (date: Date) => date.getTime() < startDate.getTime();
    const openingBalance = round(
      invoices
        .filter((invoice) => before(invoice.issueDate))
        .reduce((sum, invoice) => sum + invoiceBalanceEffect(invoice), 0) -
        payments
          .filter((payment) => before(payment.paidDate))
          .reduce((sum, payment) => sum + receivedAmount(payment), 0),
    );
    const periodInvoices = invoices.filter((invoice) => !before(invoice.issueDate));
    const periodPayments = payments.filter((payment) => !before(payment.paidDate));

    const entries = buildLedgerEntries(periodInvoices, periodPayments, openingBalance);

    // The balance carried in, as the first line: what the running balance
    // starts from.
    const listed: LedgerEntry[] =
      openingBalance !== 0
        ? [
            {
              id: "opening",
              date: startDate,
              type: openingBalance > 0 ? "debit" : "credit",
              category: "opening",
              description: "Opening balance",
              reference: "",
              debitAmount: openingBalance > 0 ? openingBalance : 0,
              creditAmount: openingBalance < 0 ? -openingBalance : 0,
              runningBalance: openingBalance,
              relatedId: "",
              status: "",
            },
            ...entries,
          ]
        : entries;

    // Filter out zero balance entries if requested
    const filteredEntries = includeZeroBalanceEntries
      ? listed
      : listed.filter(
          (entry) => entry.debitAmount > 0 || entry.creditAmount > 0
        );

    // Apply pagination
    const startIndex = (page - 1) * limit;
    const paginatedEntries = filteredEntries.slice(
      startIndex,
      startIndex + limit
    );

    // Generate summary
    const summary = this.generateLedgerSummary(
      tenantId,
      periodInvoices,
      periodPayments,
      entries,
      openingBalance,
      `${tenant?.firstName ?? ""} ${tenant?.lastName ?? ""}`.trim(),
      [...periodInvoices, ...periodPayments, ...invoices, ...payments].find(
        (row) => row.propertyName,
      )?.propertyName ?? null,
      startDate,
      endDate,
      leaseId
    );

    return {
      summary,
      entries: paginatedEntries,
      pagination: {
        page,
        limit,
        total: filteredEntries.length,
        pages: Math.ceil(filteredEntries.length / limit),
      },
    };
  }

  /**
   * Generate ledger summary
   */
  private generateLedgerSummary(
    tenantId: string,
    invoices: LedgerInvoiceRow[],
    payments: LedgerPaymentRow[],
    entries: LedgerEntry[],
    openingBalance: number,
    tenantName: string,
    propertyName: string | null,
    startDate: Date,
    endDate: Date,
    leaseId?: string
  ): LedgerSummary {
    const totalDebits = round(entries.reduce((sum, entry) => sum + entry.debitAmount, 0));
    const totalCredits = round(entries.reduce((sum, entry) => sum + entry.creditAmount, 0));
    const currentBalance = round(openingBalance + totalDebits - totalCredits);

    // Calculate breakdown by category
    const breakdown: LedgerSummary["breakdown"] = {
      rent: { debits: 0, credits: 0 },
      securityDeposit: { debits: 0, credits: 0 },
      lateFees: { debits: 0, credits: 0 },
      utilities: { debits: 0, credits: 0 },
      maintenance: { debits: 0, credits: 0 },
      vat: { debits: 0, credits: 0 },
      other: { debits: 0, credits: 0 },
    };
    for (const invoice of invoices) {
      for (const entry of invoiceEntries(invoice)) {
        const bucket =
          breakdown[entry.category as keyof typeof breakdown] ?? breakdown.other;
        bucket.debits = round(bucket.debits + entry.debitAmount);
        bucket.credits = round(bucket.credits + entry.creditAmount);
      }
    }
    // Receipts are not allocated to a charge here (simplified, as before).
    breakdown.rent.credits = round(
      breakdown.rent.credits +
        payments.reduce((sum, payment) => sum + receivedAmount(payment), 0),
    );

    // Calculate status counts
    const charges = invoices.filter((invoice) => invoice.documentType !== "credit_note");
    const statusCounts = {
      paidInvoices: charges.filter((inv) => inv.status === InvoiceStatus.PAID).length,
      unpaidInvoices: charges.filter(
        (inv) =>
          inv.status === InvoiceStatus.ISSUED ||
          inv.status === InvoiceStatus.PARTIAL
      ).length,
      overdueInvoices: charges.filter(
        (inv) => inv.status === InvoiceStatus.OVERDUE
      ).length,
      totalPayments: payments.length,
    };

    return {
      tenantId,
      tenantName: tenantName || "Unknown Tenant",
      propertyName: propertyName ?? "Unknown Property",
      leaseId,
      periodStart: startDate,
      periodEnd: endDate,
      openingBalance,
      totalDebits,
      totalCredits,
      currentBalance,
      breakdown,
      statusCounts,
    };
  }

  /**
   * Export ledger to CSV format
   */
  async exportLedgerToCSV(
    tenantId: string,
    options: {
      leaseId?: string;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<string> {
    const ledger = await this.generateTenantLedger(tenantId, {
      ...options,
      limit: 10000, // Get all entries for export
    });

    const headers = [
      "Date",
      "Type",
      "Category",
      "Description",
      "Reference",
      "Debit Amount",
      "Credit Amount",
      "Running Balance",
      "Status",
    ];

    const rows = ledger.entries.map((entry) => [
      new Date(entry.date).toLocaleDateString(),
      entry.type,
      entry.category,
      entry.description,
      entry.reference,
      entry.debitAmount.toFixed(2),
      entry.creditAmount.toFixed(2),
      entry.runningBalance.toFixed(2),
      entry.status,
    ]);

    // Convert to CSV
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    return csvContent;
  }

  /**
   * Get current tenant balance
   */
  async getCurrentBalance(
    tenantId: string,
    leaseId?: string
  ): Promise<{
    currentBalance: number;
    totalOutstanding: number;
    overdueAmount: number;
    lastPaymentDate?: Date;
    lastPaymentAmount?: number;
  }> {
    const filter: any = { tenantId };
    if (leaseId) filter.leaseId = leaseId;

    // Get outstanding invoices
    const outstandingInvoices = await db.invoice.findMany({
      where: {
        ...filter,
        balanceRemaining: { gt: 0 },
      },
    });

    // Get recent payment
    const recentPayment = await db.payment.findFirst({
      where: {
        ...filter,
        status: PaymentStatus.PAID,
      },
      orderBy: { paidDate: "desc" },
    });

    const totalOutstanding = outstandingInvoices.reduce(
      (sum, inv) => sum + inv.balanceRemaining,
      0
    );

    const overdueAmount = outstandingInvoices
      .filter((inv) => inv.status === InvoiceStatus.OVERDUE)
      .reduce((sum, inv) => sum + inv.balanceRemaining, 0);

    return {
      currentBalance: totalOutstanding,
      totalOutstanding,
      overdueAmount,
      lastPaymentDate: recentPayment?.paidDate ?? undefined,
      lastPaymentAmount: recentPayment?.amount,
    };
  }
}

export const tenantLedgerService = new TenantLedgerService();
