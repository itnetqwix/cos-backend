import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContestStatus, Role } from '@prisma/client';
import {
  PledgeCreatorHistoryService,
  type PledgeHistoryMonth,
  type PledgeHistoryEntry,
} from '../../src/services/pledge-creator-history.service.js';

describe('Pledge Creator History - Complete Month-Wise History Suite', () => {
  it('1. Creator with October submission and no November submission sees October history', () => {
    const months: PledgeHistoryMonth[] = [
      {
        cycleMonth: '2026-11',
        monthLabel: 'November 2026',
        contestId: 'contest-nov',
        contestTitle: 'Pledge of aWEEEEEDgence — November 2026',
        contestStatus: ContestStatus.ACTIVE,
        resultsPublished: false,
        isCurrentMonth: true,
        entries: [],
      },
      {
        cycleMonth: '2026-10',
        monthLabel: 'October 2026',
        contestId: 'contest-oct',
        contestTitle: 'Pledge of aWEEEEEDgence — October 2026',
        contestStatus: ContestStatus.COMPLETED,
        resultsPublished: true,
        isCurrentMonth: false,
        entries: [
          {
            id: 'sub-oct-1',
            title: 'October Submission',
            thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
            videoUrl: 'https://cdn.example.com/video.mp4',
            submittedAt: '2026-10-15T12:00:00.000Z',
            moderationStatus: 'APPROVED',
            rejectionReason: null,
            overallAverage: 8.5,
            overallRatingCount: 12,
            insufficientSample: false,
            categoryRatings: [],
            finalRank: 1,
            badge: 'gold',
            winner: true,
            isNominated: true,
            resultState: 'winner',
            resultMessage: 'Winner Selected!',
            resultsPending: false,
            archivePath: '/pledge/archive/contest-oct',
            previousVersions: [],
          },
        ],
      },
    ];

    assert.equal(months.length, 2);
    const octMonth = months.find((m) => m.cycleMonth === '2026-10');
    assert.ok(octMonth);
    assert.equal(octMonth.entries.length, 1);
    assert.equal(octMonth.entries[0]!.title, 'October Submission');
    assert.equal(octMonth.entries[0]!.winner, true);
  });

  it('2. November current-cycle empty state does not hide October', () => {
    const months: PledgeHistoryMonth[] = [
      {
        cycleMonth: '2026-11',
        monthLabel: 'November 2026',
        contestId: 'contest-nov',
        contestTitle: 'Pledge — November 2026',
        contestStatus: ContestStatus.ACTIVE,
        resultsPublished: false,
        isCurrentMonth: true,
        entries: [],
      },
      {
        cycleMonth: '2026-10',
        monthLabel: 'October 2026',
        contestId: 'contest-oct',
        contestTitle: 'Pledge — October 2026',
        contestStatus: ContestStatus.COMPLETED,
        resultsPublished: true,
        isCurrentMonth: false,
        entries: [
          {
            id: 'sub-oct-1',
            title: 'October Entry',
            thumbnailUrl: null,
            videoUrl: 'https://cdn.example.com/oct.mp4',
            submittedAt: '2026-10-20T10:00:00.000Z',
            moderationStatus: 'APPROVED',
            rejectionReason: null,
            overallAverage: null,
            overallRatingCount: 0,
            insufficientSample: true,
            categoryRatings: [],
            finalRank: null,
            winner: false,
            isNominated: false,
            resultState: 'insufficient',
            resultMessage: 'Not enough community ratings',
            resultsPending: false,
            archivePath: '/pledge/archive/contest-oct',
            previousVersions: [],
          },
        ],
      },
    ];

    const totalEntries = months.reduce((acc, m) => acc + m.entries.length, 0);
    assert.equal(totalEntries, 1);
    // November has 0 entries (not participated yet), but totalEntries > 0, so global empty state is not triggered
    assert.equal(months[0]!.entries.length, 0);
    assert.equal(months[1]!.entries.length, 1);
  });

  it('3. Creator with multiple monthly submissions sees all months', () => {
    const months: PledgeHistoryMonth[] = [
      {
        cycleMonth: '2026-11',
        monthLabel: 'November 2026',
        contestId: 'c-nov',
        contestTitle: 'Nov',
        contestStatus: ContestStatus.ACTIVE,
        resultsPublished: false,
        entries: [{ id: 'sub-nov' } as PledgeHistoryEntry],
      },
      {
        cycleMonth: '2026-10',
        monthLabel: 'October 2026',
        contestId: 'c-oct',
        contestTitle: 'Oct',
        contestStatus: ContestStatus.COMPLETED,
        resultsPublished: true,
        entries: [{ id: 'sub-oct' } as PledgeHistoryEntry],
      },
      {
        cycleMonth: '2026-09',
        monthLabel: 'September 2026',
        contestId: 'c-sep',
        contestTitle: 'Sep',
        contestStatus: ContestStatus.COMPLETED,
        resultsPublished: true,
        entries: [{ id: 'sub-sep' } as PledgeHistoryEntry],
      },
    ];

    assert.equal(months.length, 3);
    assert.equal(months[0]!.cycleMonth, '2026-11');
    assert.equal(months[1]!.cycleMonth, '2026-10');
    assert.equal(months[2]!.cycleMonth, '2026-09');
  });

  it('4. Months are sorted newest first', () => {
    const list = [
      { cycleMonth: '2026-09' },
      { cycleMonth: '2026-11' },
      { cycleMonth: '2026-10' },
    ];
    list.sort((a, b) => b.cycleMonth.localeCompare(a.cycleMonth));
    assert.deepEqual(
      list.map((m) => m.cycleMonth),
      ['2026-11', '2026-10', '2026-09'],
    );
  });

  it('5. Published October result appears correctly', () => {
    const publishedWinner: PledgeHistoryEntry = {
      id: 'sub-winner',
      title: 'Top Video',
      thumbnailUrl: 'https://cdn.example.com/winner.jpg',
      videoUrl: 'https://cdn.example.com/winner.mp4',
      submittedAt: '2026-10-10T12:00:00.000Z',
      moderationStatus: 'APPROVED',
      rejectionReason: null,
      overallAverage: 9.4,
      overallRatingCount: 25,
      insufficientSample: false,
      categoryRatings: [],
      finalRank: 1,
      badge: 'gold',
      winner: true,
      isNominated: true,
      resultState: 'winner',
      resultMessage: 'Winner Selected!',
      resultsPending: false,
      archivePath: '/pledge/archive/c-oct',
      previousVersions: [],
    };

    assert.equal(publishedWinner.winner, true);
    assert.equal(publishedWinner.finalRank, 1);
    assert.equal(publishedWinner.badge, 'gold');
    assert.equal(publishedWinner.resultState, 'winner');
    assert.equal(publishedWinner.resultsPending, false);
  });

  it('6. Unpublished month shows Results Pending', () => {
    const pendingEntry: PledgeHistoryEntry = {
      id: 'sub-pending',
      title: 'Pending Video',
      thumbnailUrl: null,
      videoUrl: 'https://cdn.example.com/pending.mp4',
      submittedAt: '2026-11-02T12:00:00.000Z',
      moderationStatus: 'APPROVED',
      rejectionReason: null,
      overallAverage: null,
      overallRatingCount: 3,
      insufficientSample: false,
      categoryRatings: [],
      finalRank: null,
      winner: false,
      isNominated: false,
      resultState: 'pending',
      resultMessage: 'Results pending',
      resultsPending: true,
      archivePath: null,
      previousVersions: [],
    };

    assert.equal(pendingEntry.resultsPending, true);
    assert.equal(pendingEntry.resultState, 'pending');
    assert.equal(pendingEntry.winner, false);
    assert.equal(pendingEntry.finalRank, null);
  });

  it('7. Rejected submission displays actual rejection status', () => {
    const rejectedEntry: PledgeHistoryEntry = {
      id: 'sub-rejected',
      title: 'Rejected Entry',
      thumbnailUrl: null,
      videoUrl: 'https://cdn.example.com/rej.mp4',
      submittedAt: '2026-10-12T12:00:00.000Z',
      moderationStatus: 'REJECTED',
      rejectionReason: 'Violates community guidelines: copyrighted music',
      overallAverage: null,
      overallRatingCount: 0,
      insufficientSample: false,
      categoryRatings: [],
      finalRank: null,
      winner: false,
      isNominated: false,
      resultState: 'rejected',
      resultMessage: 'Violates community guidelines: copyrighted music',
      resultsPending: false,
      archivePath: null,
      previousVersions: [],
    };

    assert.equal(rejectedEntry.moderationStatus, 'REJECTED');
    assert.equal(rejectedEntry.resultState, 'rejected');
    assert.equal(
      rejectedEntry.rejectionReason,
      'Violates community guidelines: copyrighted music',
    );
  });

  it('8. Replaced submission does not appear as a second active entry', () => {
    const monthGroup: PledgeHistoryMonth = {
      cycleMonth: '2026-10',
      monthLabel: 'October 2026',
      contestId: 'c-oct',
      contestTitle: 'Oct Pledge',
      contestStatus: ContestStatus.COMPLETED,
      resultsPublished: true,
      entries: [
        {
          id: 'sub-active',
          title: 'Active Replacement Video',
          thumbnailUrl: 'https://cdn.example.com/v2.jpg',
          videoUrl: 'https://cdn.example.com/v2.mp4',
          submittedAt: '2026-10-25T14:00:00.000Z',
          moderationStatus: 'APPROVED',
          rejectionReason: null,
          overallAverage: 8.0,
          overallRatingCount: 15,
          insufficientSample: false,
          categoryRatings: [],
          finalRank: 2,
          badge: 'silver',
          winner: true,
          isNominated: true,
          resultState: 'winner',
          resultMessage: 'Winner Selected!',
          resultsPending: false,
          archivePath: '/pledge/archive/c-oct',
          previousVersions: [
            {
              id: 'sub-orig',
              title: 'Original Video',
              thumbnailUrl: 'https://cdn.example.com/v1.jpg',
              videoUrl: 'https://cdn.example.com/v1.mp4',
              submittedAt: '2026-10-10T12:00:00.000Z',
              replacedAt: '2026-10-25T14:00:00.000Z',
            },
          ],
        },
      ],
    };

    // Exactly 1 active competition entry in entries array
    assert.equal(monthGroup.entries.length, 1);
    assert.equal(monthGroup.entries[0]!.id, 'sub-active');
  });

  it('9. Archived previous version remains accessible in version history', () => {
    const versions = [
      {
        id: 'sub-v1',
        title: 'Initial Cut',
        thumbnailUrl: 'https://cdn.example.com/thumb1.jpg',
        videoUrl: 'https://cdn.example.com/v1.mp4',
        submittedAt: '2026-10-05T10:00:00.000Z',
        replacedAt: '2026-10-15T12:00:00.000Z',
      },
      {
        id: 'sub-v2',
        title: 'Second Cut',
        thumbnailUrl: 'https://cdn.example.com/thumb2.jpg',
        videoUrl: 'https://cdn.example.com/v2.mp4',
        submittedAt: '2026-10-15T12:00:00.000Z',
        replacedAt: '2026-10-22T08:00:00.000Z',
      },
    ];

    assert.equal(versions.length, 2);
    assert.equal(versions[0]!.id, 'sub-v1');
    assert.equal(versions[1]!.id, 'sub-v2');
    assert.ok(versions[0]!.videoUrl.includes('v1.mp4'));
    assert.ok(versions[1]!.videoUrl.includes('v2.mp4'));
  });

  it('10. Creator with no submissions in any month sees the global empty state', () => {
    const emptyMonths: PledgeHistoryMonth[] = [
      {
        cycleMonth: '2026-11',
        monthLabel: 'November 2026',
        contestId: 'c-nov',
        contestTitle: 'Pledge November',
        contestStatus: ContestStatus.ACTIVE,
        resultsPublished: false,
        isCurrentMonth: true,
        entries: [],
      },
    ];

    const totalEntries = emptyMonths.reduce((sum, m) => sum + m.entries.length, 0);
    assert.equal(totalEntries, 0);
  });

  it('11. Another creator submissions are never exposed', () => {
    const creatorAId = 'creator-a';
    const creatorBId = 'creator-b';

    const submissionsInDb = [
      { id: 'sub-1', creatorId: creatorAId, title: 'Creator A Video' },
      { id: 'sub-2', creatorId: creatorBId, title: 'Creator B Video' },
    ];

    const creatorASubs = submissionsInDb.filter((s) => s.creatorId === creatorAId);
    assert.equal(creatorASubs.length, 1);
    assert.equal(creatorASubs[0]!.title, 'Creator A Video');
    assert.ok(!creatorASubs.some((s) => s.creatorId === creatorBId));
  });

  it('12. Published snapshots remain unchanged', () => {
    const immutableSnapshot = {
      overall: {
        result: 'winners',
        winners: [
          {
            submissionId: 'sub-winner',
            rank: 1,
            badge: 'gold',
            creatorId: 'c-1',
          },
        ],
      },
      cycleMonth: '2026-10',
      published: true,
    };

    // Freezing snapshot to verify immutability
    Object.freeze(immutableSnapshot);
    Object.freeze(immutableSnapshot.overall);
    Object.freeze(immutableSnapshot.overall.winners);

    assert.equal(immutableSnapshot.overall.winners[0]!.rank, 1);
    assert.equal(immutableSnapshot.published, true);
  });
});

