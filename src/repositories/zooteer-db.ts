import {
  Prisma,
  PrismaClient,
  ZooteerAuditAction,
  ZooteerParticipantRole,
  ZooteerParticipantStatus,
  ZooteerRoomEventType,
  ZooteerRoomStatus,
} from '@prisma/client';
import { prisma } from '../config/database.js';

export interface ZooteerRoomRecord {
  id: string;
  name: string;
  description: string | null;
  status: ZooteerRoomStatus;
  hostId: string;
  createdById: string;
  maxParticipants: number;
  idleTimeoutSeconds: number;
  closedAt: Date | null;
  closedById: string | null;
  deletedAt: Date | null;
  deletedById: string | null;
  livekitRoomName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ZooteerParticipantRecord {
  id: string;
  roomId: string;
  userId: string;
  status: ZooteerParticipantStatus;
  participantRole: ZooteerParticipantRole;
  firstJoinedAt: Date;
  lastJoinedAt: Date;
  leftAt: Date | null;
  disconnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ZooteerEventRecord {
  id: string;
  roomId: string;
  actorUserId: string;
  type: ZooteerRoomEventType;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
}

export interface ZooteerAuditRecord {
  id: string;
  roomId: string;
  actorUserId: string;
  action: ZooteerAuditAction;
  reason: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}

export interface ZooteerInvitationRecord {
  id: string;
  roomId: string;
  inviteeUserId: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

type RoomWhere = {
  id?: string;
  deletedAt?: null;
  status?: ZooteerRoomStatus;
  livekitRoomName?: string;
  roomId?: { in: string[] };
};

type ParticipantWhere = {
  id?: string;
  roomId?: string | { in: string[] };
  userId?: string;
  status?: ZooteerParticipantStatus;
};

type InvitationWhere = {
  id?: string;
  roomId?: string;
  inviteeUserId?: string;
  tokenHash?: string;
  acceptedAt?: null;
  revokedAt?: null;
};

export interface ZooteerDb {
  zooteerRoom: {
    create(args: { data: Record<string, unknown> }): Promise<ZooteerRoomRecord>;
    findFirst(args: { where: RoomWhere }): Promise<ZooteerRoomRecord | null>;
    findMany(args: {
      where: RoomWhere;
      orderBy?: { createdAt: 'asc' | 'desc' };
      skip?: number;
      take?: number;
    }): Promise<ZooteerRoomRecord[]>;
    count(args: { where: RoomWhere }): Promise<number>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<ZooteerRoomRecord>;
    updateMany(args: {
      where: RoomWhere;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  zooteerParticipant: {
    create(args: { data: Record<string, unknown> }): Promise<ZooteerParticipantRecord>;
    findFirst(args: {
      where: ParticipantWhere;
    }): Promise<ZooteerParticipantRecord | null>;
    findMany(args: {
      where: ParticipantWhere;
      orderBy?: { createdAt: 'asc' | 'desc' };
    }): Promise<ZooteerParticipantRecord[]>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<ZooteerParticipantRecord>;
    count(args: { where: ParticipantWhere }): Promise<number>;
  };
  zooteerRoomEvent: {
    create(args: { data: Record<string, unknown> }): Promise<ZooteerEventRecord>;
  };
  zooteerAuditLog: {
    create(args: { data: Record<string, unknown> }): Promise<ZooteerAuditRecord>;
  };
  zooteerInvitation: {
    create(args: { data: Record<string, unknown> }): Promise<ZooteerInvitationRecord>;
    findFirst(args: { where: InvitationWhere }): Promise<ZooteerInvitationRecord | null>;
    findMany(args: {
      where: InvitationWhere;
      orderBy?: { createdAt: 'asc' | 'desc' };
      skip?: number;
      take?: number;
    }): Promise<ZooteerInvitationRecord[]>;
    count(args: { where: InvitationWhere }): Promise<number>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<ZooteerInvitationRecord>;
  };
  /** Row lock. PostgreSQL uses SELECT … FOR UPDATE. The memory double serializes transactions. */
  lockRoom(roomId: string): Promise<void>;
  $transaction<T>(fn: (tx: ZooteerDb) => Promise<T>): Promise<T>;
}

function bindPrisma(client: PrismaClient | Prisma.TransactionClient): ZooteerDb {
  const root = '$connect' in client;
  return {
    zooteerRoom: client.zooteerRoom as unknown as ZooteerDb['zooteerRoom'],
    zooteerParticipant:
      client.zooteerParticipant as unknown as ZooteerDb['zooteerParticipant'],
    zooteerRoomEvent: client.zooteerRoomEvent as unknown as ZooteerDb['zooteerRoomEvent'],
    zooteerAuditLog: client.zooteerAuditLog as unknown as ZooteerDb['zooteerAuditLog'],
    zooteerInvitation:
      client.zooteerInvitation as unknown as ZooteerDb['zooteerInvitation'],
    async lockRoom(roomId: string) {
      await client.$queryRaw`SELECT "id" FROM "zooteer_rooms" WHERE "id" = ${roomId} FOR UPDATE`;
    },
    $transaction(fn) {
      if (!root) {
        throw new Error('Nested Zooteer transactions are not used');
      }
      return (client as PrismaClient).$transaction((tx) => fn(bindPrisma(tx)));
    },
  };
}

let current: ZooteerDb = bindPrisma(prisma);

export function zooteerDb(): ZooteerDb {
  return current;
}

/** Test seam. Pass null to restore the Prisma client. */
export function setZooteerDb(next: ZooteerDb | null): void {
  current = next ?? bindPrisma(prisma);
}
