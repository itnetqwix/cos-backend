import { Prisma, ZooteerAuditAction } from '@prisma/client';
import { ZooteerAuditRecord, ZooteerDb } from './zooteer-db.js';

export class ZooteerAuditRepository {
  static async append(
    tx: ZooteerDb,
    input: {
      roomId: string;
      actorUserId: string;
      action: ZooteerAuditAction;
      reason?: string | null;
      metadata?: Prisma.InputJsonValue | null;
    },
  ): Promise<ZooteerAuditRecord> {
    return tx.zooteerAuditLog.create({
      data: {
        roomId: input.roomId,
        actorUserId: input.actorUserId,
        action: input.action,
        reason: input.reason ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  }
}
