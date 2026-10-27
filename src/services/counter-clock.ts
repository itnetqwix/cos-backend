import { ValidationError } from '../utils/response.js';
import { utcToZonedWallTime, zonedWallTimeToUtc } from './contest-schedule.js';

/**
 * Phil's provisional model. These are assumptions, not measured live counts.
 *
 * baseDaily = users × uses per user per day
 * effectiveDaily = baseDaily × effective multiplier
 * per second = effectiveDaily / 86400
 *
 * Monday defaults to 0.8. Other weekdays default to 1.
 * Friday boost and weekend boost stack on that day's weekday multiplier.
 * April 20 defaults to 4.2 and replaces the weekly multiplier.
 * An admin can switch April 20, or any custom date, to stacking.
 *
 * Precedence on one local day: highest-priority matching custom date,
 * then the configured special date (April 20 by default), then the weekly
 * schedule. The main counter never resets at midnight.
 *
 * ponytail: one local-day segment at a time. Coarse buckets if an anchor
 * is kept for decades and snapshots become hot.
 */

export const MICROS_PER_HIT = 1_000_000;
const MILLION = 1_000_000n;
const DAY_MS = 86_400_000n;

export type WeekdayMultipliers = [number, number, number, number, number, number, number];
export type SpecialMode = 'override' | 'stack';

export interface SpecialDate {
  label: string;
  month: number;
  day: number;
  multiplier: number;
  mode: SpecialMode;
  recurring: boolean;
  startDate: string | null;
  endDate: string | null;
  priority: number;
}

export interface CounterPending {
  effectiveAt: string;
  endsAt: string | null;
  estimatedUsers?: string;
  averageUsesPerUserPerDay?: number;
  manualRatePerSecond?: number | null;
  weekdayMultipliers?: WeekdayMultipliers;
  fridayBoost?: number;
  weekendBoost?: number;
  april20Multiplier?: number;
  specialMonth?: number;
  specialDay?: number;
  specialMode?: SpecialMode;
  specialDates?: SpecialDate[];
  timezone?: string;
}

export interface CounterRecord {
  startingEstimate: string;
  remainderMicros: number;
  anchorAt: Date;
  paused: boolean;
  enabled: boolean;
  frozenHits: string | null;
  estimatedUsers: string;
  averageUsesPerUserPerDay: number;
  manualRatePerSecond: number | null;
  useAssumptions: boolean;
  baseRatePerSecond: number;
  weekdayMultipliers: WeekdayMultipliers;
  fridayBoost: number;
  weekendBoost: number;
  april20Multiplier: number;
  specialMonth: number;
  specialDay: number;
  specialMode: SpecialMode;
  specialDates: SpecialDate[];
  pending: CounterPending | null;
  timezone: string;
  provisional: boolean;
  title: string;
  subtitle: string;
  updatedAt: Date;
  updatedById: string | null;
}

export interface CounterPatch {
  startingEstimate?: string;
  confirmReset?: boolean;
  estimatedUsers?: string;
  averageUsesPerUserPerDay?: number;
  manualRatePerSecond?: number | null;
  weekdayMultipliers?: WeekdayMultipliers;
  fridayBoost?: number;
  weekendBoost?: number;
  april20Multiplier?: number;
  specialMonth?: number;
  specialDay?: number;
  specialMode?: SpecialMode;
  specialDates?: SpecialDate[];
  effectiveAt?: string | null;
  endsAt?: string | null;
  timezone?: string;
  provisional?: boolean;
  paused?: boolean;
  enabled?: boolean;
  title?: string;
  subtitle?: string;
}

export interface CounterProjection {
  hits: string;
  remainderMicros: number;
  ratePerSecond: number;
}

export interface RateDescription {
  multiplier: number;
  dailyHits: string;
  ratePerSecond: number;
  label: string;
  source: string;
}

export const ESTIMATE_NOTE = 'This is a model-based estimate, not a verified live count.';

export const PROVISIONAL_COUNTER_DEFAULTS = {
  startingEstimate: '0',
  estimatedUsers: '256000000',
  averageUsesPerUserPerDay: 3.2,
  manualRatePerSecond: null as number | null,
  useAssumptions: true,
  weekdayMultipliers: [1, 0.8, 1, 1, 1, 1, 1] as WeekdayMultipliers,
  fridayBoost: 1,
  weekendBoost: 1.2,
  april20Multiplier: 4.2,
  specialMonth: 4,
  specialDay: 20,
  specialMode: 'override' as SpecialMode,
  timezone: 'UTC',
  provisional: true,
  title: 'International Ripskis Counter',
  subtitle: 'Estimated hits worldwide',
};

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function millionths(value: number): bigint {
  if (!Number.isFinite(value)) throw new Error('Counter multiplier is invalid');
  return BigInt(Math.round(value * 1_000_000));
}

