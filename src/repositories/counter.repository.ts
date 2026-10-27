import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  CounterPending,
  CounterRecord,
  SpecialDate,
  SpecialMode,
  WeekdayMultipliers,
} from '../services/counter-clock.js';

export const COUNTER_ID = 'singleton';

export interface CounterAuditWrite {
  actorId: string;
  createdAt: Date;
  before: unknown;
  after: unknown;
}

export interface CounterAuditEntry {
  id: string;
  actorId: string;
  createdAt: string;
  before: unknown;
  after: unknown;
}

export interface CounterStore {
  load(): Promise<CounterRecord | null>;
  createIfMissing(record: CounterRecord): Promise<CounterRecord>;
  save(record: CounterRecord, audit?: CounterAuditWrite | null): Promise<CounterRecord>;
  listAudits(limit: number): Promise<CounterAuditEntry[]>;
}

function asWeekdays(value: Prisma.JsonValue): WeekdayMultipliers {
  if (
    !Array.isArray(value) ||
    value.length !== 7 ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    throw new Error('Stored weekday multipliers are invalid');
  }
  return [...value] as WeekdayMultipliers;
}

function asMode(value: string): SpecialMode {
  return value === 'stack' ? 'stack' : 'override';
}

function asSpecialDates(value: Prisma.JsonValue): SpecialDate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.label !== 'string' || typeof row.multiplier !== 'number') return [];
    return [
      {
        label: row.label,
        month: Number(row.month),
        day: Number(row.day),
        multiplier: row.multiplier,
        mode: row.mode === 'stack' ? 'stack' : 'override',
        recurring: row.recurring !== false,
        startDate: typeof row.startDate === 'string' ? row.startDate : null,
        endDate: typeof row.endDate === 'string' ? row.endDate : null,
        priority: typeof row.priority === 'number' ? row.priority : 0,
      },
    ];
  });
}

function asPending(value: Prisma.JsonValue): CounterPending | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.effectiveAt !== 'string') return null;
  return {
    effectiveAt: row.effectiveAt,
    endsAt: typeof row.endsAt === 'string' ? row.endsAt : null,
    estimatedUsers:
      typeof row.estimatedUsers === 'string' ? row.estimatedUsers : undefined,
    averageUsesPerUserPerDay:
      typeof row.averageUsesPerUserPerDay === 'number'
        ? row.averageUsesPerUserPerDay
        : undefined,
    manualRatePerSecond:
      typeof row.manualRatePerSecond === 'number' || row.manualRatePerSecond === null
        ? (row.manualRatePerSecond as number | null)
        : undefined,
    weekdayMultipliers: Array.isArray(row.weekdayMultipliers)
      ? asWeekdays(row.weekdayMultipliers as Prisma.JsonValue)
      : undefined,
    fridayBoost: typeof row.fridayBoost === 'number' ? row.fridayBoost : undefined,
    weekendBoost: typeof row.weekendBoost === 'number' ? row.weekendBoost : undefined,
    april20Multiplier:
      typeof row.april20Multiplier === 'number' ? row.april20Multiplier : undefined,
    specialMonth: typeof row.specialMonth === 'number' ? row.specialMonth : undefined,
    specialDay: typeof row.specialDay === 'number' ? row.specialDay : undefined,
    specialMode:
      row.specialMode === 'stack' || row.specialMode === 'override'
        ? row.specialMode
        : undefined,
    specialDates: Array.isArray(row.specialDates)
      ? asSpecialDates(row.specialDates as Prisma.JsonValue)
      : undefined,
    timezone: typeof row.timezone === 'string' ? row.timezone : undefined,
  };
}

function toRecord(row: {
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
  weekdayMultipliers: Prisma.JsonValue;
  fridayBoost: number;
  weekendBoost: number;
  april20Multiplier: number;
  specialMonth: number;
  specialDay: number;
  specialMode: string;
  specialDates: Prisma.JsonValue;
  pendingConfig: Prisma.JsonValue | null;
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
    enabled: row.enabled,
    frozenHits: row.frozenHits,
    estimatedUsers: row.estimatedUsers,
    averageUsesPerUserPerDay: row.averageUsesPerUserPerDay,
    manualRatePerSecond: row.manualRatePerSecond,
    useAssumptions: row.useAssumptions,
    baseRatePerSecond: row.baseRatePerSecond,
    weekdayMultipliers: asWeekdays(row.weekdayMultipliers),
    fridayBoost: row.fridayBoost,
    weekendBoost: row.weekendBoost,
    april20Multiplier: row.april20Multiplier,
    specialMonth: row.specialMonth,
    specialDay: row.specialDay,
    specialMode: asMode(row.specialMode),
    specialDates: asSpecialDates(row.specialDates),
    pending: asPending(row.pendingConfig),
    timezone: row.timezone,
    provisional: row.provisional,
    title: row.title,
    subtitle: row.subtitle,
    updatedAt: row.updatedAt,
    updatedById: row.updatedById,
  };
}

function toData(record: CounterRecord): Prisma.RipskisCounterUncheckedCreateInput {
  return {
    id: COUNTER_ID,
    startingEstimate: record.startingEstimate,
    remainderMicros: record.remainderMicros,
    anchorAt: record.anchorAt,
    paused: record.paused,
    enabled: record.enabled,
    frozenHits: record.frozenHits,
    estimatedUsers: record.estimatedUsers,
    averageUsesPerUserPerDay: record.averageUsesPerUserPerDay,
    manualRatePerSecond: record.manualRatePerSecond,
    useAssumptions: record.useAssumptions,
    baseRatePerSecond: record.baseRatePerSecond,
    weekdayMultipliers: record.weekdayMultipliers,
    fridayBoost: record.fridayBoost,
    weekendBoost: record.weekendBoost,
    april20Multiplier: record.april20Multiplier,
    specialMonth: record.specialMonth,
    specialDay: record.specialDay,
    specialMode: record.specialMode,
    specialDates: record.specialDates as unknown as Prisma.InputJsonValue,
    pendingConfig:
      record.pending === null
        ? Prisma.JsonNull
        : (record.pending as unknown as Prisma.InputJsonValue),
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
  async save(record, audit) {
    const row = await prisma.$transaction(async (tx) => {
      const saved = await tx.ripskisCounter.update({
        where: { id: COUNTER_ID },
        data: toData(record),
      });
      if (audit) {
        await tx.ripskisCounterAudit.create({
          data: {
            actorId: audit.actorId,
            createdAt: audit.createdAt,
            before: audit.before as Prisma.InputJsonValue,
            after: audit.after as Prisma.InputJsonValue,
          },
        });
      }
      return saved;
    });
    return toRecord(row);
  },
  async listAudits(limit) {
    const rows = await prisma.ripskisCounterAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
      before: row.before,
      after: row.after,
    }));
  },
};

let override: CounterStore | null = null;

export function setCounterStoreForTests(store: CounterStore | null): void {
  override = store;
}

export function getCounterStore(): CounterStore {
  return override ?? prismaStore;
}
