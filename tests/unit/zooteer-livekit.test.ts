import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AccountStatus, Role } from '@prisma/client';
import { AccessToken, TrackSource, WebhookReceiver } from 'livekit-server-sdk';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { setZooteerDb } from '../../src/repositories/zooteer-db.js';
import { createZooteerInvitationSchema } from '../../src/schemas/zooteer-invitation.schema.js';
import { createZooteerRoomSchema } from '../../src/schemas/zooteer-room.schema.js';
import { EmailService } from '../../src/services/email/email.service.js';
import { setZooteerInviteeLookup, ZooteerInvitee } from '../../src/services/zooteer-invitee.js';
import { setZooteerLinkOrigin, ZooteerInvitationService } from '../../src/services/zooteer-invitation.service.js';
import {
  LiveKitGateway,
  participantVideoGrant,
  setLiveKitGateway,
  VerifiedMediaWebhook,
} from '../../src/services/zooteer-livekit.js';
import { applyMediaWebhook, issueMediaToken, retryProviderCleanup } from '../../src/services/zooteer-media.service.js';
import { relayZooteerEvent, resetRelayLimits } from '../../src/services/zooteer-relay.js';
import { DISCONNECT_GRACE_MS } from '../../src/services/zooteer-grace.js';
import { ZooteerRoomService } from '../../src/services/zooteer-room.service.js';
import { AppError, ConflictError, ForbiddenError, ValidationError } from '../../src/utils/response.js';
import { MemoryZooteerDb } from './memory-zooteer-db.js';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const KEY = 'devkey';
const SECRET = 'secretsecretsecretsecretsecretsecret';

class FakeLiveKit implements LiveKitGateway {
  url = 'wss://livekit.test';
  names: string[] = [];
  deleted: string[] = [];
  tokens: { identity: string; room: string }[] = [];
  failCreate = false;
  failDelete = false;

  async createRoom(name: string): Promise<void> {
    if (this.failCreate) throw new Error('livekit down');
    this.names.push(name);
  }

  async deleteRoom(name: string): Promise<void> {
    if (this.failDelete) throw new Error('livekit down');
    this.deleted.push(name);
  }

  async issueToken(input: { identity: string; room: string }): Promise<string> {
    this.tokens.push({ identity: input.identity, room: input.room });
    return `token-for-${input.identity}`;
  }

  async verifyWebhook(body: string, authorization: string | undefined): Promise<VerifiedMediaWebhook | null> {
    if (authorization !== 'signed') throw new Error('bad signature');
    return JSON.parse(body) as VerifiedMediaWebhook;
  }

  sent: Uint8Array[] = [];

  async sendData(_room: string, data: Uint8Array): Promise<void> {
    this.sent.push(data);
  }
}

function user(id: string, verified: boolean): ZooteerInvitee {
  return {
    id,
    email: `${id.slice(0, 8)}@ripskis.test`,
    name: 'Member',
    role: id === ADMIN ? Role.ADMIN : Role.CREATOR,
    accountStatus: AccountStatus.ACTIVE,
    emailVerifiedAt: verified ? new Date('2026-01-01T00:00:00.000Z') : null,
  };
}

