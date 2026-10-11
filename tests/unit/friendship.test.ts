import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { FriendshipRepository } from '../../src/repositories/friendship.repository.js';
import { FriendshipService } from '../../src/services/friendship.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../src/utils/response.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STRANGER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ROW_ID = '11111111-1111-4111-8111-111111111111';

const meUser = { id: ME, name: 'Ada', avatarObjectKey: null };
const themUser = { id: THEM, name: 'Bea', avatarObjectKey: null };

function row(status: 'PENDING' | 'ACCEPTED', requesterId: string) {
  return {
    id: ROW_ID,
    userLowId: ME,
    userHighId: THEM,
    requesterId,
    status,
    createdAt: new Date('2026-10-11T00:00:00.000Z'),
    updatedAt: new Date('2026-10-11T00:00:00.000Z'),
    userLow: meUser,
    userHigh: themUser,
  };
}

const originals = {
  findActiveCreator: FriendshipRepository.findActiveCreator,
  searchCreators: FriendshipRepository.searchCreators,
  findPair: FriendshipRepository.findPair,
  findByPairs: FriendshipRepository.findByPairs,
  findById: FriendshipRepository.findById,
  listForUser: FriendshipRepository.listForUser,
  create: FriendshipRepository.create,
  markAccepted: FriendshipRepository.markAccepted,
  deleteById: FriendshipRepository.deleteById,
};

after(() => {
  Object.assign(FriendshipRepository, originals);
});

describe('creator friendships', { concurrency: false }, () => {
  it('stores one ordered pair and rejects a self pair in the migration', () => {
    const schema = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');
    const sql = readFileSync(
      path.join(ROOT, 'prisma/migrations/20261011180000_creator_friendships/migration.sql'),
      'utf8',
    );
    assert.match(schema, /@@unique\(\[userLowId, userHighId\]\)/);
    assert.match(sql, /CREATE TABLE "friendships"/);
    assert.match(sql, /CHECK \("userLowId" < "userHighId"\)/);
    assert.match(sql, /CHECK \("requesterId" = "userLowId" OR "requesterId" = "userHighId"\)/);
    assert.doesNotMatch(sql, /ALTER TABLE "(submissions|ratings|contests|users)"/);
  });

  it('rejects a request to yourself', async () => {
    let lookedUp = false;
    FriendshipRepository.findActiveCreator = async () => {
      lookedUp = true;
      return themUser;
    };
    await assert.rejects(
      () => FriendshipService.sendRequest(ME, ME),
      (error: unknown) => error instanceof ValidationError,
    );
    assert.equal(lookedUp, false);
  });

  it('hides admins and missing creators', async () => {
    FriendshipRepository.findActiveCreator = async () => null;
    await assert.rejects(
      () => FriendshipService.sendRequest(ME, THEM),
      (error: unknown) => error instanceof NotFoundError,
    );
  });

  it('rejects a duplicate pending request and a request between friends', async () => {
    FriendshipRepository.findActiveCreator = async () => themUser;
    FriendshipRepository.findPair = async () => row('PENDING', THEM);
    await assert.rejects(
      () => FriendshipService.sendRequest(ME, THEM),
      (error: unknown) => error instanceof ConflictError && /already exists/.test(error.message),
    );

    FriendshipRepository.findPair = async () => row('ACCEPTED', ME);
    await assert.rejects(
      () => FriendshipService.sendRequest(ME, THEM),
      (error: unknown) => error instanceof ConflictError && /already friends/.test(error.message),
    );
  });

  it('stores a pending request from the sender on the ordered pair', async () => {
    let saved: { userLowId: string; userHighId: string; requesterId: string } | null = null;
    FriendshipRepository.findActiveCreator = async () => themUser;
    FriendshipRepository.findPair = async () => null;
    FriendshipRepository.create = async (data) => {
      saved = data;
      return row('PENDING', data.requesterId);
    };

    const created = await FriendshipService.sendRequest(THEM, ME);
    assert.deepEqual(saved, { userLowId: ME, userHighId: THEM, requesterId: THEM });
    assert.equal(created.status, 'PENDING');
  });

  it('splits accepted friends from incoming and outgoing requests', async () => {
    FriendshipRepository.listForUser = async () => [
      row('ACCEPTED', ME),
      row('PENDING', THEM),
      { ...row('PENDING', ME), id: '22222222-2222-4222-8222-222222222222' },
    ];
    const list = await FriendshipService.list(ME);
    assert.equal(list.friends.length, 1);
    assert.equal(list.friends[0].user.id, THEM);
    assert.equal(list.incoming.length, 1);
    assert.equal(list.incoming[0].direction, 'INCOMING');
    assert.equal(list.outgoing.length, 1);
    assert.equal(list.outgoing[0].direction, 'OUTGOING');
  });

  it('lets only the recipient accept or reject', async () => {
    FriendshipRepository.findById = async () => row('PENDING', THEM);
    let accepted = false;
    let deleted = false;
    FriendshipRepository.markAccepted = async () => {
      accepted = true;
      return row('ACCEPTED', THEM);
    };
    FriendshipRepository.deleteById = async () => {
      deleted = true;
    };

    const acceptedRow = await FriendshipService.accept(ME, ROW_ID);
    assert.equal(accepted, true);
    assert.equal(acceptedRow.status, 'ACCEPTED');

    await assert.rejects(
      () => FriendshipService.accept(THEM, ROW_ID),
      (error: unknown) => error instanceof ForbiddenError,
    );

    await FriendshipService.reject(ME, ROW_ID);
    assert.equal(deleted, true);
    await assert.rejects(
      () => FriendshipService.reject(THEM, ROW_ID),
      (error: unknown) => error instanceof ForbiddenError,
    );
  });

  it('lets only the sender cancel, and either friend remove an accepted row', async () => {
    const deleted: string[] = [];
    FriendshipRepository.deleteById = async (id: string) => {
      deleted.push(id);
    };
    FriendshipRepository.findById = async () => row('PENDING', ME);

    await FriendshipService.cancel(ME, ROW_ID);
    await assert.rejects(
      () => FriendshipService.cancel(THEM, ROW_ID),
      (error: unknown) => error instanceof ForbiddenError,
    );
    await assert.rejects(
      () => FriendshipService.remove(ME, ROW_ID),
      (error: unknown) => error instanceof ConflictError,
    );

    FriendshipRepository.findById = async () => row('ACCEPTED', ME);
    await FriendshipService.remove(THEM, ROW_ID);
    await FriendshipService.remove(ME, ROW_ID);
    assert.deepEqual(deleted, [ROW_ID, ROW_ID, ROW_ID]);
  });

  it('does not reveal a friendship the caller is not part of', async () => {
    FriendshipRepository.findById = async () => row('PENDING', ME);
    await assert.rejects(
      () => FriendshipService.accept(STRANGER, ROW_ID),
      (error: unknown) => error instanceof NotFoundError,
    );
  });

  it('annotates search hits and does not search when the query is empty', async () => {
    let searched = false;
    FriendshipRepository.searchCreators = async () => {
      searched = true;
      return [themUser];
    };
    FriendshipRepository.findByPairs = async () => [row('PENDING', ME)];

    const empty = await FriendshipService.search(ME, '   ');
    assert.deepEqual(empty, []);
    assert.equal(searched, false);

    const hits = await FriendshipService.search(ME, 'be');
    assert.equal(hits[0].relationship, 'OUTGOING');
    assert.equal(hits[0].friendshipId, ROW_ID);
    assert.equal('email' in hits[0], false);
  });
});

