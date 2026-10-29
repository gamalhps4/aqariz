/**
 * PropertyPro - Global Toast Notification System
 * Reusable, modular toast notifications for error, success, warning, and info alerts
 */

import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
} from "lucide-react";
import { localizationService } from "@/lib/services/localization.service";

/** A message in the reader's language; these helpers run outside React. */
function tr(key: string, english: string, values?: Record<string, string | number>): string {
  return localizationService.translate(key, { defaultValue: english, values });
}

// Types
export interface ToastItem {
  field?: string;
  message: string;
}

export interface ToastOptions {
  title: string;
  description?: string;
  items?: ToastItem[];
  duration?: number;
  position?:
    | "top-left"
    | "top-right"
    | "top-center"
    | "bottom-left"
    | "bottom-right"
    | "bottom-center";
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNestedStringValue(
  source: unknown,
  path: string[]
): string | undefined {
  let current = source;

  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return getStringValue(current);
}

export function getApiErrorMessage(
  error: unknown,
  fallbackMessage: string = tr("toast.unexpected", "An unexpected error occurred")
): string {
  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }

  const directMessage = getStringValue(error);
  if (directMessage) {
    return directMessage;
  }

  if (error && typeof error === "object") {
    const message =
      getNestedStringValue(error, ["error"]) ||
      getNestedStringValue(error, ["message"]) ||
      getNestedStringValue(error, ["data", "error"]) ||
      getNestedStringValue(error, ["data", "message"]) ||
      getNestedStringValue(error, ["response", "data", "error"]) ||
      getNestedStringValue(error, ["response", "data", "message"]) ||
      getNestedStringValue(error, ["statusText"]);

    if (message) {
      return message;
    }
  }

  return fallbackMessage;
}

// Field name mapping for user-friendly display (English; see fieldLabel).
const fieldNameMap: Record<string, string> = {
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  squareFootage: "Area (m²)",
  rentAmount: "Rent",
  securityDeposit: "Security deposit",
  unitNumber: "Unit number",
  unitType: "Unit type",
  floor: "Floor",
  status: "Status",
  name: "Name",
  description: "Description",
  street: "Street address",
  city: "City",
  state: "Region",
  zipCode: "Postal code",
  country: "Country",
  email: "Email",
  password: "Password",
  phone: "Phone",
  firstName: "First name",
  lastName: "Last name",
  amount: "Amount",
  dueDate: "Due date",
  startDate: "Start date",
  endDate: "End date",
};

/** A field's name in the reader's language, or the raw name when unknown. */
function fieldLabel(field: string): string {
  const english = fieldNameMap[field];
  return english ? tr(`toast.field.${field}`, english) : field;
}

// Helper function to parse validation errors into user-friendly messages
export function parseValidationErrors(errorMessage: string): ToastItem[] {
  // Check if it's a comma-separated list of validation errors
  const errors = errorMessage.split(",").map((e) => e.trim());

  return errors.map((error) => {
    // Parse patterns like "units.0.bedrooms: Number must be less than or equal to 20"
    const match = error.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      const [, fieldPath, message] = match;

      // Extract unit number and field name
      const unitMatch = fieldPath.match(/units\.(\d+)\.(\w+)/);
      if (unitMatch) {
        const [, unitIndex, fieldName] = unitMatch;
        const readableField = fieldLabel(fieldName);
        return {
          field: tr("toast.unitField", "Unit {number} → {field}", { number: parseInt(unitIndex) + 1, field: readableField }),
          message: message,
        };
      }

      // Handle address fields
      const addressMatch = fieldPath.match(/address\.(\w+)/);
      if (addressMatch) {
        const [, fieldName] = addressMatch;
        const readableField = fieldLabel(fieldName);
        return {
          field: readableField,
          message: message,
        };
      }

      // Handle other nested fields
      const nestedMatch = fieldPath.match(/(\w+)\.(\d+)\.(\w+)/);
      if (nestedMatch) {
        const [, parentField, index, fieldName] = nestedMatch;
        const readableField = fieldLabel(fieldName);
        const parentReadable =
          parentField.charAt(0).toUpperCase() + parentField.slice(1);
        return {
          field: `${parentReadable} ${parseInt(index) + 1} → ${readableField}`,
          message: message,
        };
      }

      // Handle other fields
      const readableField = fieldLabel(fieldPath);
      return {
        field: readableField,
        message: message,
      };
    }
    return { field: undefined, message: error };
  });
}

