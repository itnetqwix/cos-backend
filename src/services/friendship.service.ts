import { Prisma } from '@prisma/client';
import {
  CreatorSearchHit,
  FriendshipRecord,
  FriendshipRepository,
} from '../repositories/friendship.repository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';

/**
 * Creator friends.
 *
 * Product rules that are NOT SPECIFIED in /docs/source:
 * - Search matches creator name only. Email is not searched and not returned.
 * - Result cap is 20. A product page size is NOT SPECIFIED.
 * - BLOCKED creators are omitted. Friending a blocked account is NOT SPECIFIED.
 * - Reject, cancel, and unfriend delete the row so either creator can request again.
 * - Chat and media sharing are out of scope.
 */

export type FriendDirection = 'INCOMING' | 'OUTGOING';
export type FriendRelationship = 'NONE' | 'INCOMING' | 'OUTGOING' | 'FRIENDS';

export interface FriendListItem {
  id: string;
  status: 'PENDING' | 'ACCEPTED';
  direction: FriendDirection;
  createdAt: Date;
  user: CreatorSearchHit;
}

export interface FriendList {
  friends: FriendListItem[];
  incoming: FriendListItem[];
  outgoing: FriendListItem[];
}

export interface FriendSearchResult extends CreatorSearchHit {
  relationship: FriendRelationship;
  friendshipId: string | null;
}

export function canonicalPair(
  a: string,
  b: string,
): { userLowId: string; userHighId: string } | null {
  if (a === b) return null;
  return a < b ? { userLowId: a, userHighId: b } : { userLowId: b, userHighId: a };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function involves(row: FriendshipRecord, userId: string): boolean {
  return row.userLowId === userId || row.userHighId === userId;
}

function otherUser(row: FriendshipRecord, userId: string): CreatorSearchHit {
  return row.userLowId === userId ? row.userHigh : row.userLow;
}

function directionFor(row: FriendshipRecord, userId: string): FriendDirection {
  return row.requesterId === userId ? 'OUTGOING' : 'INCOMING';
}

function toListItem(row: FriendshipRecord, userId: string): FriendListItem {
  return {
    id: row.id,
    status: row.status,
    direction: directionFor(row, userId),
    createdAt: row.createdAt,
    user: otherUser(row, userId),
  };
}

function relationshipFor(row: FriendshipRecord, userId: string): FriendRelationship {
  if (row.status === 'ACCEPTED') return 'FRIENDS';
  return directionFor(row, userId);
}

async function loadOwned(
  friendshipId: string,
  actorId: string,
): Promise<FriendshipRecord> {
  const row = await FriendshipRepository.findById(friendshipId);
  if (!row || !involves(row, actorId)) {
    throw new NotFoundError('Friend request not found');
  }
  return row;
}

export class FriendshipService {
  static async list(actorId: string): Promise<FriendList> {
    const rows = await FriendshipRepository.listForUser(actorId);
    const friends: FriendListItem[] = [];
    const incoming: FriendListItem[] = [];
    const outgoing: FriendListItem[] = [];
    for (const row of rows) {
      const item = toListItem(row, actorId);
      if (row.status === 'ACCEPTED') friends.push(item);
      else if (item.direction === 'INCOMING') incoming.push(item);
      else outgoing.push(item);
    }
    return { friends, incoming, outgoing };
  }

  static async search(
    actorId: string,
    rawQuery: string | undefined,
  ): Promise<FriendSearchResult[]> {
    const query = (rawQuery ?? '').trim();
    if (!query) return [];
    const creators = await FriendshipRepository.searchCreators(
      query.slice(0, 80),
      actorId,
    );
    const pairs = creators
      .map((creator) => canonicalPair(actorId, creator.id))
      .filter((pair): pair is { userLowId: string; userHighId: string } => pair !== null);
    const rows = await FriendshipRepository.findByPairs(pairs);
    const byOther = new Map<string, FriendshipRecord>();
    for (const row of rows) {
      byOther.set(otherUser(row, actorId).id, row);
    }
    return creators.map((creator) => {
      const row = byOther.get(creator.id);
      return {
        ...creator,
        relationship: row ? relationshipFor(row, actorId) : 'NONE',
        friendshipId: row?.id ?? null,
      };
    });
  }

  static async sendRequest(
    actorId: string,
    addresseeId: string,
  ): Promise<FriendshipRecord> {
    const pair = canonicalPair(actorId, addresseeId);
    if (!pair) {
      throw new ValidationError('You cannot send a friend request to yourself');
    }
    const addressee = await FriendshipRepository.findActiveCreator(addresseeId);
    if (!addressee) {
      throw new NotFoundError('Creator not found');
    }
    const existing = await FriendshipRepository.findPair(pair.userLowId, pair.userHighId);
    if (existing?.status === 'ACCEPTED') {
      throw new ConflictError('You are already friends');
    }
    if (existing?.status === 'PENDING') {
      throw new ConflictError('A friend request already exists');
    }
    try {
      return await FriendshipRepository.create({
        ...pair,
        requesterId: actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A friend request already exists');
      }
      throw error;
    }
  }

  static async accept(actorId: string, friendshipId: string): Promise<FriendshipRecord> {
    const row = await loadOwned(friendshipId, actorId);
    if (row.status !== 'PENDING') {
      throw new ConflictError('This request is no longer pending');
    }
    if (row.requesterId === actorId) {
      throw new ForbiddenError('Only the recipient can accept this request');
    }
    return FriendshipRepository.markAccepted(friendshipId);
  }

  static async reject(actorId: string, friendshipId: string): Promise<void> {
    const row = await loadOwned(friendshipId, actorId);
    if (row.status !== 'PENDING') {
      throw new ConflictError('This request is no longer pending');
    }
    if (row.requesterId === actorId) {
      throw new ForbiddenError('Only the recipient can reject this request');
    }
    await FriendshipRepository.deleteById(friendshipId);
  }

  static async cancel(actorId: string, friendshipId: string): Promise<void> {
    const row = await loadOwned(friendshipId, actorId);
    if (row.status !== 'PENDING') {
      throw new ConflictError('This request is no longer pending');
    }
    if (row.requesterId !== actorId) {
      throw new ForbiddenError('Only the sender can cancel this request');
    }
    await FriendshipRepository.deleteById(friendshipId);
  }

  static async remove(actorId: string, friendshipId: string): Promise<void> {
    const row = await loadOwned(friendshipId, actorId);
    if (row.status !== 'ACCEPTED') {
      throw new ConflictError('Only accepted friends can be removed');
    }
    await FriendshipRepository.deleteById(friendshipId);
  }
}
