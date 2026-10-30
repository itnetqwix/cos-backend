import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ContestStatus } from '@prisma/client';
import { createRecurringContestSchema } from '../../src/schemas/recurring-contest.schema.js';
import {
  RecurringContestService,
  type RecurringAuditWrite,
  type RecurringStore,
  type RecurringTemplateRow,
} from '../../src/services/recurring-contest.service.js';
import { nextGenerationTarget } from '../../src/services/pledge-recurrence.service.js';
import { ConflictError, NotFoundError } from '../../src/utils/response.js';

function template(partial: Partial<RecurringTemplateRow> = {}): RecurringTemplateRow {
  return {
    id: partial.id ?? 'template-1',
    title: 'Pledge of aWEEEEEDgence',
    description: 'monthly',
    seriesSlug: 'pledge',
    cycleMonth: null,
    status: ContestStatus.SCHEDULED,
    tagline: null,
    bannerUrl: null,
    bannerObjectKey: null,
    thumbnailUrl: null,
    categoryId: null,
    category: null,
    rules: ['Guest and signed-in voting'],
    prizeSummary: null,
    autoAdvanceDelayMs: 1800,
    minOverallVoters: 10,
    minCategoryVoters: 5,
    isRecurringMonthly: true,
    configFrozenAt: null,
    ...partial,
  };
}

function memory(): RecurringStore & { rows: RecurringTemplateRow[]; audits: RecurringAuditWrite[] } {
  const rows: RecurringTemplateRow[] = [];
  const audits: RecurringAuditWrite[] = [];
  return {
    rows,
    audits,
    async listTemplates() {
      return rows.filter((row) => row.cycleMonth === null && row.isRecurringMonthly);
    },
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async findTemplateBySlug(seriesSlug) {
      return rows.find((row) => row.seriesSlug === seriesSlug && row.cycleMonth === null) ?? null;
    },
    async listCycles(seriesSlug) {
      return rows.filter((row) => row.seriesSlug === seriesSlug && row.cycleMonth !== null);
    },
    async insert(row) {
      if (rows.some((existing) => existing.seriesSlug === row.seriesSlug && existing.cycleMonth === null)) {
        throw new ConflictError('Series slug already exists');
      }
      rows.push(row);
      return row;
    },
    async update(id, data) {
      const row = rows.find((existing) => existing.id === id);
      if (!row) throw new NotFoundError('missing');
      Object.assign(row, data);
      return row;
    },
    async remove(id) {
      const index = rows.findIndex((existing) => existing.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    async categoryExists() {
      return false;
    },
    async audit(entry) {
      audits.push(entry);
    },
  };
}

describe('recurring contest templates', () => {
  it('rejects a duplicate slug, a bad slug, and unknown scoring fields', async () => {
    assert.throws(
      () => createRecurringContestSchema.parse({
        title: 'Pledge',
        description: 'd',
        seriesSlug: 'Bad_Slug',
      }),
      /Series slug is invalid/,
    );
    assert.throws(
      () => createRecurringContestSchema.parse({
        title: 'Pledge',
        description: 'd',
        seriesSlug: 'pledge',
        ratingCategories: [{ name: 'Smell', weight: 1 }],
      }),
    );

    const store = memory();
    const input = createRecurringContestSchema.parse({
      title: 'Pledge of aWEEEEEDgence',
      description: 'monthly',
      seriesSlug: 'pledge',
      rules: ['Self-voting is prohibited'],
    });
    const created = await RecurringContestService.create('admin-1', input, new Date('2026-10-15T00:00:00.000Z'), store);
    assert.equal(created.enabled, true);
    assert.equal(created.frequency, 'monthly');
    assert.equal(created.timezone, 'UTC');
    assert.equal(created.minOverallVoters, 10);
    assert.equal(created.minCategoryVoters, 5);
    assert.equal(created.categoriesCount, 0);
    assert.equal(store.audits[0]?.action, 'RECURRENCE_CREATE');
    await assert.rejects(
      RecurringContestService.create('admin-1', input, new Date('2026-10-15T00:00:00.000Z'), store),
      ConflictError,
    );
  });

  it('edits the template only, previews without inserting, and pause blocks the enabled flag', async () => {
    const store = memory();
    const frozen = template({
      id: 'month-10',
      cycleMonth: '2026-10',
      status: ContestStatus.ACTIVE,
      description: 'frozen-october',
      configFrozenAt: new Date('2026-10-01T00:00:00.000Z'),
      isRecurringMonthly: true,
    });
    store.rows.push(template(), frozen);
    const before = store.rows.length;
    const preview = await RecurringContestService.preview(
      'template-1',
      new Date('2026-10-20T00:00:00.000Z'),
      store,
    );
    assert.equal(preview.persisted, false);
    assert.equal(preview.cycleMonth, '2026-11');
    assert.equal(preview.title, 'Pledge of aWEEEEEDgence — November 2026');
    assert.equal(preview.minOverallVoters, 10);
    assert.equal(store.rows.length, before);

    const updated = await RecurringContestService.update(
      'admin-1',
      'template-1',
      { description: 'future-only', minOverallVoters: 12 },
      new Date('2026-10-20T00:00:00.000Z'),
      store,
    );
    assert.equal(updated.description, 'future-only');
    assert.equal(frozen.description, 'frozen-october');
    assert.equal(frozen.minOverallVoters, 10);
    assert.equal(store.audits.at(-1)?.action, 'RECURRENCE_UPDATE');

    const paused = await RecurringContestService.setEnabled(
      'admin-1',
      'template-1',
      false,
      new Date('2026-10-20T00:00:00.000Z'),
      store,
    );
    assert.equal(paused.enabled, false);
    assert.equal(frozen.status, ContestStatus.ACTIVE);
    assert.equal(store.audits.at(-1)?.action, 'RECURRENCE_PAUSE');

    const resumed = await RecurringContestService.setEnabled(
      'admin-1',
      'template-1',
      true,
      new Date('2026-10-20T00:00:00.000Z'),
      store,
    );
    assert.equal(resumed.enabled, true);
    assert.equal(store.audits.at(-1)?.action, 'RECURRENCE_RESUME');
    const cycles = await RecurringContestService.cycles('template-1', store);
    assert.equal(cycles.length, 1);
    assert.equal(cycles[0]?.description, 'frozen-october');
  });

  it('uses the UTC month boundary for the next cycle', () => {
    const endOfOctober = nextGenerationTarget(new Date('2026-10-31T23:30:00.000Z'), []);
    assert.equal(endOfOctober.cycleMonth, '2026-10');
    const november = nextGenerationTarget(new Date('2026-11-01T00:00:00.000Z'), ['2026-10']);
    assert.equal(november.cycleMonth, '2026-11');
    const afterCurrent = nextGenerationTarget(new Date('2026-12-15T00:00:00.000Z'), ['2026-12']);
    assert.equal(afterCurrent.cycleMonth, '2027-01');
  });

  it('keeps recurring routes behind the admin contest guard', () => {
    const src = readFileSync(new URL('../../src/routes/index.ts', import.meta.url), 'utf8');
    assert.match(src, /contestGuards = \[fastify\.authenticate, authorizeRoles\(Role\.ADMIN\)\]/);
    assert.match(src, /'\/admin\/contests\/recurring',\s*\{ onRequest: contestGuards \}/);
    assert.match(src, /'\/admin\/contests\/recurring\/:id\/pause',\s*\{ onRequest: contestGuards \}/);
  });
});