describe('creator friendship routes deny guests and admins', { concurrency: false }, () => {
  let app: FastifyInstance;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  const guarded = [
    ['GET', '/api/v1/friends'],
    ['GET', '/api/v1/friends/search?q=ada'],
    ['POST', '/api/v1/friends/requests'],
    ['POST', `/api/v1/friends/requests/${ROW_ID}/accept`],
    ['POST', `/api/v1/friends/requests/${ROW_ID}/reject`],
    ['DELETE', `/api/v1/friends/requests/${ROW_ID}`],
    ['DELETE', `/api/v1/friends/${ROW_ID}`],
  ] as const;

  for (const [method, url] of guarded) {
    it(`${method} ${url} is 401 without a token`, async () => {
      const res = await app.inject({ method, url, payload: { addresseeId: THEM } });
      assert.equal(res.statusCode, 401);
      const body = JSON.parse(res.payload) as { success: boolean; data: null };
      assert.equal(body.success, false);
      assert.equal(body.data, null);
    });

    it(`${method} ${url} is 403 for ADMIN`, async () => {
      const token = app.jwt.sign({
        id: ME,
        email: 'admin@ripskis.com',
        role: Role.ADMIN,
      });
      const res = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
        payload: { addresseeId: THEM },
      });
      assert.equal(res.statusCode, 403);
      const body = JSON.parse(res.payload) as { success: boolean; message: string };
      assert.equal(body.success, false);
      assert.match(body.message, /Forbidden/);
    });
  }

  it('registers friend routes on the creator guard', () => {
    const routes = readFileSync(path.join(ROOT, 'src/routes/index.ts'), 'utf8');
    const start = routes.indexOf('// Creator friends.');
    const end = routes.indexOf('// User listing is ADMIN only.');
    const block = routes.slice(start, end);
    assert.match(block, /authorizeRoles\(Role\.CREATOR\)|onRequest: creatorGuards/);
    assert.equal(block.match(/onRequest: creatorGuards/g)?.length, 7);
    assert.doesNotMatch(block, /Role\.ADMIN/);
  });
});
