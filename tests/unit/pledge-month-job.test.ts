import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContestStatus } from '@prisma/client';
import { runPledgeMonthJob, type PledgeMonthLog } from '../../src/jobs/pledge-month.js';
import {
  DuplicatePledgeMonthError,
  type PledgeMonthRow,
  type PledgeRecurrenceStore,
} from '../../src/services/pledge-recurrence.service.js';

function row(partial: Partial<PledgeMonthRow> & Pick<PledgeMonthRow, 'id' | 'cycleMonth'>): PledgeMonthRow {
  return {
    seriesSlug: 'pledge',
    status: ContestStatus.ACTIVE,
    title: 'Pledge',
    description: 'frozen',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-11-01T00:00:00.000Z'),
    votingClosesAt: new Date('2026-11-01T00:00:00.000Z'),
    isRecurringMonthly: true,
    minOverallVoters: 10,
    minCategoryVoters: 5,
    autoAdvanceDelayMs: 1800,
    categoryId: null,
    rules: ['keep'],
    prizeSummary: null,
    configFrozenAt: new Date('2026-10-01T00:00:00.000Z'),
    isWinnersFinalized: false,
    ...partial,
  };
}

function store(seed: PledgeMonthRow[] = []): PledgeRecurrenceStore & { rows: PledgeMonthRow[] } {
  const rows = seed;
  return {
    rows,
    async findMonth(seriesSlug, cycleMonth) {
      return rows.find((item) => item.seriesSlug === seriesSlug && item.cycleMonth === cycleMonth) ?? null;
    },
    async findTemplate(seriesSlug) {
      return rows.find((item) => item.seriesSlug === seriesSlug && item.cycleMonth === null) ?? null;
    },
    async listSeries(seriesSlug) {
      return rows.filter((item) => item.seriesSlug === seriesSlug);
    },
    async insertMonth(item) {
      if (rows.some((existing) => existing.cycleMonth === item.cycleMonth && existing.seriesSlug === item.seriesSlug)) {
        throw new DuplicatePledgeMonthError();
      }
      rows.push(item);
      return item;
    },
    async markJudging(id) {
      const item = rows.find((existing) => existing.id === id);
      if (item?.status === ContestStatus.ACTIVE) item.status = ContestStatus.JUDGING;
    },
  };
}

describe('pledge month job', () => {
  it('creates the current month, closes expired ones, and does not certify winners', async () => {
    const memory = store([
      row({ id: 'sep', cycleMonth: '2026-09', votingClosesAt: new Date('2026-10-01T00:00:00.000Z'), rules: ['september'] }),
      row({ id: 'oct', cycleMonth: '2026-10', votingClosesAt: new Date('2026-11-01T00:00:00.000Z'), rules: ['october'] }),
    ]);
    const logs: PledgeMonthLog[] = [];
    const created = await runPledgeMonthJob({
      now: new Date('2026-11-15T00:00:00.000Z'),
      store: memory,
      log: (entry) => logs.push(entry),
    });
    assert.equal(created.cycleMonth, '2026-11');
    assert.equal(created.isWinnersFinalized, false);
    assert.equal(memory.rows.find((item) => item.id === 'sep')?.status, ContestStatus.JUDGING);
    assert.equal(memory.rows.find((item) => item.id === 'oct')?.status, ContestStatus.JUDGING);
    assert.deepEqual(memory.rows.find((item) => item.id === 'oct')?.rules, ['october']);
    assert.equal(logs[0]?.result, 'created');
    assert.equal(logs[0]?.closedIds?.includes('sep'), true);
    assert.equal(JSON.stringify(logs).includes('guest'), false);

    const again = await runPledgeMonthJob({
      now: new Date('2026-11-20T00:00:00.000Z'),
      store: memory,
      log: (entry) => logs.push(entry),
    });
    assert.equal(again.id, created.id);
    assert.equal(logs.at(-1)?.result, 'existing');
    assert.equal(memory.rows.filter((item) => item.cycleMonth === '2026-11').length, 1);
  });

  it('does not close a month before its UTC cutoff and survives a concurrent run', async () => {
    const memory = store([
      row({ id: 'nov', cycleMonth: '2026-11', votingClosesAt: new Date('2026-12-01T00:00:00.000Z') }),
    ]);
    await runPledgeMonthJob({ now: new Date('2026-11-30T23:59:00.000Z'), store: memory, log: () => undefined });
    assert.equal(memory.rows.find((item) => item.id === 'nov')?.status, ContestStatus.ACTIVE);

    const [first, second] = await Promise.all([
      runPledgeMonthJob({ now: new Date('2026-12-01T00:05:00.000Z'), store: memory, log: () => undefined }),
      runPledgeMonthJob({ now: new Date('2026-12-01T00:05:00.000Z'), store: memory, log: () => undefined }),
    ]);
    assert.equal(first.cycleMonth, '2026-12');
    assert.equal(second.cycleMonth, '2026-12');
    assert.equal(memory.rows.find((item) => item.id === 'nov')?.status, ContestStatus.JUDGING);
    assert.equal(memory.rows.find((item) => item.id === 'nov')?.isWinnersFinalized, false);
    assert.equal(memory.rows.filter((item) => item.cycleMonth === '2026-12').length, 1);
  });
});
