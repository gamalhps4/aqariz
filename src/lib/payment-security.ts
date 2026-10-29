/**
 * PropertyPro - Payment Security Module
 * Implements fraud detection, rate limiting, and security measures for payments
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { PaymentStatus } from "@/types";

// ============================================================================
// INTERFACES
// ============================================================================

interface SecurityCheck {
  isValid: boolean;
  riskLevel: "low" | "medium" | "high";
  reasons: string[];
  recommendations: string[];
}

interface PaymentAttempt {
  userId: string;
  amount: number;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  success: boolean;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  message?: string;
}

// ============================================================================
// FRAUD DETECTION
// ============================================================================

export async function detectFraud(
  userId: string,
  amount: number,
  ipAddress: string,
  userAgent: string
): Promise<SecurityCheck> {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let riskLevel: "low" | "medium" | "high" = "low";

  try {
    // Check 1: Unusual payment amount
    const amountCheck = await checkUnusualAmount(userId, amount);
    if (amountCheck.suspicious) {
      reasons.push(amountCheck.reason);
      riskLevel = "medium";
    }

    // Check 2: Payment frequency
    const frequencyCheck = await checkPaymentFrequency(userId);
    if (frequencyCheck.suspicious) {
      reasons.push(frequencyCheck.reason);
      riskLevel = frequencyCheck.riskLevel;
    }

    // Check 3: Stripe payment validation
    const stripeValidation = await validateStripePayment(amount, userId);
    if (!stripeValidation.isValid) {
      reasons.push(...stripeValidation.reasons);
      if (stripeValidation.riskLevel === "high") {
        riskLevel = "high";
      } else if (
        stripeValidation.riskLevel === "medium" &&
        riskLevel === "low"
      ) {
        riskLevel = "medium";
      }
    }

    // Check 3: IP address patterns
    const ipCheck = await checkIPPatterns(userId, ipAddress);
    if (ipCheck.suspicious) {
      reasons.push(ipCheck.reason);
      riskLevel =
        Math.max(
          riskLevel === "low" ? 0 : riskLevel === "medium" ? 1 : 2,
          ipCheck.riskLevel === "low"
            ? 0
            : ipCheck.riskLevel === "medium"
            ? 1
            : 2
        ) === 0
          ? "low"
          : Math.max(
              riskLevel === "low" ? 0 : riskLevel === "medium" ? 1 : 2,
              ipCheck.riskLevel === "low"
                ? 0
                : ipCheck.riskLevel === "medium"
                ? 1
                : 2
            ) === 1
          ? "medium"
          : "high";
    }

    // Check 4: User agent consistency
    const userAgentCheck = await checkUserAgentConsistency(userId, userAgent);
    if (userAgentCheck.suspicious) {
      reasons.push(userAgentCheck.reason);
      if (riskLevel === "low") riskLevel = "medium";
    }

    // Check 5: Failed payment attempts
    const failedAttemptsCheck = await checkFailedAttempts(userId, ipAddress);
    if (failedAttemptsCheck.suspicious) {
      reasons.push(failedAttemptsCheck.reason);
      riskLevel = "high";
    }

    // Generate recommendations based on risk level
    if (riskLevel === "high") {
      recommendations.push("Require additional verification");
      recommendations.push("Contact tenant directly");
      recommendations.push("Consider temporary payment suspension");
    } else if (riskLevel === "medium") {
      recommendations.push("Monitor closely");
      recommendations.push("Consider email verification");
    }

    return {
      isValid: riskLevel !== "high",
      riskLevel,
      reasons,
      recommendations,
    };
  } catch (error) {
    console.error("Fraud detection error:", error);
    return {
      isValid: false,
      riskLevel: "high",
      reasons: ["System error during fraud detection"],
      recommendations: ["Manual review required"],
    };
  }
}

// ============================================================================
// RATE LIMITING
// ============================================================================

const rateLimitStore = new Map<string, { count: number; resetTime: Date }>();

export function checkRateLimit(
  identifier: string,
  maxAttempts: number = 5,
  windowMinutes: number = 15
): RateLimitResult {
  const now = new Date();
  const key = `payment_${identifier}`;
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetTime < now) {
    // Reset or create new entry
    rateLimitStore.set(key, {
      count: 1,
      resetTime: new Date(now.getTime() + windowMinutes * 60 * 1000),
    });

    return {
      allowed: true,
      remaining: maxAttempts - 1,
      resetTime: new Date(now.getTime() + windowMinutes * 60 * 1000),
    };
  }

  if (existing.count >= maxAttempts) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: existing.resetTime,
      message: `Too many payment attempts. Try again after ${existing.resetTime.toLocaleTimeString()}`,
    };
  }

  existing.count++;
  rateLimitStore.set(key, existing);

  return {
    allowed: true,
    remaining: maxAttempts - existing.count,
    resetTime: existing.resetTime,
  };
}

// ============================================================================
// SECURITY VALIDATION
// ============================================================================

export function validatePaymentRequest(request: NextRequest): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check for required headers
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    errors.push("Invalid content type");
  }

  // Check for suspicious user agents
  const userAgent = request.headers.get("user-agent");
  if (!userAgent || userAgent.length < 10) {
    errors.push("Suspicious user agent");
  }

  // Check for common bot patterns
  if (userAgent && /bot|crawler|spider|scraper/i.test(userAgent)) {
    errors.push("Automated request detected");
  }

  // Check referer (if present). Skipped entirely when no app origin is
  // configured — `includes("")` matches everything, which silently disabled
  // this check under the old NEXTAUTH_URL-only lookup.
  const referer = request.headers.get("referer");
  const appOrigin =
    process.env.BETTER_AUTH_URL || process.env.APP_URL || process.env.AUTH_URL;
  if (referer && appOrigin && !referer.startsWith(appOrigin)) {
    errors.push("Invalid referer");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function checkUnusualAmount(userId: string, amount: number) {
  const recentPayments = await db.payment.findMany({
    where: {
      tenantId: userId,
      createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }, // Last 90 days
    },
    select: { amount: true },
  });

  if (recentPayments.length === 0) {
    return { suspicious: false, reason: "" };
  }

  const amounts = recentPayments.map((p) => p.amount);
  const avgAmount = amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length;
  const maxAmount = Math.max(...amounts);

  // Check if amount is significantly higher than usual
  if (amount > avgAmount * 3 || amount > maxAmount * 1.5) {
    return {
      suspicious: true,
      reason: `Payment amount (${amount}) is unusually high compared to recent payments`,
    };
  }

  return { suspicious: false, reason: "" };
}

async function checkPaymentFrequency(userId: string) {
  const today = new Date();
  const oneDayAgo = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(today.getTime() - 60 * 60 * 1000);

  const paymentsLast24h = await db.payment.count({
    where: {
      tenantId: userId,
      createdAt: { gte: oneDayAgo },
    },
  });

  const paymentsLastHour = await db.payment.count({
    where: {
      tenantId: userId,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (paymentsLastHour > 3) {
    return {
      suspicious: true,
      reason: "Too many payment attempts in the last hour",
      riskLevel: "high" as const,
    };
  }

  if (paymentsLast24h > 10) {
    return {
      suspicious: true,
      reason: "Unusually high payment frequency in the last 24 hours",
      riskLevel: "medium" as const,
    };
  }

  return { suspicious: false, reason: "", riskLevel: "low" as const };
}

async function checkIPPatterns(userId: string, currentIP: string) {
  // Payment rows no longer carry per-request metadata (the Mongo documents'
  // optional `metadata.ipAddress` never made it into the Postgres schema), so
  // there is nothing to inspect — exactly the empty result the old check
  // produced against documents without metadata.
  return { suspicious: false, reason: "", riskLevel: "low" as const };
}

async function checkUserAgentConsistency(
  userId: string,
  currentUserAgent: string
) {
  // See checkIPPatterns: request metadata (user agent) is not stored on
  // payments, so the consistency check has nothing to compare against.
  return { suspicious: false, reason: "" };
}

async function checkFailedAttempts(userId: string, ipAddress: string) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // The old query also matched `metadata.ipAddress`, which no longer exists on
  // payments — the tenant match is the surviving (and only effective) branch.
  const failedAttempts = await db.payment.count({
    where: {
      tenantId: userId,
      status: PaymentStatus.FAILED,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (failedAttempts > 3) {
    return {
      suspicious: true,
      reason: "Multiple failed payment attempts detected",
    };
  }

  return { suspicious: false, reason: "" };
}

// ============================================================================
// STRIPE PAYMENT VALIDATION
// ============================================================================

async function validateStripePayment(
  amount: number,
  userId: string
): Promise<{
  isValid: boolean;
  reasons: string[];
  riskLevel: "low" | "medium" | "high";
}> {
  const reasons: string[] = [];
  let riskLevel: "low" | "medium" | "high" = "low";

  // Check amount limits
  if (amount > 10000) {
    reasons.push("Payment amount exceeds $10,000 limit");
    riskLevel = "high";
  } else if (amount > 5000) {
    reasons.push("Payment amount exceeds $5,000 threshold");
    riskLevel = "medium";
  }

  // Check minimum amount
  if (amount < 1) {
    reasons.push("Payment amount below minimum threshold");
    riskLevel = "high";
  }

  // Check for round numbers (potential fraud indicator)
  if (amount >= 1000 && amount % 100 === 0) {
    reasons.push("Payment amount is a round number over $1,000");
    riskLevel = "medium";
  }

  return {
    isValid: reasons.length === 0,
    reasons,
    riskLevel,
  };
}

// ============================================================================
// SECURITY LOGGING
// ============================================================================

export async function logSecurityEvent(
  eventType: string,
  userId: string,
  details: Record<string, any>,
  riskLevel: "low" | "medium" | "high" = "low"
) {
  try {
    // In a production environment, you would log to a security monitoring system
    // You could also store events in a dedicated security log table.
  } catch (error) {
    console.error("Failed to log security event:", error);
  }
}
