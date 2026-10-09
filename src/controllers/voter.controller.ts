import { FastifyReply, FastifyRequest } from 'fastify';
import { voterParamsSchema } from '../schemas/judging.schema.js';
import { VoterService } from '../services/voter.service.js';
import { parsePaginationParams, PaginationQuery } from '../utils/pagination.js';
import { sendPaginated } from '../utils/response.js';

export class VoterController {
  /**
   * GET /api/v1/submissions/:id/voters
   * Public. Approved submissions only. Scoped to that submission's ratings.
   */
  static async list(request: FastifyRequest, reply: FastifyReply) {
    const { id } = voterParamsSchema.parse(request.params);
    const { page, limit } = parsePaginationParams(request.query as PaginationQuery);
    const { items, total } = await VoterService.listForSubmission(id, page, limit);
    return sendPaginated(
      reply,
      items,
      total,
      page,
      limit,
      'Voters retrieved successfully',
    );
  }
}
