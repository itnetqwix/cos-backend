import { prisma } from '../config/database.js';
import {
  PledgeRecurrenceService,
  type PledgeMonthRow,
  type PledgeRecurrenceStore,
} from '../services/pledge-recurrence.service.js';

/**
 * CLI entry for the Pledge month. There is no HTTP route.
 * Schedule it in UTC, for example `5 * * * *` (hourly at minute 5).
 * The process is not deployed by this repository. See the checklist.
 */

export interface PledgeMonthLog {
  event: 'pledge-month';
  result: 'created' | 'existing' | 'failed';
  cycleMonth?: string | null;
  status?: string;
  closedIds?: string[];
  error?: string;
}

type PledgeSnapshot = {
  id: string;
  status: string;
  cycleMonth: string | null;
  isWinnersFinalized: boolean;
};

async function listPledge(store?: PledgeRecurrenceStore): Promise<PledgeSnapshot[]> {
  if (store) {
    return (await store.listSeries('pledge')).map((row) => ({
      id: row.id,
      status: row.status,
      cycleMonth: row.cycleMonth,
      isWinnersFinalized: row.isWinnersFinalized,
    }));
  }
  return prisma.contest.findMany({
    where: { seriesSlug: 'pledge' },
    select: { id: true, status: true, cycleMonth: true, isWinnersFinalized: true },
  });
}

export async function runPledgeMonthJob(
  input: {
    now?: Date;
    store?: PledgeRecurrenceStore;
    log?: (entry: PledgeMonthLog) => void;
  } = {},
): Promise<PledgeMonthRow> {
  const now = input.now ?? new Date();
  const log =
    input.log ??
    ((entry) => {
      console.log(JSON.stringify(entry));
    });
  const before = await listPledge(input.store);
  const closedBefore = new Set(
    before
      .filter((row) => row.status === 'JUDGING' || row.status === 'COMPLETED')
      .map((row) => row.id),
  );
  try {
    const row = await PledgeRecurrenceService.ensureCurrentMonthlyContest(
      now,
      input.store,
    );
    const after = await listPledge(input.store);
    const closedIds = after
      .filter(
        (item) =>
          item.status === 'JUDGING' &&
          !closedBefore.has(item.id) &&
          !item.isWinnersFinalized,
      )
      .map((item) => item.id);
    const created = !before.some((item) => item.cycleMonth === row.cycleMonth);
    log({
      event: 'pledge-month',
      result: created ? 'created' : 'existing',
      cycleMonth: row.cycleMonth,
      status: row.status,
      closedIds,
    });
    return row;
  } catch (error) {
    log({
      event: 'pledge-month',
      result: 'failed',
      error: error instanceof Error ? error.message : 'Pledge month job failed',
    });
    throw error;
  }
}
