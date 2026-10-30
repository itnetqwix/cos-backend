import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContestStatus } from '@prisma/client';
import { getUtcMonthBoundaries } from '../../src/services/contest-schedule.js';
import {
  DuplicatePledgeMonthError,
  PledgeRecurrenceService,
  type PledgeMonthRow,
  type PledgeRecurrenceStore,
} from '../../src/services/pledge-recurrence.service.js';

function row(partial: Partial<PledgeMonthRow> & Pick<PledgeMonthRow, 'id' | 'cycleMonth'>): PledgeMonthRow {
  return {
    seriesSlug: partial.cycleMonth ? 'pledge' : 'pledge',
    status: ContestStatus.ACTIVE,
    title: partial.cycleMonth ? `Pledge ${partial.cycleMonth}` : 'Pledge template',
    description: 'rules-v1',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-11-01T00:00:00.000Z'),
    votingClosesAt: new Date('2026-11-01T00:00:00.000Z'),
    isRecurringMonthly: true,
    minOverallVoters: 10,
    minCategoryVoters: 5,
    autoAdvanceDelayMs: 1800,
    categoryId: 'cat-1',
    rules: ['frozen'],
    prizeSummary: null,
    configFrozenAt: new Date('2026-10-01T00:00:00.000Z'),
    isWinnersFinalized: false,
    ...partial,
  };
}

function enabledTemplate(): PledgeMonthRow {
  return row({
    id: 'template',
    cycleMonth: null,
    status: ContestStatus.SCHEDULED,
    title: 'Pledge of aWEEEEEDgence',
    description: 'series-v1',
    rules: ['series'],
    configFrozenAt: null,
    minOverallVoters: 10,
    minCategoryVoters: 5,
  });
}

function memoryStore(seed: PledgeMonthRow[] = []): PledgeRecurrenceStore & { rows: PledgeMonthRow[] } {
  const rows = [...seed];
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
      if (rows.some((existing) => existing.seriesSlug === item.seriesSlug && existing.cycleMonth === item.cycleMonth)) {
        throw new DuplicatePledgeMonthError();
      }
      rows.push(item);
      return item;
    },
    async markJudging(id) {
      const item = rows.find((existing) => existing.id === id);
      if (item && item.status === ContestStatus.ACTIVE) item.status = ContestStatus.JUDGING;
    },
  };
}

describe('UTC pledge schedule', () => {
  it('uses UTC month boundaries, including leap February and December', () => {
    const june = getUtcMonthBoundaries(2026, 6);
    assert.equal(june.start.toISOString(), '2026-06-01T00:00:00.000Z');
    assert.equal(june.end.toISOString(), '2026-07-01T00:00:00.000Z');
    assert.equal(june.votingClosesAt.toISOString(), june.end.toISOString());
    assert.equal(june.cycleMonth, '2026-06');

    const leap = getUtcMonthBoundaries(2024, 2);
    assert.equal(leap.start.toISOString(), '2024-02-01T00:00:00.000Z');
    assert.equal(leap.end.toISOString(), '2024-03-01T00:00:00.000Z');

    const december = getUtcMonthBoundaries(2026, 12);
    assert.equal(december.start.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(december.end.toISOString(), '2027-01-01T00:00:00.000Z');
  });

  it('creates one current month, closes the previous month, and leaves history frozen', async () => {
    const october = row({
      id: 'october',
      cycleMonth: '2026-10',
      description: 'october-rules',
      rules: ['october'],
    });
    const unrelated = row({
      id: 'open',
      cycleMonth: null,
      seriesSlug: null,
      status: ContestStatus.ACTIVE,
      description: 'not pledge',
    });
    const template = enabledTemplate();
    const store = memoryStore([october, unrelated, template]);
    const created = await PledgeRecurrenceService.ensureCurrentMonthlyContest(
      new Date('2026-11-15T12:00:00.000Z'),
      store,
    );
    assert.ok(created);
    assert.equal(created.cycleMonth, '2026-11');
    assert.equal(created.description, 'series-v1');
    assert.equal(created.minOverallVoters, 10);
    assert.equal(created.status, ContestStatus.ACTIVE);
    assert.equal(created.votingClosesAt?.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(created.isWinnersFinalized, false);
    assert.equal(october.status, ContestStatus.JUDGING);
    assert.equal(october.isWinnersFinalized, false);
    assert.deepEqual(october.rules, ['october']);
    assert.equal(unrelated.status, ContestStatus.ACTIVE);

    template.description = 'series-v2';
    const again = await PledgeRecurrenceService.ensureCurrentMonthlyContest(
      new Date('2026-11-20T00:00:00.000Z'),
      store,
    );
    assert.equal(again?.id, created.id);
    assert.equal(created.description, 'series-v1');
    assert.equal(store.rows.filter((item) => item.cycleMonth === '2026-11').length, 1);
  });

  it('returns the existing row when two creates race', async () => {
    const store = memoryStore([enabledTemplate()]);
    const [first, second] = await Promise.all([
      PledgeRecurrenceService.ensureCurrentMonthlyContest(new Date('2026-11-02T00:00:00.000Z'), store),
      PledgeRecurrenceService.ensureCurrentMonthlyContest(new Date('2026-11-02T00:00:00.000Z'), store),
    ]);
    assert.equal(first?.cycleMonth, '2026-11');
    assert.equal(second?.cycleMonth, '2026-11');
    assert.equal(store.rows.filter((item) => item.cycleMonth === '2026-11').length, 1);
  });
});
