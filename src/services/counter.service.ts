import { updateCounterSchema } from '../schemas/counter.schema.js';
import {
  getCounterStore,
  setCounterStoreForTests,
} from '../repositories/counter.repository.js';
import {
  CounterProjection,
  CounterRecord,
  defaultCounterRecord,
  applyCounterPatch,
  projectCounter,
} from './counter-clock.js';

export interface CounterSnapshot extends CounterProjection {
  asOf: string;
  paused: boolean;
  provisional: boolean;
  title: string;
  subtitle: string;
  timezone: string;
}

export interface CounterConfigView {
  startingEstimate: string;
  remainderMicros: number;
  anchorAt: string;
  paused: boolean;
  frozenHits: string | null;
  baseRatePerSecond: number;
  weekdayMultipliers: number[];
  fridayBoost: number;
  weekendBoost: number;
  april20Multiplier: number;
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
  asOf: Date,
): CounterSnapshot {
  return {
    ...projection,
    asOf: asOf.toISOString(),
    paused: record.paused,
    provisional: record.provisional,
    title: record.title,
    subtitle: record.subtitle,
    timezone: record.timezone,
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
    weekdayMultipliers: [...record.weekdayMultipliers],
    fridayBoost: record.fridayBoost,
    weekendBoost: record.weekendBoost,
    april20Multiplier: record.april20Multiplier,
    timezone: record.timezone,
    provisional: record.provisional,
    title: record.title,
    subtitle: record.subtitle,
    updatedAt: record.updatedAt.toISOString(),
    updatedById: record.updatedById,
  };
}

export const CounterService = {
  async snapshot(): Promise<CounterSnapshot> {
    const asOf = now();
    const row = await currentRow();
    return toSnapshot(row, projectCounter(row, asOf), asOf);
  },

  async adminView(): Promise<{ config: CounterConfigView; snapshot: CounterSnapshot }> {
    const asOf = now();
    const row = await currentRow();
    return {
      config: toConfig(row),
      snapshot: toSnapshot(row, projectCounter(row, asOf), asOf),
    };
  },

  async update(
    actorId: string,
    body: unknown,
  ): Promise<{ config: CounterConfigView; snapshot: CounterSnapshot }> {
    const patch = updateCounterSchema.parse(body);
    const asOf = now();
    const current = await currentRow();
    const next = applyCounterPatch(current, patch, asOf);
    next.updatedById = actorId;
    const saved = await getCounterStore().save(next);
    cached = { row: saved, at: asOf.getTime() };
    return {
      config: toConfig(saved),
      snapshot: toSnapshot(saved, projectCounter(saved, asOf), asOf),
    };
  },
};
