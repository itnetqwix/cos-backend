import {
  Role,
  ZooteerParticipantStatus,
  ZooteerReportStatus,
  ZooteerRoomStatus,
} from '@prisma/client';
import { parsePaginationParams } from '../utils/pagination.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/response.js';
import { ZooteerAuditRepository } from '../repositories/zooteer-audit.repository.js';
import {
  ZooteerReportRecord,
  zooteerReportDb,
} from '../repositories/zooteer-report.repository.js';
import { zooteerDb } from '../repositories/zooteer-db.js';
import { realtimeContract } from './zooteer-realtime.js';

const NOT_A_PARTICIPANT = 'You are not a participant in this room';

export async function requireOpenActiveMember(userId: string, roomId: string) {
  const room = await zooteerDb().zooteerRoom.findFirst({
    where: { id: roomId, deletedAt: null },
  });
  if (!room) throw new NotFoundError('Room not found');
  if (room.status !== ZooteerRoomStatus.OPEN) throw new ConflictError('Room is closed');
  const member = await zooteerDb().zooteerParticipant.findFirst({
    where: { roomId, userId },
  });
  if (!member || member.status !== ZooteerParticipantStatus.ACTIVE) {
    throw new ForbiddenError(NOT_A_PARTICIPANT);
  }
  return room;
}

export function participantRealtimeContract(userId: string, roomId: string) {
  return requireOpenActiveMember(userId, roomId).then(() => realtimeContract());
}

export async function createAbuseReport(input: {
  reporterId: string;
  roomId: string;
  reportedUserId: string;
  category: ZooteerReportRecord['category'];
  description: string | null;
}) {
  if (input.reporterId === input.reportedUserId) {
    throw new ConflictError('You cannot report yourself');
  }
  await requireOpenActiveMember(input.reporterId, input.roomId);
  const reported = await zooteerDb().zooteerParticipant.findFirst({
    where: { roomId: input.roomId, userId: input.reportedUserId },
  });
  if (!reported) throw new NotFoundError('Reported participant was not found');
  const report = await zooteerReportDb().zooteerAbuseReport.create({
    data: {
      roomId: input.roomId,
      reporterId: input.reporterId,
      reportedUserId: input.reportedUserId,
      category: input.category,
      description: input.description,
      status: ZooteerReportStatus.OPEN,
      reviewedAt: null,
      reviewedById: null,
    },
  });
  await ZooteerAuditRepository.append(zooteerDb(), {
    roomId: input.roomId,
    actorUserId: input.reporterId,
    action: 'REPORT_CREATE',
    metadata: {
      reportId: report.id,
      category: input.category,
      reportedUserId: input.reportedUserId,
    },
  });
  return report;
}

export async function listAbuseReports(query: {
  status?: ZooteerReportStatus;
  page?: number;
  limit?: number;
}) {
  const { page, limit, skip } = parsePaginationParams(query);
  const where = query.status ? { status: query.status } : {};
  const [items, totalCount] = await Promise.all([
    zooteerReportDb().zooteerAbuseReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    zooteerReportDb().zooteerAbuseReport.count({ where }),
  ]);
  return { items, totalCount, page, limit };
}

export async function reviewAbuseReport(reportId: string, adminId: string, role: Role) {
  if (role !== Role.ADMIN) throw new ForbiddenError('Admin authorization is required');
  return transition(reportId, adminId, ZooteerReportStatus.REVIEWED, 'REPORT_REVIEW');
}

export async function resolveAbuseReport(reportId: string, adminId: string, role: Role) {
  if (role !== Role.ADMIN) throw new ForbiddenError('Admin authorization is required');
  return transition(reportId, adminId, ZooteerReportStatus.RESOLVED, 'REPORT_RESOLVE');
}

async function transition(
  reportId: string,
  adminId: string,
  status: ZooteerReportStatus,
  action: 'REPORT_REVIEW' | 'REPORT_RESOLVE',
): Promise<ZooteerReportRecord> {
  const current = await zooteerReportDb().zooteerAbuseReport.findFirst({
    where: { id: reportId },
  });
  if (!current) throw new NotFoundError('Report not found');
  if (
    status === ZooteerReportStatus.REVIEWED &&
    current.status !== ZooteerReportStatus.OPEN
  ) {
    throw new ConflictError('Report cannot be reviewed');
  }
  if (
    status === ZooteerReportStatus.RESOLVED &&
    current.status !== ZooteerReportStatus.OPEN &&
    current.status !== ZooteerReportStatus.REVIEWED
  ) {
    throw new ConflictError('Report cannot be resolved');
  }
  const now = new Date();
  const updated = await zooteerReportDb().zooteerAbuseReport.update({
    where: { id: reportId },
    data: { status, reviewedAt: now, reviewedById: adminId, updatedAt: now },
  });
  await ZooteerAuditRepository.append(zooteerDb(), {
    roomId: current.roomId,
    actorUserId: adminId,
    action,
    metadata: { reportId },
  });
  return updated;
}
