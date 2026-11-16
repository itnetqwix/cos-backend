import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { zooteerRoomIdParamSchema } from '../schemas/zooteer-room.schema.js';
import {
  createZooteerReportSchema,
  listZooteerReportsQuerySchema,
  zooteerReportIdParamSchema,
} from '../schemas/zooteer-report.schema.js';
import { ZooteerReportRecord } from '../repositories/zooteer-report.repository.js';
import {
  createAbuseReport,
  listAbuseReports,
  participantRealtimeContract,
  resolveAbuseReport,
  reviewAbuseReport,
} from '../services/zooteer-report.service.js';
import { relayZooteerEvent } from '../services/zooteer-relay.js';
import { sendPaginated, sendSuccess } from '../utils/response.js';

function view(row: ZooteerReportRecord) {
  return {
    id: row.id,
    roomId: row.roomId,
    reporterId: row.reporterId,
    reportedUserId: row.reportedUserId,
    category: row.category,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

export class ZooteerReportController {
  static async contract(request: FastifyRequest, reply: FastifyReply) {
    const { roomId } = zooteerRoomIdParamSchema.parse(request.params);
    const contract = await participantRealtimeContract(request.user.id, roomId);
    return sendSuccess(reply, contract, 'Realtime contract');
  }

  static async relay(request: FastifyRequest, reply: FastifyReply) {
    const { roomId } = zooteerRoomIdParamSchema.parse(request.params);
    const accepted = await relayZooteerEvent({
      userId: request.user.id,
      roomId,
      body: request.body,
    });
    return sendSuccess(reply, accepted, 'Event accepted');
  }

  static async create(request: FastifyRequest, reply: FastifyReply) {
    const { roomId } = zooteerRoomIdParamSchema.parse(request.params);
    const body = createZooteerReportSchema.parse(request.body ?? {});
    const report = await createAbuseReport({
      reporterId: request.user.id,
      roomId,
      reportedUserId: body.reportedUserId,
      category: body.category,
      description:
        body.description && body.description.length > 0 ? body.description : null,
    });
    return sendSuccess(reply, view(report), 'Report submitted', HTTP_STATUS.CREATED);
  }

  static async list(request: FastifyRequest, reply: FastifyReply) {
    const query = listZooteerReportsQuerySchema.parse(request.query ?? {});
    const result = await listAbuseReports(query);
    return sendPaginated(
      reply,
      result.items.map(view),
      result.totalCount,
      result.page,
      result.limit,
      'Reports retrieved',
    );
  }

  static async review(request: FastifyRequest, reply: FastifyReply) {
    const { reportId } = zooteerReportIdParamSchema.parse(request.params);
    const report = await reviewAbuseReport(reportId, request.user.id, request.user.role);
    return sendSuccess(reply, view(report), 'Report reviewed');
  }

  static async resolve(request: FastifyRequest, reply: FastifyReply) {
    const { reportId } = zooteerReportIdParamSchema.parse(request.params);
    const report = await resolveAbuseReport(reportId, request.user.id, request.user.role);
    return sendSuccess(reply, view(report), 'Report resolved');
  }
}
