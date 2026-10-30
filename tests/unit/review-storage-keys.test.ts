import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPublicCdnMediaUrl,
  buildReviewObjectKey,
  buildSubmissionObjectKey,
  isSignableObjectKey,
  parseReviewObjectKey,
  parseReviewThumbnailObjectKey,
  parseSubmissionObjectKey,
  thumbnailKeyForReview,
  thumbnailKeyForSubmission,
} from '../../src/services/storage.service.js';
import { ValidationError } from '../../src/utils/response.js';

const TESTER = '11111111-1111-4111-8111-111111111111';
const OBJECT = '22222222-2222-4222-8222-222222222222';
const CONTEST = '62d3e785-8c7b-40ce-ae01-a7a1ff011d3b';
const CREATOR = 'add1f46b-5d58-4e59-a288-3b7a1c72db24';

describe('review storage keys', () => {
  it('builds reviews/{testerId}/{uuid}.{ext} for supported video types', () => {
    assert.equal(
      buildReviewObjectKey({ testerId: TESTER, contentType: 'video/mp4', objectId: OBJECT }),
      `reviews/${TESTER}/${OBJECT}.mp4`,
    );
    assert.equal(
      buildReviewObjectKey({ testerId: TESTER, contentType: 'video/webm', objectId: OBJECT }).endsWith('.webm'),
      true,
    );
    assert.equal(
      buildReviewObjectKey({ testerId: TESTER, contentType: 'video/quicktime', objectId: OBJECT }).endsWith('.mov'),
      true,
    );
    const parsed = parseReviewObjectKey(`reviews/${TESTER}/${OBJECT}.mp4`);
    assert.deepEqual(parsed, { testerId: TESTER, objectId: OBJECT, extension: 'mp4' });
  });

  it('rejects invalid tester ids, object ids, paths, and extensions', () => {
    assert.throws(
      () => buildReviewObjectKey({ testerId: 'tester', contentType: 'video/mp4', objectId: OBJECT }),
      ValidationError,
    );
    assert.throws(
      () => buildReviewObjectKey({ testerId: TESTER, contentType: 'video/mp4', objectId: 'nope' }),
      ValidationError,
    );
    assert.throws(
      () => buildReviewObjectKey({ testerId: TESTER, contentType: 'image/jpeg', objectId: OBJECT }),
      ValidationError,
    );
    assert.equal(parseReviewObjectKey(`contests/${CONTEST}/creators/${CREATOR}/${OBJECT}.mp4`), null);
    assert.equal(parseReviewObjectKey(`reviews/${TESTER}/${OBJECT}.exe`), null);
    assert.equal(parseReviewObjectKey(`reviews/${TESTER}/${OBJECT}.mp4/extra`), null);
    assert.equal(parseReviewObjectKey(''), null);
  });

  it('pairs a review thumbnail and accepts both keys for signing and CDN playback', () => {
    const video = buildReviewObjectKey({
      testerId: TESTER,
      contentType: 'video/mp4',
      objectId: OBJECT,
    });
    const thumb = thumbnailKeyForReview(video);
    assert.equal(thumb, `reviews/${TESTER}/${OBJECT}.jpg`);
    assert.deepEqual(parseReviewThumbnailObjectKey(thumb!), { testerId: TESTER, objectId: OBJECT });
    assert.equal(thumbnailKeyForReview('not-a-review'), null);
    assert.equal(isSignableObjectKey(video), true);
    assert.equal(isSignableObjectKey(thumb!), true);
    assert.equal(isSignableObjectKey('reviews/not/a/key.mp4'), false);
    assert.equal(
      buildPublicCdnMediaUrl('https://media.ripskis.com', video),
      `https://media.ripskis.com/v1/${video}`,
    );
    assert.equal(
      buildPublicCdnMediaUrl('https://media.ripskis.com', thumb!),
      `https://media.ripskis.com/v1/${thumb}`,
    );
  });

  it('keeps contest key generation, parsing, thumbnails, and signing', () => {
    const key = buildSubmissionObjectKey({
      contestId: CONTEST,
      creatorId: CREATOR,
      contentType: 'video/mp4',
      objectId: OBJECT,
    });
    assert.equal(key, `contests/${CONTEST}/creators/${CREATOR}/${OBJECT}.mp4`);
    assert.equal(parseSubmissionObjectKey(key)?.contestId, CONTEST);
    assert.equal(parseReviewObjectKey(key), null);
    assert.equal(thumbnailKeyForSubmission(key), `contests/${CONTEST}/creators/${CREATOR}/${OBJECT}.jpg`);
    assert.equal(thumbnailKeyForReview(key), null);
    assert.equal(isSignableObjectKey(key), true);
    assert.equal(
      buildPublicCdnMediaUrl('https://media.ripskis.com', key),
      `https://media.ripskis.com/v1/${key}`,
    );
    assert.equal(buildPublicCdnMediaUrl('https://media.ripskis.com', 'not-a-key'), null);
  });
});
