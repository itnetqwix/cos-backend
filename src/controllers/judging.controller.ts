import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { JudgingQueueItem, JudgingService } from '../services/judging.service.js';
import {
  contestIdParamSchema,
  rateBodySchema,
  rateParamsSchema,
} from '../schemas/judging.schema.js';
import { sendSuccess } from '../utils/response.js';
import { clientIp } from '../utils/client-ip.js';
import { hashVoterIp } from '../services/voter-ip-hash.js';

function voterFromRequest(request: FastifyRequest) {
  if (!request.user) return null;
  return {
    id: request.user.id,
    role: request.user.role,
  };
}

function toQueueItemView(item: JudgingQueueItem) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    videoUrl: item.videoUrl,
    thumbnailUrl: item.thumbnailUrl,
    durationSeconds: item.durationSeconds,
    tags: item.tags,
    communityScore: item.communityScore,
    totalVotes: item.totalVotes,
    status: item.status,
    category: item.category,
    creator: item.creator,
    createdAt:
      item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
  };
}

export class JudgingController {
  /**
   * GET /api/v1/contests/:id/queue
   * Public. APPROVED submissions for an ACTIVE or JUDGING contest.
   */
  static async queue(request: FastifyRequest, reply: FastifyReply) {
    const { id } = contestIdParamSchema.parse(request.params);
    const queue = await JudgingService.getQueue(id);
    return sendSuccess(
      reply,
      {
        contestId: queue.contestId,
        status: queue.status,
        ratingOpen: queue.ratingOpen,
        autoAdvanceDelayMs: queue.autoAdvanceDelayMs,
        items: queue.items.map(toQueueItemView),
      },
      'Judging queue retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * POST /api/v1/contests/:id/videos/:videoId/rate
   * Auth optional. VIEWER or anonymous. Returns previousScore, newScore, delta, totalVotes.
   */
  static async rate(request: FastifyRequest, reply: FastifyReply) {
    const params = rateParamsSchema.parse(request.params);
    const body = rateBodySchema.parse(request.body ?? {});
    const score = await JudgingService.rateSubmission({
      contestId: params.id,
      videoId: params.videoId,
      rating: body.rating,
      voter: voterFromRequest(request),
      voterFingerprint: body.voterFingerprint ?? null,
      voterIpHash: hashVoterIp(clientIp(request)),
    });
    return sendSuccess(
      reply,
      {
        previousScore: score.previousScore,
        newScore: score.newScore,
        delta: score.delta,
        totalVotes: score.totalVotes,
      },
      'Rating recorded',
      HTTP_STATUS.OK,
    );
  }
}
