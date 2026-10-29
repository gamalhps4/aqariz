/**
 * PropertyPro - Settings Error Handler
 * Comprehensive error handling for settings operations
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

// Settings-specific error types
export enum SettingsErrorType {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  RATE_LIMITED = "RATE_LIMITED",
  DATABASE_ERROR = "DATABASE_ERROR",
  ENCRYPTION_ERROR = "ENCRYPTION_ERROR",
  MIGRATION_ERROR = "MIGRATION_ERROR",
  BACKUP_ERROR = "BACKUP_ERROR",
  SYNC_ERROR = "SYNC_ERROR",
  CONFLICT_ERROR = "CONFLICT_ERROR",
}

export class SettingsError extends Error {
  public readonly type: SettingsErrorType;
  public readonly statusCode: number;
  public readonly details?: any;
  public readonly userId?: string;
  public readonly settingsCategory?: string;

  constructor(
    type: SettingsErrorType,
    message: string,
    statusCode: number = 500,
    details?: any,
    userId?: string,
    settingsCategory?: string
  ) {
    super(message);
    this.name = "SettingsError";
    this.type = type;
    this.statusCode = statusCode;
    this.details = details;
    this.userId = userId;
    this.settingsCategory = settingsCategory;
  }
}

// Specific error classes
export class SettingsValidationError extends SettingsError {
  constructor(
    message: string,
    details?: any,
    userId?: string,
    settingsCategory?: string
  ) {
    super(
      SettingsErrorType.VALIDATION_ERROR,
      message,
      400,
      details,
      userId,
      settingsCategory
    );
  }
}

export class SettingsNotFoundError extends SettingsError {
  constructor(message: string, userId?: string, settingsCategory?: string) {
    super(
      SettingsErrorType.NOT_FOUND,
      message,
      404,
      undefined,
      userId,
      settingsCategory
    );
  }
}

export class SettingsPermissionError extends SettingsError {
  constructor(message: string, userId?: string, settingsCategory?: string) {
    super(
      SettingsErrorType.PERMISSION_DENIED,
      message,
      403,
      undefined,
      userId,
      settingsCategory
    );
  }
}

export class SettingsRateLimitError extends SettingsError {
  constructor(message: string, resetTime?: number, userId?: string) {
    super(SettingsErrorType.RATE_LIMITED, message, 429, { resetTime }, userId);
  }
}

export class SettingsDatabaseError extends SettingsError {
  constructor(
    message: string,
    details?: any,
    userId?: string,
    settingsCategory?: string
  ) {
    super(
      SettingsErrorType.DATABASE_ERROR,
      message,
      500,
      details,
      userId,
      settingsCategory
    );
  }
}

export class SettingsConflictError extends SettingsError {
  constructor(
    message: string,
    details?: any,
    userId?: string,
    settingsCategory?: string
  ) {
    super(
      SettingsErrorType.CONFLICT_ERROR,
      message,
      409,
      details,
      userId,
      settingsCategory
    );
  }
}

// Error handler function
export function handleSettingsError(
  error: any,
  userId?: string,
  settingsCategory?: string
): NextResponse {
  console.error("Settings error:", {
    error: error.message,
    stack: error.stack,
    userId,
    settingsCategory,
    type: error.type || "UNKNOWN",
  });

  // Handle SettingsError instances
  if (error instanceof SettingsError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: error.type,
          message: error.message,
          details: error.details,
          category: error.settingsCategory,
        },
        timestamp: new Date().toISOString(),
      },
      { status: error.statusCode }
    );
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const validationErrors = error.errors.map((err) => ({
      field: err.path.join("."),
      message: err.message,
      code: err.code,
    }));

    return NextResponse.json(
      {
        success: false,
        error: {
          type: SettingsErrorType.VALIDATION_ERROR,
          message: "Validation failed",
          details: validationErrors,
          category: settingsCategory,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 }
    );
  }

  // Handle Prisma known request errors (constraint/shape violations)
  if (typeof (error as any)?.code === "string" && (error as any).code.startsWith("P2")) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: SettingsErrorType.VALIDATION_ERROR,
          message: "Database validation failed",
          details: { code: (error as any).code, meta: (error as any).meta },
          category: settingsCategory,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 }
    );
  }

  // Handle MongoDB duplicate key errors
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || {})[0] || "field";
    return NextResponse.json(
      {
        success: false,
        error: {
          type: SettingsErrorType.CONFLICT_ERROR,
          message: `Duplicate ${field} already exists`,
          details: {
            field,
            value: error.keyValue?.[field],
          },
          category: settingsCategory,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 409 }
    );
  }

  // Handle generic database errors
  if (error.name === "MongoError" || error.name === "MongoServerError") {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: SettingsErrorType.DATABASE_ERROR,
          message: "Database operation failed",
          details: {
            code: error.code,
            codeName: error.codeName,
          },
          category: settingsCategory,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }

  // Handle network/timeout errors
  if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: SettingsErrorType.DATABASE_ERROR,
          message: "Database connection failed",
          details: {
            code: error.code,
          },
          category: settingsCategory,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }

  // Handle unknown errors
  return NextResponse.json(
    {
      success: false,
      error: {
        type: "UNKNOWN_ERROR",
        message: "An unexpected error occurred",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
        category: settingsCategory,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 500 }
  );
}

// Validation helper functions
export function validateUserId(userId: any): string {
  if (!userId || typeof userId !== "string") {
    throw new SettingsValidationError("Valid user ID is required");
  }

  if (!/^[A-Za-z0-9_-]{8,64}$/.test(userId)) {
    throw new SettingsValidationError("Invalid user ID format");
  }

  return userId;
}

export function validateSettingsCategory(category: any): string {
  if (!category || typeof category !== "string") {
    throw new SettingsValidationError("Settings category is required");
  }

  const validCategories = [
    "profile",
    "notifications",
    "security",
    "display",
    "privacy",
    "system",
  ];
  if (!validCategories.includes(category.toLowerCase())) {
    throw new SettingsValidationError(`Invalid settings category: ${category}`);
  }

  return category.toLowerCase();
}

export function validateRequestBody(body: any): any {
  if (!body || typeof body !== "object") {
    throw new SettingsValidationError("Request body is required");
  }

  if (Object.keys(body).length === 0) {
    throw new SettingsValidationError("Request body cannot be empty");
  }

  return body;
}

// Async error wrapper for API routes
export function withSettingsErrorHandling(
  handler: (req: any, ...args: any[]) => Promise<NextResponse>,
  settingsCategory?: string
) {
  return async (req: any, ...args: any[]): Promise<NextResponse> => {
    try {
      return await handler(req, ...args);
    } catch (error) {
      const userId = req.headers?.get("x-user-id") || req.user?.id;
      return handleSettingsError(error, userId, settingsCategory);
    }
  };
}

// Database operation wrapper
export async function withDatabaseErrorHandling<T>(
  operation: () => Promise<T>,
  operationName: string,
  userId?: string,
  settingsCategory?: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(`Database operation failed: ${operationName}`, {
      error: (error as Error)?.message,
      userId,
      settingsCategory,
    });

    if (typeof (error as any)?.code === "string" && (error as any).code.startsWith("P")) {
      throw new SettingsDatabaseError(
        `Database operation failed: ${operationName}`,
        { originalError: (error as Error)?.message },
        userId,
        settingsCategory
      );
    }

    throw error;
  }
}

// Settings operation logger
export function logSettingsOperation(
  operation: string,
  userId: string,
  settingsCategory: string,
  success: boolean,
  details?: any
): void {
  const logData = {
    operation,
    userId,
    settingsCategory,
    success,
    timestamp: new Date().toISOString(),
    details,
  };

  if (success) {

  } else {
    console.error("Settings operation failed:", logData);
  }
}

