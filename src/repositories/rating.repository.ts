import { ContestStatus, Prisma, SubmissionStatus } from '@prisma/client';
import { prisma } from '../config/database.js';

/**
 * Rating persistence (M08-P02-T01).
 *
 * applyRating locks the submission row, inserts one Rating, and writes
 * communityScore / totalVotes in the same transaction.
 * Guest votes are unique per submission and voterIpHash.
 * voterFingerprint is stored as supplied and is not the uniqueness key.
 * voterIpHash is an HMAC. The raw IP is not persisted.
 */

export interface LockedSubmissionScore {
  id: string;
  contestId: string;
  status: SubmissionStatus;
  communityScore: number;
  totalVotes: number;
  contestStatus: ContestStatus;
}

export interface InsertRatingData {
  submissionId: string;
  userId: string | null;
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
        c.status AS "contestStatus"
      FROM "submissions" s
      INNER JOIN "contests" c ON c.id = s."contestId"
      WHERE s.id = ${submissionId}
        AND s."contestId" = ${contestId}
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
      contestStatus: row.contestStatus,
    };
  }

  static async findGuestVote(
    submissionId: string,
    voterIpHash: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{ id: string } | null> {
    return tx.rating.findFirst({
      where: { submissionId, voterIpHash },
      select: { id: true },
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
}
