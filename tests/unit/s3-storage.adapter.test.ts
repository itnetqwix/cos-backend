import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIDEO_CONSTRAINTS } from '../../src/config/constants.js';
import { S3StorageAdapter } from '../../src/services/s3-storage.adapter.js';
import { ContestStatus } from '@prisma/client';
import { ContestRepository } from '../../src/repositories/contest.repository.js';
import { SubmissionRepository } from '../../src/repositories/submission.repository.js';
import { JudgingService } from '../../src/services/judging.service.js';
import {
  buildSubmissionObjectKey,
  parseSubmissionObjectKey,
  playbackUrlForSubmission,
  setStorageService,
} from '../../src/services/storage.service.js';

describe('M06-P02 S3 storage adapter', () => {
  const ORG = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';
  const CONTEST = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
  const CREATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

  it('constructs tenant-scoped object keys the client cannot choose', () => {
    const key = buildSubmissionObjectKey({
      contestId: CONTEST,
      creatorId: CREATOR,
      contentType: 'video/mp4',
      objectId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
    });
    assert.equal(
      key,
      `contests/${CONTEST}/creators/${CREATOR}/cccccccc-cccc-4ccc-8ccc-000000000001.mp4`,
    );
    const parsed = parseSubmissionObjectKey(key);
    assert.ok(parsed);
    assert.equal(parsed.contestId, CONTEST);
    assert.equal(parsed.creatorId, CREATOR);
    assert.equal(parsed.extension, 'mp4');
    assert.equal(parseSubmissionObjectKey('other-org/secret.mp4'), null);
  });

  it('signs a PUT with mocked S3 and never streams bytes', async () => {
    let captured: { bucket?: string; key?: string; contentType?: string; expiresIn?: number } = {};
    const adapter = new S3StorageAdapter({
      region: 'us-east-1',
      bucket: 'cos-test-bucket',
      signPutObject: async (input) => {
        captured = input;
        return 'https://cos-test-bucket.s3.us-east-1.amazonaws.com/signed?X-Amz-Signature=test';
      },
    });

    const result = await adapter.createPresignedUpload({
      objectKey: 'org/a/contests/b/creators/c/d.mp4',
      contentType: 'video/mp4',
    });

    assert.equal(captured.bucket, 'cos-test-bucket');
    assert.equal(captured.key, 'org/a/contests/b/creators/c/d.mp4');
    assert.equal(captured.contentType, 'video/mp4');
    assert.equal(captured.expiresIn, VIDEO_CONSTRAINTS.PRESIGN_EXPIRES_SECONDS);
    assert.equal(result.method, 'PUT');
    assert.equal(result.headers['Content-Type'], 'video/mp4');
    assert.match(result.uploadUrl, /X-Amz-Signature=test/);
    assert.equal(
      adapter.getPublicUrl('org/a/clip.mp4'),
      'https://cos-test-bucket.s3.us-east-1.amazonaws.com/org/a/clip.mp4',
    );
  });

  it('documents that Fastify must not stream multipart video', () => {
    const routes = readFileSync(new URL('../../src/routes/index.ts', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');
    const adapter = readFileSync(
      new URL('../../src/services/s3-storage.adapter.ts', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(routes, /multipart/);
    assert.doesNotMatch(routes, /fastify\.(post|get)\(\s*'\/submissions\/upload'/);
    assert.doesNotMatch(app, /@fastify\/multipart/);
    assert.match(adapter, /Does not receive, stream, or buffer video bytes/);
  });

  it('M12-P01-T04 keeps presign private: no public ACL and no AWS keys in the signer input', () => {
    const adapter = readFileSync(
      new URL('../../src/services/s3-storage.adapter.ts', import.meta.url),
      'utf8',
    );
    const commandBlock = adapter.slice(
      adapter.indexOf('new PutObjectCommand'),
      adapter.indexOf('getSignedUrl(s3, command'),
    );
    assert.match(commandBlock, /Bucket:\s*bucket/);
    assert.match(commandBlock, /Key:\s*key/);
    assert.match(commandBlock, /ContentType:\s*contentType/);
    assert.doesNotMatch(commandBlock, /ACL|public-read|Grant|PutObjectAcl/);
    assert.doesNotMatch(commandBlock, /AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID/);
    assert.equal(VIDEO_CONSTRAINTS.PRESIGN_EXPIRES_SECONDS, 900);
    const getAt = adapter.indexOf('new GetObjectCommand');
    const getBlock = adapter.slice(getAt, adapter.indexOf('getSignedUrl(s3, command', getAt));
    assert.match(getBlock, /Bucket:\s*bucket/);
    assert.match(getBlock, /Key:\s*key/);
    assert.doesNotMatch(getBlock, /ACL|public-read|Range|Grant/);
  });

  it('signs a GET for a submission key and rejects an arbitrary key', async () => {
    const key = buildSubmissionObjectKey({
      contestId: CONTEST,
      creatorId: CREATOR,
      contentType: 'video/mp4',
      objectId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
    });
    let captured: { bucket?: string; key?: string; expiresIn?: number } = {};
    const adapter = new S3StorageAdapter({
      region: 'us-east-2',
      bucket: 'ripskis-production-media',
      signPutObject: async () => 'https://ripskis-production-media.s3.us-east-2.amazonaws.com/put',
      signGetObject: async (input) => {
        captured = input;
        return `https://ripskis-production-media.s3.us-east-2.amazonaws.com/${input.key}?X-Amz-Signature=get`;
      },
    });

    const upload = await adapter.createPresignedUpload({
      objectKey: key,
      contentType: 'video/mp4',
    });
    assert.equal(upload.method, 'PUT');

    const playback = await adapter.createPresignedDownload(key);
    assert.equal(captured.bucket, 'ripskis-production-media');
    assert.equal(captured.key, key);
    assert.equal(captured.expiresIn, 900);
    assert.match(playback, /^https:\/\/ripskis-production-media\.s3\.us-east-2\.amazonaws\.com\//);
    assert.match(playback, /X-Amz-Signature=get/);
    await assert.rejects(
      () => adapter.createPresignedDownload('other-bucket/secret.mp4'),
      /submission key/,
    );
  });

  it('signs playback only for approved judging rows and not for an arbitrary key', async () => {
    const approvedKey = buildSubmissionObjectKey({
      contestId: CONTEST,
      creatorId: CREATOR,
      contentType: 'video/mp4',
      objectId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
    });
    const pendingKey = buildSubmissionObjectKey({
      contestId: CONTEST,
      creatorId: CREATOR,
      contentType: 'video/mp4',
      objectId: 'eeeeeeee-eeee-4eee-8eee-000000000001',
    });
    const signed: string[] = [];
    setStorageService({
      createPresignedUpload: async () => {
        throw new Error('PUT is not used for playback');
      },
      createPresignedDownload: async (objectKey) => {
        signed.push(objectKey);
        return `https://ripskis-production-media.s3.us-east-2.amazonaws.com/${objectKey}?X-Amz-Signature=queue`;
      },
    });
    const originalFind = ContestRepository.findById;
    const originalList = SubmissionRepository.listApprovedForContest;
    ContestRepository.findById = (async () => ({
      id: CONTEST,
      status: ContestStatus.ACTIVE,
      autoAdvanceDelayMs: 1800,
    })) as typeof ContestRepository.findById;
    SubmissionRepository.listApprovedForContest = (async () => [
      {
        objectKey: approvedKey,
        videoUrl: 'https://ripskis-production-media.s3.us-east-2.amazonaws.com/unsigned.mp4',
        id: 'dddddddd-dddd-4ddd-8ddd-000000000001',
        title: 'Approved',
        description: null,
        thumbnailUrl: null,
        durationSeconds: 10,
        tags: [],
        communityScore: 0,
        totalVotes: 0,
        status: 'APPROVED',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        creator: { id: CREATOR, name: 'Ada' },
        contest: { category: null },
      },
    ]) as typeof SubmissionRepository.listApprovedForContest;

    try {
      const queue = await JudgingService.getQueue(CONTEST);
      assert.deepEqual(signed, [approvedKey]);
      assert.equal(signed.includes(pendingKey), false);
      assert.match(queue.items[0].videoUrl, /X-Amz-Signature=queue/);
      assert.equal(
        await playbackUrlForSubmission(
          'not-a-submission-key',
          'https://example.com/stored.mp4',
        ),
        'https://example.com/stored.mp4',
      );
      const routes = readFileSync(new URL('../../src/routes/index.ts', import.meta.url), 'utf8');
      assert.doesNotMatch(routes, /objectKey.*sign|\/media/);
    } finally {
      ContestRepository.findById = originalFind;
      SubmissionRepository.listApprovedForContest = originalList;
      setStorageService(null);
    }
  });
});
