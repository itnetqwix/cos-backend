import { FastifyReply, FastifyRequest } from 'fastify';
import { ContestRecord } from '../repositories/contest.repository.js';
import { ContestService } from '../services/contest.service.js';
import { z } from 'zod';
import {
  contestIdParamSchema,
  createContestSchema,
  listContestsQuerySchema,
  presignContestBannerSchema,
  updateContestSchema,
} from '../schemas/contest.schema.js';
import { sendSuccess } from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';
import { DEFAULT_CONTEST_TIMEZONE } from '../services/contest-schedule.js';
import { PledgeFinalizationService } from '../services/pledge-finalization.service.js';
import { resolveContestBannerUrl } from '../services/storage.service.js';

function actorFromRequest(request: FastifyRequest) {
  return {
    id: request.user.id,
    role: request.user.role,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function toContestView(contest: ContestRecord) {
  const bannerUrl = await resolveContestBannerUrl(
    contest.bannerObjectKey,
    contest.bannerUrl,
  );
  return {
    id: contest.id,
    categoryId: contest.categoryId,
    category: contest.category,
    title: contest.title,
    description: contest.description,
    tagline: contest.tagline,
    bannerUrl,
    bannerObjectKey: contest.bannerObjectKey ?? null,
    thumbnailUrl: contest.thumbnailUrl,
    status: contest.status,
    timezone: contest.timezone || DEFAULT_CONTEST_TIMEZONE,
    startDate: iso(contest.startDate),
    endDate: iso(contest.endDate),
    votingClosesAt: contest.votingClosesAt ? iso(contest.votingClosesAt) : null,
    utcMonthCutoff:
      contest.seriesSlug === 'pledge' && contest.votingClosesAt
        ? iso(contest.votingClosesAt)
        : null,
    prizeSummary: contest.prizeSummary,
    rules: contest.rules,
    autoAdvanceDelayMs: contest.autoAdvanceDelayMs,
    seriesSlug: contest.seriesSlug,
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
      await Promise.all(contests.map((contest) => toContestView(contest))),
      'Contests retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * GET /api/v1/contests/active
   * Public. Deployment organization only.
   */
  static async listDeploymentActive(request: FastifyRequest, reply: FastifyReply) {
    z.object({})
      .strict()
      .parse(request.query ?? {});
    const contests = await ContestService.listActive();
    return sendSuccess(
      reply,
      await Promise.all(contests.map((contest) => toContestView(contest))),
      'Active contests retrieved successfully',
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
      await toContestView(contest),
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
      await toContestView(contest),
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
      await toContestView(contest),
      'Contest updated successfully',
      HTTP_STATUS.OK,
    );
  }

  static async remove(request: FastifyRequest, reply: FastifyReply) {
    const { id } = contestIdParamSchema.parse(request.params);
    const deleted = await ContestService.remove(actorFromRequest(request), id);
    return sendSuccess(reply, deleted, 'Contest deleted successfully', HTTP_STATUS.OK);
  }

  static async listForCreator(request: FastifyRequest, reply: FastifyReply) {
    const contests = await ContestService.listForCreator(actorFromRequest(request));
    return sendSuccess(
      reply,
      await Promise.all(contests.map((contest) => toContestView(contest))),
      'Contests retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async presignBanner(request: FastifyRequest, reply: FastifyReply) {
    const body = presignContestBannerSchema.parse(request.body);
    const signed = await ContestService.presignBanner(actorFromRequest(request), body);
    return sendSuccess(
      reply,
      signed,
      'Presigned contest banner upload URL created',
      HTTP_STATUS.OK,
    );
  }

  static async getForCreator(request: FastifyRequest, reply: FastifyReply) {
    const { id } = contestIdParamSchema.parse(request.params);
    const contest = await ContestService.getForCreator(actorFromRequest(request), id);
    return sendSuccess(
      reply,
      await toContestView(contest),
      'Contest retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async listViewable(_request: FastifyRequest, reply: FastifyReply) {
    const contests = await ContestService.listViewable();
    return sendSuccess(
      reply,
      await Promise.all(contests.map((contest) => toContestView(contest))),
      'Viewable contests retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async finalizeWinners(request: FastifyRequest, reply: FastifyReply) {
    const { id } = contestIdParamSchema.parse(request.params);
    const body = z
      .object({
        submissionIds: z.array(z.string().uuid()).min(1).max(1_000),
      })
      .strict()
      .parse(request.body ?? {});
    const snapshot = await PledgeFinalizationService.selectMonthlyWinners(
      id,
      request.user.id,
      body.submissionIds,
    );
    return sendSuccess(reply, snapshot, 'Pledge winners selected', HTTP_STATUS.OK);
  }

  static async pledgeReview(request: FastifyRequest, reply: FastifyReply) {
    const { id } = contestIdParamSchema.parse(request.params);
    const data = await PledgeFinalizationService.reviewMonth(id);
    return sendSuccess(reply, data, 'Pledge review retrieved', HTTP_STATUS.OK);
  }

  static async saveTeamEvaluation(request: FastifyRequest, reply: FastifyReply) {
    const { id } = contestIdParamSchema.parse(request.params);
    const body = z
      .object({
        submissionId: z.string().uuid(),
        score: z.number().int().min(1).max(10).nullable().optional(),
        notes: z.string().trim().max(2000).optional(),
        nominated: z.boolean().optional(),
      })
      .strict()
      .parse(request.body);
    const data = await PledgeFinalizationService.saveTeamEvaluation(
      id,
      request.user.id,
      body,
    );
    return sendSuccess(reply, data, 'Team evaluation saved', HTTP_STATUS.OK);
  }

  static async correctWinner(request: FastifyRequest, reply: FastifyReply) {
    const { id } = contestIdParamSchema.parse(request.params);
    const body = z
      .object({
        reason: z.string().trim().min(1).max(2000),
        overallSubmissionIds: z.array(z.string().uuid()).min(1).max(20),
      })
      .strict()
      .parse(request.body);
    const snapshot = await PledgeFinalizationService.correctWinner(
      id,
      request.user.id,
      body.reason,
      body.overallSubmissionIds,
    );
    return sendSuccess(reply, snapshot, 'Pledge winners corrected', HTTP_STATUS.OK);
  }

  static async publishWinners(request: FastifyRequest, reply: FastifyReply) {
    const { id } = contestIdParamSchema.parse(request.params);
    const snapshot = await PledgeFinalizationService.publishMonthlyWinners(id);
    return sendSuccess(reply, snapshot, 'Pledge winners published', HTTP_STATUS.OK);
  }
}
