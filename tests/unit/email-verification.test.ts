import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { EmailVerificationTokenRepository } from '../../src/repositories/email-verification-token.repository.js';
import { AuthService } from '../../src/services/auth.service.js';
import { CreatorActivityService } from '../../src/services/creator-activity.service.js';
import { EmailVerificationService } from '../../src/services/email-verification.service.js';
import { EmailService } from '../../src/services/email/email.service.js';
import { SendEmailOptions } from '../../src/services/email/email-provider.interface.js';
import { ForbiddenError } from '../../src/utils/response.js';

describe('signup email verification', () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
  });

  after(() => {
    EmailService.setProvider(null);
  });

  it('emails a verify link and blocks login until that link is used', async () => {
    const app = await buildApp();
    const passwordHash = await bcrypt.hash('password123', 10);
    const user = {
      id: 'verify-user',
      email: 'verify@contestos.com',
      name: 'Verify User',
      passwordHash,
      role: Role.CREATOR,
      emailVerifiedAt: null as Date | null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let stored: { tokenHash: string; expiresAt: Date; usedAt: Date | null } | null = null;
    const sent: SendEmailOptions[] = [];

    const originalFind = UserRepository.findByEmail;
    const originalMark = UserRepository.markEmailVerified;
    const originalCreate = EmailVerificationTokenRepository.create;
    const originalInvalidate = EmailVerificationTokenRepository.invalidateAllForUser;
    const originalFindToken = EmailVerificationTokenRepository.findValidByTokenHash;
    const originalMarkUsed = EmailVerificationTokenRepository.markUsed;
    const originalActivity = CreatorActivityService.record;
    CreatorActivityService.record = async () => ({}) as never;

    UserRepository.findByEmail = (async () => user) as unknown as typeof UserRepository.findByEmail;
    UserRepository.markEmailVerified = (async () => {
      user.emailVerifiedAt = new Date();
      return user;
    }) as unknown as typeof UserRepository.markEmailVerified;
    EmailVerificationTokenRepository.invalidateAllForUser = async () => ({ count: 0 });
    EmailVerificationTokenRepository.create = (async (data) => {
      stored = { tokenHash: data.tokenHash, expiresAt: data.expiresAt, usedAt: null };
      return { id: 'tok-1', ...stored, userId: data.userId, createdAt: new Date() };
    }) as unknown as typeof EmailVerificationTokenRepository.create;
    EmailVerificationTokenRepository.findValidByTokenHash = (async (hash) => {
      if (!stored || stored.tokenHash !== hash || stored.usedAt) return null;
      return { id: 'tok-1', userId: user.id, ...stored, createdAt: new Date() };
    }) as unknown as typeof EmailVerificationTokenRepository.findValidByTokenHash;
    EmailVerificationTokenRepository.markUsed = (async () => {
      if (stored) stored.usedAt = new Date();
      return stored;
    }) as unknown as typeof EmailVerificationTokenRepository.markUsed;
    EmailService.setProvider({
      name: 'test',
      isConfigured: () => true,
      async sendEmail(options) {
        sent.push(options);
        return { delivered: true, provider: 'test' };
      },
    });

    try {
      await assert.rejects(
        () => AuthService.login({ email: user.email, password: 'password123' }, app),
        (err: unknown) => err instanceof ForbiddenError,
      );

      await EmailVerificationService.sendForUser(user);
      const token = sent[0].text.match(/token=([a-f0-9]+)/)?.[1];
      assert.ok(token);
      assert.match(sent[0].html, /verify-email/);

      const verified = await EmailVerificationService.verifyEmail(token);
      assert.equal(verified.verified, true);
      assert.ok(user.emailVerifiedAt);

      const session = await AuthService.login({ email: user.email, password: 'password123' }, app);
      assert.equal(session.user.email, user.email);
      assert.equal((session.user as { passwordHash?: string }).passwordHash, undefined);
    } finally {
      UserRepository.findByEmail = originalFind;
      UserRepository.markEmailVerified = originalMark;
      EmailVerificationTokenRepository.create = originalCreate;
      EmailVerificationTokenRepository.invalidateAllForUser = originalInvalidate;
      EmailVerificationTokenRepository.findValidByTokenHash = originalFindToken;
      EmailVerificationTokenRepository.markUsed = originalMarkUsed;
      CreatorActivityService.record = originalActivity;
      EmailService.setProvider(null);
      await app.close();
    }
  });
});
