import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Role } from '@prisma/client';
import { AdminCreatorRepository } from '../../src/repositories/admin-creator.repository.js';
import { CommentRepository } from '../../src/repositories/comment.repository.js';
import { CreatorActivityRepository } from '../../src/repositories/creator-activity.repository.js';
import { CreatorWarningRepository } from '../../src/repositories/creator-warning.repository.js';
import { SubmissionRepository } from '../../src/repositories/submission.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { CommentService } from '../../src/services/comment.service.js';
import { AdminCreatorService } from '../../src/services/admin-creator.service.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const VIDEO = '22222222-2222-4222-8222-222222222221';
const CREATOR = 'bbbbbbbb-bbbb-4bbb-8bbb-0000000000bb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-0000000000aa';

const originals = {
  findById: SubmissionRepository.findById,
  deleteById: SubmissionRepository.deleteById,
  listByCreatorId: SubmissionRepository.listByCreatorId,
  listComments: CommentRepository.listBySubmissionId,
  createComment: CommentRepository.create,
  listCreators: UserRepository.listCreators,
  findCreatorById: UserRepository.findCreatorById,
  summary: AdminCreatorRepository.summary,
  searchCreators: AdminCreatorRepository.searchCreators,
  submissionStatsForCreators: AdminCreatorRepository.submissionStatsForCreators,
  creatorStats: AdminCreatorRepository.creatorStats,
  latestForCreators: CreatorActivityRepository.latestForCreators,
  findLatest: CreatorActivityRepository.findLatest,
  listWarnings: CreatorWarningRepository.listByCreator,
};

after(() => {
  SubmissionRepository.findById = originals.findById;
  SubmissionRepository.deleteById = originals.deleteById;
  SubmissionRepository.listByCreatorId = originals.listByCreatorId;
  CommentRepository.listBySubmissionId = originals.listComments;
  CommentRepository.create = originals.createComment;
  UserRepository.listCreators = originals.listCreators;
  UserRepository.findCreatorById = originals.findCreatorById;
  AdminCreatorRepository.summary = originals.summary;
  AdminCreatorRepository.searchCreators = originals.searchCreators;
  AdminCreatorRepository.submissionStatsForCreators = originals.submissionStatsForCreators;
  AdminCreatorRepository.creatorStats = originals.creatorStats;
  CreatorActivityRepository.latestForCreators = originals.latestForCreators;
  CreatorActivityRepository.findLatest = originals.findLatest;
  CreatorWarningRepository.listByCreator = originals.listWarnings;
});

