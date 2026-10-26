import { utcToZonedWallTime } from './contest-schedule.js';

/**
 * International Ripskis Counter clock.
 *
 * Product figures are NOT SPECIFIED. `PROVISIONAL_COUNTER_DEFAULTS` is an
 * estimate so the clock runs before an admin replaces it.
 *
 * Weekday multipliers use the calendar day in `timezone` (Sunday = 0).
 * Friday boost stacks on Friday. Weekend boost stacks on Saturday and Sunday.
 * The April 20 multiplier stacks for that whole local calendar day.
 * Daylight-saving length is the real elapsed time between local midnights.
 *
 * ponytail: one segment per local day. Coarse buckets if an anchor is ever
 * kept for decades and a snapshot per second becomes hot.
 */

export const MICROS_PER_HIT = 1_000_000;

export type WeekdayMultipliers = [number, number, number, number, number, number, number];

export interface CounterRecord {
  startingEstimate: string;
  remainderMicros: number;
  anchorAt: Date;
  paused: boolean;
  frozenHits: string | null;
  baseRatePerSecond: number;
  weekdayMultipliers: WeekdayMultipliers;
  fridayBoost: number;
  weekendBoost: number;
  april20Multiplier: number;
  timezone: string;
  provisional: boolean;
  title: string;
  subtitle: string;
  updatedAt: Date;
  updatedById: string | null;
}

export interface CounterPatch {
  startingEstimate?: string;
  baseRatePerSecond?: number;
  weekdayMultipliers?: WeekdayMultipliers;
  fridayBoost?: number;
  weekendBoost?: number;
  april20Multiplier?: number;
  timezone?: string;
  provisional?: boolean;
  paused?: boolean;
  title?: string;
  subtitle?: string;
}

export interface CounterProjection {
  hits: string;
  remainderMicros: number;
  ratePerSecond: number;
}

export const PROVISIONAL_COUNTER_DEFAULTS = {
  startingEstimate: '1000000000',
  baseRatePerSecond: 2.5,
  weekdayMultipliers: [1.1, 1, 1.05, 1.1, 1.15, 1.4, 1.25] as WeekdayMultipliers,
  fridayBoost: 1.2,
  weekendBoost: 1.15,
  april20Multiplier: 4.2,
  timezone: 'UTC',
  provisional: true,
  title: 'International Ripskis Counter',
  subtitle: 'Estimated hits worldwide',
};

export function defaultCounterRecord(now: Date): CounterRecord {
  return {
    ...PROVISIONAL_COUNTER_DEFAULTS,
    weekdayMultipliers: [...PROVISIONAL_COUNTER_DEFAULTS.weekdayMultipliers],
    remainderMicros: 0,
    anchorAt: now,
    paused: false,
    frozenHits: null,
    updatedAt: now,
    updatedById: null,
  };
}

