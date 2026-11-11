import crypto from 'node:crypto';
import { EmailVerificationTokenRepository } from '../repositories/email-verification-token.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { ValidationError } from '../utils/response.js';
import { EmailService } from './email/email.service.js';
import { PasswordResetService, RESET_TOKEN_EXPIRY_MS } from './password-reset.service.js';

export class EmailVerificationService {
  static async sendForUser(user: { id: string; email: string; name?: string }) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    await EmailVerificationTokenRepository.invalidateAllForUser(user.id);
    await EmailVerificationTokenRepository.create({
      userId: user.id,
      tokenHash: PasswordResetService.hashToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_EXPIRY_MS),
    });

    const result = await EmailService.sendVerificationEmail(user, rawToken);
    if (!result.delivered) {
      await UserRepository.deleteById(user.id);
      throw new ValidationError('Could not send the verification email. Try again.');
    }
  }

  static async verifyEmail(rawToken: string) {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      throw new ValidationError('Verification token is required');
    }

    const record = await EmailVerificationTokenRepository.findValidByTokenHash(
      PasswordResetService.hashToken(rawToken.trim()),
    );
    if (!record) {
      throw new ValidationError('Invalid or expired verification link');
    }

    await UserRepository.markEmailVerified(record.userId);
    await EmailVerificationTokenRepository.markUsed(record.id);
    return { verified: true as const };
  }
}
