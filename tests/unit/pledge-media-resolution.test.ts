import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  playbackUrlForSubmission,
  resolveThumbnailUrl,
  resolveSubmissionMedia,
  extractObjectKeyFromUrl,
  setStorageService,
  StorageService,
} from '../../src/services/storage.service.js';
import { toModerationSubmissionView } from '../../src/controllers/moderation.controller.js';
import { ContestStatus, SubmissionStatus } from '@prisma/client';

describe('Pledge media and thumbnail resolution', () => {
  const originalEnv = process.env.NODE_ENV;
  const CONTEST_ID = 'b951fc3e-eec1-4bdb-be83-a0f85ac4742f';
  const CREATOR_ID = '695d754b-d748-433a-8740-fa9d375bb6bb';
  const OBJECT_ID = 'b7137617-f49f-44e9-9ad8-89f691e7c24e';
  const OBJECT_KEY = `contests/${CONTEST_ID}/creators/${CREATOR_ID}/${OBJECT_ID}.mov`;
  const THUMBNAIL_KEY = `contests/${CONTEST_ID}/creators/${CREATOR_ID}/${OBJECT_ID}.jpg`;
  const RAW_VIDEO_S3_URL = `https://ripskis-production-media.s3.us-east-2.amazonaws.com/${OBJECT_KEY}`;
  const RAW_THUMB_S3_URL = `https://ripskis-production-media.s3.us-east-2.amazonaws.com/${THUMBNAIL_KEY}`;

  let signedRequests: Array<{ key: string; expiresInSeconds?: number }> = [];

  const mockStorage: StorageService = {
    createPresignedUpload: async () => {
      throw new Error('Not used in test');
    },
    createPresignedDownload: async (key: string, options?: { expiresInSeconds?: number }) => {
      signedRequests.push({ key, expiresInSeconds: options?.expiresInSeconds });
      return `https://ripskis-production-media.s3.us-east-2.amazonaws.com/${key}?X-Amz-Signature=mock-sig&expires=${options?.expiresInSeconds ?? 900}`;
    },
  };

  beforeEach(() => {
    signedRequests = [];
    setStorageService(mockStorage);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    setStorageService(null);
  });

  it('extractObjectKeyFromUrl correctly parses raw S3 URLs and preserves keys', () => {
    assert.equal(extractObjectKeyFromUrl(RAW_VIDEO_S3_URL), OBJECT_KEY);
    assert.equal(extractObjectKeyFromUrl(RAW_THUMB_S3_URL), THUMBNAIL_KEY);
    assert.equal(extractObjectKeyFromUrl(OBJECT_KEY), OBJECT_KEY);
  });

  it('playbackUrlForSubmission generates signed playback URL with custom expiry', async () => {
    const signed = await playbackUrlForSubmission(OBJECT_KEY, RAW_VIDEO_S3_URL, {
      expiresInSeconds: 3600,
    });
    assert.match(signed, /X-Amz-Signature=mock-sig/);
    assert.match(signed, /expires=3600/);
    assert.equal(signedRequests.length, 1);
    assert.equal(signedRequests[0]?.key, OBJECT_KEY);
    assert.equal(signedRequests[0]?.expiresInSeconds, 3600);
  });

  it('resolveThumbnailUrl derives companion jpg poster from objectKey when stored thumbnail is null', async () => {
    const signed = await resolveThumbnailUrl(null, {
      objectKey: OBJECT_KEY,
      expiresInSeconds: 3600,
    });
    assert.ok(signed);
    assert.match(signed, new RegExp(THUMBNAIL_KEY));
    assert.match(signed, /X-Amz-Signature=mock-sig/);
    assert.equal(signedRequests.some((r) => r.key === THUMBNAIL_KEY), true);
  });

  it('resolveThumbnailUrl extracts key from unsigned raw S3 URL and signs it', async () => {
    const signed = await resolveThumbnailUrl(RAW_THUMB_S3_URL, {
      expiresInSeconds: 3600,
    });
    assert.ok(signed);
    assert.match(signed, new RegExp(THUMBNAIL_KEY));
    assert.match(signed, /X-Amz-Signature=mock-sig/);
  });

  it('resolveSubmissionMedia resolves both video and companion thumbnail with 1-hour admin TTL', async () => {
    const media = await resolveSubmissionMedia(OBJECT_KEY, RAW_VIDEO_S3_URL, null, {
      expiresInSeconds: 3600,
    });
    assert.ok(media.videoUrl);
    assert.match(media.videoUrl, /X-Amz-Signature=mock-sig/);
    assert.ok(media.thumbnailUrl);
    assert.match(media.thumbnailUrl, /X-Amz-Signature=mock-sig/);
    assert.match(media.thumbnailUrl, /\.jpg\?/);
  });

  it('toModerationSubmissionView resolves both videoUrl and thumbnailUrl for admin moderation', async () => {
    const mockSubmission = {
      id: OBJECT_ID,
      contestId: CONTEST_ID,
      creatorId: CREATOR_ID,
      title: 'October Entry',
      description: 'Test description',
      videoUrl: RAW_VIDEO_S3_URL,
      objectKey: OBJECT_KEY,
      thumbnailUrl: null, // As stored in production DB!
      durationSeconds: 30,
      status: SubmissionStatus.PENDING_REVIEW,
      rejectionReason: null,
      moderatedById: null,
      moderatedAt: null,
      tags: ['comedy'],
      communityScore: 8.5,
      totalVotes: 12,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      deletedById: null,
      categoryId: null,
      otherCategoryLabel: null,
      contest: {
        id: CONTEST_ID,
        title: 'Pledge of aWEEEEEDgence — October 2026',
        cycleMonth: '2026-10',
        status: ContestStatus.JUDGING,
      },
      creator: {
        id: CREATOR_ID,
        name: 'Test Creator',
      },
    };

    const view = await toModerationSubmissionView(mockSubmission as any);
    assert.equal(view.id, OBJECT_ID);
    assert.match(view.videoUrl, /X-Amz-Signature=mock-sig/);
    assert.ok(view.thumbnailUrl);
    assert.match(view.thumbnailUrl, /X-Amz-Signature=mock-sig/);
    assert.match(view.thumbnailUrl, /\.jpg\?/);
  });
});

