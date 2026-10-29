/**
 * PropertyPro - Email Service
 * Email sending service with SMTP/Nodemailer support
 */

import { getEmailConfig } from "@/lib/services/email-config.service";

export interface EmailData {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

class EmailService {
  // Build a transporter from the active (DB-first, env-fallback) config.
  private async getTransport() {
    const { createTransport } = await import("nodemailer");
    const config = await getEmailConfig();
    const transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
    return { transporter, config };
  }

  async sendEmail(emailData: EmailData): Promise<EmailResult> {
    try {
      return await this.sendWithSMTP(emailData);
    } catch (error) {
      console.error("Email sending failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async sendWithSMTP(emailData: EmailData): Promise<EmailResult> {
    try {
      const { transporter, config } = await this.getTransport();

      const mailOptions = {
        from:
          emailData.from ||
          `${config.fromName} <${config.fromEmail}>`,
        to: Array.isArray(emailData.to)
          ? emailData.to.join(", ")
          : emailData.to,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
        replyTo: emailData.replyTo || config.replyTo,
        attachments: emailData.attachments,
      };

      const info = await transporter.sendMail(mailOptions);

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error: any) {
      console.error("SMTP error:", error);
      return {
        success: false,
        error: error.message || "SMTP sending failed",
      };
    }
  }

  async sendBulkEmails(emails: EmailData[]): Promise<EmailResult[]> {
    const results: EmailResult[] = [];

    // Process emails in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      const batchPromises = batch.map((email) => this.sendEmail(email));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batches
      if (i + batchSize < emails.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  async verifyConnection(): Promise<boolean> {
    try {
      const { transporter } = await this.getTransport();
      await transporter.verify();
      return true;
    } catch (error) {
      console.error("Email service verification failed:", error);
      return false;
    }
  }

  async getProviderInfo(): Promise<{
    provider: string;
    configured: boolean;
    source: "database" | "environment";
  }> {
    const config = await getEmailConfig();
    return {
      provider: "smtp",
      configured: config.configured,
      source: config.source,
    };
  }
}

export const emailService = new EmailService();
