import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const auditInclude = {
  actor: {
    select: {
      id: true,
      name: true,
    },
  },
  submission: {
    select: {
      id: true,
      title: true,
      status: true,
      contest: {
        select: {
          id: true,
          organizationId: true,
        },
      },
      creator: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.AuditLogInclude;

export type AuditLogRecord = Prisma.AuditLogGetPayload<{
  include: typeof auditInclude;
}>;

export interface CreateAuditLogData {
  submissionId: string;
  actorId: string;
  action: AuditAction;
  reason: string | null;
  metadata: Prisma.InputJsonValue | null;
}

/**
 * Append-only audit persistence (M07-P01-T03).
 * No update or delete. Retention / purge is NOT SPECIFIED.
 */
export class AuditLogRepository {
  static async create(
    data: CreateAuditLogData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AuditLogRecord> {
    return tx.auditLog.create({
      data: {
        submissionId: data.submissionId,
        actorId: data.actorId,
        action: data.action,
        reason: data.reason,
        metadata: data.metadata === null ? Prisma.JsonNull : data.metadata,
      },
      include: auditInclude,
    });
  }

  /**
   * organizationId undefined = all tenants (SUPER_ADMIN).
   * Brand admins see logs whose submission contest belongs to their organization.
   * Newest first.
   */
  static async list(organizationId?: string): Promise<AuditLogRecord[]> {
    return prisma.auditLog.findMany({
      where: organizationId ? { submission: { contest: { organizationId } } } : {},
      include: auditInclude,
      orderBy: { createdAt: 'desc' },
    });
  }
}
