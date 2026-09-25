import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { sanitizeUser } from '../../src/utils/sanitize-user.js';
import { AuthService } from '../../src/services/auth.service.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { buildApp } from '../../src/app.js';

describe('M12-P02-T01 sanitizeUser', () => {
  it('drops passwordHash and keeps the public profile fields', () => {
    const safe = sanitizeUser({
      id: 'user-1',
      email: 'jane@contestos.com',
      name: 'Jane',
      role: Role.CREATOR,
      organizationId: null,
      passwordHash: '$2b$10$should-not-leak',
      createdAt: new Date('2026-09-25T00:00:00.000Z'),
    });

    assert.equal('passwordHash' in safe, false);
    assert.equal(safe.id, 'user-1');
    assert.equal(safe.email, 'jane@contestos.com');
    assert.equal(JSON.stringify(safe).includes('should-not-leak'), false);
  });

  it('login still returns a user when the repository row includes passwordHash', async () => {
    const originalFindByEmail = UserRepository.findByEmail;
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('password123', 4);
    UserRepository.findByEmail = (async () => ({
      id: 'user-1',
      email: 'jane@contestos.com',
      name: 'Jane',
      role: Role.CREATOR,
      organizationId: null,
      passwordHash,
      organization: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as unknown as typeof UserRepository.findByEmail;

    const app = await buildApp();
    await app.ready();
    try {
      const result = await AuthService.login(
        { email: 'jane@contestos.com', password: 'password123' },
        app,
      );
      assert.equal('passwordHash' in result.user, false);
      assert.equal(JSON.stringify(result).includes(passwordHash), false);
      assert.equal(result.user.email, 'jane@contestos.com');
      assert.equal(typeof result.token, 'string');
    } finally {
      UserRepository.findByEmail = originalFindByEmail;
      await app.close();
    }
  });
});