export function assumptionDailyHits(users: string, usesPerDay: number): bigint {
  return (BigInt(users) * millionths(usesPerDay)) / MILLION;
}

export function normalDailyMicros(record: CounterRecord): bigint {
  if (record.manualRatePerSecond != null) {
    return millionths(record.manualRatePerSecond) * 86_400n;
  }
  if (!record.useAssumptions) {
    return millionths(record.baseRatePerSecond) * 86_400n;
  }
  return (
    assumptionDailyHits(record.estimatedUsers, record.averageUsesPerUserPerDay) * MILLION
  );
}

export function defaultCounterRecord(now: Date): CounterRecord {
  const daily = assumptionDailyHits(
    PROVISIONAL_COUNTER_DEFAULTS.estimatedUsers,
    PROVISIONAL_COUNTER_DEFAULTS.averageUsesPerUserPerDay,
  );
  return {
    ...PROVISIONAL_COUNTER_DEFAULTS,
    weekdayMultipliers: [...PROVISIONAL_COUNTER_DEFAULTS.weekdayMultipliers],
    specialDates: [],
    pending: null,
    remainderMicros: 0,
    anchorAt: now,
    paused: false,
    enabled: true,
    frozenHits: null,
    baseRatePerSecond: Number(daily) / 86400,
    updatedAt: now,
    updatedById: null,
  };
}

