/**
 * PropertyPro - Property Status Audit Logger Service
 * Comprehensive audit logging for property status changes and synchronization events
 *
 * Backed by the `property_status_audit_logs` Postgres table
 * (Prisma model PropertyStatusAuditLog). `unitChanges` and `metadata`
 * are Json columns.
 */

import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireOrgId } from "@/lib/tenancy/context";
import { PropertyStatus } from "@/types";

export interface PropertyStatusAuditLog {
  _id?: string;
  id?: string;
  propertyId: string;
  propertyName: string;
  eventType: PropertyStatusAuditEventType;
  oldStatus?: PropertyStatus;
  newStatus: PropertyStatus;
  triggeredBy: string;
  triggerSource: PropertyStatusTriggerSource;
  unitChanges?: UnitStatusChange[];
  metadata?: Record<string, any>;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UnitStatusChange {
  unitId: string;
  unitNumber: string;
  oldStatus?: PropertyStatus;
  newStatus: PropertyStatus;
  reason?: string;
}

export enum PropertyStatusAuditEventType {
  STATUS_CHANGE = "status_change",
  SYNC_TRIGGERED = "sync_triggered",
  VALIDATION_FAILED = "validation_failed",
  MANUAL_OVERRIDE = "manual_override",
  BULK_UPDATE = "bulk_update",
  SYSTEM_CORRECTION = "system_correction",
}

export enum PropertyStatusTriggerSource {
  LEASE_ACTIVATION = "lease_activation",
  LEASE_TERMINATION = "lease_termination",
  UNIT_UPDATE = "unit_update",
  MAINTENANCE_REQUEST = "maintenance_request",
  MANUAL_API = "manual_api",
  BULK_OPERATION = "bulk_operation",
  SYSTEM_SYNC = "system_sync",
  VALIDATION_CORRECTION = "validation_correction",
}

export class PropertyAuditLogger {
  private static instance: PropertyAuditLogger;

  public static getInstance(): PropertyAuditLogger {
    if (!PropertyAuditLogger.instance) {
      PropertyAuditLogger.instance = new PropertyAuditLogger();
    }
    return PropertyAuditLogger.instance;
  }

  /**
   * Log a property status change event
   */
  async logStatusChange(
    propertyId: string,
    propertyName: string,
    oldStatus: PropertyStatus | undefined,
    newStatus: PropertyStatus,
    triggeredBy: string,
    triggerSource: PropertyStatusTriggerSource,
    options: {
      unitChanges?: UnitStatusChange[];
      metadata?: Record<string, any>;
      userId?: string;
      sessionId?: string;
      ipAddress?: string;
      userAgent?: string;
    } = {},
  ): Promise<PropertyStatusAuditLog> {
    const savedLog = await db.propertyStatusAuditLog.create({
      data: {
        organizationId: requireOrgId(),
        propertyId,
        propertyName,
        eventType: PropertyStatusAuditEventType.STATUS_CHANGE,
        oldStatus: oldStatus ?? null,
        newStatus,
        triggeredBy,
        triggerSource,
        unitChanges: (options.unitChanges ??
          []) as unknown as Prisma.InputJsonValue,
        metadata: (options.metadata ?? {}) as Prisma.InputJsonValue,
        timestamp: new Date(),
        userId: options.userId ?? null,
        sessionId: options.sessionId ?? null,
        ipAddress: options.ipAddress ?? null,
        userAgent: options.userAgent ?? null,
      },
    });

    return savedLog as unknown as PropertyStatusAuditLog;
  }

  /**
   * Log a synchronization event
   */
  async logSyncEvent(
    propertyId: string,
    propertyName: string,
    eventType: PropertyStatusAuditEventType,
    triggeredBy: string,
    triggerSource: PropertyStatusTriggerSource,
    metadata: Record<string, any> = {},
  ): Promise<PropertyStatusAuditLog> {
    const savedLog = await db.propertyStatusAuditLog.create({
      data: {
        organizationId: requireOrgId(),
        propertyId,
        propertyName,
        eventType,
        newStatus: metadata.newStatus || PropertyStatus.AVAILABLE,
        oldStatus: metadata.oldStatus ?? null,
        triggeredBy,
        triggerSource,
        metadata: metadata as Prisma.InputJsonValue,
        timestamp: new Date(),
      },
    });

    return savedLog as unknown as PropertyStatusAuditLog;
  }

