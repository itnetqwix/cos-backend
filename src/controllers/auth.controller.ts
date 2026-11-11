import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from '../services/auth.service.js';
import { PasswordResetService } from '../services/password-reset.service.js';
import {
  forgotPasswordSchema,
  loginSchema,
  presignAvatarSchema,
  registerCreatorSchema,
  resetPasswordSchema,
  updateCreatorProfileSchema,
  verifyResetTokenSchema,
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

  /**
   * PATCH /api/v1/auth/me
   * The user id is the authenticated creator. The body cannot name another user.
   */
  static async updateMe(request: FastifyRequest, reply: FastifyReply) {
    const body = updateCreatorProfileSchema.parse(request.body);
    const user = await AuthService.updateCurrentUser(request.user.id, body);
    return sendSuccess(reply, user, 'Profile updated successfully', HTTP_STATUS.OK);
  }

  /**
   * POST /api/v1/auth/me/avatar/presign
   * Does not persist the image. The client uploads, then PATCH /auth/me stores the key.
   */
  static async presignAvatar(request: FastifyRequest, reply: FastifyReply) {
    const body = presignAvatarSchema.parse(request.body);
    const signed = await AuthService.presignAvatar(request.user.id, body);
    return sendSuccess(
      reply,
      signed,
      'Presigned profile image upload URL created',
      HTTP_STATUS.OK,
    );
  }

  /**
   * Request password reset link.
   * POST /api/v1/auth/forgot-password
   */
  static async forgotPassword(request: FastifyRequest, reply: FastifyReply) {
    const body = forgotPasswordSchema.parse(request.body);
    const result = await PasswordResetService.requestPasswordReset(body.email);
    return sendSuccess(reply, result.data, result.message, HTTP_STATUS.OK);
  }

  /**
   * Reset password with valid token.
   * POST /api/v1/auth/reset-password
   */
  static async resetPassword(request: FastifyRequest, reply: FastifyReply) {
    const body = resetPasswordSchema.parse(request.body);
    const result = await PasswordResetService.resetPassword(body.token, body.password);
    return sendSuccess(reply, result.data, result.message, HTTP_STATUS.OK);
  }

  /**
   * Verify token validity.
   * GET /api/v1/auth/verify-reset-token
   */
  static async verifyResetToken(request: FastifyRequest, reply: FastifyReply) {
    const query = verifyResetTokenSchema.parse(request.query);
    const result = await PasswordResetService.verifyResetToken(query.token);
    return sendSuccess(reply, result, 'Token is valid', HTTP_STATUS.OK);
  }
}
