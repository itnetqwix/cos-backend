import { prisma } from '../config/database.js';
import { Prisma } from '@prisma/client';

export type TokeEntityType =
  'TESTER' | 'APPLICATION' | 'PRODUCT' | 'CATEGORY' | 'PROPOSAL' | 'REVIEW';

export interface CreateTokeAuditInput {
  actorId: string;
  entityType: TokeEntityType | string;
  entityId: string;
  action: string;
  reason?: string | null;
  details?: Record<string, unknown> | null;
}

export interface ListTokeAuditQuery {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  search?: string;
  fromDate?: Date;
  toDate?: Date;
  skip?: number;
  take?: number;
}

export interface TokeAuditRow {
  id: string;
  actorId: string;
  actor: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  entityType: string;
  entityId: string;
  action: string;
  reason: string | null;
  details: unknown | null;
  createdAt: Date;
}

const inMemoryAuditLogs: Array<CreateTokeAuditInput & { id: string; createdAt: Date }> =
  [];

export class TokeAuditRepository {
  /** Record an audit entry. Never throws to avoid failing the primary business operation. */
  static async record(input: CreateTokeAuditInput): Promise<void> {
    inMemoryAuditLogs.push({
      ...input,
      id: Math.random().toString(),
      createdAt: new Date(),
    });
    try {
      await prisma.tokeAuditLog.create({
        data: {
          actorId: input.actorId,
          entityType: input.entityType,
          entityId: input.entityId,
          action: input.action,
          reason: input.reason ?? null,
          details: input.details
            ? (input.details as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        // Primary business transactions must not abort on telemetry / audit logging errors.
        console.error('Failed to record TokeAuditLog:', err);
      }
    }
  }

  static async listPage(
    query: ListTokeAuditQuery,
  ): Promise<{ rows: TokeAuditRow[]; total: number }> {
    const where: Prisma.TokeAuditLogWhereInput = {};

    if (query.entityType) {
      where.entityType = query.entityType;
    }
    if (query.entityId) {
      where.entityId = query.entityId;
    }
    if (query.actorId) {
      where.actorId = query.actorId;
    }
    if (query.action) {
      where.action = query.action;
    }
    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate ? { gte: query.fromDate } : {}),
        ...(query.toDate ? { lte: query.toDate } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: 'insensitive' } },
        { reason: { contains: query.search, mode: 'insensitive' } },
        { entityId: { contains: query.search, mode: 'insensitive' } },
        { actor: { name: { contains: query.search, mode: 'insensitive' } } },
        { actor: { email: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.tokeAuditLog.count({ where }),
      prisma.tokeAuditLog.findMany({
        where,
        skip: query.skip ?? 0,
        take: query.take ?? 20,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        actor: r.actor,
        entityType: r.entityType,
        entityId: r.entityId,
        action: r.action,
        reason: r.reason,
        details: r.details,
        createdAt: r.createdAt,
      })),
    };
  }
}
