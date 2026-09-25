import { FastifyReply, FastifyRequest } from 'fastify';
import { ContestRecord } from '../repositories/contest.repository.js';
import { ContestService } from '../services/contest.service.js';
import {
  contestIdParamSchema,
  createContestSchema,
  listContestsQuerySchema,
  updateContestSchema,
} from '../schemas/contest.schema.js';
import { sendSuccess } from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';

function actorFromRequest(request: FastifyRequest) {
  return {
    role: request.user.role,
    organizationId: request.user.organizationId,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toContestView(contest: ContestRecord) {
  return {
    id: contest.id,
    organizationId: contest.organizationId,
    organization: contest.organization,
    categoryId: contest.categoryId,
    category: contest.category,
    title: contest.title,
    description: contest.description,
    status: contest.status,
    startDate: iso(contest.startDate),
    endDate: iso(contest.endDate),
    prizeSummary: contest.prizeSummary,
    rules: contest.rules,
    autoAdvanceDelayMs: contest.autoAdvanceDelayMs,
    createdAt: iso(contest.createdAt),
    updatedAt: iso(contest.updatedAt),
  };
}

export class ContestController {
  /**
   * GET /api/v1/contests
   */
  static async list(request: FastifyRequest, reply: FastifyReply) {
    const query = listContestsQuerySchema.parse(request.query);
    const contests = await ContestService.list(actorFromRequest(request), query);
    return sendSuccess(
      reply,
      contests.map(toContestView),
      'Contests retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * POST /api/v1/contests
   */
  static async create(request: FastifyRequest, reply: FastifyReply) {
    const body = createContestSchema.parse(request.body);
    const contest = await ContestService.create(actorFromRequest(request), body);
    return sendSuccess(
      reply,
      toContestView(contest),
      'Contest created successfully',
      HTTP_STATUS.CREATED,
    );
  }

  /**
   * GET /api/v1/contests/:id
   */
  static async getById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = contestIdParamSchema.parse(request.params);
    const contest = await ContestService.getById(actorFromRequest(request), id);
    return sendSuccess(
      reply,
      toContestView(contest),
      'Contest retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * PATCH /api/v1/contests/:id
   */
  static async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = contestIdParamSchema.parse(request.params);
    const body = updateContestSchema.parse(request.body);
    const contest = await ContestService.update(actorFromRequest(request), id, body);
    return sendSuccess(
      reply,
      toContestView(contest),
      'Contest updated successfully',
      HTTP_STATUS.OK,
    );
  }
}
