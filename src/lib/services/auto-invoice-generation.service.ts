/**
 * PropertyPro - Auto Invoice Generation Service
 * Service for automatically generating invoices from lease terms
 *
 * Converted from Mongoose to Prisma/Postgres. The Invoice model's pre-save
 * recompute now runs through `computeInvoiceDerivedState` on every invoice
 * this service creates or mutates.
 */

import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { InvoiceReadModel as InvoiceModel } from "@/lib/invoice/phase0-columns";
import type { MoneyAsNumber } from "@/lib/db/prisma";
// Money fields arrive as numbers via the money result extension.
type InvoiceRow = MoneyAsNumber<InvoiceModel>;
import { InvoiceStatus, InvoiceType, UserRole } from "@/types";
import { EmailService } from "@/lib/email-service";
import { buildInvoiceEmailHtml } from "@/lib/templates/invoice-email-template";
import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import {
  getCompanyInfoServer,
  getOrgDisplayLanguage,
} from "@/lib/utils/company-info-server";
import { generateInvoicePdfBuffer } from "@/lib/services/invoice-pdf.service";
import { formatCurrency } from "@/lib/utils/formatting";
import { computeInvoiceDerivedState } from "./payment-invoice-linking.service";
import {
  leaseCurrency,
  leaseRentAmount,
  leaseSecurityDeposit,
} from "@/lib/lease-money";
import {
  FREQUENCY_LABELS,
  leaseInstallmentPlan,
  normalizeFrequency,
  type PlannedInstallment,
} from "@/lib/lease-installments";
import { unbilledInstallments } from "@/lib/lease-lifecycle";
import { uniqueViolationTarget } from "@/lib/db/unique-violation";
import { createWithInvoiceNumber } from "@/lib/services/invoice-number.service";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { endOfBusinessDay, startOfBusinessDay } from "@/lib/dates/business-day";

export interface InvoiceGenerationConfig {
  generateOnLeaseCreation: boolean;
  generateMonthlyRent: boolean;
  generateSecurityDeposit: boolean;
  advanceMonths: number;
  gracePeriodDays: number;
  autoIssue: boolean;
  autoEmail: boolean;
}

export interface GenerationResult {
  /** Nothing went wrong — including a run that found nothing left to bill. */
  success: boolean;
  invoicesGenerated: number;
  invoiceIds: string[];
  /** Everything that went wrong, one line each. Never swallowed: see below. */
  errors: string[];
  emailsSent: number;
}

/**
 * One line for the person reading the result; the whole error goes to the
 * server log. Prisma's messages open with the failing call and a code frame,
 * so their last line is what actually went wrong — and in production even
 * that stays in the log, as with every other unexpected database error (see
 * handleApiError).
 */
function errorText(error: unknown): string {
  const fromDatabase =
    error instanceof Error && error.name.startsWith("PrismaClient");
  if (fromDatabase && process.env.NODE_ENV === "production") {
    return "could not be saved";
  }
  const message = error instanceof Error ? error.message : String(error);
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines[lines.length - 1] ?? "unknown error").slice(0, 300);
}

export class AutoInvoiceGenerationService {
  private defaultConfig: InvoiceGenerationConfig = {
    generateOnLeaseCreation: true,
    generateMonthlyRent: true,
    generateSecurityDeposit: true,
    advanceMonths: 0,
    gracePeriodDays: 5,
    autoIssue: false,
    autoEmail: false,
  };

