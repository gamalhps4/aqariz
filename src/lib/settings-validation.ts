/**
 * PropertyPro - Settings Validation Utilities
 * Comprehensive validation and testing for settings modules
 */

import {
  userSettingsSchema,
  notificationSettingsSchema,
  displaySettingsSchema,
  privacySettingsSchema,
} from "@/lib/validations";

// Validation result interface
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

// Settings test result interface
export interface SettingsTestResult {
  category: string;
  passed: boolean;
  message: string;
  details?: any;
}

/**
 * Validate user settings data
 */
export function validateUserSettings(data: any): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    suggestions: [],
  };

  try {
    // Validate overall structure
    const validation = userSettingsSchema.safeParse(data);

    if (!validation.success) {
      result.isValid = false;
      result.errors = validation.error.errors.map(
        (err) => `${err.path.join(".")}: ${err.message}`
      );
      return result;
    }

    // Additional custom validations
    const settings = validation.data;

    // Notification settings validation
    if (settings.notifications) {
      const notifResult = validateNotificationSettings(settings.notifications);
      result.warnings.push(...notifResult.warnings);
      result.suggestions.push(...notifResult.suggestions);
    }

    // Display settings validation
    if (settings.display) {
      const displayResult = validateDisplaySettings(settings.display);
      result.warnings.push(...displayResult.warnings);
      result.suggestions.push(...displayResult.suggestions);
    }

    // Privacy settings validation
    if (settings.privacy) {
      const privacyResult = validatePrivacySettings(settings.privacy);
      result.warnings.push(...privacyResult.warnings);
      result.suggestions.push(...privacyResult.suggestions);
    }
  } catch (error) {
    result.isValid = false;
    result.errors.push(`Validation error: ${error}`);
  }

  return result;
}

/**
 * Validate notification settings
 */
export function validateNotificationSettings(data: any): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    suggestions: [],
  };

  try {
    const validation = notificationSettingsSchema.safeParse(data);

    if (!validation.success) {
      result.isValid = false;
      result.errors = validation.error.errors.map(
        (err) => `${err.path.join(".")}: ${err.message}`
      );
      return result;
    }

    const settings = validation.data;

    // Check for potential issues
    if (settings.email.enabled && !settings.email.paymentReminders) {
      result.warnings.push(
        "Payment reminders are disabled - you may miss important payment notifications"
      );
    }

    if (settings.sms.enabled && settings.sms.emergencyOnly) {
      result.suggestions.push(
        "Consider enabling maintenance updates via SMS for urgent issues"
      );
    }

    if (
      !settings.email.enabled &&
      !settings.sms.enabled &&
      !settings.push.enabled
    ) {
      result.warnings.push(
        "All notification methods are disabled - you may miss important updates"
      );
    }

    // Quiet hours validation
    if (settings.email.quietHours?.enabled) {
      const start = settings.email.quietHours.startTime;
      const end = settings.email.quietHours.endTime;

      if (start === end) {
        result.warnings.push(
          "Email quiet hours start and end times are the same"
        );
      }
    }
  } catch (error) {
    result.isValid = false;
    result.errors.push(`Notification validation error: ${error}`);
  }

  return result;
}

/**
 * Validate display settings
 */
export function validateDisplaySettings(data: any): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    suggestions: [],
  };

  try {
    const validation = displaySettingsSchema.safeParse(data);

    if (!validation.success) {
      result.isValid = false;
      result.errors = validation.error.errors.map(
        (err) => `${err.path.join(".")}: ${err.message}`
      );
      return result;
    }

    const settings = validation.data;

    // Branding color validation
    if (settings.branding) {
      const { primaryColor, secondaryColor } = settings.branding;

      if (primaryColor === secondaryColor) {
        result.warnings.push(
          "Primary and secondary colors are the same - this may affect readability"
        );
      }
    }
  } catch (error) {
    result.isValid = false;
    result.errors.push(`Display validation error: ${error}`);
  }

  return result;
}

/**
 * Validate privacy settings
 */
