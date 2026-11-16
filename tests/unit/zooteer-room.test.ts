import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Role, ZooteerParticipantRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { setZooteerDb } from '../../src/repositories/zooteer-db.js';
import { ZooteerParticipantRepository } from '../../src/repositories/zooteer-participant.repository.js';
import { ZooteerRoomRepository } from '../../src/repositories/zooteer-room.repository.js';
import {
  createZooteerRoomSchema,
  listZooteerRoomsQuerySchema,
} from '../../src/schemas/zooteer-room.schema.js';
import { ZOOTEER_ROOM_LIMITS } from '../../src/services/zooteer-room-rules.js';
import { ZooteerRoomService } from '../../src/services/zooteer-room.service.js';
import { ConflictError, NotFoundError } from '../../src/utils/response.js';
import { MemoryZooteerDb } from './memory-zooteer-db.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN_A = '11111111-1111-4111-8111-111111111111';
const ADMIN_B = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

function admin(id = ADMIN_A) {
  return { id, role: Role.ADMIN };
}

function roomInput(name: string, extra: Record<string, unknown> = {}) {
  return createZooteerRoomSchema.parse({ name, ...extra });
}

describe('PZ-M02 schema and validation', () => {
  const schema = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(
    path.join(ROOT, 'prisma/migrations/20261116195000_zooteer_room_foundation/migration.sql'),
    'utf8',
  );

  it('stores only OPEN and CLOSED and one membership per user per room', () => {
    const status = schema.match(/enum ZooteerRoomStatus \{([^}]*)\}/)?.[1] ?? '';
    assert.match(status, /\bOPEN\b/);
    assert.match(status, /\bCLOSED\b/);
    assert.doesNotMatch(status, /DRAFT|FULL|WAITING/);
    assert.match(schema, /@@unique\(\[roomId, userId\]\)/);
    assert.match(schema, /onDelete: Restrict/);
    assert.doesNotMatch(schema, /model ZooteerChat/);
    assert.match(migration, /CHECK \("maxParticipants" >= 2 AND "maxParticipants" <= 20\)/);
    assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/i);
  });

  it('rejects an empty name, a bad capacity, a bad timeout, and a client status', () => {
    assert.equal(createZooteerRoomSchema.safeParse({ name: '   ' }).success, false);
    assert.equal(createZooteerRoomSchema.safeParse({ name: 'x'.repeat(81) }).success, false);
    assert.equal(createZooteerRoomSchema.safeParse({ name: 'Landing', maxParticipants: 1 }).success, false);
    assert.equal(createZooteerRoomSchema.safeParse({ name: 'Landing', maxParticipants: 21 }).success, false);
    assert.equal(
      createZooteerRoomSchema.safeParse({ name: 'Landing', idleTimeoutSeconds: 0 }).success,
      false,
    );
    assert.equal(
      createZooteerRoomSchema.safeParse({ name: 'Landing', idleTimeoutSeconds: 86_401 }).success,
      false,
    );
    assert.equal(createZooteerRoomSchema.safeParse({ name: 'Landing', status: 'CLOSED' }).success, false);
    assert.equal(createZooteerRoomSchema.safeParse({ name: 'Landing', hostId: ADMIN_A }).success, false);
    const parsed = createZooteerRoomSchema.parse({ name: '  Landing  ' });
    assert.equal(parsed.name, 'Landing');
    assert.equal(parsed.maxParticipants, ZOOTEER_ROOM_LIMITS.CAPACITY_DEFAULT);
    assert.equal(parsed.idleTimeoutSeconds, ZOOTEER_ROOM_LIMITS.IDLE_TIMEOUT_DEFAULT_SECONDS);
    assert.equal(listZooteerRoomsQuerySchema.safeParse({ status: 'FULL' }).success, false);
    assert.equal(listZooteerRoomsQuerySchema.parse({ status: 'OPEN', page: '2' }).page, 2);
  });
});

