import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContestStatus } from '@prisma/client';
import {
  assertContestConfigurationMutable,
  assertContestTransition,
  nextContestStatus,
} from '../../src/services/contest-lifecycle.js';
import { ConflictError } from '../../src/utils/response.js';
import {
  createContestSchema,
  listContestsQuerySchema,
  updateContestSchema,
} from '../../src/schemas/contest.schema.js';

const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../prisma/schema.prisma',
);

describe('M05-P01 contest schema', () => {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');

  it('defines ContestStatus without a cancellation value', () => {
    const enumBody = schema.match(/enum ContestStatus \{([^}]*)\}/)?.[1] ?? '';
    assert.notEqual(enumBody, '');
    for (const status of ['DRAFT', 'SCHEDULED', 'ACTIVE', 'JUDGING', 'COMPLETED', 'ARCHIVED']) {
      assert.match(enumBody, new RegExp(`\\b${status}\\b`));
    }
    assert.doesNotMatch(enumBody, /CANCELLED/);
    assert.equal(ContestStatus.DRAFT, 'DRAFT');
    assert.equal(ContestStatus.ARCHIVED, 'ARCHIVED');
    assert.equal((ContestStatus as Record<string, string>).CANCELLED, undefined);
  });

  it('defines Category with organization scope and unique slug', () => {
    assert.match(schema, /model Category \{/);
    assert.match(schema, /organizationId\s+String/);
    assert.match(schema, /@@unique\(\[organizationId, slug\]\)/);
    assert.match(schema, /@@map\("categories"\)/);
  });

  it('defines Contest fields and the organization/status index', () => {
    assert.match(schema, /model Contest \{/);
    assert.match(schema, /autoAdvanceDelayMs\s+Int\s+@default\(1800\)/);
    assert.match(schema, /prizeSummary\s+String\?/);
    assert.match(schema, /rules\s+Json\?/);
    assert.match(schema, /@@index\(\[organizationId, status\]\)/);
    assert.match(schema, /@@map\("contests"\)/);
    assert.match(schema, /submissions\s+Submission\[\]/);
  });
});

describe('M05-P02 contest lifecycle', () => {
  it('allows only the documented forward step', () => {
    assert.equal(nextContestStatus(ContestStatus.DRAFT), ContestStatus.SCHEDULED);
    assert.equal(nextContestStatus(ContestStatus.SCHEDULED), ContestStatus.ACTIVE);
    assert.equal(nextContestStatus(ContestStatus.ACTIVE), ContestStatus.JUDGING);
    assert.equal(nextContestStatus(ContestStatus.JUDGING), ContestStatus.COMPLETED);
    assert.equal(nextContestStatus(ContestStatus.COMPLETED), ContestStatus.ARCHIVED);
    assert.equal(nextContestStatus(ContestStatus.ARCHIVED), null);

    assert.doesNotThrow(() =>
      assertContestTransition(ContestStatus.DRAFT, ContestStatus.SCHEDULED),
    );
    assert.throws(
      () => assertContestTransition(ContestStatus.DRAFT, ContestStatus.ACTIVE),
      (error: unknown) =>
        error instanceof ConflictError &&
        /Invalid contest status transition from DRAFT to ACTIVE/.test(error.message),
    );
    assert.throws(
      () => assertContestTransition(ContestStatus.ACTIVE, ContestStatus.SCHEDULED),
      ConflictError,
    );
    assert.throws(
      () => assertContestTransition(ContestStatus.ARCHIVED, ContestStatus.ACTIVE),
      ConflictError,
    );
  });

  it('locks configuration at ACTIVE and keeps COMPLETED/ARCHIVED read-only', () => {
    assert.doesNotThrow(() => assertContestConfigurationMutable(ContestStatus.DRAFT));
    assert.doesNotThrow(() => assertContestConfigurationMutable(ContestStatus.SCHEDULED));
    assert.throws(
      () => assertContestConfigurationMutable(ContestStatus.ACTIVE),
      (error: unknown) =>
        error instanceof ConflictError && /cannot be modified once a contest is ACTIVE/.test(error.message),
    );
    assert.throws(
      () => assertContestConfigurationMutable(ContestStatus.JUDGING),
      (error: unknown) => error instanceof ConflictError && /ACTIVE/.test(error.message),
    );
    assert.throws(
      () => assertContestConfigurationMutable(ContestStatus.COMPLETED),
      (error: unknown) =>
        error instanceof ConflictError && /read-only historical records/.test(error.message),
    );
    assert.throws(
      () => assertContestConfigurationMutable(ContestStatus.ARCHIVED),
      (error: unknown) =>
        error instanceof ConflictError && /read-only historical records/.test(error.message),
    );
  });
});

describe('M05-P03 contest zod schemas', () => {
  const validCreate = {
    organizationId: 'e7a18492-91f2-4c22-9fa4-a4f61e890123',
    title: 'Summer Comedy Slam',
    description: 'Short comedy entries.',
    startDate: '2026-10-01T00:00:00.000Z',
    endDate: '2026-10-31T00:00:00.000Z',
    category: { name: 'Comedy Skits' },
    rules: ['Be original'],
  };

  it('accepts a documented create payload and rejects skips, inverted dates, and unknown keys', () => {
    assert.equal(createContestSchema.parse(validCreate).title, 'Summer Comedy Slam');
    assert.equal(createContestSchema.safeParse({ ...validCreate, status: 'ACTIVE' }).success, false);
    assert.equal(
      createContestSchema.safeParse({ ...validCreate, criteria: ['humor'] }).success,
      false,
    );
    assert.equal(
      createContestSchema.safeParse({
        ...validCreate,
        endDate: '2026-09-01T00:00:00.000Z',
      }).success,
      false,
    );
  });

  it('accepts a status transition patch and rejects an empty patch', () => {
    assert.equal(updateContestSchema.parse({ status: 'SCHEDULED' }).status, 'SCHEDULED');
    assert.equal(updateContestSchema.safeParse({}).success, false);
    assert.equal(updateContestSchema.safeParse({ status: 'CANCELLED' }).success, false);
    assert.equal(listContestsQuerySchema.parse({ status: 'ACTIVE', category: 'comedy' }).status, 'ACTIVE');
    assert.equal(listContestsQuerySchema.safeParse({ status: 'PAUSED' }).success, false);
  });
});
