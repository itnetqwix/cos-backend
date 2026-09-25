import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { LeaderboardService } from '../services/leaderboard.service.js';
import {
  getLeaderboardParamsSchema,
  getLeaderboardQuerySchema,
} from '../schemas/leaderboard.schema.js';
import { sendSuccess } from '../utils/response.js';

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
}
