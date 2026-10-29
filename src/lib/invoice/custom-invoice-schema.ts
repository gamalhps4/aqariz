/**
 * PropertyPro - What a custom invoice or credit note is made from
 *
 * The body of POST /api/invoices, shared by the route and the form. No
 * database: the route resolves the customer and the contract
 * (custom-invoice.service.ts).
 *
 * The customer is a tenant (with or without a contract), an owner, or anyone
 * else — a name, and a VAT number and address when the office has them. Each
 * line names its VAT category and rate; the discount is one amount off the
 * invoice, taken before VAT (vat.ts).
 *
 * A credit note names the invoice it corrects and the lines it credits, as
 * positive amounts; it is stored negative.
 */

import { z } from "zod";
import { InvoiceType } from "@/types";
import { VAT_CATEGORIES } from "@/lib/invoice/vat";

export const CUSTOMER_TYPES = ["tenant", "owner", "customer"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const DOCUMENT_TYPES = ["invoice", "credit_note"] as const;
export type InvoiceDocumentType = (typeof DOCUMENT_TYPES)[number];

const id = z.string().trim().min(1).max(64);

export const vatLineSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Line item description is required")
    .max(200, "Description cannot exceed 200 characters"),
  category: z.string().trim().max(100).nullish(),
  quantity: z.coerce.number().finite().positive("Quantity must be more than zero").default(1),
  unitPrice: z.coerce.number().finite().min(0, "Price cannot be negative"),
  vatCategory: z.enum(VAT_CATEGORIES),
  vatRate: z.coerce.number().finite().min(0).max(100).optional(),
});

export type VatLineBody = z.infer<typeof vatLineSchema>;

export const customInvoiceSchema = z
  .object({
    documentType: z.enum(DOCUMENT_TYPES).default("invoice"),
    /** A credit note's invoice. */
    originalInvoiceId: id.optional(),
    /** Why the credit note was issued; printed on it. */
    reason: z.string().trim().max(500).optional(),
    customerType: z.enum(CUSTOMER_TYPES).default("tenant"),
    tenantId: id.optional(),
    leaseId: id.optional(),
    propertyId: id.optional(),
    ownerId: id.optional(),
    customer: z
      .object({
        name: z.string().trim().min(1, "The customer's name is required").max(200),
        vatNumber: z.string().trim().max(32).optional(),
        address: z.string().trim().max(500).optional(),
      })
      .optional(),
    /** The buyer's VAT number for a tenant or an owner, when they have one. */
    buyerVatNumber: z.string().trim().max(32).optional(),
    /** The buyer's address as printed, when it is not the one on file. */
    customerAddress: z.string().trim().max(500).optional(),
    category: z.nativeEnum(InvoiceType).optional(),
    issueDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
    lines: z
      .array(vatLineSchema)
      .min(1, "At least one line item is required")
      .max(100, "An invoice holds at most 100 lines"),
    discountAmount: z.coerce.number().finite().min(0, "Discount cannot be negative").default(0),
    notes: z.string().max(2000, "Notes too long").optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.documentType === "credit_note") {
      if (!body.originalInvoiceId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["originalInvoiceId"],
          message: "A credit note names the invoice it corrects",
        });
      }
      return;
    }
    if (body.customerType === "tenant" && !body.tenantId && !body.leaseId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tenantId"],
        message: "Tenant is required",
      });
    }
    if (body.customerType === "owner" && !body.ownerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownerId"],
        message: "Owner is required",
      });
    }
    if (body.customerType === "customer" && !body.customer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "name"],
        message: "The customer's name is required",
      });
    }
  });

export type CustomInvoiceBody = z.infer<typeof customInvoiceSchema>;

/**
 * The body the form sent before invoices had VAT lines — `lineItems` with one
 * amount each and a tax typed in as an amount — read as the new one. Each
 * line takes `defaultCategory`'s treatment (the contract's, for rent); the
 * typed tax is dropped, since the lines now say what is taxed.
 */
export function fromLegacyInvoiceBody(
  body: Record<string, unknown>,
  treatment: (category: string | undefined) => { vatCategory: string; vatRate: number },
): Record<string, unknown> {
  if (Array.isArray(body.lines) || !Array.isArray(body.lineItems)) return body;
  const items = body.lineItems as Array<Record<string, unknown>>;
  const { lineItems: _lineItems, taxAmount: _taxAmount, ...rest } = body;
  void _lineItems;
  void _taxAmount;
  return {
    ...rest,
    lines: items.map((item) => {
      const category =
        typeof item.type === "string" ? item.type : (body.category as string | undefined);
      const quantity = Number(item.quantity ?? 1) || 1;
      const unitPrice =
        item.unitPrice !== undefined
          ? Number(item.unitPrice)
          : Number(item.amount ?? 0) / quantity;
      return {
        description: item.description,
        category,
        quantity,
        unitPrice,
        ...treatment(category),
      };
    }),
  };
}