// Toast variant configurations
const toastConfig = {
  error: {
    icon: AlertCircle,
    colors: {
      border: "border-red-200 dark:border-red-800",
      headerBg: "bg-red-50 dark:bg-red-950/50",
      headerBorder: "border-red-200 dark:border-red-800",
      iconBg: "bg-red-100 dark:bg-red-900/50",
      iconColor: "text-red-600 dark:text-red-400",
      title: "text-red-900 dark:text-red-100",
      subtitle: "text-red-600 dark:text-red-400",
      closeHover: "hover:bg-red-100 dark:hover:bg-red-900/50",
      closeIcon: "text-red-500",
      itemBg: "bg-red-50 dark:bg-red-950/30",
      itemDot: "bg-red-500",
      itemField: "text-red-800 dark:text-red-200",
      itemMessage: "text-red-600 dark:text-red-400",
      footerBg: "bg-red-50/50 dark:bg-red-950/30",
      footerBorder: "border-red-100 dark:border-red-900",
      footerText: "text-red-600 dark:text-red-400",
    },
  },
  success: {
    icon: CheckCircle2,
    colors: {
      border: "border-green-200 dark:border-green-800",
      headerBg: "bg-green-50 dark:bg-green-950/50",
      headerBorder: "border-green-200 dark:border-green-800",
      iconBg: "bg-green-100 dark:bg-green-900/50",
      iconColor: "text-green-600 dark:text-green-400",
      title: "text-green-900 dark:text-green-100",
      subtitle: "text-green-600 dark:text-green-400",
      closeHover: "hover:bg-green-100 dark:hover:bg-green-900/50",
      closeIcon: "text-green-500",
      itemBg: "bg-green-50 dark:bg-green-950/30",
      itemDot: "bg-green-500",
      itemField: "text-green-800 dark:text-green-200",
      itemMessage: "text-green-600 dark:text-green-400",
      footerBg: "bg-green-50/50 dark:bg-green-950/30",
      footerBorder: "border-green-100 dark:border-green-900",
      footerText: "text-green-600 dark:text-green-400",
    },
  },
  warning: {
    icon: AlertTriangle,
    colors: {
      border: "border-yellow-200 dark:border-yellow-800",
      headerBg: "bg-yellow-50 dark:bg-yellow-950/50",
      headerBorder: "border-yellow-200 dark:border-yellow-800",
      iconBg: "bg-yellow-100 dark:bg-yellow-900/50",
      iconColor: "text-yellow-600 dark:text-yellow-400",
      title: "text-yellow-900 dark:text-yellow-100",
      subtitle: "text-yellow-600 dark:text-yellow-400",
      closeHover: "hover:bg-yellow-100 dark:hover:bg-yellow-900/50",
      closeIcon: "text-yellow-500",
      itemBg: "bg-yellow-50 dark:bg-yellow-950/30",
      itemDot: "bg-yellow-500",
      itemField: "text-yellow-800 dark:text-yellow-200",
      itemMessage: "text-yellow-600 dark:text-yellow-400",
      footerBg: "bg-yellow-50/50 dark:bg-yellow-950/30",
      footerBorder: "border-yellow-100 dark:border-yellow-900",
      footerText: "text-yellow-600 dark:text-yellow-400",
    },
  },
  info: {
    icon: Info,
    colors: {
      border: "border-blue-200 dark:border-blue-800",
      headerBg: "bg-blue-50 dark:bg-blue-950/50",
      headerBorder: "border-blue-200 dark:border-blue-800",
      iconBg: "bg-blue-100 dark:bg-blue-900/50",
      iconColor: "text-blue-600 dark:text-blue-400",
      title: "text-blue-900 dark:text-blue-100",
      subtitle: "text-blue-600 dark:text-blue-400",
      closeHover: "hover:bg-blue-100 dark:hover:bg-blue-900/50",
      closeIcon: "text-blue-500",
      itemBg: "bg-blue-50 dark:bg-blue-950/30",
      itemDot: "bg-blue-500",
      itemField: "text-blue-800 dark:text-blue-200",
      itemMessage: "text-blue-600 dark:text-blue-400",
      footerBg: "bg-blue-50/50 dark:bg-blue-950/30",
      footerBorder: "border-blue-100 dark:border-blue-900",
      footerText: "text-blue-600 dark:text-blue-400",
    },
  },
};

