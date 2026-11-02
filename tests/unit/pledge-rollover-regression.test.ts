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

function createRow(
  partial: Partial<PledgeMonthRow> & Pick<PledgeMonthRow, 'id' | 'cycleMonth'>,
): PledgeMonthRow {
  return {
    seriesSlug: 'pledge',
    status: ContestStatus.ACTIVE,
    title: partial.cycleMonth ? `Pledge ${partial.cycleMonth}` : 'Pledge template',
    description: 'Monthly video contest',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-11-01T00:00:00.000Z'),
    votingClosesAt: new Date('2026-11-01T00:00:00.000Z'),
    isRecurringMonthly: true,
    minOverallVoters: 10,
    minCategoryVoters: 5,
    autoAdvanceDelayMs: 1800,
    categoryId: null,
    rules: ['Community voting is open to guests and signed-in users.'],
    prizeSummary: '$1,000 top video',
    configFrozenAt: new Date('2026-10-01T00:00:00.000Z'),
    isWinnersFinalized: false,
    ...partial,
  };
}

function createTemplate(status: ContestStatus = ContestStatus.SCHEDULED): PledgeMonthRow {
  return createRow({
    id: 'template-pledge-id',
    cycleMonth: null,
    status,
    title: 'Pledge of aWEEEEEDgence testing',
    description: 'Monthly community video contest.',
    rules: ['Rule 1', 'Rule 2'],
    configFrozenAt: null,
  });
}

function createMockStore(
  initialRows: PledgeMonthRow[] = [],
): PledgeRecurrenceStore & { rows: PledgeMonthRow[] } {
  const rows = [...initialRows];
  return {
    rows,
    async findMonth(seriesSlug, cycleMonth) {
      return (
        rows.find(
          (item) => item.seriesSlug === seriesSlug && item.cycleMonth === cycleMonth,
        ) ?? null
      );
    },
    async findTemplate(seriesSlug) {
      const found =
        rows.find((item) => item.seriesSlug === seriesSlug && item.cycleMonth === null) ??
        null;
      if (found && found.status === ContestStatus.DRAFT) {
        found.status = ContestStatus.SCHEDULED;
      }
      return found;
    },
    async listSeries(seriesSlug) {
      for (const item of rows) {
        if (
          item.seriesSlug === seriesSlug &&
          item.cycleMonth === null &&
          item.status === ContestStatus.DRAFT
        ) {
          item.status = ContestStatus.SCHEDULED;
        }
      }
      return rows.filter((item) => item.seriesSlug === seriesSlug);
    },
    async insertMonth(item) {
      if (
        rows.some(
          (existing) =>
            existing.seriesSlug === item.seriesSlug &&
            existing.cycleMonth === item.cycleMonth,
        )
      ) {
        throw new DuplicatePledgeMonthError();
      }
      rows.push(item);
      return item;
    },
    async markJudging(id) {
      const item = rows.find((existing) => existing.id === id);
      if (item && item.status === ContestStatus.ACTIVE) {
        item.status = ContestStatus.JUDGING;
      }
    },
    async activateMonth(id, configFrozenAt) {
      const item = rows.find((existing) => existing.id === id);
      if (item) {
        item.status = ContestStatus.ACTIVE;
        item.configFrozenAt = configFrozenAt;
      }
    },
  };
}

