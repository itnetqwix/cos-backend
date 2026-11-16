import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccountStatus, Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { setZooteerDb } from '../../src/repositories/zooteer-db.js';
import { ZooteerInvitationRepository } from '../../src/repositories/zooteer-invitation.repository.js';
import { createZooteerInvitationSchema } from '../../src/schemas/zooteer-invitation.schema.js';
import { createZooteerRoomSchema } from '../../src/schemas/zooteer-room.schema.js';
import { EmailService } from '../../src/services/email/email.service.js';
import { admissionWouldExceedCapacity, seatHolders } from '../../src/services/zooteer-capacity.js';
import { setZooteerInviteeLookup, ZooteerInvitee } from '../../src/services/zooteer-invitee.js';
import {
  setZooteerLinkOrigin,
  ZooteerInvitationService,
} from '../../src/services/zooteer-invitation.service.js';
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationTokenHashesMatch,
} from '../../src/services/zooteer-invitation-token.js';
import { ZooteerRoomService } from '../../src/services/zooteer-room.service.js';
import { AppError, ConflictError } from '../../src/utils/response.js';
import { MemoryZooteerDb } from './memory-zooteer-db.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN_A = '11111111-1111-4111-8111-111111111111';
const ADMIN_B = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const UNVERIFIED = '55555555-5555-4555-8555-555555555555';

function admin(id = ADMIN_A) {
  return { id, role: Role.ADMIN };
}

function invitee(id: string, verified: boolean, status = AccountStatus.ACTIVE): ZooteerInvitee {
  return {
    id,
    email: `${id.slice(0, 8)}@ripskis.test`,
    name: 'Member',
    role: id === ADMIN_A ? Role.ADMIN : Role.CREATOR,
    accountStatus: status,
    emailVerifiedAt: verified ? new Date('2026-01-01T00:00:00.000Z') : null,
  };
}

function tokenFrom(link: string): string {
  const value = new URL(link).searchParams.get('token');
  assert.ok(value);
  return value;
}

