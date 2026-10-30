import { ContestStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  PLEDGE_SERIES_SLUG,
  getUtcMonthBoundaries,
  utcCycleMonth,
  type UtcMonthBoundaries,
} from './contest-schedule.js';

/**
 * Monthly Pledge instances. A template row, when present, has seriesSlug
 * "pledge" and a null cycleMonth. It is not a month. Existing contests with
 * a null seriesSlug are never treated as Pledge.
 *
 * Month-end moves ACTIVE to JUDGING. It does not finalize winners.
 */

export interface PledgeMonthRow {
  id: string;
  seriesSlug: string | null;
  cycleMonth: string | null;
  status: ContestStatus;
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  votingClosesAt: Date | null;
  isRecurringMonthly: boolean;
  minOverallVoters: number;
  minCategoryVoters: number;
  autoAdvanceDelayMs: number;
  categoryId: string | null;
  rules: Prisma.JsonValue | null;
  prizeSummary: string | null;
  configFrozenAt: Date | null;
  isWinnersFinalized: boolean;
}

export class DuplicatePledgeMonthError extends Error {
  constructor() {
    super('Pledge month already exists');
    this.name = 'DuplicatePledgeMonthError';
  }
}

export interface PledgeRecurrenceStore {
  findMonth(seriesSlug: string, cycleMonth: string): Promise<PledgeMonthRow | null>;
  findTemplate(seriesSlug: string): Promise<PledgeMonthRow | null>;
  listSeries(seriesSlug: string): Promise<PledgeMonthRow[]>;
  insertMonth(row: PledgeMonthRow): Promise<PledgeMonthRow>;
  markJudging(id: string): Promise<void>;
}

export function pledgeMonthShouldClose(row: PledgeMonthRow, now: Date): boolean {
  return (
    row.seriesSlug === PLEDGE_SERIES_SLUG &&
    row.cycleMonth !== null &&
    row.status === ContestStatus.ACTIVE &&
    row.votingClosesAt !== null &&
    row.votingClosesAt.getTime() <= now.getTime()
  );
}

export function buildPledgeMonth(
  boundaries: UtcMonthBoundaries,
  template: PledgeMonthRow | null,
  now: Date,
  id: string,
): PledgeMonthRow {
  return {
    id,
    seriesSlug: PLEDGE_SERIES_SLUG,
    cycleMonth: boundaries.cycleMonth,
    status: ContestStatus.ACTIVE,
    title: `Pledge ${boundaries.cycleMonth}`,
    description: template?.description ?? 'Pledge of aWEEEEEDgence monthly contest',
    startDate: boundaries.start,
    endDate: boundaries.end,
    votingClosesAt: boundaries.votingClosesAt,
    isRecurringMonthly: true,
    minOverallVoters: template?.minOverallVoters ?? 10,
    minCategoryVoters: template?.minCategoryVoters ?? 5,
    autoAdvanceDelayMs: template?.autoAdvanceDelayMs ?? 1800,
    categoryId: template?.categoryId ?? null,
    rules: template?.rules ?? null,
    prizeSummary: template?.prizeSummary ?? null,
    configFrozenAt: now,
    isWinnersFinalized: false,
  };
}

export class PledgeRecurrenceService {
  static async ensureCurrentMonthlyContest(
    now = new Date(),
    store: PledgeRecurrenceStore = prismaPledgeStore,
  ): Promise<PledgeMonthRow> {
    const { year, month } = utcCycleMonth(now);
    const boundaries = getUtcMonthBoundaries(year, month);
    const series = await store.listSeries(PLEDGE_SERIES_SLUG);
    for (const row of series) {
      if (pledgeMonthShouldClose(row, now)) {
        await store.markJudging(row.id);
        row.status = ContestStatus.JUDGING;
      }
    }
    const existing =
      series.find((row) => row.cycleMonth === boundaries.cycleMonth) ??
      (await store.findMonth(PLEDGE_SERIES_SLUG, boundaries.cycleMonth));
    if (existing) return existing;

    const template =
      series.find((row) => row.cycleMonth === null) ??
      (await store.findTemplate(PLEDGE_SERIES_SLUG));
    const created = buildPledgeMonth(boundaries, template, now, crypto.randomUUID());
    try {
      return await store.insertMonth(created);
    } catch (error) {
      if (!(error instanceof DuplicatePledgeMonthError)) throw error;
      const raced = await store.findMonth(PLEDGE_SERIES_SLUG, boundaries.cycleMonth);
      if (!raced) throw error;
      return raced;
    }
  }
}

const prismaPledgeStore: PledgeRecurrenceStore = {
  async findMonth(seriesSlug, cycleMonth) {
    const row = await prisma.contest.findFirst({
      where: { seriesSlug, cycleMonth },
    });
    return row ? toPledgeMonth(row) : null;
  },
  async findTemplate(seriesSlug) {
    const row = await prisma.contest.findFirst({
      where: { seriesSlug, cycleMonth: null },
    });
    return row ? toPledgeMonth(row) : null;
  },
  async listSeries(seriesSlug) {
    const rows = await prisma.contest.findMany({ where: { seriesSlug } });
    return rows.map(toPledgeMonth);
  },
  async insertMonth(row) {
    try {
      const created = await prisma.contest.create({
        data: {
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          timezone: 'UTC',
          startDate: row.startDate,
          endDate: row.endDate,
          votingClosesAt: row.votingClosesAt,
          seriesSlug: row.seriesSlug,
          cycleMonth: row.cycleMonth,
          isRecurringMonthly: row.isRecurringMonthly,
          minOverallVoters: row.minOverallVoters,
          minCategoryVoters: row.minCategoryVoters,
          autoAdvanceDelayMs: row.autoAdvanceDelayMs,
          categoryId: row.categoryId,
          rules:
            row.rules === null ? Prisma.JsonNull : (row.rules as Prisma.InputJsonValue),
          prizeSummary: row.prizeSummary,
          configFrozenAt: row.configFrozenAt,
          isWinnersFinalized: false,
        },
      });
      return toPledgeMonth(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new DuplicatePledgeMonthError();
      }
      throw error;
    }
  },
  async markJudging(id) {
    await prisma.contest.updateMany({
      where: { id, seriesSlug: PLEDGE_SERIES_SLUG, status: ContestStatus.ACTIVE },
      data: { status: ContestStatus.JUDGING },
    });
  },
};

function toPledgeMonth(row: {
  id: string;
  seriesSlug: string | null;
  cycleMonth: string | null;
  status: ContestStatus;
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  votingClosesAt: Date | null;
  isRecurringMonthly: boolean;
  minOverallVoters: number;
  minCategoryVoters: number;
  autoAdvanceDelayMs: number;
  categoryId: string | null;
  rules: Prisma.JsonValue;
  prizeSummary: string | null;
  configFrozenAt: Date | null;
  isWinnersFinalized: boolean;
}): PledgeMonthRow {
  return {
    id: row.id,
    seriesSlug: row.seriesSlug,
    cycleMonth: row.cycleMonth,
    status: row.status,
    title: row.title,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    votingClosesAt: row.votingClosesAt,
    isRecurringMonthly: row.isRecurringMonthly,
    minOverallVoters: row.minOverallVoters,
    minCategoryVoters: row.minCategoryVoters,
    autoAdvanceDelayMs: row.autoAdvanceDelayMs,
    categoryId: row.categoryId,
    rules: row.rules,
    prizeSummary: row.prizeSummary,
    configFrozenAt: row.configFrozenAt,
    isWinnersFinalized: row.isWinnersFinalized,
  };
}
