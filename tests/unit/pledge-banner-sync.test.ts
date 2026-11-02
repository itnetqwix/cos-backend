import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ContestStatus } from '@prisma/client';
import {
  RecurringContestService,
  type RecurringStore,
  type RecurringTemplateRow,
} from '../../src/services/recurring-contest.service.js';
import { resolveContestBannerUrl, setStorageService, type StorageService } from '../../src/services/storage.service.js';
import { ConflictError } from '../../src/utils/response.js';

const VALID_BANNER_KEY_1 = 'contest-banners/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg';
const VALID_BANNER_KEY_2 = 'contest-banners/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.png';

function mockTemplate(partial: Partial<RecurringTemplateRow> = {}): RecurringTemplateRow {
  return {
    id: partial.id ?? 'template-pledge',
    title: 'Pledge of aWEEEEEDgence',
    description: 'Monthly video competition',
    seriesSlug: 'pledge',
    cycleMonth: null,
    status: ContestStatus.SCHEDULED,
    tagline: 'Show your passion',
    bannerUrl: null,
    bannerObjectKey: null,
    thumbnailUrl: null,
    categoryId: null,
    category: null,
    rules: ['One video per creator'],
    prizeSummary: '$1000 prize pool',
    autoAdvanceDelayMs: 1800,
    minOverallVoters: 10,
    minCategoryVoters: 5,
    isRecurringMonthly: true,
    configFrozenAt: null,
    winnerCount: 3,
    maxVideoSizeMb: 100,
    maxVideoDurationSeconds: 60,
    allowedVideoFormats: ['mp4', 'mov', 'webm'],
    rankingNeedsReview: false,
    isWinnersFinalized: false,
    winnersPublished: false,
    submissionCount: 0,
    startDate: null,
    endDate: null,
    votingClosesAt: null,
    ...partial,
  };
}

function mockCycle(partial: Partial<RecurringTemplateRow> = {}): RecurringTemplateRow {
  return {
    ...mockTemplate(),
    id: partial.id ?? 'cycle-2026-11',
    cycleMonth: partial.cycleMonth ?? '2026-11',
    status: partial.status ?? ContestStatus.ACTIVE,
    startDate: new Date('2026-11-01T00:00:00Z'),
    endDate: new Date('2026-11-30T23:59:59Z'),
    votingClosesAt: new Date('2026-11-30T23:59:59Z'),
    ...partial,
  };
}

function createMemoryStore(initialRows: RecurringTemplateRow[] = []): RecurringStore & { rows: RecurringTemplateRow[] } {
  const rows = [...initialRows];
  return {
    rows,
    async listTemplates() {
      return rows.filter((r) => r.cycleMonth === null && r.isRecurringMonthly);
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async findTemplateBySlug(seriesSlug) {
      return rows.find((r) => r.seriesSlug === seriesSlug && r.cycleMonth === null) ?? null;
    },
    async listCycles(seriesSlug) {
      return rows.filter((r) => r.seriesSlug === seriesSlug && r.cycleMonth !== null);
    },
    async insert(row) {
      rows.push(row);
      return row;
    },
    async update(id, data) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) throw new Error('not found');
      Object.assign(rows[idx]!, data);
      return rows[idx]!;
    },
    async remove(id) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
    },
    async categoryExists() {
      return true;
    },
    async audit() {},
  };
}