function wallParts(
  instant: Date,
  timeZone: string,
): { date: string; month: number; day: number; dow: number } {
  const wall = utcToZonedWallTime(instant, timeZone);
  if (!wall) throw new Error('Counter timezone is invalid');
  const date = wall.slice(0, 10);
  const [year, month, day] = date.split('-').map(Number);
  return { date, month, day, dow: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
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

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function inWindow(date: string, start: string | null, end: string | null): boolean {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function weeklyMultiplier(
  record: CounterRecord,
  dow: number,
): { multiplier: number; label: string } {
  let multiplier = record.weekdayMultipliers[dow];
  let label = WEEKDAY_NAMES[dow];
  if (dow === 5) {
    multiplier *= record.fridayBoost;
    label = 'Friday';
  }
  if (dow === 0 || dow === 6) {
    multiplier *= record.weekendBoost;
    label = 'Weekend';
  }
  return { multiplier, label };
}

export function resolveActive(record: CounterRecord, instant: Date): CounterRecord {
  const pending = record.pending;
  if (!pending) return record;
  const t = instant.getTime();
  const start = Date.parse(pending.effectiveAt);
  const end = pending.endsAt ? Date.parse(pending.endsAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(start) || t < start || t >= end) return record;
  return {
    ...record,
    estimatedUsers: pending.estimatedUsers ?? record.estimatedUsers,
    averageUsesPerUserPerDay:
      pending.averageUsesPerUserPerDay ?? record.averageUsesPerUserPerDay,
    manualRatePerSecond:
      pending.manualRatePerSecond !== undefined
        ? pending.manualRatePerSecond
        : record.manualRatePerSecond,
    weekdayMultipliers: pending.weekdayMultipliers
      ? [...pending.weekdayMultipliers]
      : record.weekdayMultipliers,
    fridayBoost: pending.fridayBoost ?? record.fridayBoost,
    weekendBoost: pending.weekendBoost ?? record.weekendBoost,
    april20Multiplier: pending.april20Multiplier ?? record.april20Multiplier,
    specialMonth: pending.specialMonth ?? record.specialMonth,
    specialDay: pending.specialDay ?? record.specialDay,
    specialMode: pending.specialMode ?? record.specialMode,
    specialDates: pending.specialDates ?? record.specialDates,
    timezone: pending.timezone ?? record.timezone,
    pending: null,
  };
}

export function describeRate(record: CounterRecord, instant: Date): RateDescription {
  const active = resolveActive(record, instant);
  const wall = wallParts(instant, active.timezone);
  const weekly = weeklyMultiplier(active, wall.dow);
  const matches = active.specialDates.filter((item) => {
    if (item.month !== wall.month || item.day !== wall.day) return false;
    if (!item.recurring) {
      if (!item.startDate || !item.endDate) return false;
      return wall.date >= item.startDate && wall.date <= item.endDate;
    }
    return inWindow(wall.date, item.startDate, item.endDate);
  });
  matches.sort(
    (a, b) =>
      b.priority - a.priority || (b.startDate ?? '').localeCompare(a.startDate ?? ''),
  );
  let multiplier = weekly.multiplier;
  let label = weekly.label;
  let source = 'weekly';
  const chosen = matches[0];
  if (chosen) {
    multiplier =
      chosen.mode === 'stack' ? weekly.multiplier * chosen.multiplier : chosen.multiplier;
    label = chosen.label;
    source = 'custom';
  } else if (wall.month === active.specialMonth && wall.day === active.specialDay) {
    multiplier =
      active.specialMode === 'stack'
        ? weekly.multiplier * active.april20Multiplier
        : active.april20Multiplier;
    label = `Special date ${active.specialMonth}/${active.specialDay}`;
    source = 'special';
  }
  const daily = normalDailyMicros(active);
  const effective = (daily * millionths(multiplier)) / MILLION;
  const dailyHits = effective / MILLION;
  return {
    multiplier,
    dailyHits: dailyHits.toString(),
    ratePerSecond: Number(effective) / 1_000_000 / 86400,
    label,
    source,
  };
}

export function ratePerSecondAt(instant: Date, record: CounterRecord): number {
  if (record.paused || !record.enabled) return 0;
  return describeRate(record, instant).ratePerSecond;
}

function nextBoundary(record: CounterRecord, cursor: number): number {
  const active = resolveActive(record, new Date(cursor));
  let boundary = nextLocalMidnight(new Date(cursor), active.timezone).getTime();
  const pending = record.pending;
  if (pending) {
    const start = Date.parse(pending.effectiveAt);
    const end = pending.endsAt ? Date.parse(pending.endsAt) : Number.NaN;
    if (start > cursor && start < boundary) boundary = start;
    if (Number.isFinite(end) && end > cursor && end < boundary) boundary = end;
  }
  return boundary;
}

export function projectCounter(record: CounterRecord, now: Date): CounterProjection {
  const rateNow = ratePerSecondAt(now, record);
  if (record.paused || !record.enabled) {
    return {
      hits: record.frozenHits ?? record.startingEstimate,
      remainderMicros: 0,
      ratePerSecond: 0,
    };
  }
  if (now.getTime() <= record.anchorAt.getTime()) {
    return {
      hits: record.startingEstimate,
      remainderMicros: record.remainderMicros,
      ratePerSecond: rateNow,
    };
  }

  let micros = BigInt(record.startingEstimate) * MILLION + BigInt(record.remainderMicros);
  let cursor = record.anchorAt.getTime();
  const end = now.getTime();
  for (let guard = 0; cursor < end && guard < 200_000; guard += 1) {
    const segmentEnd = Math.min(nextBoundary(record, cursor), end);
    if (segmentEnd <= cursor) break;
    const active = resolveActive(record, new Date(cursor));
    const described = describeRate(active, new Date(cursor));
    const daily = normalDailyMicros(active);
    const added =
      (daily * millionths(described.multiplier) * BigInt(segmentEnd - cursor)) /
      (MILLION * DAY_MS);
    micros += added;
    cursor = segmentEnd;
  }

  return {
    hits: (micros / MILLION).toString(),
    remainderMicros: Number(micros % MILLION),
    ratePerSecond: rateNow,
  };
}

function rateFieldsTouched(patch: CounterPatch): boolean {
  return (
    patch.estimatedUsers !== undefined ||
    patch.averageUsesPerUserPerDay !== undefined ||
    patch.manualRatePerSecond !== undefined ||
    patch.weekdayMultipliers !== undefined ||
    patch.fridayBoost !== undefined ||
    patch.weekendBoost !== undefined ||
    patch.april20Multiplier !== undefined ||
    patch.specialMonth !== undefined ||
    patch.specialDay !== undefined ||
    patch.specialMode !== undefined ||
    patch.specialDates !== undefined ||
    patch.timezone !== undefined
  );
}

function derivedBaseRate(record: CounterRecord): number {
  return Number(normalDailyMicros(record) / 86_400n) / 1_000_000;
}

export function applyCounterPatch(
  current: CounterRecord,
  patch: CounterPatch,
  now: Date,
): CounterRecord {
  if (patch.startingEstimate !== undefined && patch.confirmReset !== true) {
    throw new ValidationError(
      'Confirm the count reset before changing the starting estimate',
    );
  }

  const next: CounterRecord = {
    ...current,
    weekdayMultipliers: [...current.weekdayMultipliers],
    specialDates: current.specialDates.map((item) => ({ ...item })),
    pending: current.pending ? { ...current.pending } : null,
    anchorAt: new Date(current.anchorAt),
    updatedAt: now,
  };

  const running = !current.paused && current.enabled;
  const willPause = patch.paused ?? current.paused;
  const willEnable = patch.enabled ?? current.enabled;
  const willRun = !willPause && willEnable;
  if (running && !willRun) {
    const live = projectCounter(current, now);
    next.paused = willPause;
    next.enabled = willEnable;
    next.frozenHits = live.hits;
    next.remainderMicros = 0;
  } else if (!running && willRun) {
    next.paused = false;
    next.enabled = true;
    next.startingEstimate = current.frozenHits ?? current.startingEstimate;
    next.remainderMicros = 0;
    next.anchorAt = now;
    next.frozenHits = null;
  } else {
    if (patch.paused !== undefined) next.paused = patch.paused;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
  }

  if (patch.startingEstimate !== undefined) {
    next.startingEstimate = BigInt(patch.startingEstimate).toString();
    next.remainderMicros = 0;
    next.anchorAt = now;
    if (!willRun) next.frozenHits = next.startingEstimate;
  }

  const future = patch.effectiveAt
    ? Date.parse(patch.effectiveAt) > now.getTime()
    : false;
  if (future && patch.effectiveAt) {
    next.pending = {
      effectiveAt: new Date(patch.effectiveAt).toISOString(),
      endsAt: patch.endsAt ? new Date(patch.endsAt).toISOString() : null,
      estimatedUsers: patch.estimatedUsers ?? current.estimatedUsers,
      averageUsesPerUserPerDay:
        patch.averageUsesPerUserPerDay ?? current.averageUsesPerUserPerDay,
      manualRatePerSecond:
        patch.manualRatePerSecond !== undefined
          ? patch.manualRatePerSecond
          : current.manualRatePerSecond,
      weekdayMultipliers: patch.weekdayMultipliers
        ? [...patch.weekdayMultipliers]
        : [...current.weekdayMultipliers],
      fridayBoost: patch.fridayBoost ?? current.fridayBoost,
      weekendBoost: patch.weekendBoost ?? current.weekendBoost,
      april20Multiplier: patch.april20Multiplier ?? current.april20Multiplier,
      specialMonth: patch.specialMonth ?? current.specialMonth,
      specialDay: patch.specialDay ?? current.specialDay,
      specialMode: patch.specialMode ?? current.specialMode,
      specialDates: patch.specialDates ?? current.specialDates,
      timezone: patch.timezone ?? current.timezone,
    };
  } else if (
    patch.startingEstimate === undefined &&
    rateFieldsTouched(patch) &&
    willRun &&
    running
  ) {
    const live = projectCounter(current, now);
    next.startingEstimate = live.hits;
    next.remainderMicros = live.remainderMicros;
    next.anchorAt = now;
    next.frozenHits = null;
    next.pending = patch.effectiveAt === null ? null : next.pending;
  }

  if (!future) {
    if (patch.estimatedUsers !== undefined)
      next.estimatedUsers = BigInt(patch.estimatedUsers).toString();
    if (patch.averageUsesPerUserPerDay !== undefined) {
      next.averageUsesPerUserPerDay = patch.averageUsesPerUserPerDay;
    }
    if (patch.manualRatePerSecond !== undefined)
      next.manualRatePerSecond = patch.manualRatePerSecond;
    if (
      patch.estimatedUsers !== undefined ||
      patch.averageUsesPerUserPerDay !== undefined
    ) {
      next.useAssumptions = next.manualRatePerSecond == null;
    }
    if (patch.weekdayMultipliers !== undefined)
      next.weekdayMultipliers = [...patch.weekdayMultipliers];
    if (patch.fridayBoost !== undefined) next.fridayBoost = patch.fridayBoost;
    if (patch.weekendBoost !== undefined) next.weekendBoost = patch.weekendBoost;
    if (patch.april20Multiplier !== undefined)
      next.april20Multiplier = patch.april20Multiplier;
    if (patch.specialMonth !== undefined) next.specialMonth = patch.specialMonth;
    if (patch.specialDay !== undefined) next.specialDay = patch.specialDay;
    if (patch.specialMode !== undefined) next.specialMode = patch.specialMode;
    if (patch.specialDates !== undefined)
      next.specialDates = patch.specialDates.map((item) => ({ ...item }));
    if (patch.timezone !== undefined) next.timezone = patch.timezone;
    if (patch.effectiveAt === null) next.pending = null;
  }

  if (patch.provisional !== undefined) next.provisional = patch.provisional;
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.subtitle !== undefined) next.subtitle = patch.subtitle;
  next.baseRatePerSecond = derivedBaseRate(next);
  return next;
}

export function growthSince(record: CounterRecord, from: Date, to: Date): bigint {
  const later = BigInt(projectCounter(record, to).hits);
  const earlier = BigInt(projectCounter(record, from).hits);
  return later - earlier;
}

export function localMidnight(instant: Date, timeZone: string): Date {
  const wall = utcToZonedWallTime(instant, timeZone);
  if (!wall) throw new Error('Counter timezone is invalid');
  const midnight = zonedWallTimeToUtc(`${wall.slice(0, 10)}T00:00:00`, timeZone);
  if (!midnight) throw new Error('Counter timezone is invalid');
  return midnight;
}

function dailyHitsOn(record: CounterRecord, ymd: string, timeZone: string): bigint {
  const noon = zonedWallTimeToUtc(`${ymd}T12:00:00`, timeZone);
  if (!noon) return 0n;
  return BigInt(describeRate(record, noon).dailyHits);
}

export interface CounterStats {
  baseDailyEstimate: string;
  effectiveMultiplier: number;
  effectiveDailyEstimate: string;
  ratePerSecond: number;
  multiplierLabel: string;
  growthToday: string;
  projectedWeek: string;
  projectedMonth: string;
  projectedYear: string;
  nextChangeAt: string | null;
  nextChangeLabel: string | null;
  estimateNote: string;
}

export function publicCounterStats(record: CounterRecord, now: Date): CounterStats {
  const active = resolveActive(record, now);
  const described = describeRate(record, now);
  const midnight = localMidnight(now, active.timezone);
  const next = nextScheduleChange(record, now);
  return {
    baseDailyEstimate: assumptionDailyHits(
      active.estimatedUsers,
      active.averageUsesPerUserPerDay,
    ).toString(),
    effectiveMultiplier: described.multiplier,
    effectiveDailyEstimate: described.dailyHits,
    ratePerSecond: described.ratePerSecond,
    multiplierLabel: described.label,
    growthToday: growthSince(record, midnight, now).toString(),
    projectedWeek: '0',
    projectedMonth: '0',
    projectedYear: '0',
    nextChangeAt: next?.at ?? null,
    nextChangeLabel: next?.label ?? null,
    estimateNote: ESTIMATE_NOTE,
  };
}

export function buildCounterStats(record: CounterRecord, now: Date): CounterStats {
  const active = resolveActive(record, now);
  const described = describeRate(record, now);
  const base = assumptionDailyHits(
    active.estimatedUsers,
    active.averageUsesPerUserPerDay,
  );
  const today = wallParts(now, active.timezone).date;
  let week = 0n;
  let year = 0n;
  for (let i = 0; i < 365; i += 1) {
    const hits = dailyHitsOn(record, addDays(today, i), active.timezone);
    year += hits;
    if (i < 7) week += hits;
  }
  const [yearNum, monthNum] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
  let month = 0n;
  for (let day = 1; day <= lastDay; day += 1) {
    const ymd = `${today.slice(0, 8)}${String(day).padStart(2, '0')}`;
    month += dailyHitsOn(record, ymd, active.timezone);
  }
  const midnight = localMidnight(now, active.timezone);
  const next = nextScheduleChange(record, now);
  return {
    baseDailyEstimate: base.toString(),
    effectiveMultiplier: described.multiplier,
    effectiveDailyEstimate: described.dailyHits,
    ratePerSecond: described.ratePerSecond,
    multiplierLabel: described.label,
    growthToday: growthSince(record, midnight, now).toString(),
    projectedWeek: week.toString(),
    projectedMonth: month.toString(),
    projectedYear: year.toString(),
    nextChangeAt: next?.at ?? null,
    nextChangeLabel: next?.label ?? null,
    estimateNote: ESTIMATE_NOTE,
  };
}

export function nextScheduleChange(
  record: CounterRecord,
  now: Date,
): { at: string; label: string } | null {
  const here = describeRate(record, now);
  let cursor = now.getTime();
  const limit = cursor + 370 * 86_400_000;
  while (cursor < limit) {
    const next = nextBoundary(record, cursor);
    if (next <= cursor) return null;
    const there = describeRate(record, new Date(next));
    if (
      there.source !== here.source ||
      there.multiplier !== here.multiplier ||
      there.dailyHits !== here.dailyHits
    ) {
      return { at: new Date(next).toISOString(), label: there.label };
    }
    cursor = next;
  }
  return null;
}