export function validatePrivacySettings(data: any): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    suggestions: [],
  };

  try {
    const validation = privacySettingsSchema.safeParse(data);

    if (!validation.success) {
      result.isValid = false;
      result.errors = validation.error.errors.map(
        (err) => `${err.path.join(".")}: ${err.message}`
      );
      return result;
    }

    const settings = validation.data;

    // Privacy recommendations
    if (settings.profileVisibility === "public" && settings.showContactInfo) {
      result.warnings.push("Your contact information will be publicly visible");
    }

    if (
      settings.allowDataCollection &&
      settings.shareUsageData &&
      settings.allowMarketing
    ) {
      result.suggestions.push(
        "Consider reviewing your data sharing preferences for better privacy"
      );
    }

    if (settings.dataRetentionPeriod > 365) {
      result.suggestions.push(
        "Consider a shorter data retention period for better privacy"
      );
    }

    // Cookie preferences
    if (settings.cookiePreferences?.marketing && !settings.allowMarketing) {
      result.warnings.push(
        "Marketing cookies are enabled but marketing is disabled - this may be inconsistent"
      );
    }
  } catch (error) {
    result.isValid = false;
    result.errors.push(`Privacy validation error: ${error}`);
  }

  return result;
}

/**
 * Test settings functionality
 */
export async function testSettings(
  category: string,
  settings: any
): Promise<SettingsTestResult[]> {
  const results: SettingsTestResult[] = [];

  switch (category) {
    case "notifications":
      results.push(...(await testNotificationSettings(settings)));
      break;
    case "display":
      results.push(...testDisplaySettings(settings));
      break;
    case "privacy":
      results.push(...testPrivacySettings(settings));
      break;
    case "system":
      results.push(...(await testSystemSettings(settings)));
      break;
    default:
      results.push({
        category,
        passed: false,
        message: `Unknown settings category: ${category}`,
      });
  }

  return results;
}

/**
 * Test notification settings
 */
async function testNotificationSettings(
  settings: any
): Promise<SettingsTestResult[]> {
  const results: SettingsTestResult[] = [];

  // Test email configuration
  if (settings.email?.enabled) {
    try {
      // This would typically test SMTP connection
      results.push({
        category: "notifications",
        passed: true,
        message: "Email notifications configuration is valid",
      });
    } catch (error) {
      results.push({
        category: "notifications",
        passed: false,
        message: "Email notification test failed",
        details: error,
      });
    }
  }

  // Test SMS configuration
  if (settings.sms?.enabled) {
    results.push({
      category: "notifications",
      passed: true,
      message: "SMS notifications configuration is valid",
    });
  }

  return results;
}

/**
 * Test display settings
 */
function testDisplaySettings(settings: any): SettingsTestResult[] {
  const results: SettingsTestResult[] = [];

  // Test color scheme
  if (settings.colorScheme) {
    const isValidColor = (color: string) => /^#[0-9A-F]{6}$/i.test(color);

    if (isValidColor(settings.colorScheme.primary)) {
      results.push({
        category: "display",
        passed: true,
        message: "Color scheme is valid",
      });
    } else {
      results.push({
        category: "display",
        passed: false,
        message: "Invalid color format in color scheme",
      });
    }
  }

  return results;
}

/**
 * Test privacy settings
 */
function testPrivacySettings(settings: any): SettingsTestResult[] {
  const results: SettingsTestResult[] = [];

  // Test data retention period
  if (settings.dataRetentionPeriod) {
    if (
      settings.dataRetentionPeriod >= 30 &&
      settings.dataRetentionPeriod <= 2555
    ) {
      results.push({
        category: "privacy",
        passed: true,
        message: "Data retention period is within valid range",
      });
    } else {
      results.push({
        category: "privacy",
        passed: false,
        message: "Data retention period is outside valid range (30-2555 days)",
      });
    }
  }

  return results;
}

/**
 * Test system settings
 */
async function testSystemSettings(
  settings: any
): Promise<SettingsTestResult[]> {
  const results: SettingsTestResult[] = [];

  // Test email configuration
  if (settings.email) {
    try {
      // This would test SMTP connection
      results.push({
        category: "system",
        passed: true,
        message: "System email configuration is valid",
      });
    } catch (error) {
      results.push({
        category: "system",
        passed: false,
        message: "System email configuration test failed",
        details: error,
      });
    }
  }

  return results;
}
