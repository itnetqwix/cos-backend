import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { PasswordResetTokenRepository } from '../../src/repositories/password-reset-token.repository.js';
import { PasswordResetService } from '../../src/services/password-reset.service.js';
import { EmailService } from '../../src/services/email/email.service.js';
import { EmailProvider, SendEmailOptions, SendEmailResult } from '../../src/services/email/email-provider.interface.js';
import { renderPasswordResetEmail } from '../../src/services/email/email-template.js';
import { hashPassword, comparePassword } from '../../src/utils/crypto.js';
import { HTTP_STATUS } from '../../src/config/constants.js';

interface MockResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  user?: any;
}

class TestMockEmailProvider implements EmailProvider {
  name = 'test-mock';
  public sentEmails: SendEmailOptions[] = [];

  isConfigured(): boolean {
    return true;
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    this.sentEmails.push(options);
    return {
      delivered: true,
      messageId: `msg-${Date.now()}`,
      provider: this.name,
    };
  }
}

describe('Password Recovery & Reset Flow', () => {
  let app: FastifyInstance;
  let mockProvider: TestMockEmailProvider;

  const mockUser = {
    id: 'user-uuid-1234',
    email: 'recovery-tester@contestos.com',
    name: 'Recovery Tester',
    role: Role.CREATOR,
    passwordHash: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let tokenStore: MockResetToken[] = [];

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    mockUser.passwordHash = await hashPassword('OldPassword123');

    // Configure test email provider
    mockProvider = new TestMockEmailProvider();
    EmailService.setProvider(mockProvider);

    // Mock UserRepository
    UserRepository.findByEmail = (async (email: string) => {
      if (email.toLowerCase() === mockUser.email.toLowerCase()) {
        return mockUser;
      }
      return null;
    }) as unknown as typeof UserRepository.findByEmail;

    UserRepository.updatePassword = (async (userId: string, newHash: string) => {
      if (userId === mockUser.id) {
        mockUser.passwordHash = newHash;
        return mockUser;
      }
      throw new Error('User not found');
    }) as unknown as typeof UserRepository.updatePassword;

    // Mock PasswordResetTokenRepository
    PasswordResetTokenRepository.create = (async (data: any) => {
      const record: MockResetToken = {
        id: `token-${Date.now()}-${Math.random()}`,
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        usedAt: null,
        createdAt: new Date(),
        user: mockUser,
      };
      tokenStore.push(record);
      return record;
    }) as unknown as typeof PasswordResetTokenRepository.create;

    PasswordResetTokenRepository.findValidByTokenHash = (async (tokenHash: string) => {
      const found = tokenStore.find(
        (t) => t.tokenHash === tokenHash && t.usedAt === null && t.expiresAt > new Date(),
      );
      return found ?? null;
    }) as unknown as typeof PasswordResetTokenRepository.findValidByTokenHash;

    PasswordResetTokenRepository.findByTokenHash = (async (tokenHash: string) => {
      const found = tokenStore.find((t) => t.tokenHash === tokenHash);
      return found ?? null;
    }) as unknown as typeof PasswordResetTokenRepository.findByTokenHash;

    PasswordResetTokenRepository.invalidateAllForUser = (async (userId: string) => {
      let count = 0;
      tokenStore.forEach((t) => {
        if (t.userId === userId && t.usedAt === null) {
          t.usedAt = new Date();
          count++;
        }
      });
      return { count };
    }) as unknown as typeof PasswordResetTokenRepository.invalidateAllForUser;

    PasswordResetTokenRepository.markUsed = (async (id: string) => {
      const found = tokenStore.find((t) => t.id === id);
      if (found) {
        found.usedAt = new Date();
        return found;
      }
      throw new Error('Token not found');
    }) as unknown as typeof PasswordResetTokenRepository.markUsed;

    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    EmailService.setProvider(null);
    await app.close();
  });

  let ipCounter = 1;
  const getNextIp = () => `10.10.0.${ipCounter++}`;

  beforeEach(() => {
    tokenStore = [];
    mockProvider.sentEmails = [];
  });

  describe('1. Forgot Password Request (POST /api/v1/auth/forgot-password)', () => {
    it('returns generic success response for an existing email without revealing account details', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: getNextIp(),
        payload: {
          email: 'recovery-tester@contestos.com',
        },
      });

      assert.equal(res.statusCode, HTTP_STATUS.OK);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.message, 'If an account exists with this email, password reset instructions have been sent.');
      assert.equal(body.data, null);

      // Verify email was dispatched
      assert.equal(mockProvider.sentEmails.length, 1);
      assert.equal(mockProvider.sentEmails[0].to, 'recovery-tester@contestos.com');
      assert.match(mockProvider.sentEmails[0].html, /Reset Your Password/);

      // Verify token in store is hashed (raw token not stored)
      assert.equal(tokenStore.length, 1);
      const stored = tokenStore[0];
      assert.equal(stored.userId, mockUser.id);
      assert.equal(stored.tokenHash.length, 64); // SHA-256 hex is 64 chars
      assert.notEqual(stored.tokenHash, mockProvider.sentEmails[0].html); // tokenHash is not raw
    });

    it('returns the same generic response for non-existent email and sends no email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: getNextIp(),
        payload: {
          email: 'nonexistent-user@contestos.com',
        },
      });

      assert.equal(res.statusCode, HTTP_STATUS.OK);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.message, 'If an account exists with this email, password reset instructions have been sent.');
      assert.equal(body.data, null);

      // No email sent
      assert.equal(mockProvider.sentEmails.length, 0);
      assert.equal(tokenStore.length, 0);
    });

    it('rejects invalid email formats with 400 validation error', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: getNextIp(),
        payload: {
          email: 'not-an-email',
        },
      });

      assert.equal(res.statusCode, HTTP_STATUS.BAD_REQUEST);
      const body = res.json();
      assert.equal(body.success, false);
    });

    it('invalidates previous unused tokens when a new reset request is made', async () => {
      const ip = getNextIp();
      // First request
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: ip,
        payload: { email: mockUser.email },
      });
      assert.equal(tokenStore.length, 1);
      const firstToken = tokenStore[0];
      assert.equal(firstToken.usedAt, null);

      // Second request
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: ip,
        payload: { email: mockUser.email },
      });
      assert.equal(tokenStore.length, 2);

      // First token should now be invalidated (usedAt is not null)
      assert.notEqual(firstToken.usedAt, null);
      // Second token is active
      assert.equal(tokenStore[1].usedAt, null);
    });
  });

  describe('2. Token Verification (GET /api/v1/auth/verify-reset-token)', () => {
    it('returns valid: true for an active, unexpired token', async () => {
      const ip = getNextIp();
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: ip,
        payload: { email: mockUser.email },
      });

      // Extract raw token from reset link in sent email
      const emailContent = mockProvider.sentEmails[0].text;
      const tokenMatch = emailContent.match(/token=([a-f0-9]+)/);
      assert.ok(tokenMatch, 'Raw token found in email text');
      const rawToken = tokenMatch[1];

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/verify-reset-token?token=${rawToken}`,
        remoteAddress: ip,
      });

      assert.equal(res.statusCode, HTTP_STATUS.OK);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.valid, true);
    });

    it('returns 400 for an unknown or malformed token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/verify-reset-token?token=unknown-bogus-token-12345',
        remoteAddress: getNextIp(),
      });

      assert.equal(res.statusCode, HTTP_STATUS.BAD_REQUEST);
      const body = res.json();
      assert.equal(body.success, false);
    });
  });

  describe('3. Password Reset (POST /api/v1/auth/reset-password)', () => {
    it('successfully resets password with a valid token and strong password', async () => {
      const ip = getNextIp();
      // 1. Request reset
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: ip,
        payload: { email: mockUser.email },
      });

      const emailContent = mockProvider.sentEmails[0].text;
      const rawToken = emailContent.match(/token=([a-f0-9]+)/)![1];

      // 2. Perform reset
      const resetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        remoteAddress: ip,
        payload: {
          token: rawToken,
          password: 'NewSecurePassword2026!',
          confirmPassword: 'NewSecurePassword2026!',
        },
      });

      assert.equal(resetRes.statusCode, HTTP_STATUS.OK);
      const resetBody = resetRes.json();
      assert.equal(resetBody.success, true);
      assert.match(resetBody.message, /Password has been reset successfully/);

      // Verify the new password can be compared successfully
      const isNewValid = await comparePassword('NewSecurePassword2026!', mockUser.passwordHash);
      assert.equal(isNewValid, true);

      // Verify the old password is now rejected
      const isOldValid = await comparePassword('OldPassword123', mockUser.passwordHash);
      assert.equal(isOldValid, false);

      // 3. Verify the token cannot be reused (single use enforcement)
      const reuseRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        remoteAddress: ip,
        payload: {
          token: rawToken,
          password: 'AnotherPassword999!',
        },
      });
      assert.equal(reuseRes.statusCode, HTTP_STATUS.BAD_REQUEST);
      const reuseBody = reuseRes.json();
      assert.equal(reuseBody.success, false);
    });

    it('rejects passwords that fail strength criteria (min 8 chars, uppercase, lowercase, number)', async () => {
      const ip = getNextIp();
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: ip,
        payload: { email: mockUser.email },
      });
      const rawToken = mockProvider.sentEmails[0].text.match(/token=([a-f0-9]+)/)![1];

      // Weak: too short
      const shortRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        remoteAddress: ip,
        payload: { token: rawToken, password: 'Pass1' },
      });
      assert.equal(shortRes.statusCode, HTTP_STATUS.BAD_REQUEST);

      // Weak: missing number
      const noNumRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        remoteAddress: ip,
        payload: { token: rawToken, password: 'PasswordOnly' },
      });
      assert.equal(noNumRes.statusCode, HTTP_STATUS.BAD_REQUEST);

      // Weak: missing uppercase
      const noUpperRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        remoteAddress: ip,
        payload: { token: rawToken, password: 'password123' },
      });
      assert.equal(noUpperRes.statusCode, HTTP_STATUS.BAD_REQUEST);
    });

    it('rejects expired tokens', async () => {
      const ip = getNextIp();
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: ip,
        payload: { email: mockUser.email },
      });
      const rawToken = mockProvider.sentEmails[0].text.match(/token=([a-f0-9]+)/)![1];

      // Artificially expire the token
      tokenStore[0].expiresAt = new Date(Date.now() - 1000);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        remoteAddress: ip,
        payload: {
          token: rawToken,
          password: 'NewStrongPassword123',
        },
      });

      assert.equal(res.statusCode, HTTP_STATUS.BAD_REQUEST);
      assert.equal(res.json().success, false);
    });

    it('enforces rate limit after exceeding max reset attempts', async () => {
      const fixedIp = '192.168.100.99';
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/forgot-password',
          remoteAddress: fixedIp,
          payload: { email: mockUser.email },
        });
        assert.equal(res.statusCode, HTTP_STATUS.OK);
      }

      // 6th attempt should be blocked by rate limit
      const blockedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: fixedIp,
        payload: { email: mockUser.email },
      });
      assert.equal(blockedRes.statusCode, HTTP_STATUS.TOO_MANY_REQUESTS);
    });
  });

  describe('4. Email Template & Link Safety', () => {
    it('renders branded HTML and text template with correct expiry information', () => {
      const template = renderPasswordResetEmail({
        name: 'Alex Creator',
        resetUrl: 'https://www.ripskis.com/reset-password?token=sample123',
        expiresInMinutes: 60,
        appName: 'Ripskis',
      });

      assert.match(template.subject, /Reset your password - Ripskis/);
      assert.match(template.html, /Hello Alex Creator,/);
      assert.match(template.html, /60 minutes/);
      assert.match(template.html, /https:\/\/www\.ripskis\.com\/reset-password\?token=sample123/);
      assert.match(template.text, /60 minutes/);
    });
  });
});
