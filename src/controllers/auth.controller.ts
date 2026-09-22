import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from '../services/auth.service.js';
import {
  registerCreatorSchema,
  registerBrandSchema,
  loginSchema,
} from '../schemas/auth.schema.js';
import { sendSuccess } from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';

export class AuthController {
  /**
   * Handle Creator registration.
   * POST /api/v1/auth/register/creator
   */
  static async registerCreator(request: FastifyRequest, reply: FastifyReply) {
    const validatedData = registerCreatorSchema.parse(request.body);
    const result = await AuthService.registerCreator(validatedData, request.server);

    return sendSuccess(
      reply,
      result,
      'Creator account created successfully',
      HTTP_STATUS.CREATED,
    );
  }

  /**
   * Handle Brand registration (Organization + Brand Admin).
   * POST /api/v1/auth/register/brand
   */
  static async registerBrand(request: FastifyRequest, reply: FastifyReply) {
    const validatedData = registerBrandSchema.parse(request.body);
    const result = await AuthService.registerBrand(validatedData, request.server);

    return sendSuccess(
      reply,
      result,
      'Brand organization and admin created successfully',
      HTTP_STATUS.CREATED,
    );
  }

  /**
   * Handle User login.
   * POST /api/v1/auth/login
   */
  static async login(request: FastifyRequest, reply: FastifyReply) {
    const validatedData = loginSchema.parse(request.body);
    const result = await AuthService.login(validatedData, request.server);

    return sendSuccess(reply, result, 'Login successful', HTTP_STATUS.OK);
  }

  /**
   * Handle authenticated user retrieval.
   * GET /api/v1/auth/me
   */
  static async getMe(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;
    const user = await AuthService.getCurrentUser(userId);

    return sendSuccess(
      reply,
      user,
      'User profile retrieved successfully',
      HTTP_STATUS.OK,
    );
  }
}