  /**
   * Get audit logs for a specific property
   */
  async getPropertyAuditLogs(
    propertyId: string,
    options: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
      eventTypes?: PropertyStatusAuditEventType[];
      triggerSources?: PropertyStatusTriggerSource[];
    } = {},
  ): Promise<{
    logs: PropertyStatusAuditLog[];
    total: number;
    hasMore: boolean;
  }> {
    const {
      limit = 50,
      offset = 0,
      startDate,
      endDate,
      eventTypes,
      triggerSources,
    } = options;

    const where: Prisma.PropertyStatusAuditLogWhereInput = { propertyId };

    if (startDate || endDate) {
      where.timestamp = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }

    if (eventTypes && eventTypes.length > 0) {
      where.eventType = { in: eventTypes };
    }

    if (triggerSources && triggerSources.length > 0) {
      where.triggerSource = { in: triggerSources };
    }

    const [rows, total] = await Promise.all([
      db.propertyStatusAuditLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip: offset,
        take: limit,
      }),
      db.propertyStatusAuditLog.count({ where }),
    ]);

    // Preserve the legacy populated `userId` shape where a user exists.
    const userIds = Array.from(
      new Set(rows.map((row) => row.userId).filter((id): id is string => !!id)),
    );
    const users =
      userIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          })
        : [];
    const usersById = new Map(users.map((user) => [user.id, user]));

    const logs = rows.map((row) => ({
      ...row,
      userId: (row.userId && usersById.get(row.userId)) || row.userId,
    }));

    return {
      logs: logs as unknown as PropertyStatusAuditLog[],
      total,
      hasMore: offset + rows.length < total,
    };
  }

  /**
   * Get audit statistics
   */
  async getAuditStatistics(
    options: {
      startDate?: Date;
      endDate?: Date;
      propertyIds?: string[];
    } = {},
  ): Promise<{
    totalEvents: number;
    eventsByType: Record<PropertyStatusAuditEventType, number>;
    eventsBySource: Record<PropertyStatusTriggerSource, number>;
    topProperties: Array<{
      propertyId: string;
      propertyName: string;
      eventCount: number;
    }>;
    recentActivity: PropertyStatusAuditLog[];
  }> {
    const { startDate, endDate, propertyIds } = options;

    const where: Prisma.PropertyStatusAuditLogWhereInput = {};
    if (startDate || endDate) {
      where.timestamp = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }
    if (propertyIds && propertyIds.length > 0) {
      where.propertyId = { in: propertyIds };
    }

    const [totalEvents, eventsByType, eventsBySource, topProperties, recentActivity] =
      await Promise.all([
        db.propertyStatusAuditLog.count({ where }),

        db.propertyStatusAuditLog.groupBy({
          by: ["eventType"],
          where,
          _count: { _all: true },
        }),

        db.propertyStatusAuditLog.groupBy({
          by: ["triggerSource"],
          where,
          _count: { _all: true },
        }),

        db.propertyStatusAuditLog.groupBy({
          by: ["propertyId", "propertyName"],
          where,
          _count: { _all: true },
          orderBy: { _count: { propertyId: "desc" } },
          take: 10,
        }),

        db.propertyStatusAuditLog.findMany({
          where,
          orderBy: { timestamp: "desc" },
          take: 20,
        }),
      ]);

    const eventsByTypeMap = Object.values(PropertyStatusAuditEventType).reduce(
      (acc, type) => {
        acc[type] = 0;
        return acc;
      },
      {} as Record<PropertyStatusAuditEventType, number>,
    );

    eventsByType.forEach((item) => {
      eventsByTypeMap[item.eventType as PropertyStatusAuditEventType] =
        item._count._all;
    });

    const eventsBySourceMap = Object.values(PropertyStatusTriggerSource).reduce(
      (acc, source) => {
        acc[source] = 0;
        return acc;
      },
      {} as Record<PropertyStatusTriggerSource, number>,
    );

    eventsBySource.forEach((item) => {
      eventsBySourceMap[item.triggerSource as PropertyStatusTriggerSource] =
        item._count._all;
    });

    return {
      totalEvents,
      eventsByType: eventsByTypeMap,
      eventsBySource: eventsBySourceMap,
      topProperties: topProperties.map((item) => ({
        propertyId: item.propertyId,
        propertyName: item.propertyName,
        eventCount: item._count._all,
      })),
      recentActivity: recentActivity as unknown as PropertyStatusAuditLog[],
    };
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs(retentionDays: number = 365): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await db.propertyStatusAuditLog.deleteMany({
      where: { timestamp: { lt: cutoffDate } },
    });

    return result.count;
  }
}

// Export singleton instance
export const propertyAuditLogger = PropertyAuditLogger.getInstance();