function wallDate(
  instant: Date,
  timeZone: string,
): { month: number; day: number; dow: number } {
  const wall = utcToZonedWallTime(instant, timeZone);
  if (!wall) throw new Error('Counter timezone is invalid');
  const [year, month, day] = wall.slice(0, 10).split('-').map(Number);
  return {
    month,
    day,
    dow: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

export function nextLocalMidnight(instant: Date, timeZone: string): Date {
  const wall = utcToZonedWallTime(instant, timeZone);
  if (!wall) throw new Error('Counter timezone is invalid');
  const today = wall.slice(0, 10);
  let lo = instant.getTime();
  let hi = instant.getTime() + 36 * 60 * 60 * 1000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const midWall = utcToZonedWallTime(new Date(mid), timeZone);
    if (midWall && midWall.slice(0, 10) === today) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

export function ratePerSecondAt(instant: Date, record: CounterRecord): number {
  const { month, day, dow } = wallDate(instant, record.timezone);
  let rate = record.baseRatePerSecond * record.weekdayMultipliers[dow];
  if (dow === 5) rate *= record.fridayBoost;
  if (dow === 0 || dow === 6) rate *= record.weekendBoost;
  if (month === 4 && day === 20) rate *= record.april20Multiplier;
  return rate;
}

export function projectCounter(record: CounterRecord, now: Date): CounterProjection {
  if (record.paused) {
    return {
      hits: record.frozenHits ?? record.startingEstimate,
      remainderMicros: 0,
      ratePerSecond: 0,
    };
  }

  const rateNow = ratePerSecondAt(now, record);
  if (now.getTime() <= record.anchorAt.getTime()) {
    return {
      hits: record.startingEstimate,
      remainderMicros: record.remainderMicros,
      ratePerSecond: rateNow,
    };
  }

  const microsPerHit = BigInt(MICROS_PER_HIT);
  let micros =
    BigInt(record.startingEstimate) * microsPerHit + BigInt(record.remainderMicros);
  let cursor = record.anchorAt.getTime();
  const end = now.getTime();
  for (let guard = 0; cursor < end && guard < 200_000; guard += 1) {
    const segmentEnd = Math.min(
      nextLocalMidnight(new Date(cursor), record.timezone).getTime(),
      end,
    );
    if (segmentEnd <= cursor) break;
    const perSecond = BigInt(
      Math.round(ratePerSecondAt(new Date(cursor), record) * MICROS_PER_HIT),
    );
    micros += (perSecond * BigInt(segmentEnd - cursor)) / 1000n;
    cursor = segmentEnd;
  }

  return {
    hits: (micros / microsPerHit).toString(),
    remainderMicros: Number(micros % microsPerHit),
    ratePerSecond: rateNow,
  };
}

function rateFieldsTouched(patch: CounterPatch): boolean {
  return (
    patch.baseRatePerSecond !== undefined ||
    patch.weekdayMultipliers !== undefined ||
    patch.fridayBoost !== undefined ||
    patch.weekendBoost !== undefined ||
    patch.april20Multiplier !== undefined ||
    patch.timezone !== undefined
  );
}

export function applyCounterPatch(
  current: CounterRecord,
  patch: CounterPatch,
  now: Date,
): CounterRecord {
  const next: CounterRecord = {
    ...current,
    weekdayMultipliers: [...current.weekdayMultipliers],
    anchorAt: new Date(current.anchorAt),
    updatedAt: now,
  };

  if (patch.paused === true && !current.paused) {
    const live = projectCounter(current, now);
    next.paused = true;
    next.frozenHits = live.hits;
    next.remainderMicros = 0;
  } else if (patch.paused === false && current.paused) {
    next.paused = false;
    next.startingEstimate = current.frozenHits ?? current.startingEstimate;
    next.remainderMicros = 0;
    next.anchorAt = now;
    next.frozenHits = null;
  }

  if (patch.startingEstimate !== undefined) {
    next.startingEstimate = BigInt(patch.startingEstimate).toString();
    next.remainderMicros = 0;
    next.anchorAt = now;
    if (next.paused) next.frozenHits = next.startingEstimate;
  } else if (rateFieldsTouched(patch) && !next.paused) {
    const live = projectCounter(current, now);
    next.startingEstimate = live.hits;
    next.remainderMicros = live.remainderMicros;
    next.anchorAt = now;
    next.frozenHits = null;
  }

  if (patch.baseRatePerSecond !== undefined)
    next.baseRatePerSecond = patch.baseRatePerSecond;
  if (patch.weekdayMultipliers !== undefined) {
    next.weekdayMultipliers = [...patch.weekdayMultipliers];
  }
  if (patch.fridayBoost !== undefined) next.fridayBoost = patch.fridayBoost;
  if (patch.weekendBoost !== undefined) next.weekendBoost = patch.weekendBoost;
  if (patch.april20Multiplier !== undefined)
    next.april20Multiplier = patch.april20Multiplier;
  if (patch.timezone !== undefined) next.timezone = patch.timezone;
  if (patch.provisional !== undefined) next.provisional = patch.provisional;
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.subtitle !== undefined) next.subtitle = patch.subtitle;
  return next;
}