type ToastVariant = keyof typeof toastConfig;

// Base toast component
function showCustomToast(
  variant: ToastVariant,
  options: ToastOptions
): string | number {
  const config = toastConfig[variant];
  const Icon = config.icon;
  const colors = config.colors;
  const {
    title,
    description,
    items = [],
    duration = 8000,
    position = "bottom-right",
  } = options;

  const hasItems = items.length > 0;
  const itemCount = items.length;

  return toast.custom(
    (toastId) => (
      <div
        className={`w-[380px] bg-white dark:bg-gray-900 border ${colors.border} rounded-xl shadow-xl overflow-hidden z-[9999]`}
      >
        {/* Header */}
        <div
          className={`flex items-center gap-3 px-4 py-3 ${colors.headerBg} border-b ${colors.headerBorder}`}
        >
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full ${colors.iconBg}`}
          >
            <Icon className={`h-5 w-5 ${colors.iconColor}`} />
          </div>
          <div className="flex-1">
            <h3 className={`font-semibold ${colors.title}`}>{title}</h3>
            {(description || hasItems) && (
              <p className={`text-xs ${colors.subtitle}`}>
                {description ||
                  tr("toast.itemCount", "{count} items", { count: itemCount })}
              </p>
            )}
          </div>
          <button
            onClick={() => toast.dismiss(toastId)}
            className={`p-1 rounded-md ${colors.closeHover} transition-colors`}
          >
            <span className="sr-only">{tr("common.dismiss", "Dismiss")}</span>
            <X className={`h-4 w-4 ${colors.closeIcon}`} />
          </button>
        </div>

        {/* Items List */}
        {hasItems && (
          <div className="p-3 space-y-2 max-h-[200px] overflow-y-auto">
            {items.slice(0, 5).map((item, index) => (
              <div
                key={index}
                className={`flex items-start gap-2 ${colors.itemBg} rounded-lg px-3 py-2`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${colors.itemDot} mt-2 shrink-0`}
                />
                <div className="flex-1 min-w-0">
                  {item.field && (
                    <p className={`text-sm font-medium ${colors.itemField}`}>
                      {item.field}
                    </p>
                  )}
                  <p
                    className={`text-xs ${colors.itemMessage} ${
                      !item.field ? "text-sm" : ""
                    }`}
                  >
                    {item.message}
                  </p>
                </div>
              </div>
            ))}
            {itemCount > 5 && (
              <p
                className={`text-xs ${colors.subtitle} text-center py-1`}
              >
                {tr("toast.more", "+{count} more", { count: itemCount - 5 })}
              </p>
            )}
          </div>
        )}

        {/* Footer (only show for items) */}
        {hasItems && (
          <div
            className={`px-4 py-2 ${colors.footerBg} border-t ${colors.footerBorder}`}
          >
            <p className={`text-xs ${colors.footerText} text-center`}>
              {variant === "error"
                ? tr("toast.footer.error", "Correct these and try again")
                : variant === "success"
                ? tr("toast.footer.success", "Everything went through")
                : variant === "warning"
                ? tr("toast.footer.warning", "Review the warnings above")
                : tr("toast.footer.info", "Details above")}
            </p>
          </div>
        )}
      </div>
    ),
    {
      duration,
      position,
    }
  );
}

