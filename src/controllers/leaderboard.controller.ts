import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HTTP_STATUS } from '../config/constants.js';
import { LeaderboardService } from '../services/leaderboard.service.js';
import { PledgeFinalizationService } from '../services/pledge-finalization.service.js';
import { PledgeRecurrenceService } from '../services/pledge-recurrence.service.js';
import {
  getLeaderboardParamsSchema,
  getLeaderboardQuerySchema,
} from '../schemas/leaderboard.schema.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

export class LeaderboardController {
  /**
   * GET /api/v1/contests/:id/leaderboard
   * Public. Ranked APPROVED submissions with podium and optional category filtering.
   */
  static async getLeaderboard(request: FastifyRequest, reply: FastifyReply) {
    const params = getLeaderboardParamsSchema.parse(request.params);
    const query = getLeaderboardQuerySchema.parse(request.query ?? {});

    const leaderboard = await LeaderboardService.getContestLeaderboard(params.id, {
      category: query.category,
      timeframe: query.timeframe,
    });

    return sendSuccess(
      reply,
      leaderboard,
      'Leaderboard retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /** GET /api/v1/contests/pledge/current. Public month, or null when none exists. */
  static async currentPledge(_request: FastifyRequest, reply: FastifyReply) {
    const month = await PledgeRecurrenceService.currentPublic();
    return sendSuccess(reply, month, 'Current Pledge month retrieved', HTTP_STATUS.OK);
  }

  /** GET /api/v1/contests/pledge/months. Public month list for the archive switcher. */
  static async pledgeMonths(_request: FastifyRequest, reply: FastifyReply) {
    const months = await PledgeRecurrenceService.listPublicMonths();
    return sendSuccess(reply, months, 'Pledge months retrieved', HTTP_STATUS.OK);
  }

  /** GET /api/v1/contests/pledge/archive. Public certified snapshots only. */
  static async archive(request: FastifyRequest, reply: FastifyReply) {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .strict()
      .parse(request.query ?? {});
    const page = await PledgeFinalizationService.listPublicArchive(
      query.page,
      query.limit,
    );
    return sendPaginated(
      reply,
      page.items,
      page.pagination.totalCount,
      query.page,
      query.limit,
      'Pledge archive retrieved',
    );
  }
}
