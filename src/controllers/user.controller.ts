import { FastifyReply, FastifyRequest } from 'fastify';
import { UserService } from '../services/user.service.js';
import {
  userParamSchema,
  listUsersQuerySchema,
  userPreferencesSchema,
} from '../schemas/user.schema.js';
import { sendSuccess } from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';

export class UserController {
  /**
   * Handle user profile retrieval by ID.
   * GET /api/v1/users/:id
   */
  static async getUserById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = userParamSchema.parse(request.params);
    const user = await UserService.getUserProfile(id);

    return sendSuccess(
      reply,
      user,
      'User profile retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * Handle paginated users query.
   * GET /api/v1/users
   */
  static async listUsers(request: FastifyRequest, reply: FastifyReply) {
    const query = listUsersQuerySchema.parse(request.query);
    const result = await UserService.listUsers(query);

    return sendSuccess(
      reply,
      result,
      'Users list retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * Handle retrieving current authenticated user's preferences.
   * GET /api/v1/users/me/preferences
   */
  static async getMyPreferences(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return;
    const userId = request.user.id;
    const preferences = await UserService.getUserPreferences(userId);

    return sendSuccess(
      reply,
      preferences,
      'User preferences retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * Handle updating current authenticated user's preferences.
   * PATCH /api/v1/users/me/preferences
   */
  static async updateMyPreferences(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return;
    const userId = request.user.id;
    const validatedData = userPreferencesSchema.parse(request.body);
    const updatedPreferences = await UserService.updateUserPreferences(
      userId,
      validatedData,
    );

    return sendSuccess(
      reply,
      updatedPreferences,
      'User preferences updated successfully',
      HTTP_STATUS.OK,
    );
  }
}