describe('PZ-M03 invitations', { concurrency: false }, () => {
  const memory = new MemoryZooteerDb();
  const users = new Map<string, ZooteerInvitee>();
  const sent: { to: string; text: string }[] = [];

  before(() => {
    setZooteerDb(memory);
    setZooteerLinkOrigin('https://ripskis.test');
    setZooteerInviteeLookup(async (id) => users.get(id) ?? null);
    users.set(MEMBER, invitee(MEMBER, true));
    users.set(OTHER, invitee(OTHER, true));
    users.set(UNVERIFIED, invitee(UNVERIFIED, false));
    users.set(ADMIN_A, invitee(ADMIN_A, true));
    EmailService.setProvider({
      name: 'test',
      isConfigured: () => true,
      async sendEmail(options) {
        sent.push({ to: options.to, text: options.text });
        return { delivered: true, provider: 'test' };
      },
    });
  });

  after(() => {
    setZooteerDb(null);
    setZooteerInviteeLookup(null);
    setZooteerLinkOrigin(undefined);
    EmailService.setProvider(null);
  });

  it('hashes tokens and counts the host once', () => {
    const raw = generateInvitationToken();
    const hash = hashInvitationToken(raw);
    assert.equal(hash.length, 64);
    assert.notEqual(hash, raw);
    assert.equal(invitationTokenHashesMatch(hash, hashInvitationToken(raw)), true);
    assert.equal(invitationTokenHashesMatch(hash, hashInvitationToken('other-token-value-xxx')), false);
    assert.equal(seatHolders('host', ['host', 'a']).size, 2);
    assert.equal(admissionWouldExceedCapacity('host', ['a'], 'host', 2), false);
    assert.equal(admissionWouldExceedCapacity('host', ['a'], 'b', 2), true);
    assert.equal(admissionWouldExceedCapacity('host', [], 'b', 2), false);
    const migration = readFileSync(
      path.join(ROOT, 'prisma/migrations/20261116210000_zooteer_invitations/migration.sql'),
      'utf8',
    );
    assert.match(migration, /zooteer_invitations_one_usable/);
    assert.equal(createZooteerInvitationSchema.safeParse({ userId: MEMBER, expiresInHours: 0 }).success, false);
    assert.equal(createZooteerInvitationSchema.safeParse({ userId: MEMBER, expiresInHours: 169 }).success, false);
    assert.equal(createZooteerInvitationSchema.parse({ userId: MEMBER }).expiresInHours, 24);
    assert.match(readFileSync(path.join(ROOT, 'src/repositories/zooteer-db.ts'), 'utf8'), /FOR UPDATE/);
    assert.doesNotMatch(
      readFileSync(path.join(ROOT, 'src/services/zooteer-invitation.service.ts'), 'utf8'),
      /logger/,
    );
  });

  it('creates a bound invitation, refuses a duplicate, and keeps history after revoke', async () => {
    const room = await ZooteerRoomService.create(
      admin(),
      createZooteerRoomSchema.parse({ name: 'Landing', maxParticipants: 2 }),
    );
    const created = await ZooteerInvitationService.create(
      admin(),
      room.id,
      createZooteerInvitationSchema.parse({ userId: MEMBER }),
    );
    assert.equal(created.invitation.state, 'active');
    assert.equal(created.email.delivered, true);
    assert.match(created.link, /^https:\/\/ripskis\.test\/zooteer\/invitations\/accept\?token=/);
    const raw = tokenFrom(created.link);
    assert.equal(memory.invitations.some((row) => row.tokenHash === raw), false);
    assert.equal(sent.at(-1)?.text.includes(raw), true);
    assert.equal(created.invitation.expiresAt > new Date().toISOString(), true);

    await assert.rejects(
      () =>
        ZooteerInvitationService.create(
          admin(ADMIN_B),
          room.id,
          createZooteerInvitationSchema.parse({ userId: MEMBER }),
        ),
      (error: unknown) => error instanceof ConflictError && /usable invitation/.test(error.message),
    );

    const revoked = await ZooteerInvitationService.revoke(admin(ADMIN_B), room.id, created.invitation.id);
    assert.equal(revoked.state, 'revoked');
    await assert.rejects(
      () => ZooteerInvitationService.revoke(admin(), room.id, created.invitation.id),
      ConflictError,
    );
    assert.equal(memory.invitations.filter((row) => row.roomId === room.id).length, 1);
  });

  it('rejects unverified, closed, archived, and missing frontend origin', async () => {
    const room = await ZooteerRoomService.create(admin(), createZooteerRoomSchema.parse({ name: 'Gate' }));
    await assert.rejects(
      () =>
        ZooteerInvitationService.create(
          admin(),
          room.id,
          createZooteerInvitationSchema.parse({ userId: UNVERIFIED }),
        ),
      (error: unknown) => error instanceof Error && /Email verification/.test(error.message),
    );
    await ZooteerRoomService.close(admin(), room.id);
    await assert.rejects(
      () =>
        ZooteerInvitationService.create(
          admin(),
          room.id,
          createZooteerInvitationSchema.parse({ userId: MEMBER }),
        ),
      (error: unknown) => error instanceof ConflictError && /closed/i.test(error.message),
    );
    const hidden = await ZooteerRoomService.create(admin(), createZooteerRoomSchema.parse({ name: 'Hidden' }));
    await ZooteerRoomService.archive(admin(), hidden.id);
    await assert.rejects(
      () =>
        ZooteerInvitationService.create(
          admin(),
          hidden.id,
          createZooteerInvitationSchema.parse({ userId: MEMBER }),
        ),
      (error: unknown) => error instanceof Error && /not found/i.test(error.message),
    );
    setZooteerLinkOrigin('');
    const open = await ZooteerRoomService.create(admin(), createZooteerRoomSchema.parse({ name: 'No link' }));
    const before = memory.invitations.length;
    await assert.rejects(
      () =>
        ZooteerInvitationService.create(
          admin(),
          open.id,
          createZooteerInvitationSchema.parse({ userId: MEMBER }),
        ),
      (error: unknown) => error instanceof AppError && error.statusCode === 503,
    );
    assert.equal(memory.invitations.length, before);
    setZooteerLinkOrigin('https://ripskis.test');
  });

  it('accepts only the invited verified account and rolls back when the audit write fails', async () => {
    const room = await ZooteerRoomService.create(
      admin(),
      createZooteerRoomSchema.parse({ name: 'Admit', maxParticipants: 2 }),
    );
    const created = await ZooteerInvitationService.create(
      admin(),
      room.id,
      createZooteerInvitationSchema.parse({ userId: MEMBER, expiresInHours: 24 }),
    );
    const raw = tokenFrom(created.link);
    await assert.rejects(
      () => ZooteerInvitationService.accept({ id: OTHER, role: Role.CREATOR }, { token: raw }),
      (error: unknown) => error instanceof AppError && error.statusCode === 404,
    );
    memory.invitations[memory.invitations.length - 1]!.expiresAt = new Date('2000-01-01T00:00:00.000Z');
    await assert.rejects(
      () => ZooteerInvitationService.accept({ id: MEMBER, role: Role.CREATOR }, { token: raw }),
      (error: unknown) => error instanceof ConflictError && /expired/i.test(error.message),
    );
    memory.invitations[memory.invitations.length - 1]!.expiresAt = new Date(Date.now() + 60_000);
    memory.failNextAudit = true;
    await assert.rejects(
      () => ZooteerInvitationService.accept({ id: MEMBER, role: Role.CREATOR }, { token: raw }),
      /audit write failed/,
    );
    assert.equal(memory.participants.some((row) => row.userId === MEMBER && row.roomId === room.id), false);
    assert.equal(memory.invitations.find((row) => row.id === created.invitation.id)?.acceptedAt, null);

    const accepted = await ZooteerInvitationService.accept(
      { id: MEMBER, role: Role.CREATOR },
      { token: raw },
    );
    assert.equal(accepted.roomId, room.id);
    await assert.rejects(
      () => ZooteerInvitationService.accept({ id: MEMBER, role: Role.CREATOR }, { token: raw }),
      ConflictError,
    );
  });

  it('lets one of two concurrent accepts take the last seat and does not double-count the host', async () => {
    const room = await ZooteerRoomService.create(
      admin(),
      createZooteerRoomSchema.parse({ name: 'Last seat', maxParticipants: 2 }),
    );
    const first = await ZooteerInvitationService.create(
      admin(),
      room.id,
      createZooteerInvitationSchema.parse({ userId: MEMBER }),
    );
    const second = await ZooteerInvitationService.create(
      admin(),
      room.id,
      createZooteerInvitationSchema.parse({ userId: OTHER }),
    );
    const results = await Promise.allSettled([
      ZooteerInvitationService.accept({ id: MEMBER, role: Role.CREATOR }, { token: tokenFrom(first.link) }),
      ZooteerInvitationService.accept({ id: OTHER, role: Role.CREATOR }, { token: tokenFrom(second.link) }),
    ]);
    const ok = results.filter((result) => result.status === 'fulfilled');
    const denied = results.filter((result) => result.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(denied.length, 1);
    assert.match(String((denied[0] as PromiseRejectedResult).reason), /full/i);
    assert.equal(memory.participants.filter((row) => row.roomId === room.id && row.status === 'ACTIVE').length, 1);

    const hostRoom = await ZooteerRoomService.create(
      admin(),
      createZooteerRoomSchema.parse({ name: 'Host seat', maxParticipants: 2 }),
    );
    const hostInvite = await ZooteerInvitationService.create(
      admin(),
      hostRoom.id,
      createZooteerInvitationSchema.parse({ userId: ADMIN_A }),
    );
    await ZooteerInvitationService.accept(admin(), { token: tokenFrom(hostInvite.link) });
    const guest = await ZooteerInvitationService.create(
      admin(),
      hostRoom.id,
      createZooteerInvitationSchema.parse({ userId: MEMBER }),
    );
    const joined = await ZooteerInvitationService.accept(
      { id: MEMBER, role: Role.CREATOR },
      { token: tokenFrom(guest.link) },
    );
    assert.equal(joined.roomId, hostRoom.id);
    assert.equal(seatHolders(ADMIN_A, [ADMIN_A, MEMBER]).size, 2);
  });

  it('reports email failure without claiming delivery and keeps a failed audit from persisting the invite', async () => {
    EmailService.setProvider({
      name: 'down',
      isConfigured: () => false,
      async sendEmail() {
        return { delivered: false, provider: 'down', error: 'No external email provider configured' };
      },
    });
    const room = await ZooteerRoomService.create(admin(), createZooteerRoomSchema.parse({ name: 'Mail' }));
    const created = await ZooteerInvitationService.create(
      admin(),
      room.id,
      createZooteerInvitationSchema.parse({ userId: OTHER }),
    );
    assert.equal(created.email.delivered, false);
    assert.match(created.link, /^https:\/\/ripskis\.test\//);
    const listed = await ZooteerInvitationService.list(admin(ADMIN_B), room.id, {});
    assert.equal(listed.items.some((item) => item.id === created.invitation.id), true);
    assert.equal(JSON.stringify(listed.items).includes('tokenHash'), false);

    memory.failNextAudit = true;
    const before = memory.invitations.length;
    await assert.rejects(
      () =>
        ZooteerInvitationRepository.createWithAudit({
          roomId: room.id,
          inviteeUserId: MEMBER,
          tokenHash: hashInvitationToken(generateInvitationToken()),
          expiresAt: new Date(Date.now() + 3_600_000),
          actorId: ADMIN_A,
          now: new Date(),
        }),
      /audit write failed/,
    );
    assert.equal(memory.invitations.length, before);
    EmailService.setProvider({
      name: 'test',
      isConfigured: () => true,
      async sendEmail(options) {
        sent.push({ to: options.to, text: options.text });
        return { delivered: true, provider: 'test' };
      },
    });
  });
});

describe('PZ-M03 invitation routes', { concurrency: false }, () => {
  const memory = new MemoryZooteerDb();
  const users = new Map<string, ZooteerInvitee>();
  let app: FastifyInstance;

  before(async () => {
    setZooteerDb(memory);
    setZooteerLinkOrigin('https://ripskis.test');
    setZooteerInviteeLookup(async (id) => users.get(id) ?? null);
    users.set(MEMBER, invitee(MEMBER, true));
    users.set(OTHER, invitee(OTHER, true));
    EmailService.setProvider({
      name: 'test',
      isConfigured: () => true,
      async sendEmail() {
        return { delivered: false, provider: 'test', error: 'skipped' };
      },
    });
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    setZooteerDb(null);
    setZooteerInviteeLookup(null);
    setZooteerLinkOrigin(undefined);
    EmailService.setProvider(null);
    await app.close();
  });

  function token(role: Role, id: string): string {
    return app.jwt.sign({ id, email: `${role.toLowerCase()}@ripskis.test`, role });
  }

  it('locks admin routes and lets only the invited account accept', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: `/api/v1/zooteer/rooms/${ADMIN_A}/invitations`,
      payload: { userId: MEMBER },
    });
    assert.equal(anon.statusCode, 401);

    const creator = await app.inject({
      method: 'POST',
      url: `/api/v1/zooteer/rooms/${ADMIN_A}/invitations`,
      headers: { authorization: `Bearer ${token(Role.CREATOR, MEMBER)}` },
      payload: { userId: MEMBER },
    });
    assert.equal(creator.statusCode, 403);

    const roomResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/zooteer/rooms',
      headers: { authorization: `Bearer ${token(Role.ADMIN, ADMIN_A)}` },
      payload: { name: 'Route room', maxParticipants: 4 },
    });
    assert.equal(roomResponse.statusCode, 201);
    const roomId = JSON.parse(roomResponse.payload).data.id as string;

    const invited = await app.inject({
      method: 'POST',
      url: `/api/v1/zooteer/rooms/${roomId}/invitations`,
      headers: { authorization: `Bearer ${token(Role.ADMIN, ADMIN_B)}` },
      payload: { userId: MEMBER },
    });
    assert.equal(invited.statusCode, 201);
    const body = JSON.parse(invited.payload) as {
      success: boolean;
      data: { link: string; email: { delivered: boolean } };
    };
    assert.equal(body.success, true);
    assert.equal(body.data.email.delivered, false);
    assert.equal(JSON.stringify(body).includes('tokenHash'), false);
    const raw = tokenFrom(body.data.link);

    const stolen = await app.inject({
      method: 'POST',
      url: '/api/v1/zooteer/invitations/accept',
      headers: { authorization: `Bearer ${token(Role.CREATOR, OTHER)}` },
      payload: { token: raw, userId: MEMBER },
    });
    assert.equal(stolen.statusCode, 400);

    const transferred = await app.inject({
      method: 'POST',
      url: '/api/v1/zooteer/invitations/accept',
      headers: { authorization: `Bearer ${token(Role.CREATOR, OTHER)}` },
      payload: { token: raw },
    });
    assert.equal(transferred.statusCode, 404);

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/zooteer/invitations/accept',
      headers: { authorization: `Bearer ${token(Role.CREATOR, MEMBER)}` },
      payload: { token: raw },
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(JSON.parse(accepted.payload).data.roomId, roomId);
  });
});
