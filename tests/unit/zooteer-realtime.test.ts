import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AccountStatus, Role, ZooteerReportStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { setZooteerDb } from '../../src/repositories/zooteer-db.js';
import {
  setZooteerReportDb,
  ZooteerReportDb,
  ZooteerReportRecord,
} from '../../src/repositories/zooteer-report.repository.js';
import { createZooteerInvitationSchema } from '../../src/schemas/zooteer-invitation.schema.js';
import { createZooteerRoomSchema } from '../../src/schemas/zooteer-room.schema.js';
import { EmailService } from '../../src/services/email/email.service.js';
import { setZooteerInviteeLookup, ZooteerInvitee } from '../../src/services/zooteer-invitee.js';
import { setZooteerLinkOrigin, ZooteerInvitationService } from '../../src/services/zooteer-invitation.service.js';
import { setLiveKitGateway } from '../../src/services/zooteer-livekit.js';
import { participantVideoGrant } from '../../src/services/zooteer-livekit.js';
import {
  createAbuseReport,
  participantRealtimeContract,
  resolveAbuseReport,
  reviewAbuseReport,
} from '../../src/services/zooteer-report.service.js';
import { MAX_CHAT_CHARS, parseRealtimeEvent, STANDARD_EMOJI } from '../../src/services/zooteer-realtime.js';
import { ZooteerRoomService } from '../../src/services/zooteer-room.service.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../src/utils/response.js';
import { MemoryZooteerDb } from './memory-zooteer-db.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN = '11111111-1111-4111-8111-111111111111';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

class MemoryReports implements ZooteerReportDb {
  rows: ZooteerReportRecord[] = [];
  readonly zooteerAbuseReport: ZooteerReportDb['zooteerAbuseReport'];

  constructor() {
    const self = this;
    this.zooteerAbuseReport = {
      async create({ data }) {
        const now = new Date();
        const row = {
          id: randomUUID(),
          description: null,
          status: ZooteerReportStatus.OPEN,
          reviewedAt: null,
          reviewedById: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        } as ZooteerReportRecord;
        self.rows.push(row);
        return row;
      },
      async findFirst({ where }) {
        return self.rows.find((row) => Object.entries(where).every(([key, value]) => row[key as keyof ZooteerReportRecord] === value)) ?? null;
      },
      async findMany({ where, skip = 0, take }) {
        const rows = self.rows.filter((row) => Object.entries(where).every(([key, value]) => row[key as keyof ZooteerReportRecord] === value));
        return rows.slice(skip, take === undefined ? undefined : skip + take);
      },
      async count({ where }) {
        return self.rows.filter((row) => Object.entries(where).every(([key, value]) => row[key as keyof ZooteerReportRecord] === value)).length;
      },
      async update({ where, data }) {
        const row = self.rows.find((item) => item.id === where.id);
        if (!row) throw new Error('missing report');
        Object.assign(row, data);
        return row;
      },
    };
  }
}

