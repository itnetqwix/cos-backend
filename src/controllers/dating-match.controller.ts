import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { datingActorId, pageOf } from './dating-profile.controller.js';
import {
  datingIdParamSchema,
  datingLikeSchema,
  datingPageQuerySchema,
  datingPassSchema,
  datingUnmatchSchema,
} from '../schemas/dating.schema.js';
import { DatingDiscoveryService } from '../services/dating-discovery.service.js';
import { DatingMatchService } from '../services/dating-match.service.js';
import { sendSuccess } from '../utils/response.js';

export class DatingMatchController {
  static async discover(request: FastifyRequest, reply: FastifyReply) {
    const query = datingPageQuerySchema.parse(request.query ?? {});
    const { page, limit } = pageOf(query);
    const data = await DatingDiscoveryService.discover(
      datingActorId(request),
      page,
      limit,
    );
    return sendSuccess(reply, data, 'Discover candidates retrieved', HTTP_STATUS.OK);
  }

  static async pass(request: FastifyRequest, reply: FastifyReply) {
    const body = datingPassSchema.parse(request.body ?? {});
    const data = await DatingMatchService.pass(datingActorId(request), body.profileId);
    return sendSuccess(reply, data, 'Profile passed', HTTP_STATUS.OK);
  }

  static async like(request: FastifyRequest, reply: FastifyReply) {
    const body = datingLikeSchema.parse(request.body ?? {});
    const data = await DatingMatchService.like(datingActorId(request), body);
    const message = data.isMatch ? "It's a Match!" : 'Like sent';
    return sendSuccess(reply, data, message, HTTP_STATUS.OK);
  }

  static async received(request: FastifyRequest, reply: FastifyReply) {
    const query = datingPageQuerySchema.parse(request.query ?? {});
    const { page, limit } = pageOf(query);
    const data = await DatingMatchService.listReceived(
      datingActorId(request),
      page,
      limit,
    );
    return sendSuccess(reply, data, 'Received likes retrieved', HTTP_STATUS.OK);
  }

  static async sent(request: FastifyRequest, reply: FastifyReply) {
    const query = datingPageQuerySchema.parse(request.query ?? {});
    const { page, limit } = pageOf(query);
    const data = await DatingMatchService.listSent(datingActorId(request), page, limit);
    return sendSuccess(reply, data, 'Sent likes retrieved', HTTP_STATUS.OK);
  }

  static async list(request: FastifyRequest, reply: FastifyReply) {
    const data = await DatingMatchService.listMatches(datingActorId(request));
    return sendSuccess(reply, data, 'Matches retrieved', HTTP_STATUS.OK);
  }

  static async get(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const data = await DatingMatchService.getMatch(datingActorId(request), id);
    return sendSuccess(reply, data, 'Match retrieved', HTTP_STATUS.OK);
  }

  static async unmatch(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const body = datingUnmatchSchema.parse(request.body ?? {});
    const data = await DatingMatchService.unmatch(
      datingActorId(request),
      id,
      body.reason,
    );
    return sendSuccess(reply, data, 'Match closed', HTTP_STATUS.OK);
  }
}