describe('submission comments and admin creator management', { concurrency: false }, () => {
  it('keeps one rating per submission and hashed client IP', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
    assert.match(schema, /@@unique\(\[submissionId, voterIpHash\]\)/);
  });

  it('loads comments for the requested submission only', async () => {
    SubmissionRepository.findById = async (id: string) =>
      id === VIDEO ? ({ id } as never) : null;
    CommentRepository.listBySubmissionId = async (submissionId: string) => {
      assert.equal(submissionId, VIDEO);
      return [
        {
          id: 'comment-1',
          submissionId,
          authorId: CREATOR,
          body: 'Nice',
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
          author: { id: CREATOR, name: 'Ada' },
        },
      ];
    };

    const comments = await CommentService.listForSubmission(VIDEO);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].submissionId, VIDEO);
  });

  it('stores a comment on the submission in the request', async () => {
    SubmissionRepository.findById = async (id: string) =>
      id === VIDEO ? ({ id } as never) : null;
    let saved: { submissionId: string; authorId: string; body: string } | null = null;
    CommentRepository.create = async (data) => {
      saved = data;
      return {
        id: 'comment-2',
        submissionId: data.submissionId,
        authorId: data.authorId,
        body: data.body,
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        author: { id: data.authorId, name: 'Ada' },
      };
    };

    const created = await CommentService.create({
      submissionId: VIDEO,
      authorId: CREATOR,
      body: '  hello  ',
    });
    assert.equal(saved?.submissionId, VIDEO);
    assert.equal(saved?.body, 'hello');
    assert.equal(created.submissionId, VIDEO);
    await assert.rejects(
      () => CommentService.create({ submissionId: VIDEO, authorId: null, body: 'guest' }),
      /Authentication required/,
    );
    await assert.rejects(
      () => CommentService.create({ submissionId: VIDEO, authorId: CREATOR, body: '   ' }),
      /cannot be empty/,
    );
  });

  it('lets an admin list creators and open one creator profile', async () => {
    AdminCreatorRepository.summary = async () => ({
      totalCreators: 1,
      activeCreators: 1,
      blockedCreators: 0,
      totalVideos: 2,
      approvedVideos: 2,
      pendingVideos: 0,
      rejectedVideos: 0,
      flaggedVideos: 0,
      underModerationVideos: 0,
    });
    AdminCreatorRepository.searchCreators = async () => ({
      totalCount: 1,
      users: [
        {
          id: CREATOR,
          email: 'ada@example.com',
          name: 'Ada',
          role: Role.CREATOR,
          accountStatus: 'ACTIVE' as const,
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      ],
    });
    AdminCreatorRepository.submissionStatsForCreators = async () => ({
      byStatus: [
        {
          creatorId: CREATOR,
          status: 'APPROVED' as const,
          _count: { _all: 2 },
        },
      ],
      byContest: [],
      ratings: [],
    });
    CreatorActivityRepository.latestForCreators = async () => [];
    AdminCreatorRepository.creatorStats = async () => ({
      byStatus: [],
      contestCount: 1,
      ratings: { _sum: { totalVotes: 183 } },
      comments: 0,
    });
    CreatorWarningRepository.listByCreator = async () => [];
    CreatorActivityRepository.findLatest = async () => null;
    const list = await AdminCreatorService.list({ id: ADMIN, role: Role.ADMIN });
    assert.equal(list.totalCreators, 1);
    assert.equal(list.creators[0].email, 'ada@example.com');
    assert.equal(list.creators[0].submissionCount, 2);
    await assert.rejects(
      () => AdminCreatorService.list({ id: CREATOR, role: Role.CREATOR }),
      /Forbidden/,
    );

    UserRepository.findCreatorById = async (id: string) =>
      id === CREATOR
        ? {
            id: CREATOR,
            email: 'ada@example.com',
            name: 'Ada',
            role: Role.CREATOR,
            createdAt: new Date('2026-10-01T00:00:00.000Z'),
            updatedAt: new Date('2026-10-01T00:00:00.000Z'),
          }
        : null;
    SubmissionRepository.listByCreatorId = async (creatorId: string) => {
      assert.equal(creatorId, CREATOR);
      return [
        {
          id: VIDEO,
          title: 'Bit',
          status: 'APPROVED',
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
          contestId: '11111111-1111-4111-8111-111111111111',
          communityScore: 4.2,
          totalVotes: 183,
          durationSeconds: 12,
          objectKey: 'not-a-storage-key',
          videoUrl: 'https://example.com/video.mp4',
          contest: { title: 'Open Mic', status: 'ACTIVE' },
        },
      ] as never;
    };

    const profile = await AdminCreatorService.getProfile(
      { id: ADMIN, role: Role.ADMIN },
      CREATOR,
    );
    assert.equal(profile.creator.email, 'ada@example.com');
    assert.equal(profile.submissions[0].id, VIDEO);
    assert.equal(profile.submissions[0].contestTitle, 'Open Mic');
    assert.equal(profile.submissions[0].videoUrl, 'https://example.com/video.mp4');
  });

  it('lets only an admin delete a creator video and keeps the media object', async () => {
    let deletedId: string | null = null;
    SubmissionRepository.findById = async (id: string) =>
      id === VIDEO ? ({ id } as never) : null;
    SubmissionRepository.deleteById = async (id: string) => {
      deletedId = id;
    };

    await assert.rejects(
      () => AdminCreatorService.deleteSubmission({ id: CREATOR, role: Role.CREATOR }, VIDEO),
      /Forbidden/,
    );
    assert.equal(deletedId, null);

    const result = await AdminCreatorService.deleteSubmission(
      { id: ADMIN, role: Role.ADMIN },
      VIDEO,
    );
    assert.equal(deletedId, VIDEO);
    assert.equal(result.deleted, true);
    assert.equal(result.mediaObjectRetained, true);
  });
});