function person(id: string): ZooteerInvitee {
  return {
    id,
    email: `${id.slice(0, 8)}@ripskis.test`,
    name: 'Member',
    role: id === ADMIN ? Role.ADMIN : Role.CREATOR,
    accountStatus: AccountStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('PZ-M05 realtime', { concurrency: false }, () => {
  const memory = new MemoryZooteerDb();
  const reports = new MemoryReports();
  const users = new Map<string, ZooteerInvitee>();
  let app: FastifyInstance;

  before(async () => {
    setZooteerDb(memory);
    setZooteerReportDb(reports);
    setLiveKitGateway(undefined);
    setZooteerLinkOrigin('https://ripskis.test');
    setZooteerInviteeLookup(async (id) => users.get(id) ?? null);
    users.set(ADMIN, person(ADMIN));
    users.set(MEMBER, person(MEMBER));
    users.set(OTHER, person(OTHER));
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
    setZooteerReportDb(null);
    setZooteerInviteeLookup(null);
    setZooteerLinkOrigin(undefined);
    EmailService.setProvider(null);
    await app.close();
  });

  it('rejects invalid chat and emoji without a message table', () => {
    const schema = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');
    assert.doesNotMatch(schema, /model ZooteerChat|zooteer_chat/);
    assert.match(schema, /model ZooteerAbuseReport/);
    const service = readFileSync(path.join(ROOT, 'src/services/zooteer-realtime.ts'), 'utf8');
    assert.doesNotMatch(service, /logger|prisma|audit/i);
    const id = randomUUID();
    const parsed = parseRealtimeEvent({ v: 1, type: 'chat.message', id, text: '  hello  ' });
    assert.equal(parsed.type === 'chat.message' && parsed.text, 'hello');
    assert.throws(() => parseRealtimeEvent({ v: 1, type: 'chat.message', id, text: '   ' }), ValidationError);
    assert.throws(
      () => parseRealtimeEvent({ v: 1, type: 'chat.message', id, text: 'a'.repeat(MAX_CHAT_CHARS + 1) }),
      ValidationError,
    );
    assert.throws(
      () => parseRealtimeEvent({ v: 1, type: 'chat.message', id, text: 'hi', senderId: MEMBER }),
      ValidationError,
    );
    assert.throws(
      () => parseRealtimeEvent({ v: 1, type: 'reaction.add', id, emoji: '💀' }),
      ValidationError,
    );
    const reaction = parseRealtimeEvent({ v: 1, type: 'reaction.add', id, emoji: STANDARD_EMOJI[0] });
    assert.equal(reaction.type, 'reaction.add');
    const grant = participantVideoGrant('pz_room');
    assert.equal(grant.canPublishData, false);
    assert.equal(grant.roomRecord, false);
    assert.equal(grant.canPublishSources.some((source) => String(source).includes('SCREEN')), false);
  });

  it('gives the contract only to an admitted member and stores a report without the chat text', async () => {
    const room = await ZooteerRoomService.create(
      { id: ADMIN, role: Role.ADMIN },
      createZooteerRoomSchema.parse({ name: 'Chat' }),
    );
    await assert.rejects(() => participantRealtimeContract(MEMBER, room.id), ForbiddenError);
    const invite = await ZooteerInvitationService.create(
      { id: ADMIN, role: Role.ADMIN },
      room.id,
      createZooteerInvitationSchema.parse({ userId: MEMBER }),
    );
    const otherInvite = await ZooteerInvitationService.create(
      { id: ADMIN, role: Role.ADMIN },
      room.id,
      createZooteerInvitationSchema.parse({ userId: OTHER }),
    );
    await ZooteerInvitationService.accept(
      { id: MEMBER, role: Role.CREATOR },
      { token: new URL(invite.link).searchParams.get('token')! },
    );
    await ZooteerInvitationService.accept(
      { id: OTHER, role: Role.CREATOR },
      { token: new URL(otherInvite.link).searchParams.get('token')! },
    );
    const contract = await participantRealtimeContract(MEMBER, room.id);
    assert.equal(contract.history, false);
    assert.equal(contract.transport, 'server-relay');
    const secret = 'quoted chat must not enter the audit log';
    const report = await createAbuseReport({
      reporterId: MEMBER,
      roomId: room.id,
      reportedUserId: OTHER,
      category: 'HARASSMENT',
      description: secret,
    });
    assert.equal(report.description, secret);
    const audit = memory.audits.find((row) => row.action === 'REPORT_CREATE');
    assert.ok(audit);
    assert.equal(JSON.stringify(audit.metadata).includes(secret), false);
    assert.equal(JSON.stringify(memory.events).includes(secret), false);
    await reviewAbuseReport(report.id, ADMIN, Role.ADMIN);
    const resolved = await resolveAbuseReport(report.id, ADMIN, Role.ADMIN);
    assert.equal(resolved.status, 'RESOLVED');
    await ZooteerRoomService.close({ id: ADMIN, role: Role.ADMIN }, room.id);
    assert.equal(reports.rows.some((row) => row.id === report.id), true);
    await assert.rejects(() => participantRealtimeContract(MEMBER, room.id), ConflictError);
  });

  it('rejects a creator reading reports and an anonymous contract call', async () => {
    const creator = app.jwt.sign({ id: MEMBER, email: 'member@ripskis.test', role: Role.CREATOR });
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/zooteer/reports',
      headers: { authorization: `Bearer ${creator}` },
    });
    assert.equal(listed.statusCode, 403);
    const adminToken = app.jwt.sign({ id: ADMIN, email: 'admin@ripskis.test', role: Role.ADMIN });
    const adminList = await app.inject({
      method: 'GET',
      url: '/api/v1/zooteer/reports?page=1&limit=20',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminList.statusCode, 200);
    const body = adminList.json() as {
      success: boolean;
      data: { items: unknown; pagination: { totalCount: number } };
      errors: null;
    };
    assert.equal(body.success, true);
    assert.equal(body.errors, null);
    assert.ok(Array.isArray(body.data.items));
    assert.equal(typeof body.data.pagination.totalCount, 'number');
    const anon = await app.inject({
      method: 'GET',
      url: `/api/v1/zooteer/rooms/${ADMIN}/realtime`,
    });
    assert.equal(anon.statusCode, 401);
    const routes = readFileSync(path.join(ROOT, 'src/routes/index.ts'), 'utf8');
    assert.match(routes, /zooteerReportRateLimit/);
    assert.match(routes, /\/pledge/);
    assert.match(routes, /\/counter/);
  });
});
