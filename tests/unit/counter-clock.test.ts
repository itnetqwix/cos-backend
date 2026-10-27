import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../../src/utils/response.js';
import {
  applyCounterPatch,
  assumptionDailyHits,
  defaultCounterRecord,
  describeRate,
  nextLocalMidnight,
  projectCounter,
  PROVISIONAL_COUNTER_DEFAULTS,
  type CounterRecord,
} from '../../src/services/counter-clock.js';

function record(overrides: Partial<CounterRecord> = {}): CounterRecord {
  const base = defaultCounterRecord(new Date('2026-01-01T00:00:00.000Z'));
  return {
    ...base,
    manualRatePerSecond: 1,
    weekdayMultipliers: [1, 1, 1, 1, 1, 1, 1],
    fridayBoost: 1,
    weekendBoost: 1,
    april20Multiplier: 1,
    timezone: 'UTC',
    ...overrides,
  };
}

function phil(anchor: string): CounterRecord {
  return {
    ...defaultCounterRecord(new Date(anchor)),
    anchorAt: new Date(anchor),
    startingEstimate: '0',
    remainderMicros: 0,
  };
}

describe('counter clock', () => {
  it('marks factory defaults as provisional estimates', () => {
    const row = defaultCounterRecord(new Date('2026-10-26T00:00:00.000Z'));
    assert.equal(row.provisional, true);
    assert.equal(row.startingEstimate, PROVISIONAL_COUNTER_DEFAULTS.startingEstimate);
    assert.equal(row.timezone, 'UTC');
    assert.equal(row.paused, false);
    assert.equal(row.specialMonth, 4);
    assert.equal(row.specialDay, 20);
    assert.equal(row.specialMode, 'override');
    assert.equal(assumptionDailyHits(row.estimatedUsers, row.averageUsesPerUserPerDay).toString(), '819200000');
  });

  it('matches Phil’s daily totals and does not stack April 20 by default', () => {
    const tuesday = projectCounter(phil('2026-04-21T00:00:00.000Z'), new Date('2026-04-22T00:00:00.000Z'));
    const monday = projectCounter(phil('2026-04-13T00:00:00.000Z'), new Date('2026-04-14T00:00:00.000Z'));
    const weekend = projectCounter(phil('2026-04-18T00:00:00.000Z'), new Date('2026-04-19T00:00:00.000Z'));
    const april20 = projectCounter(phil('2026-04-20T00:00:00.000Z'), new Date('2026-04-21T00:00:00.000Z'));
    assert.equal(tuesday.hits, '819200000');
    assert.equal(monday.hits, '655360000');
    assert.equal(weekend.hits, '983040000');
    assert.equal(april20.hits, '3440640000');
    assert.ok(Math.abs(describeRate(phil('2026-04-21T12:00:00.000Z'), new Date('2026-04-21T12:00:00.000Z')).ratePerSecond - 819200000 / 86400) < 1e-6);
    assert.ok(Math.abs(describeRate(phil('2026-04-18T12:00:00.000Z'), new Date('2026-04-18T12:00:00.000Z')).ratePerSecond - 983040000 / 86400) < 1e-4);
    assert.ok(Math.abs(describeRate(phil('2026-04-20T12:00:00.000Z'), new Date('2026-04-20T12:00:00.000Z')).ratePerSecond - 3440640000 / 86400) < 1e-3);

    const stacked = phil('2026-04-20T00:00:00.000Z');
    stacked.specialMode = 'stack';
    assert.equal(projectCounter(stacked, new Date('2026-04-21T00:00:00.000Z')).hits, '2752512000');
  });

  it('lets a custom date beat April 20, and a higher priority beat another custom date', () => {
    const custom = phil('2026-04-20T00:00:00.000Z');
    custom.specialDates = [
      {
        label: 'Lower',
        month: 4,
        day: 20,
        multiplier: 2,
        mode: 'override',
        recurring: true,
        startDate: null,
        endDate: null,
        priority: 1,
      },
      {
        label: 'Higher',
        month: 4,
        day: 20,
        multiplier: 3,
        mode: 'override',
        recurring: true,
        startDate: null,
        endDate: null,
        priority: 5,
      },
    ];
    const described = describeRate(custom, new Date('2026-04-20T12:00:00.000Z'));
    assert.equal(described.label, 'Higher');
    assert.equal(described.dailyHits, '2457600000');

    const closed = phil('2026-04-20T00:00:00.000Z');
    closed.specialDates = [
      {
        label: 'Closed window',
        month: 4,
        day: 20,
        multiplier: 9,
        mode: 'override',
        recurring: false,
        startDate: '2025-04-20',
        endDate: '2025-04-20',
        priority: 9,
      },
    ];
    assert.equal(describeRate(closed, new Date('2026-04-20T12:00:00.000Z')).source, 'special');
  });

  it('keeps growing across midnight and a scheduled rate change', () => {
    const row = phil('2026-04-21T00:00:00.000Z');
    const noon = projectCounter(row, new Date('2026-04-21T12:00:00.000Z'));
    const nextMorning = projectCounter(row, new Date('2026-04-22T12:00:00.000Z'));
    assert.ok(BigInt(nextMorning.hits) > BigInt(noon.hits));
    assert.notEqual(nextMorning.hits, '0');

    const scheduled = applyCounterPatch(
      row,
      { weekendBoost: 2, effectiveAt: '2026-04-25T00:00:00.000Z' },
      new Date('2026-04-21T12:00:00.000Z'),
    );
    assert.equal(scheduled.weekendBoost, 1.2);
    assert.equal(scheduled.pending?.weekendBoost, 2);
    const before = projectCounter(scheduled, new Date('2026-04-24T12:00:00.000Z'));
    const during = projectCounter(scheduled, new Date('2026-04-25T12:00:00.000Z'));
    assert.ok(BigInt(during.hits) > BigInt(before.hits));
  });

  it('lands on the next UTC midnight', () => {
    const next = nextLocalMidnight(new Date('2026-10-16T15:30:00.000Z'), 'UTC');
    assert.equal(next.toISOString(), '2026-10-17T00:00:00.000Z');
  });

  it('uses a 23 hour New York spring-forward day and a 25 hour fall-back day', () => {
    const spring = record({
      anchorAt: new Date('2026-03-08T05:00:00.000Z'),
      startingEstimate: '0',
    });
    const springHits = projectCounter(spring, new Date('2026-03-09T04:00:00.000Z'));
    assert.equal(springHits.hits, String(23 * 3600));

    const fall = record({
      anchorAt: new Date('2026-11-01T04:00:00.000Z'),
      startingEstimate: '0',
    });
    const fallHits = projectCounter(fall, new Date('2026-11-02T05:00:00.000Z'));
    assert.equal(fallHits.hits, String(25 * 3600));
  });

  it('splits Friday and weekend boosts at the local midnight', () => {
    const friday = record({
      anchorAt: new Date('2026-10-15T18:00:00.000Z'),
      startingEstimate: '0',
      manualRatePerSecond: 10,
      fridayBoost: 2,
      timezone: 'Asia/Kolkata',
    });
    const across = projectCounter(friday, new Date('2026-10-15T19:00:00.000Z'));
    assert.equal(across.hits, '54000');

    const saturday = record({
      anchorAt: new Date('2026-10-17T00:00:00.000Z'),
      startingEstimate: '0',
      weekdayMultipliers: [1, 1, 1, 1, 1, 1, 3],
      weekendBoost: 2,
    });
    const weekend = projectCounter(saturday, new Date('2026-10-17T00:10:00.000Z'));
    assert.equal(weekend.hits, '3600');
  });

  it('applies the April 20 multiplier only on that local calendar day', () => {
    assert.equal(new Date(Date.UTC(2026, 3, 20)).getUTCDay(), 1);
    const day = record({
      anchorAt: new Date('2026-04-19T23:00:00.000Z'),
      startingEstimate: '0',
      april20Multiplier: 4,
    });
    const hits = projectCounter(day, new Date('2026-04-20T01:00:00.000Z'));
    assert.equal(hits.hits, '18000');

    const kolkata = record({
      anchorAt: new Date('2026-04-19T18:00:00.000Z'),
      startingEstimate: '0',
      april20Multiplier: 4,
      timezone: 'Asia/Kolkata',
    });
    const local = projectCounter(kolkata, new Date('2026-04-19T19:00:00.000Z'));
    assert.equal(local.hits, '9000');
  });

  it('freezes while paused and keeps the fractional hit when rates change', () => {
    const running = record({
      anchorAt: new Date('2026-06-01T00:00:00.000Z'),
      startingEstimate: '100',
      manualRatePerSecond: 1.5,
    });
    const atOneSecond = new Date('2026-06-01T00:00:01.000Z');
    const live = projectCounter(running, atOneSecond);
    assert.equal(live.hits, '101');
    assert.equal(live.remainderMicros, 500_000);

    const paused = applyCounterPatch(running, { paused: true }, atOneSecond);
    const later = projectCounter(paused, new Date('2026-06-02T00:00:00.000Z'));
    assert.equal(later.hits, '101');
    assert.equal(later.ratePerSecond, 0);

    const slowed = applyCounterPatch(running, { manualRatePerSecond: 0 }, atOneSecond);
    const held = projectCounter(slowed, new Date('2026-06-01T00:00:10.000Z'));
    assert.equal(held.hits, '101');
    assert.equal(held.remainderMicros, 500_000);

    assert.throws(
      () => applyCounterPatch(slowed, { startingEstimate: '0005' }, atOneSecond),
      (error: unknown) => error instanceof ValidationError,
    );
    const reset = applyCounterPatch(
      slowed,
      { startingEstimate: '0005', confirmReset: true },
      atOneSecond,
    );
    assert.equal(projectCounter(reset, atOneSecond).hits, '5');
    assert.equal(reset.remainderMicros, 0);
  });

  it('resumes from the frozen integer', () => {
    const running = record({
      anchorAt: new Date('2026-06-01T00:00:00.000Z'),
      startingEstimate: '10',
      manualRatePerSecond: 2,
    });
    const pausedAt = new Date('2026-06-01T00:00:05.000Z');
    const paused = applyCounterPatch(running, { paused: true }, pausedAt);
    const resumed = applyCounterPatch(paused, { paused: false }, new Date('2026-06-01T01:00:00.000Z'));
    const after = projectCounter(resumed, new Date('2026-06-01T01:00:02.000Z'));
    assert.equal(resumed.startingEstimate, '20');
    assert.equal(after.hits, '24');
  });
});