describe('PZ-M02 runtime', { concurrency: false }, () => {
describe('PZ-M02 room repository and service', () => {
  const memory = new MemoryZooteerDb();

  before(() => {
    setZooteerDb(memory);
  });

  after(() => {
    setZooteerDb(null);
  });

  it('creates an OPEN room with an audit row and rolls back when the audit write fails', async () => {
    const room = await ZooteerRoomService.create(admin(), roomInput('Landing', { description: '  ' }));
    assert.equal(room.status, 'OPEN');
    assert.equal(room.maxParticipants, 20);
    assert.equal(room.hostId, ADMIN_A);
    assert.equal(room.createdById, ADMIN_A);
    assert.equal(room.description, null);
    assert.equal(room.activeParticipantCount, 1);
    assert.equal(memory.events.filter((event) => event.type === 'ROOM_CREATED').length, 1);
    assert.equal(memory.audits.filter((row) => row.action === 'ROOM_CREATE').length, 1);

    memory.failNextAudit = true;
    await assert.rejects(
      () => ZooteerRoomRepository.create({
        name: 'Nope',
        description: null,
        maxParticipants: 20,
        idleTimeoutSeconds: 3600,
        actorId: ADMIN_A,
      }),
      /audit write failed/,
    );
    assert.equal(memory.rooms.some((row) => row.name === 'Nope'), false);
    assert.equal(memory.events.length, memory.rooms.length);
    assert.equal(memory.audits.length, memory.rooms.length);
  });

  it('lets any admin close a room once, keeps membership, and hides an archive', async () => {
    const created = await ZooteerRoomService.create(admin(), roomInput('Night'));
    await ZooteerParticipantRepository.create({
      roomId: created.id,
      userId: MEMBER,
      participantRole: ZooteerParticipantRole.PARTICIPANT,
    });
    await assert.rejects(
      () =>
        ZooteerParticipantRepository.create({
          roomId: created.id,
          userId: MEMBER,
          participantRole: ZooteerParticipantRole.PARTICIPANT,
        }),
      ConflictError,
    );

    const closed = await ZooteerRoomService.close(admin(ADMIN_B), created.id, 'done');
    assert.equal(closed.status, 'CLOSED');
    assert.equal(closed.closedById, ADMIN_B);
    assert.equal(memory.participants.filter((row) => row.roomId === created.id).length, 1);
    await assert.rejects(() => ZooteerRoomService.close(admin(), created.id), ConflictError);
    await assert.rejects(
      () => ZooteerParticipantRepository.markLeft(created.id, MEMBER),
      ConflictError,
    );

    const listed = await ZooteerRoomService.list(admin(), { status: 'CLOSED' });
    assert.equal(listed.items.some((room) => room.id === created.id), true);

    await ZooteerRoomService.archive(admin(), created.id);
    const after = await ZooteerRoomService.list(admin(), {});
    assert.equal(after.items.some((room) => room.id === created.id), false);
    await assert.rejects(() => ZooteerRoomService.get(admin(), created.id), NotFoundError);
    assert.equal(memory.participants.some((row) => row.roomId === created.id), true);
    assert.equal(memory.audits.some((row) => row.action === 'ROOM_ARCHIVE' && row.roomId === created.id), true);
    assert.equal(memory.rooms.some((row) => row.id === created.id), true);
  });

  it('updates the same membership row and pages visible rooms', async () => {
    const room = await ZooteerRoomService.create(admin(), roomInput('Pageable', { maxParticipants: 8 }));
    assert.equal(room.maxParticipants, 8);
    const membership = await ZooteerParticipantRepository.create({
      roomId: room.id,
      userId: MEMBER,
      participantRole: ZooteerParticipantRole.HOST,
    });
    const left = await ZooteerParticipantRepository.markLeft(room.id, MEMBER);
    assert.equal(left.id, membership.id);
    assert.equal(left.status, 'LEFT');
    assert.equal(await ZooteerParticipantRepository.countActive(room.id), 0);
    const again = await ZooteerParticipantRepository.update(room.id, MEMBER, {
      status: 'ACTIVE',
      lastJoinedAt: new Date(),
      leftAt: null,
    });
    assert.equal(again.id, membership.id);
    assert.equal(await ZooteerParticipantRepository.countActive(room.id), 1);

    await ZooteerRoomService.create(admin(), roomInput('Second'));
    await ZooteerRoomService.create(admin(), roomInput('Third'));
    const page = await ZooteerRoomService.list(admin(), { page: 1, limit: 2, status: 'OPEN' });
    assert.equal(page.items.length, 2);
    assert.ok(page.totalCount >= 2);
    assert.equal(page.items.every((item) => item.status === 'OPEN'), true);
  });

  it('counts the host once when the host also has an active row', async () => {
    const room = await ZooteerRoomService.create(admin(), roomInput('Seats'));
    assert.equal(room.activeParticipantCount, 1);
    await ZooteerParticipantRepository.create({
      roomId: room.id,
      userId: ADMIN_A,
      participantRole: ZooteerParticipantRole.HOST,
    });
    const withHostRow = await ZooteerRoomService.get(admin(), room.id);
    assert.equal(withHostRow.activeParticipantCount, 1);
    await ZooteerParticipantRepository.create({
      roomId: room.id,
      userId: MEMBER,
      participantRole: ZooteerParticipantRole.PARTICIPANT,
    });
    const withGuest = await ZooteerRoomService.get(admin(), room.id);
    assert.equal(withGuest.activeParticipantCount, 2);
    const listed = await ZooteerRoomService.list(admin(), { status: 'OPEN', limit: 100 });
    assert.equal(listed.items.find((item) => item.id === room.id)?.activeParticipantCount, 2);
  });

  it('refuses a creator at the service', async () => {
    await assert.rejects(
      () => ZooteerRoomService.create({ id: MEMBER, role: Role.CREATOR }, roomInput('No')),
      (error: unknown) => error instanceof Error && /Admin authorization/.test(error.message),
    );
  });
});

describe('PZ-M02 admin routes', { concurrency: false }, () => {
  const memory = new MemoryZooteerDb();
  let app: FastifyInstance;

  before(async () => {
    setZooteerDb(memory);
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    setZooteerDb(null);
    await app.close();
  });

  function token(role: Role, id = ADMIN_A): string {
    return app.jwt.sign({ id, email: `${role.toLowerCase()}@ripskis.com`, role });
  }

  it('rejects anonymous and creator callers and lets an admin create and read', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: '/api/v1/zooteer/rooms',
      payload: { name: 'Closed door' },
    });
    assert.equal(anon.statusCode, 401);
    const anonBody = JSON.parse(anon.payload) as { success: boolean; data: null };
    assert.equal(anonBody.success, false);
    assert.equal(anonBody.data, null);

    const creator = await app.inject({
      method: 'POST',
      url: '/api/v1/zooteer/rooms',
      headers: { authorization: `Bearer ${token(Role.CREATOR, MEMBER)}` },
      payload: { name: 'Closed door' },
    });
    assert.equal(creator.statusCode, 403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/zooteer/rooms',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { name: 'Portal' },
    });
    assert.equal(created.statusCode, 201);
    const body = JSON.parse(created.payload) as {
      success: boolean;
      errors: null;
      data: { id: string; status: string; maxParticipants: number };
    };
    assert.equal(body.success, true);
    assert.equal(body.errors, null);
    assert.equal(body.data.status, 'OPEN');
    assert.equal(body.data.maxParticipants, 20);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/zooteer/rooms',
      headers: { authorization: `Bearer ${token(Role.ADMIN, ADMIN_B)}` },
    });
    assert.equal(listed.statusCode, 200);
    const listBody = JSON.parse(listed.payload) as { data: { items: { id: string }[] } };
    assert.equal(listBody.data.items.some((item) => item.id === body.data.id), true);

    const people = await app.inject({
      method: 'GET',
      url: `/api/v1/zooteer/rooms/${body.data.id}/participants`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
    });
    assert.equal(people.statusCode, 200);
    assert.deepEqual(JSON.parse(people.payload).data, []);

    const tooBig = await app.inject({
      method: 'POST',
      url: '/api/v1/zooteer/rooms',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { name: 'Overflow', maxParticipants: 21 },
    });
    assert.equal(tooBig.statusCode, 400);
  });

  it('keeps pledge, toke, and counter route registrations in place', () => {
    const source = readFileSync(path.join(ROOT, 'src/routes/index.ts'), 'utf8');
    assert.match(source, /\/pledge/);
    assert.match(source, /\/admin\/toke/);
    assert.match(source, /\/counter/);
    assert.match(source, /\/zooteer\/rooms/);
    assert.match(source, /\/zooteer\/invitations\/accept/);
    assert.match(source, /\/zooteer\/rooms\/:roomId\/media-token/);
  });
});
});
