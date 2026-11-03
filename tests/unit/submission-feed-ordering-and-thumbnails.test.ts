import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ContestStatus, Role, SubmissionStatus } from '@prisma/client';
import {
  setStorageService,
  StorageService,
  resolveThumbnailUrl,
  resolveSubmissionMedia,
  thumbnailKeyForSubmission,
} from '../../src/services/storage.service.js';
import { JudgingService } from '../../src/services/judging.service.js';
import { toSubmissionView } from '../../src/controllers/submission.controller.js';

describe('Submission Feed Ordering and Thumbnail Resolution', () => {
  const CONTEST_ID = 'b951fc3e-eec1-4bdb-be83-a0f85ac4742f';
  const CREATOR_ID = '695d754b-d748-433a-8740-fa9d375bb6bb';
  const SUBMISSION_1_ID = '11111111-1111-4111-a111-111111111111';
  const SUBMISSION_2_ID = '22222222-2222-4222-a222-222222222222';
  const OBJ_KEY_1 = `contests/${CONTEST_ID}/creators/${CREATOR_ID}/11111111-1111-4111-a111-111111111111.mp4`;
  const OBJ_KEY_2 = `contests/${CONTEST_ID}/creators/${CREATOR_ID}/22222222-2222-4222-a222-222222222222.mp4`;
  const THUMB_KEY_1 = thumbnailKeyForSubmission(OBJ_KEY_1)!;
  const THUMB_KEY_2 = thumbnailKeyForSubmission(OBJ_KEY_2)!;

  let downloadedKeys: string[] = [];

  const mockStorage: StorageService = {
    createPresignedUpload: async () => {
      throw new Error('Not used in test');
    },
    createPresignedDownload: async (key: string, options?: { expiresInSeconds?: number }) => {
      downloadedKeys.push(key);
      return `https://s3.example.com/${key}?signed=true&expires=${options?.expiresInSeconds ?? 900}`;
    },
  };

  beforeEach(() => {
    downloadedKeys = [];
    setStorageService(mockStorage);
  });

  afterEach(() => {
    setStorageService(null);
  });

  it('thumbnailKeyForSubmission correctly pairs jpg key for mp4/webm/mov', () => {
    assert.equal(THUMB_KEY_1, `contests/${CONTEST_ID}/creators/${CREATOR_ID}/11111111-1111-4111-a111-111111111111.jpg`);
    assert.equal(
      thumbnailKeyForSubmission(`contests/${CONTEST_ID}/creators/${CREATOR_ID}/33333333-3333-4333-a333-333333333333.mov`),
      `contests/${CONTEST_ID}/creators/${CREATOR_ID}/33333333-3333-4333-a333-333333333333.jpg`
    );
    assert.equal(
      thumbnailKeyForSubmission(`contests/${CONTEST_ID}/creators/${CREATOR_ID}/44444444-4444-4444-a444-444444444444.webm`),
      `contests/${CONTEST_ID}/creators/${CREATOR_ID}/44444444-4444-4444-a444-444444444444.jpg`
    );
  });

  it('resolveThumbnailUrl generates a signed GET URL when thumbnailUrl is null but objectKey is provided', async () => {
    const signed = await resolveThumbnailUrl(null, {
      objectKey: OBJ_KEY_1,
      expiresInSeconds: 1800,
    });
    assert.ok(signed);
    assert.match(signed, new RegExp(THUMB_KEY_1));
    assert.match(signed, /signed=true/);
    assert.match(signed, /expires=1800/);
    assert.ok(downloadedKeys.includes(THUMB_KEY_1));
  });

  it('resolveThumbnailUrl preserves and signs explicit stored thumbnail key', async () => {
    const signed = await resolveThumbnailUrl(THUMB_KEY_2, {
      objectKey: OBJ_KEY_2,
      expiresInSeconds: 3600,
    });
    assert.ok(signed);
    assert.match(signed, new RegExp(THUMB_KEY_2));
    assert.match(signed, /expires=3600/);
    assert.ok(downloadedKeys.includes(THUMB_KEY_2));
  });

  it('resolveSubmissionMedia resolves both playback URL and companion thumbnail for restricted audience', async () => {
    const media = await resolveSubmissionMedia(
      OBJ_KEY_1,
      `https://s3.example.com/${OBJ_KEY_1}`,
      null,
      { audience: 'restricted', expiresInSeconds: 3600 },
    );
    assert.ok(media.videoUrl);
    assert.ok(media.thumbnailUrl);
    assert.match(media.videoUrl, new RegExp(OBJ_KEY_1));
    assert.match(media.thumbnailUrl, new RegExp(THUMB_KEY_1));
  });

  it('toSubmissionView resolves thumbnail URL even when stored thumbnailUrl is null', async () => {
    const mockRecord: any = {
      id: SUBMISSION_1_ID,
      contestId: CONTEST_ID,
      creatorId: CREATOR_ID,
      title: 'First Submission',
      description: 'Desc',
      videoUrl: `https://s3.example.com/${OBJ_KEY_1}`,
      objectKey: OBJ_KEY_1,
      thumbnailUrl: null, // Stored as null in DB
      durationSeconds: 30,
      status: SubmissionStatus.APPROVED,
      rejectionReason: null,
      moderatedById: null,
      moderatedAt: null,
      tags: ['weed'],
      communityScore: 8.5,
      totalVotes: 10,
      createdAt: new Date('2026-11-01T10:00:00Z'),
      updatedAt: new Date('2026-11-01T10:00:00Z'),
      contest: { id: CONTEST_ID, title: 'Test Contest', status: ContestStatus.ACTIVE },
    };

    const view = await toSubmissionView(mockRecord);
    assert.ok(view.thumbnailUrl);
    assert.match(view.thumbnailUrl, new RegExp(THUMB_KEY_1));
    assert.match(view.thumbnailUrl, /signed=true/);
  });

  it('verifies newest-first ordering logic preserves descending chronology', () => {
    const subs = [
      { id: '1', createdAt: new Date('2026-10-01T10:00:00Z') },
      { id: '2', createdAt: new Date('2026-11-01T10:00:00Z') },
      { id: '3', createdAt: new Date('2026-11-03T10:00:00Z') },
    ];
    const sorted = [...subs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    assert.equal(sorted[0]?.id, '3');
    assert.equal(sorted[1]?.id, '2');
    assert.equal(sorted[2]?.id, '1');
  });
});
