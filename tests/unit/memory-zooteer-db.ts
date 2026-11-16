import { randomUUID } from 'node:crypto';
import {
  ZooteerAuditRecord,
  ZooteerDb,
  ZooteerEventRecord,
  ZooteerInvitationRecord,
  ZooteerParticipantRecord,
  ZooteerRoomRecord,
} from '../../src/repositories/zooteer-db.js';

type Row = Record<string, unknown>;

function matches(row: Row, where: Row): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = row[key];
    if (expected && typeof expected === 'object' && 'in' in (expected as Row)) {
      const values = (expected as { in: unknown[] }).in;
      if (!values.includes(actual)) return false;
      continue;
    }
    if (actual instanceof Date && expected instanceof Date) {
      if (actual.getTime() !== expected.getTime()) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function stamp<T extends { id: string; createdAt: Date; updatedAt?: Date }>(
  data: Row,
  withUpdated: boolean,
): T {
  const now = new Date();
  return {
    ...data,
    id: typeof data.id === 'string' ? data.id : randomUUID(),
    createdAt: data.createdAt instanceof Date ? data.createdAt : now,
    ...(withUpdated
      ? { updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now }
      : {}),
  } as T;
}

/**
 * Isolated stand-in for Prisma. Transactions restore a snapshot on throw.
 * Not used outside tests.
 */
export class MemoryZooteerDb implements ZooteerDb {
  rooms: ZooteerRoomRecord[] = [];
  participants: ZooteerParticipantRecord[] = [];
  events: ZooteerEventRecord[] = [];
  audits: ZooteerAuditRecord[] = [];
  invitations: ZooteerInvitationRecord[] = [];
  failNextAudit = false;
  private chain: Promise<void> = Promise.resolve();

  readonly zooteerRoom: ZooteerDb['zooteerRoom'];
  readonly zooteerParticipant: ZooteerDb['zooteerParticipant'];
  readonly zooteerRoomEvent: ZooteerDb['zooteerRoomEvent'];
  readonly zooteerAuditLog: ZooteerDb['zooteerAuditLog'];
  readonly zooteerInvitation: ZooteerDb['zooteerInvitation'];

  constructor() {
    const self = this;
    this.zooteerRoom = {
      async create({ data }) {
        const row = stamp<ZooteerRoomRecord>(data, true);
        self.rooms.push(row);
        return row;
      },
      async findFirst({ where }) {
        return self.rooms.find((row) => matches(row as unknown as Row, where)) ?? null;
      },
      async findMany({ where, orderBy, skip = 0, take }) {
        const rows = self.rooms.filter((row) => matches(row as unknown as Row, where));
        rows.sort((a, b) => {
          const delta = a.createdAt.getTime() - b.createdAt.getTime();
          return orderBy?.createdAt === 'asc' ? delta : -delta;
        });
        return rows.slice(skip, take === undefined ? undefined : skip + take);
      },
      async count({ where }) {
        return self.rooms.filter((row) => matches(row as unknown as Row, where)).length;
      },
      async update({ where, data }) {
        const row = self.rooms.find((item) => item.id === where.id);
        if (!row) throw new Error('room not found');
        Object.assign(row, defined(data), { updatedAt: new Date() });
        return row;
      },
      async updateMany({ where, data }) {
        const rows = self.rooms.filter((row) => matches(row as unknown as Row, where));
        for (const row of rows) Object.assign(row, defined(data));
        return { count: rows.length };
      },
    };
    this.zooteerParticipant = {
      async create({ data }) {
        const row = stamp<ZooteerParticipantRecord>(data, true);
        self.participants.push(row);
        return row;
      },
      async findFirst({ where }) {
        return self.participants.find((row) => matches(row as unknown as Row, where)) ?? null;
      },
      async findMany({ where, orderBy }) {
        const rows = self.participants.filter((row) => matches(row as unknown as Row, where));
        rows.sort((a, b) => {
          const delta = a.createdAt.getTime() - b.createdAt.getTime();
          return orderBy?.createdAt === 'desc' ? -delta : delta;
        });
        return rows;
      },
      async update({ where, data }) {
        const row = self.participants.find((item) => item.id === where.id);
        if (!row) throw new Error('membership not found');
        Object.assign(row, defined(data));
        return row;
      },
      async count({ where }) {
        return self.participants.filter((row) => matches(row as unknown as Row, where)).length;
      },
    };
    this.zooteerRoomEvent = {
      async create({ data }) {
        const row = stamp<ZooteerEventRecord>(data, false);
        self.events.push(row);
        return row;
      },
    };
    this.zooteerAuditLog = {
      async create({ data }) {
        if (self.failNextAudit) {
          self.failNextAudit = false;
          throw new Error('audit write failed');
        }
        const row = stamp<ZooteerAuditRecord>(
          {
            reason: null,
            metadata: null,
            ...data,
          },
          false,
        );
        self.audits.push(row);
        return row;
      },
    };
    this.zooteerInvitation = {
      async create({ data }) {
        const hash = String(data.tokenHash);
        if (self.invitations.some((row) => row.tokenHash === hash)) {
          throw new Error('token hash already exists');
        }
        const row = stamp<ZooteerInvitationRecord>(
          {
            acceptedAt: null,
            revokedAt: null,
            ...data,
          },
          true,
        );
        self.invitations.push(row);
        return row;
      },
      async findFirst({ where }) {
        return self.invitations.find((row) => matches(row as unknown as Row, where)) ?? null;
      },
      async findMany({ where, orderBy, skip = 0, take }) {
        const rows = self.invitations.filter((row) => matches(row as unknown as Row, where));
        rows.sort((a, b) => {
          const delta = a.createdAt.getTime() - b.createdAt.getTime();
          return orderBy?.createdAt === 'asc' ? delta : -delta;
        });
        return rows.slice(skip, take === undefined ? undefined : skip + take);
      },
      async count({ where }) {
        return self.invitations.filter((row) => matches(row as unknown as Row, where)).length;
      },
      async update({ where, data }) {
        const row = self.invitations.find((item) => item.id === where.id);
        if (!row) throw new Error('invitation not found');
        Object.assign(row, defined(data));
        return row;
      },
    };
  }

  async lockRoom(): Promise<void> {
    return undefined;
  }

  async $transaction<T>(fn: (tx: ZooteerDb) => Promise<T>): Promise<T> {
    const previous = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snap = {
      rooms: structuredClone(this.rooms),
      participants: structuredClone(this.participants),
      events: structuredClone(this.events),
      audits: structuredClone(this.audits),
      invitations: structuredClone(this.invitations),
    };
    try {
      return await fn(this);
    } catch (error) {
      this.rooms = snap.rooms;
      this.participants = snap.participants;
      this.events = snap.events;
      this.audits = snap.audits;
      this.invitations = snap.invitations;
      throw error;
    } finally {
      release();
    }
  }
}

function defined(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}
