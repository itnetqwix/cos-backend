import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  approveSubmissionSchema,
  rejectSubmissionSchema,
} from '../../src/schemas/moderation.schema.js';

const SCHEMA = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

describe('M07-P01 moderation schema and reject contract', () => {
  it('defines AuditAction and AuditLog and keeps moderation columns', () => {
    assert.match(SCHEMA, /enum AuditAction/);
    for (const action of ['APPROVE', 'REJECT', 'FLAG', 'ISSUE_WARNING', 'SUSPEND_CREATOR']) {
      assert.match(SCHEMA, new RegExp(action));
    }
    assert.match(SCHEMA, /model AuditLog/);
    assert.match(SCHEMA, /@@map\("audit_logs"\)/);
    assert.match(SCHEMA, /rejectionReason\s+String\?/);
    assert.match(SCHEMA, /moderatedById\s+String\?/);
    assert.match(SCHEMA, /moderatedAt\s+DateTime\?/);
    assert.match(SCHEMA, /model Rating/);
    assert.doesNotMatch(SCHEMA, /model Leaderboard/);
  });

  it('rejects an empty or missing rejection reason', () => {
    assert.equal(rejectSubmissionSchema.safeParse({}).success, false);
    assert.equal(rejectSubmissionSchema.safeParse({ reason: '' }).success, false);
    assert.equal(rejectSubmissionSchema.safeParse({ reason: '   ' }).success, false);
    const parsed = rejectSubmissionSchema.parse({
      reason: '  Watermark remains visible  ',
      reasonCode: 'WATERMARK',
    });
    assert.equal(parsed.reason, 'Watermark remains visible');
    assert.equal(parsed.reasonCode, 'WATERMARK');
    assert.equal(rejectSubmissionSchema.safeParse({ reason: 'No', extra: true }).success, false);
  });

  it('allows approve with an empty body and rejects unknown keys', () => {
    assert.deepEqual(approveSubmissionSchema.parse({}), {});
    assert.equal(approveSubmissionSchema.parse({ note: ' Looks good ' }).note, 'Looks good');
    assert.equal(approveSubmissionSchema.safeParse({ status: 'APPROVED' }).success, false);
  });
});