describe('PZ-M04 LiveKit', { concurrency: false }, () => {
  const memory = new MemoryZooteerDb();
  const users = new Map<string, ZooteerInvitee>();
  const livekit = new FakeLiveKit();
  let app: FastifyInstance;

  before(async () => {
    setZooteerDb(memory);
    setLiveKitGateway(livekit);
    setZooteerLinkOrigin('https://ripskis.test');
    setZooteerInviteeLookup(async (id) => users.get(id) ?? null);
    users.set(ADMIN, user(ADMIN, true));
    users.set(MEMBER, user(MEMBER, true));
    users.set(OTHER, user(OTHER, false));
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
    setLiveKitGateway(undefined);
    setZooteerInviteeLookup(null);
    setZooteerLinkOrigin(undefined);
    EmailService.setProvider(null);
    await app.close();
  });

  async function admittedRoom(name: string) {
    const room = await ZooteerRoomService.create(
      { id: ADMIN, role: Role.ADMIN },
      createZooteerRoomSchema.parse({ name, maxParticipants: 4 }),
    );
    const invite = await ZooteerInvitationService.create(
      { id: ADMIN, role: Role.ADMIN },
      room.id,
      createZooteerInvitationSchema.parse({ userId: MEMBER }),
    );
    const token = new URL(invite.link).searchParams.get('token');
    assert.ok(token);
    await ZooteerInvitationService.accept({ id: MEMBER, role: Role.CREATOR }, { token });
    return room;
  }

  it('limits token grants to camera and microphone', () => {
    const grant = participantVideoGrant('pz_room');
    assert.deepEqual(grant.canPublishSources, [TrackSource.CAMERA, TrackSource.MICROPHONE]);
    assert.equal(grant.roomRecord, false);
    assert.equal(grant.recorder, false);
    assert.equal(grant.canPublishData, false);
    assert.equal(grant.canPublishSources.includes(TrackSource.SCREEN_SHARE), false);
    assert.equal(DISCONNECT_GRACE_MS, 60_000);
  });

  it('signs a participant token with the official SDK and rejects a bad webhook', async () => {
    const access = new AccessToken(KEY, SECRET, { identity: MEMBER, ttl: 60, name: 'Member' });
    access.addGrant(participantVideoGrant('pz_signed'));
    const jwt = await access.toJwt();
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as {
      sub?: string;
      video?: { room?: string; roomRecord?: boolean; canPublishSources?: string[] };
    };
    assert.equal(payload.sub, MEMBER);
    assert.equal(payload.video?.room, 'pz_signed');
    assert.equal(payload.video?.roomRecord, false);
    assert.deepEqual(payload.video?.canPublishSources, ['camera', 'microphone']);
    assert.equal(jwt.includes(SECRET), false);

    const body = JSON.stringify({
      event: 'participant_left',
      id: 'evt-1',
      createdAt: String(Math.floor(Date.now() / 1000)),
      room: { name: 'pz_signed' },
      participant: { identity: MEMBER },
    });
    const checksum = createHash('sha256').update(body).digest('base64');
    const signed = new AccessToken(KEY, SECRET, { ttl: 60 });
    signed.sha256 = checksum;
    const header = await signed.toJwt();
    const receiver = new WebhookReceiver(KEY, SECRET);
    const verified = await receiver.receive(body, header);
    assert.equal(verified.event, 'participant_left');
    await assert.rejects(() => receiver.receive(body, 'not-a-jwt'));
  });

  it('issues one provider room for an admitted member and rejects everyone else', async () => {
    const room = await admittedRoom('Media');
    const first = await issueMediaToken(MEMBER, room.id);
    const second = await issueMediaToken(MEMBER, room.id);
    assert.equal(first.url, 'wss://livekit.test');
    assert.equal(first.token, `token-for-${MEMBER}`);
    assert.equal(first.token.includes(SECRET), false);
    assert.equal(new Set(livekit.names).size, 1);
    assert.equal(second.token.endsWith(MEMBER), true);
    assert.equal(livekit.tokens.every((row) => row.room === livekit.names[0]), true);

    await assert.rejects(() => issueMediaToken(ADMIN, room.id), ForbiddenError);
    users.set(OTHER, user(OTHER, false));
    await assert.rejects(() => issueMediaToken(OTHER, room.id), (error: unknown) =>
      error instanceof ForbiddenError && /Email verification/.test(error.message),
    );
    users.set(OTHER, user(OTHER, true));
    await assert.rejects(() => issueMediaToken(OTHER, room.id), ForbiddenError);

    await ZooteerRoomService.close({ id: ADMIN, role: Role.ADMIN }, room.id);
    await assert.rejects(() => issueMediaToken(MEMBER, room.id), ConflictError);
    assert.equal(livekit.deleted.includes(livekit.names[0]!), true);
  });

  it('keeps the application room when provider cleanup fails', async () => {
    const room = await admittedRoom('Cleanup');
    await issueMediaToken(MEMBER, room.id);
    livekit.failDelete = true;
    const closed = await ZooteerRoomService.close({ id: ADMIN, role: Role.ADMIN }, room.id);
    livekit.failDelete = false;
    assert.equal(closed.status, 'CLOSED');
    assert.equal(memory.participants.some((row) => row.roomId === room.id), true);
    assert.equal(memory.rooms.find((row) => row.id === room.id)?.status, 'CLOSED');
  });

  it('reuses the participant row across a disconnect and ends it after grace', async () => {
    const room = await admittedRoom('Grace');
    await issueMediaToken(MEMBER, room.id);
    const provider = memory.rooms.find((row) => row.id === room.id)?.livekitRoomName;
    assert.ok(provider);
    const member = memory.participants.find((row) => row.roomId === room.id && row.userId === MEMBER);
    assert.ok(member);
    const leftAt = new Date();
    await applyMediaWebhook({
      id: 'left-1',
      event: 'participant_left',
      roomName: provider,
      identity: MEMBER,
      occurredAt: leftAt,
    });
    await applyMediaWebhook({
      id: 'left-1',
      event: 'participant_left',
      roomName: provider,
      identity: MEMBER,
      occurredAt: leftAt,
    });
    const disconnected = memory.participants.find((row) => row.id === member.id);
    assert.equal(disconnected?.status, 'ACTIVE');
    assert.equal(disconnected?.disconnectedAt?.toISOString(), leftAt.toISOString());

    await applyMediaWebhook({
      id: 'join-1',
      event: 'participant_joined',
      roomName: provider,
      identity: MEMBER,
      occurredAt: new Date(leftAt.getTime() + 1000),
    });
    const rejoined = memory.participants.find((row) => row.id === member.id);
    assert.equal(rejoined?.status, 'ACTIVE');
    assert.equal(rejoined?.disconnectedAt, null);

    rejoined!.disconnectedAt = new Date(Date.now() - DISCONNECT_GRACE_MS - 1000);
    await assert.rejects(() => issueMediaToken(MEMBER, room.id), ForbiddenError);
    assert.equal(
      memory.participants.find((row) => row.id === member.id)?.status,
      'LEFT',
    );
  });

  it('rejects anonymous callers and invalid webhook signatures over HTTP', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: `/api/v1/zooteer/rooms/${ADMIN}/media-token`,
    });
    assert.equal(anon.statusCode, 401);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/zooteer/livekit/webhook',
      headers: { 'content-type': 'application/webhook+json', authorization: 'nope' },
      payload: JSON.stringify({ event: 'participant_left' }),
    });
    assert.equal(bad.statusCode, 401);
    assert.equal(JSON.stringify(JSON.parse(bad.payload)).includes(SECRET), false);

    livekit.failCreate = true;
    const room = await admittedRoom('Outage');
    await assert.rejects(() => issueMediaToken(MEMBER, room.id), (error: unknown) =>
      error instanceof AppError && error.statusCode === 503,
    );
    livekit.failCreate = false;
    assert.equal(memory.rooms.find((row) => row.id === room.id)?.status, 'OPEN');
  });

  it('retries provider cleanup without reopening the room', async () => {
    const room = await admittedRoom('Retry');
    await issueMediaToken(MEMBER, room.id);
    livekit.failDelete = true;
    await ZooteerRoomService.close({ id: ADMIN, role: Role.ADMIN }, room.id);
    await assert.rejects(
      () => ZooteerRoomService.close({ id: ADMIN, role: Role.ADMIN }, room.id),
      ConflictError,
    );
    await assert.rejects(
      () => retryProviderCleanup({ id: ADMIN, role: Role.ADMIN }, room.id),
      (error: unknown) => error instanceof AppError && error.statusCode === 503,
    );
    assert.equal(memory.rooms.find((row) => row.id === room.id)?.status, 'CLOSED');
    livekit.failDelete = false;
    const first = await retryProviderCleanup({ id: ADMIN, role: Role.ADMIN }, room.id);
    const second = await retryProviderCleanup({ id: ADMIN, role: Role.ADMIN }, room.id);
    assert.equal(first.providerCleanup, 'ok');
    assert.equal(second.providerCleanup, 'ok');
    assert.equal(first.roomStatus, 'CLOSED');
    assert.equal(memory.rooms.find((row) => row.id === room.id)?.status, 'CLOSED');
    assert.equal(memory.participants.some((row) => row.roomId === room.id), true);
    assert.ok(memory.audits.some((row) => row.roomId === room.id && row.metadata && (row.metadata as { ok?: boolean }).ok === false));
  });

  it('relays only a valid event from the signed-in member', async () => {
    resetRelayLimits();
    const room = await admittedRoom('Relay');
    await issueMediaToken(MEMBER, room.id);
    const id = '55555555-5555-4555-8555-555555555555';
    const accepted = await relayZooteerEvent({
      userId: MEMBER,
      roomId: room.id,
      body: { v: 1, type: 'chat.message', id, text: 'hello' },
    });
    assert.equal(accepted.type, 'chat.message');
    const sent = JSON.parse(Buffer.from(livekit.sent.at(-1) ?? new Uint8Array()).toString());
    assert.equal(sent.senderId, MEMBER);
    assert.equal(sent.text, 'hello');
    await assert.rejects(
      () =>
        relayZooteerEvent({
          userId: MEMBER,
          roomId: room.id,
          body: { v: 1, type: 'participant.joined', id, userId: OTHER },
        }),
      ValidationError,
    );
    await assert.rejects(
      () =>
        relayZooteerEvent({
          userId: MEMBER,
          roomId: room.id,
          body: { v: 1, type: 'chat.message', id, text: 'x'.repeat(1001) },
        }),
      ValidationError,
    );
    await assert.rejects(
      () => relayZooteerEvent({ userId: OTHER, roomId: room.id, body: { v: 1, type: 'chat.message', id, text: 'nope' } }),
      ForbiddenError,
    );
    await ZooteerRoomService.close({ id: ADMIN, role: Role.ADMIN }, room.id);
    await assert.rejects(
      () => relayZooteerEvent({ userId: MEMBER, roomId: room.id, body: { v: 1, type: 'chat.message', id, text: 'late' } }),
      ConflictError,
    );
    resetRelayLimits();
    const open = await admittedRoom('Burst');
    await issueMediaToken(MEMBER, open.id);
    for (let index = 0; index < 20; index += 1) {
      await relayZooteerEvent({
        userId: MEMBER,
        roomId: open.id,
        now: 1_000,
        body: { v: 1, type: 'reaction.add', id, emoji: '👍' },
      });
    }
    await assert.rejects(
      () =>
        relayZooteerEvent({
          userId: MEMBER,
          roomId: open.id,
          now: 1_000,
          body: { v: 1, type: 'reaction.add', id, emoji: '👍' },
        }),
      (error: unknown) => error instanceof AppError && error.statusCode === 429,
    );
  });
});
