import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import {
  getMyDatingProfileSwaggerSchema,
  listDatingConversationsSwaggerSchema,
  listMatchesSwaggerSchema,
} from '../../src/schemas/dating.schema.js';

test('match and conversation lists stay arrays; profile stays an object', async () => {
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { strict: false, keywords: ['example'] } },
  });
  const match = { id: 'm1', isActive: true, matchedProfile: { displayName: 'Ada' } };
  app.get('/dating/matches', { schema: listMatchesSwaggerSchema }, async () => ({
    success: true,
    message: 'Matches retrieved',
    data: [match],
    errors: null,
  }));
  app.get('/dating/conversations', { schema: listDatingConversationsSwaggerSchema }, async () => ({
    success: true,
    message: 'Conversations retrieved',
    data: [],
    errors: null,
  }));
  app.get('/dating/profile/me', { schema: getMyDatingProfileSwaggerSchema }, async () => ({
    success: true,
    message: 'OK',
    data: { id: 'p1', status: 'ACTIVE' },
    errors: null,
  }));
  await app.ready();

  const matches = JSON.parse((await app.inject({ method: 'GET', url: '/dating/matches' })).body);
  const conversations = JSON.parse(
    (await app.inject({ method: 'GET', url: '/dating/conversations' })).body,
  );
  const profile = JSON.parse((await app.inject({ method: 'GET', url: '/dating/profile/me' })).body);

  assert.equal(matches.data[0].matchedProfile.displayName, 'Ada');
  assert.deepEqual(conversations.data, []);
  assert.equal(profile.data.status, 'ACTIVE');
  await app.close();
});
