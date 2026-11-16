import { ZooteerParticipantStatus, ZooteerRoomEventType } from '@prisma/client';
import { ZooteerAuditRepository } from '../repositories/zooteer-audit.repository.js';
import { ZooteerDb } from '../repositories/zooteer-db.js';

/** Approved disconnect grace. There is no background timer. */
export const DISCONNECT_GRACE_MS = 60_000;

/**
 * Marks ACTIVE rows LEFT once their disconnect is older than the grace window.
 * Called inside a room lock on media-token and invitation accept.
 * A quiet room keeps the seat until the next one of those operations.
 */
export async function expireDisconnects(
  tx: ZooteerDb,
  roomId: string,
  now: Date,
): Promise<void> {
  const rows = await tx.zooteerParticipant.findMany({
    where: { roomId, status: ZooteerParticipantStatus.ACTIVE },
  });
  for (const row of rows) {
    if (!row.disconnectedAt) continue;
    const elapsed = now.getTime() - row.disconnectedAt.getTime();
    if (elapsed < DISCONNECT_GRACE_MS) continue;
    const leftAt = new Date(row.disconnectedAt.getTime() + DISCONNECT_GRACE_MS);
    await tx.zooteerParticipant.update({
      where: { id: row.id },
      data: {
        status: ZooteerParticipantStatus.LEFT,
        leftAt,
        updatedAt: now,
      },
    });
    await tx.zooteerRoomEvent.create({
      data: {
        roomId,
        actorUserId: row.userId,
        type: ZooteerRoomEventType.PARTICIPANT_GRACE_EXPIRED,
        payload: { participantId: row.id, leftAt: leftAt.toISOString() },
      },
    });
    await ZooteerAuditRepository.append(tx, {
      roomId,
      actorUserId: row.userId,
      action: 'MEDIA_CLEANUP',
      reason: 'Disconnect grace elapsed',
      metadata: { participantId: row.id },
    });
  }
}
