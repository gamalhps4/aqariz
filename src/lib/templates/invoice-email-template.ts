/**
 * PropertyPro - Invoice email
 *
 * The message a tenant receives with their invoice attached. Written in the
 * office's language — right to left for Arabic — and signed by the office
 * itself: it used to be English whatever the office worked in, and signed
 * "PropertyPro Management Team" on every organization's behalf.
 */

import { formatCurrency } from "@/lib/utils/formatting";
import {
  formatPdfDate,
  isRtlLanguage,
  pdfLabel,
  type PdfLanguage,
} from "@/lib/invoice/pdf-i18n";

interface InvoiceEmailTemplateOptions {
  message: string;
  propertyName?: string;
  tenantName?: string;
  invoiceNumber?: string;
  amountDue?: number;
  dueDate?: Date;
  currencyCode?: string;
  /** Who is sending it — the office's name. */
  companyName?: string;
  lang?: PdfLanguage;
}

/** Stored text (a tenant's name, a note) goes into markup escaped. */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildInvoiceEmailHtml(
  options: InvoiceEmailTemplateOptions
): string {
  const lang = options.lang ?? "en";
  const label = (key: string, english: string) =>
    escapeHtml(pdfLabel(lang, `leases.invoiceEmail.${key}`, english));
  const dir = isRtlLanguage(lang) ? "rtl" : "ltr";
  const align = isRtlLanguage(lang) ? "right" : "left";

  const messageHtml = (options.message || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(escapeHtml)
    .join("<br>");

  const row = (key: string, english: string, value: string | undefined) =>
    value
      ? `<p style="margin: 5px 0;"><strong>${label(key, english)}:</strong> ${escapeHtml(value)}</p>`
      : "";

  const sender = options.companyName?.trim() || "";

  return `
      <div dir="${dir}" style="font-family: Arial, Tahoma, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; text-align: ${align};">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 26px; font-weight: 400;">${escapeHtml(sender || label("heading", "Invoice"))}</h1>
        </div>

        <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2 style="color: #333; margin-top: 0;">${label("heading", "Invoice")}</h2>

          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            ${messageHtml}
          </div>

          <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #1976d2; margin: 0 0 10px 0;">${label("details", "Invoice details")}</h3>
            ${row("property", "Property", options.propertyName)}
            ${row("tenant", "Tenant", options.tenantName)}
            ${row("number", "Invoice number", options.invoiceNumber)}
            ${row(
              "totalDue",
              "Amount due",
              typeof options.amountDue === "number"
                ? formatCurrency(options.amountDue, options.currencyCode)
                : undefined,
            )}
            ${row(
              "dueDate",
              "Due date",
              options.dueDate ? formatPdfDate(options.dueDate, lang) : undefined,
            )}
          </div>

          <div style="background: #fff3e0; padding: 15px; border-radius: 8px; margin: 20px 0; border-${align}: 4px solid #ff9800;">
            <p style="margin: 0; color: #e65100;">📎 ${label("attachment", "The invoice is attached as a PDF.")}</p>
          </div>

          <div style="margin: 30px 0; text-align: center;">
            <a href="${process.env.APP_URL || "#"}/dashboard"
               style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">
              ${label("portal", "Open your portal")}
            </a>
          </div>

          <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; color: #666; font-size: 14px;">
            <p>${label("questions", "Questions about this invoice? Reply to this email or contact your property manager.")}</p>
            ${sender ? `<p style="margin-bottom: 0;">${label("regards", "Kind regards,")}<br>${escapeHtml(sender)}</p>` : ""}
          </div>
        </div>
      </div>
    `;
}
