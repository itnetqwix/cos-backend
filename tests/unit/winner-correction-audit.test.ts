import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { AuditLogRepository, type CreateAuditLogData } from '../../src/repositories/audit-log.repository.js';
import { ContestRepository } from '../../src/repositories/contest.repository.js';
import {
  PledgeFinalizationService,
  setWinnerCorrectionTransaction,
  type WinnerSnapshot,
} from '../../src/services/pledge-finalization.service.js';
import { ConflictError, ValidationError } from '../../src/utils/response.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

function snapshot(version = 1): WinnerSnapshot {
  return {
    contestId: '11111111-1111-4111-8111-111111111111',
    seriesSlug: 'pledge',
    cycleMonth: '2026-11',
    finalizedAt: '2026-12-02T00:00:00.000Z',
    finalizedById: 'admin-1',
    certificationStatus: 'certified',
    version,
    thresholds: { overallVoters: 10, categoryRatings: 5 },
    categoryNames: ['Comedy'],
    overall: {
      result: 'winners',
      message: null,
      winners: [],
      tiedCandidates: [
        {
          submissionId: '22222222-2222-4222-8222-222222222221',
          creatorId: 'creator-a',
          creatorName: 'Ada',
          title: 'A',
          videoUrl: 'https://example.com/a.mp4',
          communityScore: 9,
          distinctVoterCount: 12,
          validRatingCount: 12,
          coWinner: true,
        },
        {
          submissionId: '22222222-2222-4222-8222-222222222222',
          creatorId: 'creator-b',
          creatorName: 'Bea',
          title: 'B',
          videoUrl: 'https://example.com/b.mp4',
          communityScore: 9,
          distinctVoterCount: 12,
          validRatingCount: 12,
          coWinner: true,
        },
      ],
    },
    categories: [],
    revisions: [],
  };
}

describe('winner correction audit', () => {
  const original = {
    lock: ContestRepository.lockById,
    save: ContestRepository.replaceWinnerSnapshot,
    audit: AuditLogRepository.create,
  };
  let current = snapshot();
  let audits: CreateAuditLogData[] = [];
  let failAudit = false;

  afterEach(() => {
    setWinnerCorrectionTransaction(null);
    ContestRepository.lockById = original.lock;
    ContestRepository.replaceWinnerSnapshot = original.save;
    AuditLogRepository.create = original.audit;
  });

  function install() {
    current = snapshot();
    audits = [];
    failAudit = false;
    setWinnerCorrectionTransaction(async (fn) => {
      const previous = structuredClone(current);
      const previousAudits = structuredClone(audits);
      try {
        return await fn({} as Prisma.TransactionClient);
      } catch (error) {
        current = previous;
        audits = previousAudits;
        throw error;
      }
    });
    ContestRepository.lockById = (async () => ({
      id: current.contestId,
      seriesSlug: 'pledge',
      isWinnersFinalized: true,
      winnersData: current,
    })) as typeof ContestRepository.lockById;
    ContestRepository.replaceWinnerSnapshot = (async (_id, data) => {
      current = data as unknown as WinnerSnapshot;
      return { winnersData: current } as never;
    }) as typeof ContestRepository.replaceWinnerSnapshot;
    AuditLogRepository.create = (async (data) => {
      if (failAudit) throw new Error('audit unavailable');
      audits.push(data);
      return { id: 'audit-1', createdAt: new Date('2026-12-03T00:00:00.000Z') } as never;
    }) as typeof AuditLogRepository.create;
  }

  it('writes CORRECT_WINNER with the admin, contest, reason, and versions', async () => {
    install();
    const next = await PledgeFinalizationService.correctWinner(
      current.contestId,
      '33333333-3333-4333-8333-333333333333',
      'Bea withdrew',
      ['22222222-2222-4222-8222-222222222221'],
      new Date('2026-12-03T00:00:00.000Z'),
    );
    assert.equal(next.version, 2);
    assert.equal(next.revisions[0]?.reason, 'Bea withdrew');
    assert.equal(next.revisions[0]?.previous?.version, 1);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.action, 'CORRECT_WINNER');
    assert.equal(audits[0]?.actorId, '33333333-3333-4333-8333-333333333333');
    assert.equal(audits[0]?.reason, 'Bea withdrew');
    const metadata = audits[0]?.metadata as { contestId: string; previousVersion: number; correctedVersion: number };
    assert.equal(metadata.contestId, current.contestId);
    assert.equal(metadata.previousVersion, 1);
    assert.equal(metadata.correctedVersion, 2);
  });

  it('rejects an empty reason, an ineligible id, and rolls back when the audit insert fails', async () => {
    install();
    await assert.rejects(
      () => PledgeFinalizationService.correctWinner(current.contestId, 'admin-2', '   ', ['22222222-2222-4222-8222-222222222221']),
      ValidationError,
    );
    await assert.rejects(
      () => PledgeFinalizationService.correctWinner(
        current.contestId,
        'admin-2',
        'not eligible',
        ['99999999-9999-4999-8999-999999999999'],
      ),
      ValidationError,
    );
    assert.equal(current.version, 1);
    assert.equal(audits.length, 0);
    failAudit = true;
    await assert.rejects(
      () => PledgeFinalizationService.correctWinner(
        current.contestId,
        'admin-2',
        'audit should fail',
        ['22222222-2222-4222-8222-222222222221'],
      ),
      /audit unavailable/,
    );
    assert.equal(current.version, 1);
    assert.equal(audits.length, 0);
  });

  it('serializes two corrections so the second sees the first revision', async () => {
    install();
    let chain: Promise<unknown> = Promise.resolve();
    setWinnerCorrectionTransaction(async (fn) => {
      const run = chain.then(() => fn({} as Prisma.TransactionClient));
      chain = run.then(() => undefined, () => undefined);
      return run;
    });
    const firstId = '22222222-2222-4222-8222-222222222221';
    const secondId = '22222222-2222-4222-8222-222222222222';
    await Promise.all([
      PledgeFinalizationService.correctWinner(current.contestId, 'admin-a', 'first', [firstId]),
      PledgeFinalizationService.correctWinner(current.contestId, 'admin-b', 'second', [secondId]),
    ]);
    assert.equal(current.version, 3);
    assert.equal(current.revisions.length, 2);
    assert.equal(audits.length, 2);
  });

  it('keeps the correction route behind the admin guard and does not open a scheduler route', () => {
    const routes = readFileSync(`${root}/src/routes/index.ts`, 'utf8');
    const at = routes.indexOf("'/admin/contests/:id/correct-winner'");
    assert.equal(routes.slice(at, at + 180).includes('contestGuards'), true);
    assert.equal(routes.includes('/admin/pledge/run'), false);
    assert.throws(
      () => {
        throw new ConflictError('Only a Pledge monthly contest can be corrected');
      },
      ConflictError,
    );
  });
});
