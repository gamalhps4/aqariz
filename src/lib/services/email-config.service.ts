/**
 * PropertyPro - Email Configuration Resolver
 *
 * Every email the platform sends — for every office — goes out through one
 * mail server: the one the Super Admin saves under Settings → Email, or the
 * server's environment variables until one is saved.
 *
 * The console's SMTP settings used to be saved and never read: the mailer
 * knew only each office's own SMTP and the environment, so the console's
 * "Send test email" and every platform email ignored what was entered there
 * (the client's "SMTP is not working in the Super Admin"). Offices no longer
 * keep their own: the client wants all mail sent centrally, and the office
 * Email settings page is gone.
 *
 * Nothing is cached here: the platform settings are (lib/platform/settings),
 * and a save in the console clears them.
 */

import { getPlatformSettings } from "@/lib/platform/settings";
import { decryptSensitiveValue } from "@/lib/security/field-encryption";

export type EmailEncryption = "none" | "tls" | "ssl";

export interface ResolvedEmailConfig {
  host: string;
  port: number;
  secure: boolean; // true => implicit TLS (port 465), false => STARTTLS/none
  encryption: EmailEncryption;
  auth: { user: string; pass: string };
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  /** Where the active config came from: the console, or the environment. */
  source: "database" | "environment";
  /** True when host + user + pass are all present (i.e. usable). */
  configured: boolean;
}

/** Map an encryption mode to nodemailer's `secure` flag. */
export function encryptionToSecure(
  encryption: EmailEncryption,
  port: number
): boolean {
  if (encryption === "ssl") return true;
  if (encryption === "tls") return false; // STARTTLS upgrade
  return port === 465; // "none" but classic SSL port still implies secure
}

/**
 * Build the environment-variable based configuration. Supports both the
 * EMAIL_SERVER_* set (used by the main email service) and the legacy SMTP_*
 * set, preferring whichever is populated.
 */
export function getEnvEmailConfig(): ResolvedEmailConfig {
  const host =
    process.env.EMAIL_SERVER_HOST || process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(
    process.env.EMAIL_SERVER_PORT || process.env.SMTP_PORT || "587",
    10
  );
  const user = process.env.EMAIL_SERVER_USER || process.env.SMTP_USER || "";
  const pass =
    process.env.EMAIL_SERVER_PASSWORD || process.env.SMTP_PASS || "";
  const fromEmail =
    process.env.EMAIL_FROM || process.env.SMTP_FROM || user || "";
  const fromName = process.env.APP_NAME || "PropertyPro";
  const replyTo =
    process.env.SUPPORT_EMAIL || process.env.CONTACT_EMAIL || undefined;

  const encryption: EmailEncryption = port === 465 ? "ssl" : "tls";

  return {
    host,
    port,
    secure: encryptionToSecure(encryption, port),
    encryption,
    auth: { user, pass },
    fromEmail,
    fromName,
    replyTo,
    source: "environment",
    configured: Boolean(host && user && pass),
  };
}

/**
 * The mail server to send through: the console's once a server address is
 * saved there, otherwise the environment's.
 */
export async function getEmailConfig(): Promise<ResolvedEmailConfig> {
  const envConfig = getEnvEmailConfig();

  try {
    const { general, email } = await getPlatformSettings();
    if (!email.smtpHost) return envConfig;

    const port = email.smtpPort || 587;
    // "Use SSL" in the console is implicit TLS; 465 is that port whatever
    // the switch says, and anything else upgrades with STARTTLS.
    const secure = email.smtpSecure || port === 465;
    const user = email.smtpUser;
    const pass = decryptSensitiveValue(email.smtpPasswordEncrypted) || "";

    return {
      host: email.smtpHost,
      port,
      secure,
      encryption: secure ? "ssl" : "tls",
      auth: { user, pass },
      fromEmail: email.fromEmail || user,
      fromName: email.fromName || general.platformName || envConfig.fromName,
      replyTo: general.supportEmail || envConfig.replyTo,
      source: "database",
      configured: Boolean(user && pass),
    };
  } catch (error) {
    // Settings unreadable — the environment still sends.
    console.error("getEmailConfig: falling back to env config:", error);
    return envConfig;
  }
}
