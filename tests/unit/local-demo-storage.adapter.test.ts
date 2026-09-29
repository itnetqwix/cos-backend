import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LocalDemoStorageAdapter } from '../../src/services/local-demo-storage.adapter.js';
import { S3StorageAdapter } from '../../src/services/s3-storage.adapter.js';

const ORG = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';
const CONTEST = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const CREATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const OBJECT = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const OBJECT_KEY = `org/${ORG}/contests/${CONTEST}/creators/${CREATOR}/${OBJECT}.mp4`;

describe('Temporary local demo storage adapter', { concurrency: 1 }, () => {
  const secret = 'local-demo-test-secret';
  let root = '';
  let adapter: LocalDemoStorageAdapter | null = null;

  after(async () => {
    await adapter?.close();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stores a PUT on disk and serves it back without using Fastify', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cos-demo-'));
    adapter = new LocalDemoStorageAdapter({
      rootDir: root,
      host: '127.0.0.1',
      port: 0,
      signingSecret: secret,
    });
    await adapter.start();

    const signed = await adapter.createPresignedUpload({
      objectKey: OBJECT_KEY,
      contentType: 'video/mp4',
    });
    assert.equal(signed.method, 'PUT');
    assert.equal(signed.headers['Content-Type'], 'video/mp4');
    assert.match(signed.uploadUrl, /^http:\/\/127\.0\.0\.1:\d+\/upload\?/);

    const body = Buffer.from('demo-mp4-bytes');
    const put = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: signed.headers,
      body,
    });
    assert.equal(put.status, 200);

    const stored = await readFile(path.join(root, ...OBJECT_KEY.split('/')));
    assert.deepEqual(stored, body);

    const mediaUrl = adapter.getPublicUrl(OBJECT_KEY);
    const full = await fetch(mediaUrl);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), body);

    const partial = await fetch(mediaUrl, { headers: { Range: 'bytes=0-3' } });
    assert.equal(partial.status, 206);
    assert.equal(Buffer.from(await partial.arrayBuffer()).toString(), 'demo');
  });

  it('rejects an expired upload token, a bad token, and a non-submission key', async () => {
    assert.ok(adapter);
    const expires = String(Math.floor(Date.now() / 1000) - 5);
    const token = createHmac('sha256', secret)
      .update(`put\n${OBJECT_KEY}\nvideo/mp4\n${expires}`)
      .digest('hex');
    const expired = new URL(`${adapter.listeningOrigin}/upload`);
    expired.searchParams.set('key', OBJECT_KEY);
    expired.searchParams.set('contentType', 'video/mp4');
    expired.searchParams.set('expires', expires);
    expired.searchParams.set('token', token);
    const expiredPut = await fetch(expired, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: Buffer.from('x'),
    });
    assert.equal(expiredPut.status, 403);

    const signed = await adapter.createPresignedUpload({
      objectKey: OBJECT_KEY,
      contentType: 'video/mp4',
    });
    const tampered = new URL(signed.uploadUrl);
    tampered.searchParams.set('token', '0'.repeat(64));
    const bad = await fetch(tampered, {
      method: 'PUT',
      headers: signed.headers,
      body: Buffer.from('x'),
    });
    assert.equal(bad.status, 403);

    await assert.rejects(
      () =>
        adapter!.createPresignedUpload({
          objectKey: '../secret.mp4',
          contentType: 'video/mp4',
        }),
      /submission key/,
    );
  });

  it('rejects an empty upload and keeps the 100MB ceiling', async () => {
    assert.ok(adapter);
    const signed = await adapter.createPresignedUpload({
      objectKey: OBJECT_KEY,
      contentType: 'video/mp4',
    });
    const empty = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: signed.headers,
      body: new Uint8Array(),
    });
    assert.equal(empty.status, 400);

    const adapterSrc = readFileSync(
      new URL('../../src/services/local-demo-storage.adapter.ts', import.meta.url),
      'utf8',
    );
    assert.match(adapterSrc, /MAX_FILE_SIZE_BYTES/);
    assert.match(adapterSrc, /Video exceeds the 100MB limit/);
  });

  it('keeps S3 as the only production storage adapter', () => {
    const app = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');
    const routes = readFileSync(new URL('../../src/routes/index.ts', import.meta.url), 'utf8');
    const server = readFileSync(new URL('../../src/server.ts', import.meta.url), 'utf8');
    const s3 = readFileSync(new URL('../../src/services/s3-storage.adapter.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(app, /local-demo|LocalDemoStorageAdapter/);
    assert.match(app, /S3StorageAdapter\.fromEnv\(\)/);
    assert.match(s3, /class S3StorageAdapter/);
    assert.match(s3, /Does not receive, stream, or buffer video bytes/);
    assert.doesNotMatch(s3, /local-demo|createWriteStream|storage\/demo/);
    assert.match(s3, /new PutObjectCommand\(\{[\s\S]*Bucket:[\s\S]*Key:[\s\S]*ContentType:[\s\S]*\}\)/);
    assert.doesNotMatch(
      s3.slice(s3.indexOf('new PutObjectCommand')),
      /ACL|public-read/,
    );
    assert.equal(typeof S3StorageAdapter.fromEnv, 'function');
    assert.doesNotMatch(routes, /local-demo|\/demo\/bootstrap/);
    assert.doesNotMatch(server, /LocalDemoStorageAdapter|5055/);
    assert.doesNotMatch(routes, /multipart/);
    assert.doesNotMatch(routes, /fastify\.(post|get)\(\s*'\/submissions\/upload'/);
  });
});
