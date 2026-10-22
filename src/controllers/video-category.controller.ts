import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  createVideoCategorySchema,
  listVideoCategoriesQuerySchema,
  updateVideoCategorySchema,
  videoCategoryIdParamSchema,
} from '../schemas/video-category.schema.js';
import { VideoCategoryService } from '../services/video-category.service.js';
import { sendPaginated, sendSuccess } from '../utils/response.js';

function actorFromRequest(request: FastifyRequest) {
  return {
    id: request.user.id,
    role: request.user.role,
  };
}

export class VideoCategoryController {
  /**
   * GET /api/v1/video-categories
   * Authenticated. Active official categories only.
   */
  static async listActive(_request: FastifyRequest, reply: FastifyReply) {
    const categories = await VideoCategoryService.listActive();
    return sendSuccess(
      reply,
      categories,
      'Video categories retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * GET /api/v1/admin/video-categories
   */
  static async listAdmin(request: FastifyRequest, reply: FastifyReply) {
    const query = listVideoCategoriesQuerySchema.parse(request.query ?? {});
    const result = await VideoCategoryService.listAdmin(actorFromRequest(request), query);
    return sendPaginated(
      reply,
      result.items,
      result.pagination.totalCount,
      result.pagination.currentPage,
      result.pagination.limit,
      'Video categories retrieved successfully',
    );
  }

  /**
   * POST /api/v1/admin/video-categories
   */
  static async create(request: FastifyRequest, reply: FastifyReply) {
    const body = createVideoCategorySchema.parse(request.body);
    const category = await VideoCategoryService.create(actorFromRequest(request), body);
    return sendSuccess(
      reply,
      category,
      'Video category created successfully',
      HTTP_STATUS.CREATED,
    );
  }

  /**
   * PATCH /api/v1/admin/video-categories/:id
   */
  static async update(request: FastifyRequest, reply: FastifyReply) {
    const params = videoCategoryIdParamSchema.parse(request.params);
    const body = updateVideoCategorySchema.parse(request.body);
    const category = await VideoCategoryService.update(
      actorFromRequest(request),
      params.id,
      body,
    );
    return sendSuccess(
      reply,
      category,
      'Video category updated successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * DELETE /api/v1/admin/video-categories/:id
   */
  static async remove(request: FastifyRequest, reply: FastifyReply) {
    const params = videoCategoryIdParamSchema.parse(request.params);
    const result = await VideoCategoryService.remove(
      actorFromRequest(request),
      params.id,
    );
    return sendSuccess(
      reply,
      result,
      'Video category deleted successfully',
      HTTP_STATUS.OK,
    );
  }
}
