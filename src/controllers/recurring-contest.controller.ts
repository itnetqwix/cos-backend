import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  createRecurringContestSchema,
  recurringContestIdParamSchema,
  updateRecurringContestSchema,
} from '../schemas/recurring-contest.schema.js';
import { RecurringContestService } from '../services/recurring-contest.service.js';
import { ForbiddenError } from '../utils/response.js';
import { sendSuccess } from '../utils/response.js';

function actorId(request: FastifyRequest): string {
  if (!request.user?.id) {
    throw new ForbiddenError('Forbidden: authenticated admin is required');
  }
  return request.user.id;
}

export class RecurringContestController {
  static async list(_request: FastifyRequest, reply: FastifyReply) {
    const data = await RecurringContestService.list();
    return sendSuccess(reply, data, 'Recurring contests retrieved', HTTP_STATUS.OK);
  }

  static async create(request: FastifyRequest, reply: FastifyReply) {
    const input = createRecurringContestSchema.parse(request.body);
    const data = await RecurringContestService.create(actorId(request), input);
    return sendSuccess(reply, data, 'Recurring contest created', HTTP_STATUS.CREATED);
  }

  static async get(request: FastifyRequest, reply: FastifyReply) {
    const { id } = recurringContestIdParamSchema.parse(request.params);
    const data = await RecurringContestService.get(id);
    return sendSuccess(reply, data, 'Recurring contest retrieved', HTTP_STATUS.OK);
  }

  static async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = recurringContestIdParamSchema.parse(request.params);
    const input = updateRecurringContestSchema.parse(request.body ?? {});
    const data = await RecurringContestService.update(actorId(request), id, input);
    return sendSuccess(reply, data, 'Recurring contest updated', HTTP_STATUS.OK);
  }

  static async pause(request: FastifyRequest, reply: FastifyReply) {
    const { id } = recurringContestIdParamSchema.parse(request.params);
    const data = await RecurringContestService.setEnabled(actorId(request), id, false);
    return sendSuccess(reply, data, 'Recurring contest paused', HTTP_STATUS.OK);
  }

  static async resume(request: FastifyRequest, reply: FastifyReply) {
    const { id } = recurringContestIdParamSchema.parse(request.params);
    const data = await RecurringContestService.setEnabled(actorId(request), id, true);
    return sendSuccess(reply, data, 'Recurring contest resumed', HTTP_STATUS.OK);
  }

  static async preview(request: FastifyRequest, reply: FastifyReply) {
    const { id } = recurringContestIdParamSchema.parse(request.params);
    const data = await RecurringContestService.preview(id);
    return sendSuccess(reply, data, 'Next cycle preview', HTTP_STATUS.OK);
  }

  static async cycles(request: FastifyRequest, reply: FastifyReply) {
    const { id } = recurringContestIdParamSchema.parse(request.params);
    const data = await RecurringContestService.cycles(id);
    return sendSuccess(reply, data, 'Generated cycles retrieved', HTTP_STATUS.OK);
  }
}
