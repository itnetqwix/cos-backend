import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccountStatus, Role, ZooteerParticipantStatus } from '@prisma/client';
import { setZooteerDb } from '../../src/repositories/zooteer-db.js';
import { createZooteerInvitationSchema } from '../../src/schemas/zooteer-invitation.schema.js';
import { createZooteerRoomSchema } from '../../src/schemas/zooteer-room.schema.js';
import { EmailService } from '../../src/services/email/email.service.js';
import { ZooteerAccessService } from '../../src/services/zooteer-access.service.js';
import { setZooteerInviteeLookup, ZooteerInvitee } from '../../src/services/zooteer-invitee.js';
import { setZooteerLinkOrigin, ZooteerInvitationService } from '../../src/services/zooteer-invitation.service.js';
import { normalizeRoomCode } from '../../src/services/zooteer-room-code.js';
import { ZooteerRoomService } from '../../src/services/zooteer-room.service.js';
import { MemoryZooteerDb } from './memory-zooteer-db.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN = '11111111-1111-4111-8111-111111111111';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

function invitee(id: string): ZooteerInvitee {
  return {
    id,
    email: `${id.slice(0, 8)}@ripskis.test`,
    name: 'Member',
    role: id === ADMIN ? Role.ADMIN : Role.CREATOR,
    accountStatus: AccountStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function tokenFrom(link: string): string {
  const value = new URL(link).searchParams.get('token');
  assert.ok(value);
  return value;
}

describe('PZ room code and rejoin', { concurrency: false }, () => {
  const memory = new MemoryZooteerDb();

  before(() => {
    setZooteerDb(memory);
    setZooteerLinkOrigin('https://ripskis.test');
    const users = new Map<string, ZooteerInvitee>([
      [ADMIN, invitee(ADMIN)],
      [MEMBER, invitee(MEMBER)],
      [OTHER, invitee(OTHER)],
    ]);
    setZooteerInviteeLookup(async (id) => users.get(id) ?? null);
    EmailService.setProvider({
      name: 'test',
      isConfigured: () => true,
      async sendEmail() {
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

  it('keeps one room id when more invitations are added and rejoins the same membership', async () => {
    assert.equal(normalizeRoomCode('ab23cd45'), 'AB23CD45');
    assert.equal(normalizeRoomCode('short'), null);
    const migration = readFileSync(
      path.join(ROOT, 'prisma/migrations/20261117120000_zooteer_room_code/migration.sql'),
      'utf8',
    );
    assert.match(migration, /zooteer_rooms_code_key/);

    const room = await ZooteerRoomService.create(
      { id: ADMIN, role: Role.ADMIN },
      createZooteerRoomSchema.parse({ name: 'Stable', maxParticipants: 3 }),
    );
    assert.equal(room.code.length, 8);
    const first = await ZooteerInvitationService.create(
      { id: ADMIN, role: Role.ADMIN },
      room.id,
      createZooteerInvitationSchema.parse({ userId: MEMBER }),
    );
    const second = await ZooteerInvitationService.create(
      { id: ADMIN, role: Role.ADMIN },
      room.id,
      createZooteerInvitationSchema.parse({ userId: OTHER }),
    );
    assert.equal(first.invitation.roomId, room.id);
    assert.equal(second.invitation.roomId, room.id);
    assert.equal((await ZooteerRoomService.get({ id: ADMIN, role: Role.ADMIN }, room.id)).code, room.code);

    const entered = await ZooteerAccessService.enter(MEMBER, tokenFrom(first.link));
    assert.equal(entered.state, 'valid');
    assert.equal(entered.roomId, room.id);
    const again = await ZooteerAccessService.enter(MEMBER, room.code);
    assert.equal(again.state, 'accepted');
    assert.equal(again.roomId, room.id);
    assert.equal(again.participantId, entered.participantId);
    assert.equal(memory.participants.filter((row) => row.userId === MEMBER && row.roomId === room.id).length, 1);

    const stranger = await ZooteerAccessService.enter(OTHER, tokenFrom(first.link));
    assert.equal(stranger.state, 'invalid');
    assert.equal(stranger.roomId, null);

    memory.participants.find((row) => row.id === entered.participantId)!.status = ZooteerParticipantStatus.LEFT;
    const rejoined = await ZooteerAccessService.enter(MEMBER, room.code);
    assert.equal(rejoined.state, 'accepted');
    assert.equal(rejoined.participantId, entered.participantId);
    assert.equal(
      memory.participants.find((row) => row.id === entered.participantId)?.status,
      ZooteerParticipantStatus.ACTIVE,
    );
    assert.equal(memory.participants.filter((row) => row.userId === MEMBER && row.roomId === room.id).length, 1);
  });

  it('reports invalid, expired, revoked, closed, full, and not invited', async () => {
    const room = await ZooteerRoomService.create(
      { id: ADMIN, role: Role.ADMIN },
      createZooteerRoomSchema.parse({ name: 'Gates', maxParticipants: 2 }),
    );
    assert.equal((await ZooteerAccessService.enter(MEMBER, 'NOPE')).state, 'invalid');
    assert.equal((await ZooteerAccessService.enter(MEMBER, room.code)).state, 'not_invited');

    const created = await ZooteerInvitationService.create(
      { id: ADMIN, role: Role.ADMIN },
      room.id,
      createZooteerInvitationSchema.parse({ userId: MEMBER }),
    );
    const row = memory.invitations.find((item) => item.id === created.invitation.id)!;
    row.expiresAt = new Date('2000-01-01T00:00:00.000Z');
    assert.equal((await ZooteerAccessService.enter(MEMBER, room.code)).state, 'expired');
    row.expiresAt = new Date(Date.now() + 3_600_000);
    row.revokedAt = new Date();
    assert.equal((await ZooteerAccessService.enter(MEMBER, room.code)).state, 'revoked');

    const open = await ZooteerInvitationService.create(
      { id: ADMIN, role: Role.ADMIN },
      room.id,
      createZooteerInvitationSchema.parse({ userId: OTHER }),
    );
    await ZooteerRoomService.close({ id: ADMIN, role: Role.ADMIN }, room.id, 'done');
    assert.equal((await ZooteerAccessService.enter(OTHER, room.code)).state, 'closed');
    assert.equal(open.invitation.roomId, room.id);

    const tight = await ZooteerRoomService.create(
      { id: ADMIN, role: Role.ADMIN },
      createZooteerRoomSchema.parse({ name: 'Full', maxParticipants: 2 }),
    );
    await ZooteerInvitationService.create(
      { id: ADMIN, role: Role.ADMIN },
      tight.id,
      createZooteerInvitationSchema.parse({ userId: MEMBER }),
    );
    await ZooteerInvitationService.create(
      { id: ADMIN, role: Role.ADMIN },
      tight.id,
      createZooteerInvitationSchema.parse({ userId: OTHER }),
    );
    assert.equal((await ZooteerAccessService.enter(MEMBER, tight.code)).state, 'pending');
    assert.equal((await ZooteerAccessService.enter(OTHER, tight.code)).state, 'full');
  });
});
