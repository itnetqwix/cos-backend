import { prisma } from '../config/database.js';

const commentInclude = {
  author: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

export type CommentRecord = {
  id: string;
  submissionId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  author: {
    id: string;
    name: string;
  };
};

export class CommentRepository {
  /**
   * Newest first. Product ordering is NOT SPECIFIED; this is the API default.
   */
  static async listBySubmissionId(submissionId: string): Promise<CommentRecord[]> {
    return prisma.comment.findMany({
      where: { submissionId },
      include: commentInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  static async create(data: {
    submissionId: string;
    authorId: string;
    body: string;
  }): Promise<CommentRecord> {
    return prisma.comment.create({
      data,
      include: commentInclude,
    });
  }
}