describe('Pledge Banner Synchronization & Persistence', () => {
  before(() => {
    setStorageService({
      createPresignedUpload: async () => ({ uploadUrl: 'https://upload.example.com', objectKey: 'test', headers: {} }),
      createPresignedDownload: async (objectKey: string) => `https://cdn.example.com/${objectKey}`,
    } as unknown as StorageService);
  });

  after(() => {
    setStorageService(null);
  });

  it('updates template banner and resolves signed/CDN URL in view', async () => {
    const tmpl = mockTemplate();
    const store = createMemoryStore([tmpl]);

    const updated = await RecurringContestService.update(
      'admin-1',
      tmpl.id,
      { bannerObjectKey: VALID_BANNER_KEY_1 },
      new Date('2026-11-02T12:00:00Z'),
      store,
    );

    assert.equal(updated.bannerObjectKey, VALID_BANNER_KEY_1);
    assert.equal(updated.bannerUrl, `https://cdn.example.com/${VALID_BANNER_KEY_1}`);
    assert.equal(store.rows[0]!.bannerUrl, null, 'Raw bannerUrl in DB must be null when bannerObjectKey is set');
  });

  it('omitting banner in update preserves existing bannerObjectKey', async () => {
    const tmpl = mockTemplate({ bannerObjectKey: VALID_BANNER_KEY_1 });
    const store = createMemoryStore([tmpl]);

    const updated = await RecurringContestService.update(
      'admin-1',
      tmpl.id,
      { title: 'New Pledge Title' },
      new Date('2026-11-02T12:00:00Z'),
      store,
    );

    assert.equal(updated.title, 'New Pledge Title');
    assert.equal(updated.bannerObjectKey, VALID_BANNER_KEY_1);
    assert.equal(updated.bannerUrl, `https://cdn.example.com/${VALID_BANNER_KEY_1}`);
  });

  it('sanitizes temporary browser blob: URLs and does not persist them to DB', async () => {
    const cycle = mockCycle({ id: 'cycle-nov', cycleMonth: '2026-11' });
    const store = createMemoryStore([cycle]);

    const updated = await RecurringContestService.updateCycle(
      'admin-1',
      cycle.id,
      {
        bannerObjectKey: VALID_BANNER_KEY_1,
        bannerUrl: 'blob:http://localhost:3000/b1234567-89ab',
      },
      new Date('2026-11-02T12:00:00Z'),
      store,
    );

    assert.equal(updated.bannerObjectKey, VALID_BANNER_KEY_1);
    assert.equal(store.rows[0]!.bannerUrl, null, 'blob: URL must never be persisted');
    assert.equal(updated.bannerUrl, `https://cdn.example.com/${VALID_BANNER_KEY_1}`);
  });

  it('allows configuring upcoming monthly cycle banner independently', async () => {
    const novCycle = mockCycle({ id: 'cycle-nov', cycleMonth: '2026-11', status: ContestStatus.ACTIVE });
    const decCycle = mockCycle({
      id: 'cycle-dec',
      cycleMonth: '2026-12',
      status: ContestStatus.SCHEDULED,
      startDate: new Date('2026-12-01T00:00:00Z'),
      endDate: new Date('2026-12-31T23:59:59Z'),
      votingClosesAt: new Date('2026-12-31T23:59:59Z'),
    });
    const store = createMemoryStore([novCycle, decCycle]);

    await RecurringContestService.updateCycle(
      'admin-1',
      decCycle.id,
      { bannerObjectKey: VALID_BANNER_KEY_2 },
      new Date('2026-11-02T12:00:00Z'),
      store,
    );

    const novInStore = store.rows.find((r) => r.id === 'cycle-nov');
    const decInStore = store.rows.find((r) => r.id === 'cycle-dec');

    assert.equal(novInStore?.bannerObjectKey, null, 'November banner remains independent');
    assert.equal(decInStore?.bannerObjectKey, VALID_BANNER_KEY_2);
  });

  it('rejects modifying published historical Pledge configuration', async () => {
    const octCycle = mockCycle({
      id: 'cycle-oct',
      cycleMonth: '2026-10',
      status: ContestStatus.COMPLETED,
      winnersPublished: true,
    });
    const store = createMemoryStore([octCycle]);

    await assert.rejects(
      async () => {
        await RecurringContestService.updateCycle(
          'admin-1',
          octCycle.id,
          { bannerObjectKey: VALID_BANNER_KEY_1 },
          new Date('2026-11-02T12:00:00Z'),
          store,
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof ConflictError);
        assert.ok(err.message.includes('Published historical Pledge configuration cannot be modified'));
        return true;
      },
    );
  });

  it('resolveContestBannerUrl correctly handles keys, URLs, and nulls', async () => {
    // Valid key
    const urlFromKey = await resolveContestBannerUrl(VALID_BANNER_KEY_1, null);
    assert.equal(urlFromKey, `https://cdn.example.com/${VALID_BANNER_KEY_1}`);

    // Legacy direct URL
    const urlFromLegacy = await resolveContestBannerUrl(null, 'https://cdn.example.com/banner.png');
    assert.equal(urlFromLegacy, 'https://cdn.example.com/banner.png');

    // Neither
    const urlNone = await resolveContestBannerUrl(null, null);
    assert.equal(urlNone, null);
  });
});