describe('Pledge monthly rollover regression', () => {
  it('transitions October to JUDGING and activates November at the UTC month boundary', async () => {
    const october = createRow({
      id: 'oct-2026',
      cycleMonth: '2026-10',
      status: ContestStatus.ACTIVE,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-11-01T00:00:00.000Z'),
      votingClosesAt: new Date('2026-11-01T00:00:00.000Z'),
      rules: ['October rules frozen'],
    });
    const template = createTemplate(ContestStatus.SCHEDULED);
    const store = createMockStore([october, template]);

    // Boundary: exactly 2026-11-01T00:00:00.000Z
    const boundaryTime = new Date('2026-11-01T00:00:00.000Z');
    const november = await PledgeRecurrenceService.ensureCurrentMonthlyContest(
      boundaryTime,
      store,
    );

    assert.ok(november, 'November cycle must be created');
    assert.equal(november.cycleMonth, '2026-11');
    assert.equal(november.status, ContestStatus.ACTIVE);
    assert.equal(november.startDate.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(november.endDate.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(november.votingClosesAt?.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(november.isWinnersFinalized, false);

    // October must be moved to JUDGING independently
    assert.equal(october.status, ContestStatus.JUDGING);
    assert.equal(october.isWinnersFinalized, false);
    assert.deepEqual(october.rules, ['October rules frozen']);
  });

  it('handles delayed API traffic on November 2, 2026 when no scheduled cron ran', async () => {
    const october = createRow({
      id: 'oct-2026',
      cycleMonth: '2026-10',
      status: ContestStatus.ACTIVE,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-11-01T00:00:00.000Z'),
      votingClosesAt: new Date('2026-11-01T00:00:00.000Z'),
      rules: ['October rules'],
    });
    const template = createTemplate(ContestStatus.SCHEDULED);
    const store = createMockStore([october, template]);

    // Delayed traffic arrives on November 2, 2026 at 15:00 UTC
    const delayedTime = new Date('2026-11-02T15:00:00.000Z');
    const november = await PledgeRecurrenceService.ensureCurrentMonthlyContest(
      delayedTime,
      store,
    );

    assert.ok(november, 'November cycle must be created upon delayed request');
    assert.equal(november.cycleMonth, '2026-11');
    assert.equal(november.status, ContestStatus.ACTIVE);
    assert.equal(november.configFrozenAt?.toISOString(), delayedTime.toISOString());

    // October closed
    assert.equal(october.status, ContestStatus.JUDGING);

    // Subsequent traffic on November 5 does not duplicate November cycle
    const laterTime = new Date('2026-11-05T10:00:00.000Z');
    const again = await PledgeRecurrenceService.ensureCurrentMonthlyContest(
      laterTime,
      store,
    );
    assert.equal(again?.id, november.id);
    assert.equal(store.rows.filter((r) => r.cycleMonth === '2026-11').length, 1);
  });

  it('activates November even when the template row is stored in DRAFT status', async () => {
    const october = createRow({
      id: 'oct-2026',
      cycleMonth: '2026-10',
      status: ContestStatus.JUDGING,
      votingClosesAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    // Template status is DRAFT (the exact production DB condition)
    const draftTemplate = createTemplate(ContestStatus.DRAFT);
    const store = createMockStore([october, draftTemplate]);

    const delayedTime = new Date('2026-11-02T15:14:00.000Z');
    const november = await PledgeRecurrenceService.ensureCurrentMonthlyContest(
      delayedTime,
      store,
    );

    assert.ok(november, 'November must be generated even if template was DRAFT');
    assert.equal(november.cycleMonth, '2026-11');
    assert.equal(november.status, ContestStatus.ACTIVE);
    assert.equal(draftTemplate.status, ContestStatus.SCHEDULED);
  });

  it('activates a pre-existing SCHEDULED November cycle when its UTC start arrives', async () => {
    const preScheduledNovember = createRow({
      id: 'pre-nov-2026',
      cycleMonth: '2026-11',
      status: ContestStatus.SCHEDULED,
      startDate: new Date('2026-11-01T00:00:00.000Z'),
      endDate: new Date('2026-12-01T00:00:00.000Z'),
      votingClosesAt: new Date('2026-12-01T00:00:00.000Z'),
      configFrozenAt: null,
    });
    const template = createTemplate();
    const store = createMockStore([preScheduledNovember, template]);

    const nov2 = new Date('2026-11-02T15:14:00.000Z');
    const activated = await PledgeRecurrenceService.ensureCurrentMonthlyContest(
      nov2,
      store,
    );

    assert.equal(activated?.id, preScheduledNovember.id);
    assert.equal(activated?.status, ContestStatus.ACTIVE);
    assert.equal(preScheduledNovember.status, ContestStatus.ACTIVE);
    assert.equal(preScheduledNovember.configFrozenAt?.toISOString(), nov2.toISOString());
  });

  it('preserves existing October submissions, ratings, and review data untouched', async () => {
    const october = createRow({
      id: 'oct-2026',
      cycleMonth: '2026-10',
      status: ContestStatus.ACTIVE,
      votingClosesAt: new Date('2026-11-01T00:00:00.000Z'),
      prizeSummary: '$500 prize',
      rules: ['Preserved rule'],
    });
    const template = createTemplate();
    const store = createMockStore([october, template]);

    await PledgeRecurrenceService.ensureCurrentMonthlyContest(
      new Date('2026-11-02T15:00:00.000Z'),
      store,
    );

    assert.equal(october.status, ContestStatus.JUDGING);
    assert.equal(october.prizeSummary, '$500 prize');
    assert.deepEqual(october.rules, ['Preserved rule']);
    assert.equal(october.isWinnersFinalized, false);
  });
});

