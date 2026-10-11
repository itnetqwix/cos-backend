import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../../src/utils/response.js';
import {
  SUBMISSION_DEADLINE_AFTER_OPENING,
  VOTING_CLOSURE_AFTER_DEADLINE,
  assertChronologicalSchedule,
  todayDateTimeLocal,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from '../../src/services/contest-schedule.js';

describe('contest schedule timezones', () => {
  it('converts Kolkata, Colombo, and New York wall times to absolute instants', () => {
    const kolkata = zonedWallTimeToUtc('2026-10-11T00:00', 'Asia/Kolkata');
    const colombo = zonedWallTimeToUtc('2026-10-11T00:00', 'Asia/Colombo');
    const winter = zonedWallTimeToUtc('2026-01-15T12:00', 'America/New_York');
    const summer = zonedWallTimeToUtc('2026-07-15T12:00', 'America/New_York');

    assert.equal(kolkata?.toISOString(), '2026-10-10T18:30:00.000Z');
    assert.equal(colombo?.toISOString(), '2026-10-10T18:30:00.000Z');
    assert.equal(winter?.toISOString(), '2026-01-15T17:00:00.000Z');
    assert.equal(summer?.toISOString(), '2026-07-15T16:00:00.000Z');
    assert.equal(utcToZonedWallTime(summer!, 'America/New_York'), '2026-07-15T12:00');
    assert.equal(utcToZonedWallTime(kolkata!, 'Asia/Kolkata'), '2026-10-11T00:00');
  });

  it('uses the contest timezone for today and rejects a daylight-saving gap', () => {
    const instant = new Date('2026-10-11T03:30:00.000Z');
    assert.equal(todayDateTimeLocal('Asia/Kolkata', instant), '2026-10-11T00:00');
    assert.equal(todayDateTimeLocal('Asia/Colombo', instant), '2026-10-11T00:00');
    assert.equal(todayDateTimeLocal('America/New_York', instant), '2026-10-10T00:00');
    assert.equal(zonedWallTimeToUtc('2026-03-08T02:30', 'America/New_York'), null);

    const fallback = zonedWallTimeToUtc('2026-11-01T01:30', 'America/New_York');
    assert.ok(fallback);
    assert.equal(utcToZonedWallTime(fallback, 'America/New_York'), '2026-11-01T01:30');
    assert.ok(
      fallback.toISOString() === '2026-11-01T05:30:00.000Z' ||
        fallback.toISOString() === '2026-11-01T06:30:00.000Z',
    );
  });

  it('rejects equal or reversed schedule instants', () => {
    const open = new Date('2026-10-11T00:00:00.000Z');
    const same = new Date('2026-10-11T00:00:00.000Z');
    const later = new Date('2026-10-12T00:00:00.000Z');
    const afterVoting = new Date('2026-10-13T00:00:00.000Z');

    assert.throws(
      () =>
        assertChronologicalSchedule({
          submissionOpenAt: open,
          submissionDeadlineAt: same,
        }),
      (error: unknown) =>
        error instanceof ValidationError && error.message === SUBMISSION_DEADLINE_AFTER_OPENING,
    );
    assert.throws(
      () =>
        assertChronologicalSchedule({
          submissionOpenAt: later,
          submissionDeadlineAt: open,
          votingClosesAt: afterVoting,
        }),
      (error: unknown) =>
        error instanceof ValidationError && error.message === SUBMISSION_DEADLINE_AFTER_OPENING,
    );
    assert.throws(
      () =>
        assertChronologicalSchedule({
          submissionOpenAt: open,
          submissionDeadlineAt: later,
          votingClosesAt: later,
        }),
      (error: unknown) =>
        error instanceof ValidationError && error.message === VOTING_CLOSURE_AFTER_DEADLINE,
    );
    assert.doesNotThrow(() =>
      assertChronologicalSchedule({
        submissionOpenAt: open,
        submissionDeadlineAt: later,
        votingClosesAt: null,
      }),
    );
    assert.doesNotThrow(() =>
      assertChronologicalSchedule({
        submissionOpenAt: open,
        submissionDeadlineAt: later,
        votingClosesAt: afterVoting,
      }),
    );
  });
});
