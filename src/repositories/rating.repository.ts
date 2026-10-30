import { ContestStatus, Prisma, SubmissionStatus } from '@prisma/client';
import { prisma } from '../config/database.js';

/**
 * Rating persistence (M08-P02-T01).
 *
 * applyRating locks the submission row, inserts one Rating, and writes
 * communityScore / totalVotes in the same transaction.
 * Guest votes are unique per submission and guestVoterId.
 * voterIpHash is stored as anti-abuse metadata and is not the lookup key.
 */

export interface LockedSubmissionScore {
  id: string;
  contestId: string;
  status: SubmissionStatus;
  communityScore: number;
  totalVotes: number;
  creatorId: string;
  contestStatus: ContestStatus;
}

export interface InsertRatingData {
  submissionId: string;
  userId: string | null;
  guestVoterId: string | null;
  voterFingerprint: string | null;
  voterIpHash: string;
  rating: number;
}

interface LockedRow {
  id: string;
  contestId: string;
  status: SubmissionStatus;
  communityScore: number;
  totalVotes: number;
  creatorId: string;
  contestStatus: ContestStatus;
}

export class RatingRepository {
  static async lockSubmission(
    contestId: string,
    submissionId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LockedSubmissionScore | null> {
    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT
        s.id,
        s."contestId",
        s.status,
        s."communityScore",
        s."totalVotes",
        s."creatorId",
        c.status AS "contestStatus"
      FROM "submissions" s
      INNER JOIN "contests" c ON c.id = s."contestId"
      WHERE s.id = ${submissionId}
        AND s."contestId" = ${contestId}
        AND s."deletedAt" IS NULL
      FOR UPDATE OF s, c
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      contestId: row.contestId,
      status: row.status,
      communityScore: Number(row.communityScore),
      totalVotes: Number(row.totalVotes),
      creatorId: row.creatorId,
      contestStatus: row.contestStatus,
    };
  }

  static async findGuestVote(
    submissionId: string,
    guestVoterId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{ id: string; rating: number; guestVoterId: string | null } | null> {
    if (!guestVoterId) return null;
    return tx.rating.findFirst({
      where: { submissionId, guestVoterId },
      select: { id: true, rating: true, guestVoterId: true },
    });
  }

  static async listGuestRatings(
    submissionIds: string[],
    guestVoterId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Array<{ submissionId: string; rating: number }>> {
    if (submissionIds.length === 0 || !guestVoterId) return [];
    return tx.rating.findMany({
      where: { guestVoterId, submissionId: { in: submissionIds } },
      select: { submissionId: true, rating: true },
    });
  }

  static async updateGuestRating(
    id: string,
    rating: number,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{ id: string; rating: number }> {
    return tx.rating.update({
      where: { id },
      data: { rating },
      select: { id: true, rating: true },
    });
  }

  static async insert(
    data: InsertRatingData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{
    id: string;
    rating: number;
    userId: string | null;
    voterFingerprint: string | null;
  }> {
    return tx.rating.create({
      data: {
        submissionId: data.submissionId,
        userId: data.userId,
        guestVoterId: data.guestVoterId,
        voterFingerprint: data.voterFingerprint,
        voterIpHash: data.voterIpHash,
        rating: data.rating,
      },
      select: {
        id: true,
        rating: true,
        userId: true,
        voterFingerprint: true,
      },
    });
  }

  static async listForSubmission(
    submissionId: string,
    skip: number,
    take: number,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{
    total: number;
    rows: Array<{
      id: string;
      rating: number;
      createdAt: Date;
      user: { id: string; name: string; avatarObjectKey: string | null } | null;
    }>;
  }> {
    const where = { submissionId };
    const [total, rows] = await Promise.all([
      tx.rating.count({ where }),
      tx.rating.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          rating: true,
          createdAt: true,
          user: {
            select: { id: true, name: true, avatarObjectKey: true },
          },
        },
      }),
    ]);
    return { total, rows };
  }

  static async writeScore(
    submissionId: string,
    communityScore: number,
    totalVotes: number,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> {
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        communityScore,
        totalVotes,
      },
    });
  }

  /** Identity rows for Pledge quorum. IP hash is returned and not used as identity. */
  static async listVoterRows(contestId: string) {
    const rows = await prisma.rating.findMany({
      where: { submission: { contestId, deletedAt: null } },
      select: {
        submissionId: true,
        userId: true,
        guestVoterId: true,
        voterIpHash: true,
        rating: true,
        submission: { select: { creatorId: true, status: true, deletedAt: true } },
      },
    });
    return rows.map((row) => ({
      submissionId: row.submissionId,
      userId: row.userId,
      guestVoterId: row.guestVoterId,
      voterIpHash: row.voterIpHash,
      rating: row.rating,
      creatorId: row.submission.creatorId,
      submissionStatus: row.submission.status,
      deleted: row.submission.deletedAt !== null,
    }));
  }
}
