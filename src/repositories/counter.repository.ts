import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { CounterRecord, WeekdayMultipliers } from '../services/counter-clock.js';

export const COUNTER_ID = 'singleton';

export interface CounterStore {
  load(): Promise<CounterRecord | null>;
  createIfMissing(record: CounterRecord): Promise<CounterRecord>;
  save(record: CounterRecord): Promise<CounterRecord>;
}

function asWeekdays(value: Prisma.JsonValue): WeekdayMultipliers {
  if (
    !Array.isArray(value) ||
    value.length !== 7 ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    throw new Error('Stored weekday multipliers are invalid');
  }
  return value as WeekdayMultipliers;
}

function toRecord(row: {
  startingEstimate: string;
  remainderMicros: number;
  anchorAt: Date;
  paused: boolean;
  frozenHits: string | null;
  baseRatePerSecond: number;
  weekdayMultipliers: Prisma.JsonValue;
  fridayBoost: number;
  weekendBoost: number;
  april20Multiplier: number;
  timezone: string;
  provisional: boolean;
  title: string;
  subtitle: string;
  updatedAt: Date;
  updatedById: string | null;
}): CounterRecord {
  return {
    startingEstimate: row.startingEstimate,
    remainderMicros: row.remainderMicros,
    anchorAt: row.anchorAt,
    paused: row.paused,
    frozenHits: row.frozenHits,
    baseRatePerSecond: row.baseRatePerSecond,
    weekdayMultipliers: asWeekdays(row.weekdayMultipliers),
    fridayBoost: row.fridayBoost,
    weekendBoost: row.weekendBoost,
    april20Multiplier: row.april20Multiplier,
    timezone: row.timezone,
    provisional: row.provisional,
    title: row.title,
    subtitle: row.subtitle,
    updatedAt: row.updatedAt,
    updatedById: row.updatedById,
  };
}

function toData(record: CounterRecord): Prisma.RipskisCounterCreateInput {
  return {
    id: COUNTER_ID,
    startingEstimate: record.startingEstimate,
    remainderMicros: record.remainderMicros,
    anchorAt: record.anchorAt,
    paused: record.paused,
    frozenHits: record.frozenHits,
    baseRatePerSecond: record.baseRatePerSecond,
    weekdayMultipliers: record.weekdayMultipliers,
    fridayBoost: record.fridayBoost,
    weekendBoost: record.weekendBoost,
    april20Multiplier: record.april20Multiplier,
    timezone: record.timezone,
    provisional: record.provisional,
    title: record.title,
    subtitle: record.subtitle,
    updatedById: record.updatedById,
  };
}

const prismaStore: CounterStore = {
  async load() {
    const row = await prisma.ripskisCounter.findUnique({ where: { id: COUNTER_ID } });
    return row ? toRecord(row) : null;
  },
  async createIfMissing(record) {
    const row = await prisma.ripskisCounter.upsert({
      where: { id: COUNTER_ID },
      create: toData(record),
      update: {},
    });
    return toRecord(row);
  },
  async save(record) {
    const row = await prisma.ripskisCounter.update({
      where: { id: COUNTER_ID },
      data: toData(record),
    });
    return toRecord(row);
  },
};

let override: CounterStore | null = null;

export function setCounterStoreForTests(store: CounterStore | null): void {
  override = store;
}

export function getCounterStore(): CounterStore {
  return override ?? prismaStore;
}
