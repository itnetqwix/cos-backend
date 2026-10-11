import { Prisma } from '@prisma/client';
import {
  CreatorSearchHit,
  FriendProfileUser,
  FriendshipRecord,
  FriendshipRepository,
} from '../repositories/friendship.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';
import {
  playbackUrlForSubmission,
  resolveThumbnailUrl,
  signedAvatarUrl,
} from './storage.service.js';

/**
 * Creator friends.
 *
 * Product rules that are NOT SPECIFIED in /docs/source:
 * - Search matches creator name only. Email is not searched and not returned.
 * - Result cap is 20. A product page size is NOT SPECIFIED.
 * - BLOCKED creators are omitted. Friending a blocked account is NOT SPECIFIED.
 * - Reject, cancel, and unfriend delete the row so either creator can request again.
 * - Chat is ChatService. These request rules do not read or write messages.
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

  static async getFriendProfile(
    actorId: string,
    identifier: string,
  ): Promise<FriendProfileResult> {
    let friendId: string | null = null;

    // Check if identifier is a friendshipId
    const friendshipRow = await FriendshipRepository.findById(identifier);
    if (friendshipRow && involves(friendshipRow, actorId)) {
      if (friendshipRow.status !== 'ACCEPTED') {
        throw new ForbiddenError('You can only view profiles of accepted friends');
      }
      friendId = otherUser(friendshipRow, actorId).id;
    } else {
      // Check if identifier is target user's id
      const pair = canonicalPair(actorId, identifier);
      if (pair) {
        const pairRow = await FriendshipRepository.findPair(
          pair.userLowId,
          pair.userHighId,
        );
        if (pairRow && involves(pairRow, actorId)) {
          if (pairRow.status !== 'ACCEPTED') {
            throw new ForbiddenError('You can only view profiles of accepted friends');
          }
          friendId = identifier;
        }
      }
    }

    if (!friendId) {
      throw new NotFoundError('Friend profile not found');
    }

    const friendUser = await FriendshipRepository.findActiveFriendUser(friendId);
    if (!friendUser) {
      throw new NotFoundError('Creator not found');
    }

    const avatarUrl = await signedAvatarUrl(friendUser.avatarObjectKey);

    // Fetch friend's non-deleted, APPROVED submissions only
    const submissions = await SubmissionRepository.listApprovedByCreatorId(friendId);

    const mappedSubmissions: FriendProfileSubmissionView[] = await Promise.all(
      submissions.map(async (sub) => ({
        id: sub.id,
        title: sub.title,
        description: sub.description,
        durationSeconds: sub.durationSeconds,
        communityScore: sub.communityScore,
        totalVotes: sub.totalVotes,
        createdAt: sub.createdAt.toISOString(),
        contestId: sub.contestId,
        contestTitle: sub.contest.title,
        category: sub.contest.category?.name ?? null,
        videoUrl: await playbackUrlForSubmission(sub.objectKey, sub.videoUrl),
        thumbnailUrl: await resolveThumbnailUrl(sub.thumbnailUrl),
      })),
    );

    const totalVotes = mappedSubmissions.reduce((acc, sub) => acc + sub.totalVotes, 0);
    const avgScore =
      mappedSubmissions.length > 0
        ? Number(
            (
              mappedSubmissions.reduce((acc, sub) => acc + sub.communityScore, 0) /
              mappedSubmissions.length
            ).toFixed(2),
          )
        : 0;

    return {
      friend: {
        id: friendUser.id,
        name: friendUser.name,
        avatarUrl: avatarUrl ?? null,
        createdAt: friendUser.createdAt.toISOString(),
      },
      stats: {
        totalSubmissions: mappedSubmissions.length,
        totalVotes,
        communityScore: avgScore,
      },
      submissions: mappedSubmissions,
    };
  }
}

export interface FriendProfileSubmissionView {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number;
  communityScore: number;
  totalVotes: number;
  createdAt: string;
  contestId: string;
  contestTitle: string;
  category: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
}

export interface FriendProfileResult {
  friend: {
    id: string;
    name: string;
    avatarUrl: string | null;
    createdAt: string;
  };
  stats: {
    totalSubmissions: number;
    totalVotes: number;
    communityScore: number;
  };
  submissions: FriendProfileSubmissionView[];
}
