import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIDEO_CONSTRAINTS } from '../../src/config/constants.js';
import { S3StorageAdapter } from '../../src/services/s3-storage.adapter.js';
import {
  buildSubmissionObjectKey,
  parseSubmissionObjectKey,
} from '../../src/services/storage.service.js';

describe('M06-P02 S3 storage adapter', () => {
  const ORG = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';
  const CONTEST = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
  const CREATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

  it('constructs tenant-scoped object keys the client cannot choose', () => {
    const key = buildSubmissionObjectKey({
      organizationId: ORG,
      contestId: CONTEST,
      creatorId: CREATOR,
      contentType: 'video/mp4',
      objectId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
    });
    assert.equal(
      key,
      `org/${ORG}/contests/${CONTEST}/creators/${CREATOR}/cccccccc-cccc-4ccc-8ccc-000000000001.mp4`,
    );
    const parsed = parseSubmissionObjectKey(key);
    assert.ok(parsed);
    assert.equal(parsed.organizationId, ORG);
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
  });
});
