import { updateCounterSchema } from '../schemas/counter.schema.js';
import {
  getCounterStore,
  setCounterStoreForTests,
} from '../repositories/counter.repository.js';
import {
  CounterProjection,
  CounterRecord,
  CounterStats,
  ESTIMATE_NOTE,
  buildCounterStats,
  publicCounterStats,
  defaultCounterRecord,
  applyCounterPatch,
  projectCounter,
} from './counter-clock.js';
import { counterListenerCount } from './counter-realtime.js';

export interface CounterSnapshot extends CounterProjection {
  asOf: string;
  paused: boolean;
  provisional: boolean;
  title: string;
  subtitle: string;
  timezone: string;
  effectiveDailyEstimate: string;
  growthToday: string;
  nextChangeAt: string | null;
  nextChangeLabel: string | null;
  estimateNote: string;
}

export interface CounterConfigView {
  startingEstimate: string;
  remainderMicros: number;
  anchorAt: string;
  paused: boolean;
  frozenHits: string | null;
  baseRatePerSecond: number;
  estimatedUsers: string;
  averageUsesPerUserPerDay: number;
  manualRatePerSecond: number | null;
  weekdayMultipliers: number[];
  fridayBoost: number;
  weekendBoost: number;
  april20Multiplier: number;
  specialMonth: number;
  specialDay: number;
  specialMode: 'override' | 'stack';
  specialDates: CounterRecord['specialDates'];
  pending: CounterRecord['pending'];
  enabled: boolean;
  timezone: string;
  provisional: boolean;
  title: string;
  subtitle: string;
  updatedAt: string;
  updatedById: string | null;
}

const CACHE_MS = 5000;

let cached: { row: CounterRecord; at: number } | null = null;
let clockOverride: (() => Date) | null = null;

function now(): Date {
  return clockOverride ? clockOverride() : new Date();
}

export function setCounterClockForTests(clock: (() => Date) | null): void {
  clockOverride = clock;
  cached = null;
}

export function invalidateCounterCache(): void {
  cached = null;
}

export function resetCounterTestHooks(): void {
  clockOverride = null;
  cached = null;
  setCounterStoreForTests(null);
}

async function currentRow(): Promise<CounterRecord> {
  if (cached && now().getTime() - cached.at < CACHE_MS) return cached.row;
  const store = getCounterStore();
  const existing = await store.load();
  const row = existing ?? (await store.createIfMissing(defaultCounterRecord(now())));
  cached = { row, at: now().getTime() };
  return row;
}

function toSnapshot(
  record: CounterRecord,
  projection: CounterProjection,
  stats: CounterStats,
  asOf: Date,
): CounterSnapshot {
  return {
    ...projection,
    asOf: asOf.toISOString(),
    paused: record.paused || !record.enabled,
    provisional: record.provisional,
    title: record.title,
    subtitle: record.subtitle,
    timezone: record.timezone,
    effectiveDailyEstimate: stats.effectiveDailyEstimate,
    growthToday: stats.growthToday,
    nextChangeAt: stats.nextChangeAt,
    nextChangeLabel: stats.nextChangeLabel,
    estimateNote: stats.estimateNote || ESTIMATE_NOTE,
  };
}

function toConfig(record: CounterRecord): CounterConfigView {
  return {
    startingEstimate: record.startingEstimate,
    remainderMicros: record.remainderMicros,
    anchorAt: record.anchorAt.toISOString(),
    paused: record.paused,
    frozenHits: record.frozenHits,
    baseRatePerSecond: record.baseRatePerSecond,
    estimatedUsers: record.estimatedUsers,
    averageUsesPerUserPerDay: record.averageUsesPerUserPerDay,
    manualRatePerSecond: record.manualRatePerSecond,
    weekdayMultipliers: [...record.weekdayMultipliers],
    fridayBoost: record.fridayBoost,
    weekendBoost: record.weekendBoost,
    april20Multiplier: record.april20Multiplier,
    specialMonth: record.specialMonth,
    specialDay: record.specialDay,
    specialMode: record.specialMode,
    specialDates: record.specialDates.map((item) => ({ ...item })),
    pending: record.pending ? { ...record.pending } : null,
    enabled: record.enabled,
    timezone: record.timezone,
    provisional: record.provisional,
    title: record.title,
    subtitle: record.subtitle,
    updatedAt: record.updatedAt.toISOString(),
    updatedById: record.updatedById,
  };
}

function present(record: CounterRecord, asOf: Date, full = false) {
  const stats = full ? buildCounterStats(record, asOf) : publicCounterStats(record, asOf);
  return {
    config: toConfig(record),
    snapshot: toSnapshot(record, projectCounter(record, asOf), stats, asOf),
    stats,
  };
}

export const CounterService = {
  async snapshot(): Promise<CounterSnapshot> {
    const asOf = now();
    const row = await currentRow();
    return present(row, asOf).snapshot;
  },

  async adminView() {
    const asOf = now();
    const row = await currentRow();
    const view = present(row, asOf, true);
    const audits = await getCounterStore().listAudits(20);
    return {
      ...view,
      audits,
      stream: { listeners: counterListenerCount(), asOf: asOf.toISOString() },
    };
  },

  async preview(body: unknown) {
    const patch = updateCounterSchema.parse(body);
    const asOf = now();
    const current = await currentRow();
    const next = applyCounterPatch(current, patch, asOf);
    return present(next, asOf, true);
  },

  async exportSummary() {
    const asOf = now();
    const row = await currentRow();
    const view = present(row, asOf, true);
    return {
      exportedAt: asOf.toISOString(),
      estimateNote: ESTIMATE_NOTE,
      assumptions: {
        estimatedUsers: row.estimatedUsers,
        averageUsesPerUserPerDay: row.averageUsesPerUserPerDay,
        baseDailyEstimate: view.stats.baseDailyEstimate,
        manualRatePerSecond: row.manualRatePerSecond,
      },
      schedule: {
        timezone: row.timezone,
        weekdayMultipliers: row.weekdayMultipliers,
        fridayBoost: row.fridayBoost,
        weekendBoost: row.weekendBoost,
        specialMonth: row.specialMonth,
        specialDay: row.specialDay,
        specialMode: row.specialMode,
        april20Multiplier: row.april20Multiplier,
        specialDates: row.specialDates,
        pending: row.pending,
      },
      stats: view.stats,
      cumulativeHits: view.snapshot.hits,
    };
  },

  async update(actorId: string, body: unknown) {
    const patch = updateCounterSchema.parse(body);
    const asOf = now();
    const current = await currentRow();
    const before = toConfig(current);
    const next = applyCounterPatch(current, patch, asOf);
    next.updatedById = actorId;
    const saved = await getCounterStore().save(next, {
      actorId,
      createdAt: asOf,
      before,
      after: toConfig(next),
    });
    cached = { row: saved, at: asOf.getTime() };
    const view = present(saved, asOf, true);
    return { ...view, audits: await getCounterStore().listAudits(20) };
  },
};
