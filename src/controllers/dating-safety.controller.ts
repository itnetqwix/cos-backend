import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { datingActorId, pageOf } from './dating-profile.controller.js';
import {
  datingBlockSchema,
  datingIdParamSchema,
  datingPageQuerySchema,
  datingReportResolveSchema,
  datingReportSchema,
} from '../schemas/dating.schema.js';
import {
  DatingNotificationService,
  DatingSafetyService,
} from '../services/dating-safety.service.js';
import { sendSuccess } from '../utils/response.js';

export class DatingSafetyController {
  static async block(request: FastifyRequest, reply: FastifyReply) {
    const body = datingBlockSchema.parse(request.body ?? {});
    const data = await DatingSafetyService.block(datingActorId(request), body.profileId);
    return sendSuccess(reply, data, 'Profile blocked', HTTP_STATUS.CREATED);
  }

  static async unblock(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const data = await DatingSafetyService.unblock(datingActorId(request), id);
    return sendSuccess(reply, data, 'Block removed', HTTP_STATUS.OK);
  }

  static async listBlocks(request: FastifyRequest, reply: FastifyReply) {
    const data = await DatingSafetyService.listBlocks(datingActorId(request));
    return sendSuccess(reply, data, 'Blocks retrieved', HTTP_STATUS.OK);
  }

  static async report(request: FastifyRequest, reply: FastifyReply) {
    const body = datingReportSchema.parse(request.body ?? {});
    const data = await DatingSafetyService.report(datingActorId(request), body);
    return sendSuccess(reply, data, 'Report filed', HTTP_STATUS.CREATED);
  }

  static async listNotifications(request: FastifyRequest, reply: FastifyReply) {
    const query = datingPageQuerySchema.parse(request.query ?? {});
    const { page, limit } = pageOf(query);
    const data = await DatingNotificationService.list(
      datingActorId(request),
      page,
      limit,
    );
    return sendSuccess(reply, data, 'Notifications retrieved', HTTP_STATUS.OK);
  }

  static async readNotification(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const data = await DatingNotificationService.markRead(datingActorId(request), id);
    return sendSuccess(reply, data, 'Notification marked read', HTTP_STATUS.OK);
  }

  static async readAllNotifications(request: FastifyRequest, reply: FastifyReply) {
    const data = await DatingNotificationService.markAllRead(datingActorId(request));
    return sendSuccess(reply, data, 'Notifications marked read', HTTP_STATUS.OK);
  }

  static async adminList(request: FastifyRequest, reply: FastifyReply) {
    const query = datingPageQuerySchema.parse(request.query ?? {});
    const { page, limit } = pageOf(query);
    const data = await DatingSafetyService.listReports(
      query.status,
      query.reasonCategory,
      page,
      limit,
    );
    return sendSuccess(reply, data, 'Reports retrieved', HTTP_STATUS.OK);
  }

  static async adminGet(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const data = await DatingSafetyService.getReport(id);
    return sendSuccess(reply, data, 'Report retrieved', HTTP_STATUS.OK);
  }

  static async adminResolve(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const body = datingReportResolveSchema.parse(request.body ?? {});
    const data = await DatingSafetyService.resolveReport(
      datingActorId(request),
      id,
      body,
    );
    return sendSuccess(reply, data, 'Report updated', HTTP_STATUS.OK);
  }

  static async adminBan(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const data = await DatingSafetyService.banProfile(id);
    return sendSuccess(reply, data, 'Dating profile banned', HTTP_STATUS.OK);
  }
}
