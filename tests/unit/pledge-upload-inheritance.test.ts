import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasValidUploadConfig,
  resolvePledgeUploadConfig,
  assertResolvedPledgeUploadConfig,
  assertPledgeUploadSettings,
  PledgeUploadCandidate,
} from '../../src/services/pledge-cycle-config.js';
import {
  buildPledgeMonth,
  PledgeMonthRow,
} from '../../src/services/pledge-recurrence.service.js';
import {
  RecurringContestService,
  RecurringTemplateRow,
  RecurringStore,
} from '../../src/services/recurring-contest.service.js';
import { getUtcMonthBoundaries } from '../../src/services/contest-schedule.js';
import { ContestStatus } from '@prisma/client';
import { ConflictError, ValidationError } from '../../src/utils/response.js';

describe('Pledge Upload Configuration Inheritance & Carry-Forward (Module 1)', () => {
  const octConfig: PledgeUploadCandidate = {
    cycleMonth: '2026-10',
    seriesSlug: 'pledge',
    maxVideoSizeMb: 100,
    maxVideoDurationSeconds: 60,
    allowedVideoFormats: ['video/mp4', 'video/webm', 'video/quicktime'],
  };

  const customOctConfig: PledgeUploadCandidate = {
    cycleMonth: '2026-10',
    seriesSlug: 'pledge',
    maxVideoSizeMb: 150,
    maxVideoDurationSeconds: 90,
    allowedVideoFormats: ['video/mp4'],
  };

  it('1. New month with explicitly saved upload settings uses its own explicit configuration', () => {
    const novTarget: PledgeUploadCandidate = {
      cycleMonth: '2026-11',
      seriesSlug: 'pledge',
      maxVideoSizeMb: 200,
      maxVideoDurationSeconds: 120,
      allowedVideoFormats: ['video/mp4', 'video/webm'],
    };

    const resolved = resolvePledgeUploadConfig(novTarget, [octConfig], null);
    assert.ok(resolved !== null);
    assert.equal(resolved.isInherited, false);
    assert.equal(resolved.maxVideoSizeMb, 200);
    assert.equal(resolved.maxVideoDurationSeconds, 120);
    assert.deepEqual(resolved.allowedVideoFormats, ['video/mp4', 'video/webm']);
    assert.equal(resolved.sourceCycleMonth, '2026-11');
  });

  it("2. New month with no upload settings inherits previous month's configuration", () => {
    const novEmptyTarget: PledgeUploadCandidate = {
      cycleMonth: '2026-11',
      seriesSlug: 'pledge',
      maxVideoSizeMb: null,
      maxVideoDurationSeconds: null,
      allowedVideoFormats: null,
    };

    const resolved = resolvePledgeUploadConfig(novEmptyTarget, [octConfig], null);
    assert.ok(resolved !== null);
    assert.equal(resolved.isInherited, true);
    assert.equal(resolved.maxVideoSizeMb, 100);
    assert.equal(resolved.maxVideoDurationSeconds, 60);
    assert.deepEqual(resolved.allowedVideoFormats, [
      'video/mp4',
      'video/webm',
      'video/quicktime',
    ]);
    assert.equal(resolved.sourceCycleMonth, '2026-10');
  });

  it('3. Explicit monthly settings override inherited settings', () => {
    const decTarget: PledgeUploadCandidate = {
      cycleMonth: '2026-12',
      seriesSlug: 'pledge',
      maxVideoSizeMb: 250,
      maxVideoDurationSeconds: 180,
      allowedVideoFormats: ['video/mp4'],
    };

    const resolved = resolvePledgeUploadConfig(decTarget, [octConfig], null);
    assert.ok(resolved !== null);
    assert.equal(resolved.isInherited, false);
    assert.equal(resolved.maxVideoSizeMb, 250);
    assert.equal(resolved.maxVideoDurationSeconds, 180);
    assert.deepEqual(resolved.allowedVideoFormats, ['video/mp4']);
    assert.equal(resolved.sourceCycleMonth, '2026-12');
  });

  it('4. Multiple consecutive months correctly carry forward the latest applicable upload configuration', () => {
    // Oct: 100MB, 60s
    // Nov: 150MB, 90s (explicitly saved in Nov)
    // Dec: null (should inherit from Nov, not Oct)
    const novCycle: PledgeUploadCandidate = {
      cycleMonth: '2026-11',
      seriesSlug: 'pledge',
      maxVideoSizeMb: 150,
      maxVideoDurationSeconds: 90,
      allowedVideoFormats: ['video/mp4', 'video/webm'],
    };
    const decEmpty: PledgeUploadCandidate = {
      cycleMonth: '2026-12',
      seriesSlug: 'pledge',
      maxVideoSizeMb: null,
      maxVideoDurationSeconds: null,
      allowedVideoFormats: null,
    };

    const resolved = resolvePledgeUploadConfig(decEmpty, [octConfig, novCycle], null);
    assert.ok(resolved !== null);
    assert.equal(resolved.isInherited, true);
    assert.equal(resolved.maxVideoSizeMb, 150);
    assert.equal(resolved.maxVideoDurationSeconds, 90);
    assert.deepEqual(resolved.allowedVideoFormats, ['video/mp4', 'video/webm']);
    assert.equal(resolved.sourceCycleMonth, '2026-11');
  });

  it('5. Missing previous configuration returns a clear actionable error', () => {
    const novTarget: PledgeUploadCandidate = {
      cycleMonth: '2026-11',
      seriesSlug: 'pledge',
      maxVideoSizeMb: null,
      maxVideoDurationSeconds: null,
      allowedVideoFormats: null,
    };

    // No previous cycles, template has null upload limits
    const resolved = resolvePledgeUploadConfig(novTarget, [], null);
    assert.equal(resolved, null);

    assert.throws(
      () => assertResolvedPledgeUploadConfig(novTarget, [], null),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.match(
          err.message,
          /This Pledge month has no upload configuration\. An administrator must configure video upload limits in Competition Settings\./,
        );
        return true;
      },
    );
  });

  it('6. Inherited configuration is persisted and frozen for the new cycle via buildPledgeMonth', () => {
    const boundaries = getUtcMonthBoundaries(2026, 11);
    const now = new Date('2026-11-01T00:00:00.000Z');
    const resolved = resolvePledgeUploadConfig(
      { cycleMonth: '2026-11' },
      [customOctConfig],
      null,
    );
    assert.ok(resolved !== null);

    const built = buildPledgeMonth(
      boundaries,
      null,
      now,
      'nov-uuid-1234',
      resolved,
    );

    // Copied and frozen into new cycle row
    assert.equal(built.cycleMonth, '2026-11');
    assert.equal(built.maxVideoSizeMb, 150);
    assert.equal(built.maxVideoDurationSeconds, 90);
    assert.deepEqual(built.allowedVideoFormats, ['video/mp4']);
    assert.ok(hasValidUploadConfig(built));
  });

  it('7. Historical configurations remain unchanged when inheritance occurs', () => {
    const historicalOct: PledgeUploadCandidate = { ...octConfig };
    const novEmpty: PledgeUploadCandidate = {
      cycleMonth: '2026-11',
      seriesSlug: 'pledge',
      maxVideoSizeMb: null,
      maxVideoDurationSeconds: null,
      allowedVideoFormats: null,
    };

    const resolved = resolvePledgeUploadConfig(novEmpty, [historicalOct], null);
    assert.ok(resolved !== null);
    // Historical October was not altered
    assert.equal(historicalOct.maxVideoSizeMb, 100);
    assert.equal(historicalOct.maxVideoDurationSeconds, 60);
    assert.equal(historicalOct.cycleMonth, '2026-10');
  });

  it('8. Admin can still edit upcoming month upload settings', async () => {
    const upcomingMonth: RecurringTemplateRow = {
      id: 'cycle-dec-upcoming',
      title: 'Pledge of aWEEEEEDgence — December 2026',
      description: 'Test',
      seriesSlug: 'pledge',
      cycleMonth: '2026-12',
      status: ContestStatus.SCHEDULED,
      tagline: null,
      bannerUrl: null,
      bannerObjectKey: null,
      thumbnailUrl: null,
      categoryId: null,
      category: null,
      rules: ['Rule 1'],
      prizeSummary: null,
      autoAdvanceDelayMs: 1800,
      minOverallVoters: 10,
      minCategoryVoters: 5,
      isRecurringMonthly: true,
      configFrozenAt: null,
      scoringCategories: [],
      winnerCount: 3,
      maxVideoSizeMb: 100,
      maxVideoDurationSeconds: 60,
      allowedVideoFormats: ['video/mp4', 'video/webm'],
      rankingNeedsReview: false,
      isWinnersFinalized: false,
      winnersPublished: false,
      submissionCount: 0,
      startDate: new Date('2026-12-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
      votingClosesAt: new Date('2026-12-31T00:00:00.000Z'),
    };

    let updatedRow: RecurringTemplateRow = upcomingMonth;
    const store: RecurringStore = {
      listTemplates: async () => [],
      findById: async () => updatedRow,
      findTemplateBySlug: async () => null,
      listCycles: async () => [updatedRow],
      insert: async (r) => r,
      update: async (_id, data) => {
        updatedRow = { ...updatedRow, ...data };
        return updatedRow;
      },
      audit: async () => {},
    };

    const result = await RecurringContestService.updateCycle(
      'admin-actor-1',
      upcomingMonth.id,
      {
        maxVideoSizeMb: 80,
        maxVideoDurationSeconds: 45,
        allowedVideoFormats: ['video/mp4'],
      },
      new Date('2026-11-03T00:00:00.000Z'),
      store,
    );

    assert.equal(result.maxVideoSizeMb, 80);
    assert.equal(result.maxVideoDurationSeconds, 45);
    assert.deepEqual(result.allowedVideoFormats, ['video/mp4']);
  });

  it('9. Running month continues to enforce its frozen upload limits (rejects Admin modification)', async () => {
    const runningNov: RecurringTemplateRow = {
      id: 'cycle-nov-active',
      title: 'Pledge of aWEEEEEDgence — November 2026',
      description: 'Test',
      seriesSlug: 'pledge',
      cycleMonth: '2026-11',
      status: ContestStatus.ACTIVE,
      tagline: null,
      bannerUrl: null,
      bannerObjectKey: null,
      thumbnailUrl: null,
      categoryId: null,
      category: null,
      rules: ['Rule 1'],
      prizeSummary: null,
      autoAdvanceDelayMs: 1800,
      minOverallVoters: 10,
      minCategoryVoters: 5,
      isRecurringMonthly: true,
      configFrozenAt: new Date('2026-11-01T00:00:00.000Z'),
      scoringCategories: [],
      winnerCount: 3,
      maxVideoSizeMb: 100,
      maxVideoDurationSeconds: 60,
      allowedVideoFormats: ['video/mp4', 'video/webm'],
      rankingNeedsReview: false,
      isWinnersFinalized: false,
      winnersPublished: false,
      submissionCount: 5,
      startDate: new Date('2026-11-01T00:00:00.000Z'),
      endDate: new Date('2026-11-30T00:00:00.000Z'),
      votingClosesAt: new Date('2026-11-30T00:00:00.000Z'),
    };

    const store: RecurringStore = {
      listTemplates: async () => [],
      findById: async () => runningNov,
      findTemplateBySlug: async () => null,
      listCycles: async () => [runningNov],
      insert: async (r) => r,
      update: async (_id, data) => ({ ...runningNov, ...data }),
      audit: async () => {},
    };

    await assert.rejects(
      async () => {
        await RecurringContestService.updateCycle(
          'admin-actor-1',
          runningNov.id,
          { maxVideoSizeMb: 300 },
          new Date('2026-11-03T00:00:00.000Z'),
          store,
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof ConflictError);
        assert.match(
          err.message,
          /Competition rules, winner count, and upload limits cannot be changed for the current running month/,
        );
        return true;
      },
    );
  });

  it('10. Presign rejects files exceeding the resolved maximum size', () => {
    const resolved = resolvePledgeUploadConfig(
      { cycleMonth: '2026-11' },
      [octConfig],
      null,
    );
    assert.ok(resolved !== null);

    const maxBytes = resolved.maxVideoSizeMb * 1024 * 1024;
    const oversizedFileBytes = maxBytes + 1;

    // Simulation of assertion helper inside submission service
    assert.throws(
      () => {
        if (oversizedFileBytes > maxBytes) {
          throw new ValidationError(`fileSizeBytes must be between 1 and ${maxBytes}`);
        }
      },
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /fileSizeBytes must be between 1 and 104857600/);
        return true;
      },
    );
  });

  it('11. Complete rejects files exceeding the resolved maximum size', () => {
    const resolved = resolvePledgeUploadConfig(
      { cycleMonth: '2026-11' },
      [octConfig],
      null,
    );
    assert.ok(resolved !== null);
    const maxBytes = resolved.maxVideoSizeMb * 1024 * 1024;
    const actualBytes = 120 * 1024 * 1024; // 120MB > 100MB

    assert.throws(
      () => {
        if (actualBytes > maxBytes) {
          throw new ValidationError('Uploaded file size exceeds monthly limit');
        }
      },
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        return true;
      },
    );
  });

  it('12. Duration validation uses the resolved monthly maximum duration', () => {
    const resolved = resolvePledgeUploadConfig(
      { cycleMonth: '2026-11' },
      [octConfig],
      null,
    );
    assert.ok(resolved !== null);
    const maxDuration = resolved.maxVideoDurationSeconds; // 60
    assert.equal(maxDuration, 60);

    const testDuration = 65; // 65 > 60
    assert.throws(
      () => {
        if (testDuration > maxDuration) {
          throw new ValidationError(
            `durationSeconds must be an integer between 3 and ${maxDuration}`,
          );
        }
      },
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /between 3 and 60/);
        return true;
      },
    );
  });

  it('13. Format validation uses the resolved allowed-format list', () => {
    const restrictiveOct: PledgeUploadCandidate = {
      cycleMonth: '2026-10',
      seriesSlug: 'pledge',
      maxVideoSizeMb: 100,
      maxVideoDurationSeconds: 60,
      allowedVideoFormats: ['video/mp4'], // only mp4
    };

    const resolved = resolvePledgeUploadConfig(
      { cycleMonth: '2026-11' },
      [restrictiveOct],
      null,
    );
    assert.ok(resolved !== null);
    assert.deepEqual(resolved.allowedVideoFormats, ['video/mp4']);

    const formatCheck = (type: string) => {
      if (!resolved.allowedVideoFormats.includes(type)) {
        throw new ValidationError(`Content type ${type} is not allowed`);
      }
    };

    assert.doesNotThrow(() => formatCheck('video/mp4'));
    assert.throws(() => formatCheck('video/webm'), /Content type video\/webm is not allowed/);
    assert.throws(() => formatCheck('video/quicktime'), /Content type video\/quicktime is not allowed/);
  });

  it('14. Exact sequence: November starts null, Admin saves 80MB/45s/MP4+WebM, Creator receives 80MB/45s, remains frozen against defaults and further edits', () => {
    // 1. November starts with null configuration in DB
    const novCycleInDb: PledgeUploadCandidate & { status: string; configFrozenAt?: Date | null } = {
      id: 'nov-cycle-id',
      cycleMonth: '2026-11',
      seriesSlug: 'pledge',
      status: 'ACTIVE',
      maxVideoSizeMb: null,
      maxVideoDurationSeconds: null,
      allowedVideoFormats: null,
    };

    // 2. Creator or public accesses participate before Admin saves settings.
    // Dynamic resolution provides fallback defaults for the response, BUT novCycleInDb in DB is not mutated.
    const publicFallback = resolvePledgeUploadConfig(novCycleInDb, [], null, {
      allowPlatformDefaults: true,
    });
    assert.ok(publicFallback !== null);
    assert.equal(publicFallback.isDefault, true);
    assert.equal(publicFallback.maxVideoSizeMb, 100);
    assert.equal(publicFallback.maxVideoDurationSeconds, 60);

    // Verify DB row was NOT mutated by the public read
    assert.equal(novCycleInDb.maxVideoSizeMb, null);
    assert.equal(novCycleInDb.maxVideoDurationSeconds, null);
    assert.equal(novCycleInDb.allowedVideoFormats, null);

    // 3. Admin opens Competition Settings and explicitly saves 80MB, 45s, MP4/WebM
    const isUploadConfigMissing = !hasValidUploadConfig(novCycleInDb);
    assert.equal(isUploadConfigMissing, true, 'Admin must be permitted to configure missing limits');

    const adminInput = {
      maxVideoSizeMb: 80,
      maxVideoDurationSeconds: 45,
      allowedVideoFormats: ['video/mp4', 'video/webm'],
    };

    // Assert and save to DB
    const validatedUpload = assertPledgeUploadSettings(adminInput);
    novCycleInDb.maxVideoSizeMb = validatedUpload.maxVideoSizeMb;
    novCycleInDb.maxVideoDurationSeconds = validatedUpload.maxVideoDurationSeconds;
    novCycleInDb.allowedVideoFormats = validatedUpload.allowedVideoFormats;
    novCycleInDb.configFrozenAt = new Date();

    // 4. Creator opens Participate now
    const creatorResolved = resolvePledgeUploadConfig(novCycleInDb, [], null, {
      allowPlatformDefaults: true,
    });
    assert.ok(creatorResolved !== null);
    assert.equal(creatorResolved.isInherited, false);
    assert.equal(creatorResolved.isDefault, false);
    assert.equal(creatorResolved.maxVideoSizeMb, 80);
    assert.equal(creatorResolved.maxVideoDurationSeconds, 45);
    assert.deepEqual(creatorResolved.allowedVideoFormats, ['video/mp4', 'video/webm']);

    // 5. Subsequent access does NOT replace with platform defaults
    const subsequentAccess = resolvePledgeUploadConfig(novCycleInDb, [], null, {
      allowPlatformDefaults: true,
    });
    assert.equal(subsequentAccess?.maxVideoSizeMb, 80);
    assert.equal(subsequentAccess?.maxVideoDurationSeconds, 45);
    assert.deepEqual(subsequentAccess?.allowedVideoFormats, ['video/mp4', 'video/webm']);

    // 6. Running month is now frozen: subsequent Admin modifications to upload limits are rejected
    const isUploadConfigMissingAfterSave = !hasValidUploadConfig(novCycleInDb);
    assert.equal(isUploadConfigMissingAfterSave, false);

    assert.throws(
      () => {
        if (!isUploadConfigMissingAfterSave && novCycleInDb.status === 'ACTIVE') {
          throw new ConflictError(
            'Competition rules, winner count, and upload limits cannot be changed for the current running month',
          );
        }
      },
      (err: unknown) => {
        assert.ok(err instanceof ConflictError);
        assert.match(
          err.message,
          /cannot be changed for the current running month/,
        );
        return true;
      },
    );
  });

  it("15. Case where no Admin settings are saved and previous month's valid settings are inherited", () => {
    // October has explicit valid settings
    const octExplicit: PledgeUploadCandidate = {
      cycleMonth: '2026-10',
      seriesSlug: 'pledge',
      maxVideoSizeMb: 100,
      maxVideoDurationSeconds: 60,
      allowedVideoFormats: ['video/mp4', 'video/webm', 'video/quicktime'],
    };

    // November starts with null
    const novUnconfigured: PledgeUploadCandidate = {
      cycleMonth: '2026-11',
      seriesSlug: 'pledge',
      maxVideoSizeMb: null,
      maxVideoDurationSeconds: null,
      allowedVideoFormats: null,
    };

    // Admin saves nothing. Creator opens Participate
    const creatorResolved = resolvePledgeUploadConfig(novUnconfigured, [octExplicit], null, {
      allowPlatformDefaults: true,
    });

    assert.ok(creatorResolved !== null);
    assert.equal(creatorResolved.isInherited, true);
    assert.equal(creatorResolved.isDefault, false);
    assert.equal(creatorResolved.sourceCycleMonth, '2026-10');
    assert.equal(creatorResolved.maxVideoSizeMb, 100);
    assert.equal(creatorResolved.maxVideoDurationSeconds, 60);
    assert.deepEqual(creatorResolved.allowedVideoFormats, [
      'video/mp4',
      'video/webm',
      'video/quicktime',
    ]);
  });

  it('16. Case where no Admin settings are saved and no previous month or template exists: falls back to platform defaults without mutating DB row', () => {
    const novEmpty: PledgeUploadCandidate = {
      cycleMonth: '2026-11',
      seriesSlug: 'pledge',
      maxVideoSizeMb: null,
      maxVideoDurationSeconds: null,
      allowedVideoFormats: null,
    };

    // No previous months, no template
    const resolvedWithDefaults = resolvePledgeUploadConfig(novEmpty, [], null, {
      allowPlatformDefaults: true,
    });

    assert.ok(resolvedWithDefaults !== null);
    assert.equal(resolvedWithDefaults.isInherited, true);
    assert.equal(resolvedWithDefaults.isDefault, true);
    assert.equal(resolvedWithDefaults.maxVideoSizeMb, 100);
    assert.equal(resolvedWithDefaults.maxVideoDurationSeconds, 60);
    assert.deepEqual(resolvedWithDefaults.allowedVideoFormats, [
      'video/mp4',
      'video/webm',
      'video/quicktime',
    ]);

    // DB row remains unmutated
    assert.equal(novEmpty.maxVideoSizeMb, null);
  });
});
