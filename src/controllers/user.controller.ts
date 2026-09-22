import { FastifyReply, FastifyRequest } from 'fastify';
import { UserService } from '../services/user.service.js';
import { userParamSchema, listUsersQuerySchema } from '../schemas/user.schema.js';
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
}
