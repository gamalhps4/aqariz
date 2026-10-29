/**
 * PropertyPro - Email Configuration
 * Email service configuration for SMTP
 */

export interface EmailConfig {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
    from: string;
  };
}

export const emailConfig: EmailConfig = {
  smtp: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
    from:
      process.env.SMTP_FROM ||
      process.env.CONTACT_EMAIL ||
      "noreply@PropertyPro.com",
  },
};

export const communicationConfig = {
  enableEmail: process.env.ENABLE_EMAIL_NOTIFICATIONS === "true",
  businessHours: {
    start: process.env.BUSINESS_HOURS_START || "09:00",
    end: process.env.BUSINESS_HOURS_END || "17:00",
    timezone: process.env.BUSINESS_TIMEZONE || "America/New_York",
  },
  respectDoNotDisturb: process.env.RESPECT_DO_NOT_DISTURB === "true",
  contactInfo: {
    phone: process.env.CONTACT_PHONE || "(555) 123-4567",
    email: process.env.CONTACT_EMAIL || "support@PropertyPro.com",
    supportEmail: process.env.SUPPORT_EMAIL || "support@PropertyPro.com",
  },
};

export const paymentSystemConfig = {
  enableAutomation: process.env.ENABLE_PAYMENT_AUTOMATION === "true",
  enableProrationCalculation:
    process.env.ENABLE_PRORATION_CALCULATION === "true",
};