  /**
   * Generate a lease's invoices: its rent installments and, when asked, the
   * security deposit.
   *
   * Safe to repeat — each billing period and the deposit are invoiced once,
   * so a second run creates only what the first one missed.
   *
   * Nothing that fails is dropped. An installment that could not be written
   * used to be logged and skipped, so a run that billed eleven months of
   * twelve — or none — still reported a clean result. Every failure is now a
   * line in `errors`, and `success` is true only when there are none.
   */
  async generateInvoicesForLease(
    leaseId: string,
    config: Partial<InvoiceGenerationConfig> = {}
  ): Promise<GenerationResult> {
    const finalConfig = { ...this.defaultConfig, ...config };

    const result: GenerationResult = {
      success: false,
      invoicesGenerated: 0,
      invoiceIds: [],
      errors: [],
      emailsSent: 0,
    };

    try {
      // Get lease details (with tenant + property for emailing)
      const lease = await db.lease.findFirst({
        where: { id: leaseId },
        include: {
          tenant: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          property: { select: { id: true, name: true } },
        },
      });

      if (!lease) {
        throw new Error("Lease not found");
      }

      const terms = (lease.terms as any) ?? {};
      const generatedInvoices: InvoiceRow[] = [];

      // Generate security deposit invoice if needed

      if (finalConfig.generateSecurityDeposit && leaseSecurityDeposit(lease) > 0) {
        try {
          const securityDepositInvoice =
            await this.generateSecurityDepositInvoice(lease);

          if (securityDepositInvoice) {
            generatedInvoices.push(securityDepositInvoice);
            result.invoiceIds.push(securityDepositInvoice.id);
            result.invoicesGenerated++;
          }
        } catch (error) {
          console.error(
            `Failed to generate the deposit invoice for lease ${lease.id}:`,
            error
          );
          result.errors.push(`Security deposit invoice: ${errorText(error)}`);
        }
      }

      // Generate monthly rent invoices

      if (finalConfig.generateMonthlyRent) {
        try {
          const rent = await this.generateMonthlyRentInvoices(
            lease,
            finalConfig
          );

          generatedInvoices.push(...rent.invoices);
          result.invoiceIds.push(...rent.invoices.map((inv) => inv.id));
          result.invoicesGenerated += rent.invoices.length;
          result.errors.push(...rent.errors);
        } catch (error) {
          console.error(
            `Failed to generate rent invoices for lease ${lease.id}:`,
            error
          );
          result.errors.push(`Monthly rent invoices: ${errorText(error)}`);
        }
      }

      if (generatedInvoices.length > 0 && finalConfig.autoEmail) {
        try {
          const { sent, failures } = await this.emailGeneratedInvoices(
            lease,
            generatedInvoices
          );
          result.emailsSent += sent;
          if (failures.length > 0) {
            result.errors.push(...failures);
          }
        } catch (error) {
          console.error("❌ Failed to auto-email invoices:", error);
          result.errors.push(
            `Auto-email invoices failed: ${
              error instanceof Error ? error.message : error
            }`
          );
        }
      }

      result.success = result.errors.length === 0;

      return result;
    } catch (error) {
      console.error("❌ Invoice generation failed:", error);
      result.errors.push(`General error: ${errorText(error)}`);
      return result;
    }
  }