// Simple toast component (without items list)
function showSimpleToast(
  variant: ToastVariant,
  options: Omit<ToastOptions, "items">
): string | number {
  const config = toastConfig[variant];
  const Icon = config.icon;
  const colors = config.colors;
  const { title, description, duration = 5000, position = "bottom-right" } = options;

  return toast.custom(
    (toastId) => (
      <div
        className={`w-[340px] bg-white dark:bg-gray-900 border ${colors.border} rounded-xl shadow-xl overflow-hidden z-[9999]`}
      >
        <div className={`flex items-center gap-3 px-4 py-3 ${colors.headerBg}`}>
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full ${colors.iconBg}`}
          >
            <Icon className={`h-5 w-5 ${colors.iconColor}`} />
          </div>
          <div className="flex-1">
            <h3 className={`font-semibold ${colors.title}`}>{title}</h3>
            {description && (
              <p className={`text-xs ${colors.subtitle} mt-0.5`}>
                {description}
              </p>
            )}
          </div>
          <button
            onClick={() => toast.dismiss(toastId)}
            className={`p-1 rounded-md ${colors.closeHover} transition-colors`}
          >
            <span className="sr-only">{tr("common.dismiss", "Dismiss")}</span>
            <X className={`h-4 w-4 ${colors.closeIcon}`} />
          </button>
        </div>
      </div>
    ),
    {
      duration,
      position,
    }
  );
}

// Export individual toast functions
export const showErrorToast = (options: ToastOptions) =>
  showCustomToast("error", { ...options, duration: options.duration || 12000 });

export const showSuccessToast = (options: ToastOptions) =>
  showCustomToast("success", options);

export const showWarningToast = (options: ToastOptions) =>
  showCustomToast("warning", { ...options, duration: options.duration || 10000 });

export const showInfoToast = (options: ToastOptions) =>
  showCustomToast("info", options);

// Simple toast exports (without items list)
export const showSimpleError = (title: string, description?: string) =>
  showSimpleToast("error", { title, description, duration: 8000 });

export const showSimpleSuccess = (title: string, description?: string) =>
  showSimpleToast("success", { title, description });

export const showSimpleWarning = (title: string, description?: string) =>
  showSimpleToast("warning", { title, description, duration: 8000 });

export const showSimpleInfo = (title: string, description?: string) =>
  showSimpleToast("info", { title, description });

export const showApiErrorToast = (
  error: unknown,
  fallbackMessage?: string,
  description?: string
) => showSimpleError(getApiErrorMessage(error, fallbackMessage), description);

// Utility function for API error handling
export function handleApiError(
  error: unknown,
  fallbackTitle: string = tr("toast.errorTitle", "Error"),
  fallbackMessage?: string
) {
  const message = getApiErrorMessage(error, fallbackMessage);
  const parsedErrors = parseValidationErrors(message);

  if (parsedErrors.length > 1 || parsedErrors.some((e) => e.field)) {
    return showErrorToast({
      title: fallbackTitle,
      description: tr("toast.validationCount", "{count} fields need attention", { count: parsedErrors.length }),
      items: parsedErrors,
    });
  }

  return showSimpleError(fallbackTitle, message);
}

// Default export with all functions
const toastNotifications = {
  error: showErrorToast,
  success: showSuccessToast,
  warning: showWarningToast,
  info: showInfoToast,
  simpleError: showSimpleError,
  simpleSuccess: showSimpleSuccess,
  simpleWarning: showSimpleWarning,
  simpleInfo: showSimpleInfo,
  apiError: showApiErrorToast,
  handleApiError,
  getApiErrorMessage,
  parseValidationErrors,
};

export default toastNotifications;
