import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  approvePledgeVideoSchema,
  listPledgeAuditLogsQuerySchema,
  listPledgeVideosQuerySchema,
  listPublicPledgeVideosQuerySchema,
  pledgeVideoIdParamSchema,
  rejectPledgeVideoSchema,
} from '../schemas/pledge-video.schema.js';
import { PledgeVideoService } from '../services/pledge-video.service.js';
import { sendSuccess } from '../utils/response.js';
import { toAuditLogView } from './moderation.controller.js';

function actorFromRequest(request: FastifyRequest) {
  return {
    id: request.user.id,
    role: request.user.role,
  };
}

export class PledgeVideoController {
  /**
   * GET /api/v1/admin/pledge/videos
   */
  static async list(request: FastifyRequest, reply: FastifyReply) {
    const query = listPledgeVideosQuerySchema.parse(request.query ?? {});
    const result = await PledgeVideoService.listVideos(actorFromRequest(request), query);
    return sendSuccess(
      reply,
      result,
      'Pledge videos retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * GET /api/v1/admin/pledge/videos/metrics
   */
  static async metrics(request: FastifyRequest, reply: FastifyReply) {
    const query = request.query as { contestId?: string } | undefined;
    const result = await PledgeVideoService.getMetrics(
      actorFromRequest(request),
      query?.contestId,
    );
    return sendSuccess(
      reply,
      result,
      'Pledge video metrics retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * GET /api/v1/admin/pledge/videos/:id
   */
  static async getById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = pledgeVideoIdParamSchema.parse(request.params);
    const video = await PledgeVideoService.getVideoById(actorFromRequest(request), id);
    return sendSuccess(
      reply,
      video,
      'Pledge video details retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * GET /api/v1/admin/pledge/videos/:id/playback-url
   */
  static async playbackUrl(request: FastifyRequest, reply: FastifyReply) {
    const { id } = pledgeVideoIdParamSchema.parse(request.params);
    const result = await PledgeVideoService.getPlaybackUrl(actorFromRequest(request), id);
    return sendSuccess(
      reply,
      result,
      'Playback URL generated successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * POST /api/v1/admin/pledge/videos/:id/approve
   */
  static async approve(request: FastifyRequest, reply: FastifyReply) {
    const { id } = pledgeVideoIdParamSchema.parse(request.params);
    const body = approvePledgeVideoSchema.parse(request.body ?? {});
    const video = await PledgeVideoService.approveVideo(
      actorFromRequest(request),
      id,
      body.note,
    );
    return sendSuccess(
      reply,
      video,
      'Pledge video approved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * POST /api/v1/admin/pledge/videos/:id/reject
   */
  static async reject(request: FastifyRequest, reply: FastifyReply) {
    const { id } = pledgeVideoIdParamSchema.parse(request.params);
    const body = rejectPledgeVideoSchema.parse(request.body ?? {});
    const video = await PledgeVideoService.rejectVideo(
      actorFromRequest(request),
      id,
      body.reason,
      body.reasonCode,
    );
    return sendSuccess(reply, video, 'Pledge video rejected', HTTP_STATUS.OK);
  }

  /**
   * GET /api/v1/admin/pledge/videos/audit-logs
   */
  static async auditLogs(request: FastifyRequest, reply: FastifyReply) {
    const query = listPledgeAuditLogsQuerySchema.parse(request.query ?? {});
    const logs = await PledgeVideoService.listAuditLogs(
      actorFromRequest(request),
      query.contestId,
    );
    return sendSuccess(
      reply,
      logs.map(toAuditLogView),
      'Pledge video audit logs retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * GET /api/v1/contests/pledge/videos
   * Public. Returns approved Pledge videos with filters and pagination.
   */
  static async listPublic(request: FastifyRequest, reply: FastifyReply) {
    const query = listPublicPledgeVideosQuerySchema.parse(request.query ?? {});
    const result = await PledgeVideoService.listPublicVideos(query);
    return sendSuccess(
      reply,
      result,
      'Public Pledge videos retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * GET /api/v1/contests/pledge/videos/:id
   * Public. Returns single approved Pledge video details with playback URL.
   */
  static async getPublicById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = pledgeVideoIdParamSchema.parse(request.params);
    const video = await PledgeVideoService.getPublicVideoById(id);
    return sendSuccess(
      reply,
      video,
      'Pledge video details retrieved successfully',
      HTTP_STATUS.OK,
    );
  }
}