  /**
   * Generate security deposit invoice. Idempotent: returns null when the
   * lease already has one (previously re-runs double-billed the deposit).
   */
  private async generateSecurityDepositInvoice(
    lease: any
  ): Promise<InvoiceRow | null> {
    const terms = (lease.terms as any) ?? {};

    const existing = await db.invoice.findFirst({
      where: {
        leaseId: lease.id,
        category: InvoiceType.SECURITY_DEPOSIT,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) return null;

    const periodStart = new Date(lease.startDate);
    const dueDate = new Date(lease.startDate);
    dueDate.setDate(dueDate.getDate() - 7); // Due 7 days before move-in

    // Issue date should be before due date
    const issueDate = new Date(dueDate);
    issueDate.setDate(issueDate.getDate() - 7); // Issue 7 days before due date

    const depositAmount = leaseSecurityDeposit(lease);
    const lineItems = [
      {
        description: "Security Deposit",
        amount: depositAmount,
        type: InvoiceType.SECURITY_DEPOSIT,
        quantity: 1,
        unitPrice: depositAmount,
      },
    ];

    // Derived-state recompute (was the Invoice pre-save hook)
    const derived = computeInvoiceDerivedState({
      lineItems,
      taxAmount: 0,
      discountAmount: 0,
      amountPaid: 0,
      dueDate,
      issueDate,
      status: InvoiceStatus.ISSUED,
    });

    return this.createInvoiceRecord("SD", {
      organizationId: lease.organizationId,
      tenantId: lease.tenantId,
      propertyId: lease.propertyId,
      leaseId: lease.id,
      unitId: lease.unitId,
      category: InvoiceType.SECURITY_DEPOSIT,
      periodStart,
      issueDate,
      dueDate,
      status: derived.status,
      subtotal: derived.subtotal,
      totalAmount: derived.totalAmount,
      amountPaid: 0,
      balanceRemaining: derived.balanceRemaining,
      gracePeriodEnd: new Date(dueDate.getTime() + 5 * 24 * 60 * 60 * 1000),
      lineItems: lineItems as unknown as Prisma.InputJsonValue,
    });
  }

  private async emailGeneratedInvoices(
    lease: any,
    invoices: InvoiceRow[]
  ): Promise<{ sent: number; failures: string[] }> {
    const failures: string[] = [];

    const tenant = lease.tenant ?? null;
    const property = lease.property ?? null;

    if (!tenant || !tenant.email) {
      failures.push(
        "Tenant email not available for automatic invoice delivery"
      );
      return { sent: 0, failures };
    }

    const tenantName =
      [tenant.firstName, tenant.lastName].filter(Boolean).join(" ").trim() ||
      "Tenant";
    const propertyName = property?.name || "Property";
    const emailService = new EmailService();

    // Resolve currency from Display Settings (admin)
    let currencyCode = "USD";
    try {
      const admin = await db.user.findFirst({
        where: { role: UserRole.ADMIN, isActive: true },
        select: { id: true },
      });
      if (admin?.id) {
        const ds = await db.displaySettings.findFirst({
          where: { userId: admin.id },
        });
        if (ds?.currency) {
          currencyCode = ds.currency;
        }
      }
    } catch (err) {
      // Fallback silently to default USD
    }

    let sent = 0;

    for (const invoice of invoices) {
      try {
        const populatedInvoice = await db.invoice.findFirst({
          where: { id: invoice.id },
          include: {
            tenant: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
            property: {
              select: {
                id: true,
                name: true,
                addressStreet: true,
                addressCity: true,
                addressState: true,
                addressZipCode: true,
              },
            },
          },
        });

        if (!populatedInvoice) {
          throw new Error("Invoice not found for email generation");
        }

        // Preserve the populated shape the PDF renderer reads
        const invoiceData: any = {
          ...populatedInvoice,
          _id: populatedInvoice.id,
          tenantId: populatedInvoice.tenant ?? populatedInvoice.tenantId,
          propertyId: populatedInvoice.property
            ? {
                ...populatedInvoice.property,
                address: {
                  street: populatedInvoice.property.addressStreet,
                  city: populatedInvoice.property.addressCity,
                  state: populatedInvoice.property.addressState,
                  zipCode: populatedInvoice.property.addressZipCode,
                },
              }
            : populatedInvoice.propertyId,
          tenant: undefined,
          property: undefined,
        };

        const pdfBuffer = await generateInvoicePdfBuffer(invoiceData as any);

        const amountDue = Number(
          invoiceData.balanceRemaining ??
            invoiceData.totalAmount ??
            invoiceData.subtotal ??
            0
        );
        const dueDate = invoiceData.dueDate
          ? new Date(invoiceData.dueDate)
          : undefined;
        const formattedAmount = formatCurrency(amountDue, currencyCode);
        // Sent in the background, so in the office's own language, and
        // signed by the office rather than by the software.
        const lang = await getOrgDisplayLanguage();
        const sender = await getCompanyInfoServer();
        const number = String(invoiceData.invoiceNumber || invoiceData.id);
        const plainMessage = pdfLabel(
          lang,
          "leases.invoiceEmail.autoMessage",
          "Hello {tenant},\n\nPlease find your invoice {number} attached. The amount due is {amount}.\n\nThank you.",
          { tenant: tenantName, number, amount: formattedAmount },
        );

        const emailHtml = buildInvoiceEmailHtml({
          message: plainMessage,
          propertyName,
          tenantName,
          invoiceNumber: invoiceData.invoiceNumber,
          amountDue,
          dueDate,
          currencyCode,
          companyName: sender?.name,
          lang,
        });

        const emailSent = await emailService.sendEmailWithAttachments(
          tenant.email,
          {
            subject: pdfLabel(
              lang,
              "leases.invoiceEmail.autoSubject",
              "Invoice {number} — {property}",
              { number, property: propertyName },
            ),
            html: emailHtml,
            text: plainMessage,
          },
          [
            {
              filename: `${invoiceData.invoiceNumber || "lease-invoice"}.pdf`,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ]
        );

        if (!emailSent) {
          throw new Error("Email service returned false");
        }

        sent += 1;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const identifier = invoice.invoiceNumber || invoice.id;
        const failureMessage = `Failed to email invoice ${identifier}: ${errorMessage}`;
        console.error(`❌ ${failureMessage}`);
        failures.push(failureMessage);
      }
    }

    return { sent, failures };
  }

  /**
   * Generate monthly rent invoices for the lease duration.
   *
   * The schedule walks calendar months by index and clamps the configured due
   * day to each month's length — the previous `setDate(31)`/`setMonth(+1)`
   * loop rolled Jan 31 into Mar 3, silently skipping February and drifting
   * every later month. The move-in month is always billed: when the due day
   * precedes the start date the first invoice falls due at move-in instead of
   * being pushed to the next month (which dropped the prorated first period
   * entirely).
   */
  private async generateMonthlyRentInvoices(
    lease: any,
    config: InvoiceGenerationConfig
  ): Promise<{ invoices: InvoiceRow[]; errors: string[] }> {
    const invoices: InvoiceRow[] = [];
    const errors: string[] = [];

    // The contract decides the schedule: how much per installment, how often,
    // and whether tax applies. `planInstallments` is the single source for
    // that shape — the preview endpoint and the contract page read the same
    // function, so what an operator is shown is what actually gets billed.
    const schedule = leaseInstallmentPlan(lease);

    // What is already billed, read once rather than once per installment. A
    // cancelled invoice still holds its period: an installment the office
    // removed is not billed again by the next run.
    const billed = await db.invoice.findMany({
      where: {
        leaseId: lease.id,
        category: InvoiceType.RENT,
        periodStart: { not: null },
        deletedAt: null,
      },
      select: { periodStart: true },
    });

    const unbilled = unbilledInstallments(
      schedule,
      billed.map((invoice) => invoice.periodStart)
    );

    for (const installment of unbilled) {
      try {
        const invoice = await this.generateRentInstallmentInvoice(
          lease,
          config,
          installment
        );
        if (invoice) invoices.push(invoice);
      } catch (error) {
        console.error(
          `Failed to generate installment ${installment.index} for lease ${lease.id}:`,
          error
        );
        errors.push(`Installment ${installment.index}: ${errorText(error)}`);
      }
    }

    return { invoices, errors };
  }

  /**
   * Generate a single rent installment invoice. Idempotent per billing
   * period: the caller passes only periods with no invoice, and the DB
   * partial unique index on (lease, category, periodStart) settles a race
   * between two runs — the loser gets null, not a second invoice.
   */
  private async generateRentInstallmentInvoice(
    lease: any,
    config: InvoiceGenerationConfig,
    installment: PlannedInstallment
  ): Promise<InvoiceRow | null> {
    const { dueDate } = installment;

    const issueDate = new Date(dueDate);
    issueDate.setDate(issueDate.getDate() - 7); // Issue 7 days before due

    const frequency = normalizeFrequency(lease.paymentFrequency);
    const description = installment.prorated
      ? `${FREQUENCY_LABELS[frequency]} Rent (Prorated)`
      : `${FREQUENCY_LABELS[frequency]} Rent`;

    const effectiveIssueDate = config.autoIssue ? issueDate : new Date();

    // Rent and any utility charges are separate lines, not one merged amount:
    // the tenant has to see what the extra is for, and the owner statement
    // reports rent income apart from recharged utilities.
    const line = (
      lineDescription: string,
      amount: number,
      type: InvoiceType,
    ) => ({
      description: lineDescription,
      amount,
      type,
      quantity: 1,
      unitPrice: amount,
      dueDate,
      periodStart: installment.periodStart,
      periodEnd: installment.periodEnd,
      installmentNumber: installment.index,
    });

    const lineItems = [
      line(description, installment.rentAmount, InvoiceType.RENT),
      ...(installment.electricityAmount > 0
        ? [
            line(
              "Electricity",
              installment.electricityAmount,
              InvoiceType.ELECTRICITY,
            ),
          ]
        : []),
      ...(installment.waterAmount > 0
        ? [line("Water", installment.waterAmount, InvoiceType.WATER_SEWER)]
        : []),
    ];

    // Derived-state recompute (was the Invoice pre-save hook). Tax comes from
    // the contract, so an exempt lease bills exactly its rent and a
    // VAT-bearing one bills rent + its own rate.
    const derived = computeInvoiceDerivedState({
      lineItems,
      taxAmount: installment.taxAmount,
      discountAmount: 0,
      amountPaid: 0,
      dueDate,
      issueDate: effectiveIssueDate,
      status: config.autoIssue ? InvoiceStatus.ISSUED : InvoiceStatus.SCHEDULED,
    });

    return this.createInvoiceRecord("RENT", {
      organizationId: lease.organizationId,
      tenantId: lease.tenantId,
      propertyId: lease.propertyId,
      leaseId: lease.id,
      unitId: lease.unitId,
      category: InvoiceType.RENT,
      periodStart: installment.periodStart,
      issueDate: effectiveIssueDate,
      dueDate,
      status: derived.status,
      currency: leaseCurrency(lease),
      subtotal: derived.subtotal,
      taxAmount: installment.taxAmount,
      totalAmount: derived.totalAmount,
      amountPaid: 0,
      balanceRemaining: derived.balanceRemaining,
      gracePeriodEnd: new Date(
        dueDate.getTime() + config.gracePeriodDays * 24 * 60 * 60 * 1000
      ),
      lineItems: lineItems as unknown as Prisma.InputJsonValue,
      metadata: {
        installmentNumber: installment.index,
        frequency,
        source: "generated",
        prorated: installment.prorated,
      } as unknown as Prisma.InputJsonValue,
    });
  }

  /**
   * Generate advance payment invoices
   */
  async generateAdvancePaymentInvoices(
    leaseId: string,
    months: number
  ): Promise<GenerationResult> {
    const result: GenerationResult = {
      success: false,
      invoicesGenerated: 0,
      invoiceIds: [],
      errors: [],
      emailsSent: 0,
    };

    try {
      const lease = await db.lease.findFirst({ where: { id: leaseId } });
      if (!lease) {
        throw new Error("Lease not found");
      }

      const terms = (lease.terms as any) ?? {};
      const startDate = new Date(lease.startDate);
      const dueDate = new Date(startDate);
      dueDate.setDate(dueDate.getDate() - 7); // Due 7 days before move-in

      for (let i = 0; i < months; i++) {
        try {
          const issueDate = new Date();
          // The calendar month this advance payment covers. Shares the
          // (lease, category, periodStart) dedupe key with the monthly
          // generator, so a month cannot be billed both ways.
          const periodStart = new Date(
            startDate.getFullYear(),
            startDate.getMonth() + i,
            1
          );

          const alreadyBilled = await db.invoice.findFirst({
            where: {
              leaseId: lease.id,
              category: InvoiceType.RENT,
              periodStart,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (alreadyBilled) continue;

          const lineItems = [
            {
              description: `Advance Rent Payment - Month ${i + 1}`,
              amount: leaseRentAmount(lease),
              type: InvoiceType.RENT,
              quantity: 1,
              unitPrice: leaseRentAmount(lease),
            },
          ];

          const derived = computeInvoiceDerivedState({
            lineItems,
            taxAmount: 0,
            discountAmount: 0,
            amountPaid: 0,
            dueDate,
            issueDate,
            status: InvoiceStatus.ISSUED,
          });

          const savedInvoice = await this.createInvoiceRecord("INV", {
            organizationId: lease.organizationId,
            tenantId: lease.tenantId,
            propertyId: lease.propertyId,
            leaseId: lease.id,
            unitId: lease.unitId,
            category: InvoiceType.RENT,
            periodStart,
            issueDate,
            dueDate,
            status: derived.status,
            subtotal: derived.subtotal,
            totalAmount: derived.totalAmount,
            amountPaid: 0,
            balanceRemaining: derived.balanceRemaining,
            gracePeriodEnd: new Date(
              dueDate.getTime() + 5 * 24 * 60 * 60 * 1000
            ),
            lineItems: lineItems as unknown as Prisma.InputJsonValue,
          });

          if (!savedInvoice) continue;

          result.invoiceIds.push(savedInvoice.id);
          result.invoicesGenerated++;
        } catch (error) {
          result.errors.push(`Advance payment ${i + 1}: ${error}`);
        }
      }

      result.success = result.invoicesGenerated > 0;
      return result;
    } catch (error) {
      result.errors.push(`General error: ${error}`);
      return result;
    }
  }

  /**
   * Update invoice statuses based on current date
   */
  async updateInvoiceStatuses(): Promise<void> {
    const now = new Date();

    // Update scheduled invoices to issued once their issue day has arrived
    // (Riyadh's calendar — the same rule the cron and the read paths use).
    await db.invoice.updateMany({
      where: {
        status: InvoiceStatus.SCHEDULED,
        issueDate: { lte: endOfBusinessDay(now) },
      },
      data: { status: InvoiceStatus.ISSUED },
    });

    // Overdue only once the due DAY has fully passed (due dates are stored at
    // midnight — see computeInvoiceDerivedState), which on Riyadh's clock is
    // its midnight.
    const startOfToday = startOfBusinessDay(now);
    await db.invoice.updateMany({
      where: {
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIAL] },
        dueDate: { lt: startOfToday },
        balanceRemaining: { gt: 0 },
      },
      data: { status: InvoiceStatus.OVERDUE },
    });
  }

  /**
   * Create an invoice with a sequential per-org number (`PREFIX-000123`).
   *
   * Invoice numbers used to be the last 6 digits of the millisecond clock —
   * two invoices in the same millisecond collided on the
   * (organizationId, invoiceNumber) unique and the failure was swallowed,
   * silently dropping a month from the schedule. The number now comes from
   * the shared allocator (services/invoice-number.service.ts), which starts
   * past the highest number issued and lets the unique constraint arbitrate.
   * Returns null when the invoices_period_per_lease_unique index reports the
   * billing period is already invoiced (concurrent generation) — the
   * idempotent-skip case.
   */
  private async createInvoiceRecord(
    prefix: string,
    data: Omit<Prisma.InvoiceUncheckedCreateInput, "invoiceNumber">
  ): Promise<InvoiceRow | null> {
    try {
      const invoice = await createWithInvoiceNumber(
        data.organizationId as string,
        prefix,
        (invoiceNumber) =>
          db.invoice.create({ data: { ...data, invoiceNumber } }),
      );
      // Every generated installment passes here: schedule generation, a
      // renewal, a contract arriving in force, the check-leases cron.
      postAfterCommit("invoice", invoice?.id);
      return invoice;
    } catch (error) {
      // Period already invoiced — skip.
      if (uniqueViolationTarget(error).includes("period")) return null;
      throw error;
    }
  }
}

export const autoInvoiceGenerationService = new AutoInvoiceGenerationService();
