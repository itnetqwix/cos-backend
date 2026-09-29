import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIDEO_CONSTRAINTS } from '../../src/config/constants.js';
import {
  completeSubmissionSchema,
  presignSubmissionSchema,
} from '../../src/schemas/submission.schema.js';

const SCHEMA = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

describe('M06-P01 submission schema and Zod contracts', () => {
  it('defines SubmissionStatus and the master-plan Submission fields', () => {
    assert.match(SCHEMA, /enum SubmissionStatus/);
    assert.match(SCHEMA, /PENDING_REVIEW/);
    assert.match(SCHEMA, /APPROVED/);
    assert.match(SCHEMA, /REJECTED/);
    assert.match(SCHEMA, /FLAGGED/);
    assert.match(SCHEMA, /model Submission/);
    assert.match(SCHEMA, /objectKey\s+String\s+@unique/);
    assert.match(SCHEMA, /@@index\(\[contestId, status\]\)/);
    assert.match(SCHEMA, /@@index\(\[creatorId\]\)/);
    assert.match(SCHEMA, /rejectionReason/);
    assert.match(SCHEMA, /moderatedById/);
    assert.match(SCHEMA, /model AuditLog/);
    assert.match(SCHEMA, /enum AuditAction/);
    assert.match(SCHEMA, /model Rating/);
    assert.doesNotMatch(SCHEMA, /model Leaderboard/);
  });

  it('rejects invalid presign metadata at the contract layer', () => {
    const valid = {
      contestId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
      contentType: 'video/mp4',
      fileSizeBytes: 1024,
      durationSeconds: 45,
    };
    assert.equal(presignSubmissionSchema.parse(valid).contentType, 'video/mp4');
    assert.equal(
      presignSubmissionSchema.parse({ ...valid, contentType: 'video/quicktime' }).contentType,
      'video/quicktime',
    );
    assert.equal(presignSubmissionSchema.safeParse({ ...valid, contentType: 'video/ogg' }).success, false);
    assert.equal(
      presignSubmissionSchema.safeParse({
        ...valid,
        fileSizeBytes: VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES + 1,
      }).success,
      false,
    );
    assert.equal(presignSubmissionSchema.safeParse({ ...valid, durationSeconds: 61 }).success, false);
    assert.equal(presignSubmissionSchema.safeParse({ ...valid, extra: true }).success, false);
  });

  it('rejects invalid complete metadata and strips client-chosen status', () => {
    const valid = {
      contestId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
      objectKey: 'org/x/contests/y/creators/z/a.mp4',
      title: 'Midnight Drift',
      durationSeconds: 30,
    };
    assert.equal(completeSubmissionSchema.parse(valid).title, 'Midnight Drift');
    assert.equal(completeSubmissionSchema.safeParse({ ...valid, status: 'APPROVED' }).success, false);
    assert.equal(completeSubmissionSchema.safeParse({ ...valid, videoUrl: 'https://evil' }).success, false);
    assert.equal(completeSubmissionSchema.safeParse({ ...valid, title: '' }).success, false);
  });
});
