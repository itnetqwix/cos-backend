import crypto from 'node:crypto';
import { UserRepository } from '../repositories/user.repository.js';
import { PasswordResetTokenRepository } from '../repositories/password-reset-token.repository.js';
import { EmailService } from './email/email.service.js';
import { hashPassword } from '../utils/crypto.js';
import { ValidationError } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export interface RequestResetResult {
  message: string;
  data: null;
}

export interface ResetPasswordResult {
  message: string;
  data: null;
}

export class PasswordResetService {
  /**
   * Hashes a raw token with SHA-256 before database lookup/storage.
   * Raw tokens are never persisted or logged.
   */
  static hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Request a password recovery email.
   * Always returns the same generic message to prevent account existence enumeration.
   */
  static async requestPasswordReset(email: string): Promise<RequestResetResult> {
    const normalizedEmail = email.toLowerCase().trim();
    const genericResponse: RequestResetResult = {
      message:
        'If an account exists with this email, password reset instructions have been sent.',
      data: null,
    };

    try {
      const user = await UserRepository.findByEmail(normalizedEmail);
      if (!user) {
        // Return same generic message without disclosing existence
        return genericResponse;
      }

      // Generate cryptographically secure random token (32 bytes hex = 64 characters)
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

      // Invalidate any previously issued unused tokens for this user
      await PasswordResetTokenRepository.invalidateAllForUser(user.id);

      // Persist only the SHA-256 hash of the token
      await PasswordResetTokenRepository.create({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      // Dispatch reset email
      await EmailService.sendPasswordResetEmail(
        { email: user.email, name: user.name },
        rawToken,
      );
    } catch (err: unknown) {
      // Do not expose internal failures; log error and return generic response
      logger.error('Error during password reset request:', err);
    }

    return genericResponse;
  }

  /**
   * Verify that a reset token is valid, unused, and not expired.
   */
  static async verifyResetToken(rawToken: string): Promise<{ valid: boolean }> {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      throw new ValidationError('Password reset token is required');
    }

    const tokenHash = this.hashToken(rawToken.trim());
    const resetRecord =
      await PasswordResetTokenRepository.findValidByTokenHash(tokenHash);

    if (!resetRecord) {
      throw new ValidationError('Invalid or expired password reset token');
    }

    if (resetRecord.usedAt !== null) {
      throw new ValidationError('This password reset token has already been used');
    }

    if (new Date() > resetRecord.expiresAt) {
      throw new ValidationError('This password reset token has expired');
    }

    return { valid: true };
  }

  /**
   * Complete password reset using token and new password.
   */
  static async resetPassword(
    rawToken: string,
    newPassword: string,
  ): Promise<ResetPasswordResult> {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      throw new ValidationError('Password reset token is required');
    }

    // Validate password complexity
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }
    if (!/[A-Z]/.test(newPassword)) {
      throw new ValidationError('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(newPassword)) {
      throw new ValidationError('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(newPassword)) {
      throw new ValidationError('Password must contain at least one number');
    }

    const tokenHash = this.hashToken(rawToken.trim());
    const resetRecord =
      await PasswordResetTokenRepository.findValidByTokenHash(tokenHash);

    if (!resetRecord) {
      throw new ValidationError('Invalid or expired password reset token');
    }

    if (resetRecord.usedAt !== null) {
      throw new ValidationError('This password reset token has already been used');
    }

    if (new Date() > resetRecord.expiresAt) {
      throw new ValidationError('This password reset token has expired');
    }

    // Hash the new password using existing bcrypt configuration
    const passwordHash = await hashPassword(newPassword);

    // Update user's password
    await UserRepository.updatePassword(resetRecord.userId, passwordHash);

    // Consume the token (single use)
    await PasswordResetTokenRepository.markUsed(resetRecord.id);

    // Invalidate any other pending reset tokens for this user
    await PasswordResetTokenRepository.invalidateAllForUser(resetRecord.userId);

    logger.info(`Password successfully reset for user ID: ${resetRecord.userId}`);

    return {
      message:
        'Password has been reset successfully. You can now sign in with your new password.',
      data: null,
    };
  }
}
