import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCounterPatch,
  defaultCounterRecord,
  nextLocalMidnight,
  projectCounter,
  PROVISIONAL_COUNTER_DEFAULTS,
  type CounterRecord,
} from '../../src/services/counter-clock.js';

function record(overrides: Partial<CounterRecord> = {}): CounterRecord {
  const base = defaultCounterRecord(new Date('2026-01-01T00:00:00.000Z'));
  return {
    ...base,
    baseRatePerSecond: 1,
    weekdayMultipliers: [1, 1, 1, 1, 1, 1, 1],
    fridayBoost: 1,
    weekendBoost: 1,
    april20Multiplier: 1,
    timezone: 'UTC',
    ...overrides,
  };
}

describe('counter clock', () => {
  it('marks factory defaults as provisional estimates', () => {
    const row = defaultCounterRecord(new Date('2026-10-26T00:00:00.000Z'));
    assert.equal(row.provisional, true);
    assert.equal(row.startingEstimate, PROVISIONAL_COUNTER_DEFAULTS.startingEstimate);
    assert.equal(row.timezone, 'UTC');
    assert.equal(row.paused, false);
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
      baseRatePerSecond: 10,
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
      baseRatePerSecond: 1.5,
    });
    const atOneSecond = new Date('2026-06-01T00:00:01.000Z');
    const live = projectCounter(running, atOneSecond);
    assert.equal(live.hits, '101');
    assert.equal(live.remainderMicros, 500_000);

    const paused = applyCounterPatch(running, { paused: true }, atOneSecond);
    const later = projectCounter(paused, new Date('2026-06-02T00:00:00.000Z'));
    assert.equal(later.hits, '101');
    assert.equal(later.ratePerSecond, 0);

    const slowed = applyCounterPatch(running, { baseRatePerSecond: 0 }, atOneSecond);
    const held = projectCounter(slowed, new Date('2026-06-01T00:00:10.000Z'));
    assert.equal(held.hits, '101');
    assert.equal(held.remainderMicros, 500_000);

    const reset = applyCounterPatch(slowed, { startingEstimate: '0005' }, atOneSecond);
    assert.equal(projectCounter(reset, atOneSecond).hits, '5');
    assert.equal(reset.remainderMicros, 0);
  });

  it('resumes from the frozen integer', () => {
    const running = record({
      anchorAt: new Date('2026-06-01T00:00:00.000Z'),
      startingEstimate: '10',
      baseRatePerSecond: 2,
    });
    const pausedAt = new Date('2026-06-01T00:00:05.000Z');
    const paused = applyCounterPatch(running, { paused: true }, pausedAt);
    const resumed = applyCounterPatch(paused, { paused: false }, new Date('2026-06-01T01:00:00.000Z'));
    const after = projectCounter(resumed, new Date('2026-06-01T01:00:02.000Z'));
    assert.equal(resumed.startingEstimate, '20');
    assert.equal(after.hits, '24');
  });
});
