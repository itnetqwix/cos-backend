import { AuditAction, ContestStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AuditLogRepository } from '../repositories/audit-log.repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/response.js';
import {
  CreateRecurringContestInput,
  UpdatePledgeCycleInput,
  UpdateRecurringContestInput,
} from '../schemas/recurring-contest.schema.js';
import { getUtcMonthBoundaries, utcCycleMonth } from './contest-schedule.js';
import {
  buildPledgeMonth,
  nextGenerationTarget,
  pledgeInstanceTitle,
  type PledgeMonthRow,
} from './pledge-recurrence.service.js';
import { parseBannerObjectKey } from './storage.service.js';
import {
  enabledCategories,
  parseStoredCategories,
  type PledgeScoreCategory,
} from './pledge-categories.js';
import {
  assertPledgeUploadSettings,
  assertPositiveWinnerCount,
  pledgeConfigPhase,
  readStoredFormats,
} from './pledge-cycle-config.js';
import { PLEDGE_SERIES_SLUG } from './contest-schedule.js';

/**
 * Admin template rows. A template is a Contest with cycleMonth null.
 * DRAFT pauses future generation. Generated months are separate rows and
 * are not updated here. Rating categories are not a column.
 */

export const RECURRING_UNSUPPORTED = [
  'One Toke review categories are a separate model and are not copied onto Pledge.',
  'Each cycle uses the UTC calendar month. Submission opens at 00:00 UTC on the 1st. The submission deadline and voting cutoff are 00:00 UTC on the 1st of the next month. Offsets are not stored.',
  'Only monthly recurrence is stored.',
  'Prize breakdown beyond prizeSummary is not stored.',
] as const;

export interface RecurringCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface RecurringTemplateRow {
  id: string;
  title: string;
  description: string;
  seriesSlug: string;
  cycleMonth: string | null;
  status: ContestStatus;
  tagline: string | null;
  bannerUrl: string | null;
  bannerObjectKey: string | null;
  thumbnailUrl: string | null;
  categoryId: string | null;
  category: RecurringCategory | null;
  rules: Prisma.JsonValue | null;
  prizeSummary: string | null;
  autoAdvanceDelayMs: number;
  minOverallVoters: number;
  minCategoryVoters: number;
  isRecurringMonthly: boolean;
  configFrozenAt: Date | null;
  scoringCategories?: PledgeScoreCategory[] | null;
  combinedScoreEnabled?: boolean;
  winnerCount: number | null;
  maxVideoSizeMb: number | null;
  maxVideoDurationSeconds: number | null;
  allowedVideoFormats: string[] | null;
  rankingNeedsReview: boolean;
  isWinnersFinalized: boolean;
  winnersPublished: boolean;
  submissionCount: number;
  startDate: Date | null;
  endDate: Date | null;
  votingClosesAt: Date | null;
}

export interface RecurringAuditWrite {
  actorId: string;
  action:
    'RECURRENCE_CREATE' | 'RECURRENCE_UPDATE' | 'RECURRENCE_PAUSE' | 'RECURRENCE_RESUME';
  seriesSlug: string;
  templateId: string;
}

export interface RecurringStore {
  listTemplates(): Promise<RecurringTemplateRow[]>;
  findById(id: string): Promise<RecurringTemplateRow | null>;
  findTemplateBySlug(seriesSlug: string): Promise<RecurringTemplateRow | null>;
  listCycles(seriesSlug: string): Promise<RecurringTemplateRow[]>;
  insert(row: RecurringTemplateRow): Promise<RecurringTemplateRow>;
  update(id: string, data: Partial<RecurringTemplateRow>): Promise<RecurringTemplateRow>;
  remove(id: string): Promise<void>;
  categoryExists(id: string): Promise<boolean>;
  audit(entry: RecurringAuditWrite): Promise<void>;
}

function blank(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertBanner(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!parseBannerObjectKey(value)) {
    throw new ValidationError('Contest banner reference is not valid');
  }
  return value;
}

function isTemplate(row: RecurringTemplateRow): boolean {
  return row.cycleMonth === null && row.isRecurringMonthly && row.seriesSlug.length > 0;
}

export function toTemplateView(
  row: RecurringTemplateRow,
  cycles: RecurringTemplateRow[],
  now = new Date(),
) {
  const months = cycles
    .map((cycle) => cycle.cycleMonth)
    .filter((month): month is string => month !== null)
    .sort();
  const last = [...cycles].sort((a, b) =>
    (b.cycleMonth ?? '').localeCompare(a.cycleMonth ?? ''),
  )[0];
  const next = nextGenerationTarget(now, months);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    seriesSlug: row.seriesSlug,
    frequency: 'monthly' as const,
    enabled: row.status !== ContestStatus.DRAFT,
    status: row.status,
    tagline: row.tagline,
    bannerUrl: row.bannerUrl,
    bannerObjectKey: row.bannerObjectKey,
    thumbnailUrl: row.thumbnailUrl,
    timezone: 'UTC' as const,
    categoryId: row.categoryId,
    category: row.category,
    categoriesCount: enabledCategories(
      parseStoredCategories(row.scoringCategories ?? null),
    ).length,
    scoringCategories: parseStoredCategories(row.scoringCategories ?? null),
    combinedScoreEnabled: row.combinedScoreEnabled === true,
    rules: row.rules,
    prizeSummary: row.prizeSummary,
    autoAdvanceDelayMs: row.autoAdvanceDelayMs,
    minOverallVoters: row.minOverallVoters,
    minCategoryVoters: row.minCategoryVoters,
    winnerCount: row.winnerCount,
    maxVideoSizeMb: row.maxVideoSizeMb,
    maxVideoDurationSeconds: row.maxVideoDurationSeconds,
    allowedVideoFormats: row.allowedVideoFormats,
    configPhase: 'template' as const,
    nextCycleMonth: next.cycleMonth,
    lastCycleMonth: last?.cycleMonth ?? null,
    lastGenerationStatus: last?.status ?? null,
    unsupported: RECURRING_UNSUPPORTED,
  };
}

function asPledgeTemplate(row: RecurringTemplateRow): PledgeMonthRow {
  return {
    id: row.id,
    seriesSlug: row.seriesSlug,
    cycleMonth: null,
    status: row.status,
    title: row.title,
    description: row.description,
    startDate: new Date(0),
    endDate: new Date(0),
    votingClosesAt: null,
    isRecurringMonthly: true,
    minOverallVoters: row.minOverallVoters,
    minCategoryVoters: row.minCategoryVoters,
    autoAdvanceDelayMs: row.autoAdvanceDelayMs,
    categoryId: row.categoryId,
    scoringCategories: parseStoredCategories(row.scoringCategories ?? null),
    combinedScoreEnabled: row.combinedScoreEnabled === true,
    rules: row.rules,
    prizeSummary: row.prizeSummary,
    configFrozenAt: null,
    isWinnersFinalized: false,
    winnerCount: row.winnerCount,
    maxVideoSizeMb: row.maxVideoSizeMb,
    maxVideoDurationSeconds: row.maxVideoDurationSeconds,
    allowedVideoFormats: row.allowedVideoFormats,
    rankingNeedsReview: false,
    tagline: row.tagline,
    bannerUrl: row.bannerUrl,
    bannerObjectKey: row.bannerObjectKey,
    thumbnailUrl: row.thumbnailUrl,
  };
}

export function previewTemplate(
  row: RecurringTemplateRow,
  cycles: RecurringTemplateRow[],
  now = new Date(),
) {
  const months = cycles
    .map((cycle) => cycle.cycleMonth)
    .filter((month): month is string => month !== null);
  const target = nextGenerationTarget(now, months);
  const built = buildPledgeMonth(
    target.boundaries,
    asPledgeTemplate(row),
    now,
    'preview',
  );
  return {
    persisted: false as const,
    generationEnabled: row.status !== ContestStatus.DRAFT,
    seriesSlug: row.seriesSlug,
    title: pledgeInstanceTitle(row.title, target.boundaries),
    cycleMonth: built.cycleMonth,
    description: built.description,
    tagline: built.tagline ?? null,
    categoryId: built.categoryId,
    category: row.category,
    categoriesCount: enabledCategories(
      parseStoredCategories(row.scoringCategories ?? null),
    ).length,
    scoringCategories: parseStoredCategories(row.scoringCategories ?? null),
    combinedScoreEnabled: row.combinedScoreEnabled === true,
    rules: built.rules,
    prizeSummary: built.prizeSummary,
    minOverallVoters: built.minOverallVoters,
    minCategoryVoters: built.minCategoryVoters,
    winnerCount: built.winnerCount ?? null,
    maxVideoSizeMb: built.maxVideoSizeMb ?? null,
    maxVideoDurationSeconds: built.maxVideoDurationSeconds ?? null,
    allowedVideoFormats: built.allowedVideoFormats ?? null,
    autoAdvanceDelayMs: built.autoAdvanceDelayMs,
    timezone: 'UTC' as const,
    startDate: built.startDate.toISOString(),
    endDate: built.endDate.toISOString(),
    votingClosesAt: built.votingClosesAt?.toISOString() ?? null,
    ratingScale: { min: 1, max: 10 },
    unsupported: RECURRING_UNSUPPORTED,
  };
}

async function requireTemplate(
  store: RecurringStore,
  id: string,
): Promise<RecurringTemplateRow> {
  const row = await store.findById(id);
  if (!row || !isTemplate(row)) {
    throw new NotFoundError('Recurring contest template not found');
  }
  if (row.configFrozenAt) {
    throw new ConflictError('Frozen monthly configuration cannot be modified');
  }
  return row;
}

export class RecurringContestService {
  static async list(now = new Date(), store: RecurringStore = prismaRecurringStore) {
    const templates = await store.listTemplates();
    const views = [];
    for (const template of templates) {
      const cycles = await store.listCycles(template.seriesSlug);
      views.push(toTemplateView(template, cycles, now));
    }
    return views;
  }

  static async get(
    id: string,
    now = new Date(),
    store: RecurringStore = prismaRecurringStore,
  ) {
    const template = await requireTemplate(store, id);
    return toTemplateView(template, await store.listCycles(template.seriesSlug), now);
  }

  static async create(
    actorId: string,
    input: CreateRecurringContestInput,
    now = new Date(),
    store: RecurringStore = prismaRecurringStore,
  ) {
    const existing = await store.findTemplateBySlug(input.seriesSlug);
    if (existing) throw new ConflictError('Series slug already exists');
    if (input.categoryId) {
      const ok = await store.categoryExists(input.categoryId);
      if (!ok) throw new NotFoundError('Category not found');
    }
    const bannerObjectKey = assertBanner(input.bannerObjectKey) ?? null;
    const settings = pledgeSettingsForWrite(input.seriesSlug, input, null);
    const row: RecurringTemplateRow = {
      id: crypto.randomUUID(),
      title: input.title,
      description: input.description,
      seriesSlug: input.seriesSlug,
      cycleMonth: null,
      status: input.enabled ? ContestStatus.SCHEDULED : ContestStatus.DRAFT,
      tagline: blank(input.tagline),
      bannerUrl: bannerObjectKey ? null : blank(input.bannerUrl),
      bannerObjectKey,
      thumbnailUrl: blank(input.thumbnailUrl),
      categoryId: input.categoryId ?? null,
      category: null,
      rules: input.rules === undefined ? null : input.rules,
      prizeSummary: input.prizeSummary ?? null,
      autoAdvanceDelayMs: input.autoAdvanceDelayMs ?? 1800,
      minOverallVoters: input.minOverallVoters,
      minCategoryVoters: input.minCategoryVoters,
      isRecurringMonthly: true,
      configFrozenAt: null,
      scoringCategories: parseStoredCategories(input.scoringCategories ?? null),
      combinedScoreEnabled: input.combinedScoreEnabled === true,
      winnerCount: settings.winnerCount ?? null,
      maxVideoSizeMb: settings.maxVideoSizeMb ?? null,
      maxVideoDurationSeconds: settings.maxVideoDurationSeconds ?? null,
      allowedVideoFormats: settings.allowedVideoFormats ?? null,
      rankingNeedsReview: false,
      isWinnersFinalized: false,
      winnersPublished: false,
      submissionCount: 0,
      startDate: null,
      endDate: null,
      votingClosesAt: null,
    };
    const created = await store.insert(row);
    try {
      await store.audit({
        actorId,
        action: 'RECURRENCE_CREATE',
        seriesSlug: created.seriesSlug,
        templateId: created.id,
      });
    } catch (error) {
      await store.remove(created.id);
      throw error;
    }
    return toTemplateView(created, [], now);
  }

  static async update(
    actorId: string,
    id: string,
    input: UpdateRecurringContestInput,
    now = new Date(),
    store: RecurringStore = prismaRecurringStore,
  ) {
    const current = await requireTemplate(store, id);
    if (input.categoryId) {
      const ok = await store.categoryExists(input.categoryId);
      if (!ok) throw new NotFoundError('Category not found');
    }
    const bannerObjectKey = assertBanner(input.bannerObjectKey);
    const data: Partial<RecurringTemplateRow> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.tagline !== undefined) data.tagline = blank(input.tagline);
    if (bannerObjectKey !== undefined) {
      data.bannerObjectKey = bannerObjectKey;
      if (bannerObjectKey) data.bannerUrl = null;
    }
    if (input.bannerUrl !== undefined && bannerObjectKey === undefined) {
      data.bannerUrl = blank(input.bannerUrl);
    }
    if (input.thumbnailUrl !== undefined) data.thumbnailUrl = blank(input.thumbnailUrl);
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    if (input.rules !== undefined) data.rules = input.rules;
    if (input.prizeSummary !== undefined) data.prizeSummary = input.prizeSummary;
    if (input.autoAdvanceDelayMs !== undefined)
      data.autoAdvanceDelayMs = input.autoAdvanceDelayMs;
    if (input.minOverallVoters !== undefined)
      data.minOverallVoters = input.minOverallVoters;
    if (input.minCategoryVoters !== undefined)
      data.minCategoryVoters = input.minCategoryVoters;
    if (input.scoringCategories !== undefined) {
      data.scoringCategories = parseStoredCategories(input.scoringCategories);
    }
    if (input.combinedScoreEnabled !== undefined) {
      data.combinedScoreEnabled = input.combinedScoreEnabled;
    }
    const pledgePatch = pledgeSettingsForWrite(current.seriesSlug, input, current);
    Object.assign(data, pledgePatch);
    if (input.enabled !== undefined) {
      data.status = input.enabled ? ContestStatus.SCHEDULED : ContestStatus.DRAFT;
    }
    const updated = await store.update(current.id, data);
    await store.audit({
      actorId,
      action: 'RECURRENCE_UPDATE',
      seriesSlug: updated.seriesSlug,
      templateId: updated.id,
    });
    return toTemplateView(updated, await store.listCycles(updated.seriesSlug), now);
  }

  static async setEnabled(
    actorId: string,
    id: string,
    enabled: boolean,
    now = new Date(),
    store: RecurringStore = prismaRecurringStore,
  ) {
    const current = await requireTemplate(store, id);
    const status = enabled ? ContestStatus.SCHEDULED : ContestStatus.DRAFT;
    if (current.status === status) {
      return toTemplateView(current, await store.listCycles(current.seriesSlug), now);
    }
    const updated = await store.update(current.id, { status });
    await store.audit({
      actorId,
      action: enabled ? 'RECURRENCE_RESUME' : 'RECURRENCE_PAUSE',
      seriesSlug: updated.seriesSlug,
      templateId: updated.id,
    });
    return toTemplateView(updated, await store.listCycles(updated.seriesSlug), now);
  }

  static async preview(
    id: string,
    now = new Date(),
    store: RecurringStore = prismaRecurringStore,
  ) {
    const template = await requireTemplate(store, id);
    return previewTemplate(template, await store.listCycles(template.seriesSlug), now);
  }

  static async cycles(
    id: string,
    now = new Date(),
    store: RecurringStore = prismaRecurringStore,
  ) {
    const template = await requireTemplate(store, id);
    let cycles = await store.listCycles(template.seriesSlug);

    // Pre-generate the next 3 upcoming calendar months if they don't exist yet
    const { year, month } = utcCycleMonth(now);
    for (let offset = 0; offset <= 3; offset++) {
      let targetMonth = month + offset;
      let targetYear = year;
      while (targetMonth > 12) {
        targetMonth -= 12;
        targetYear += 1;
      }
      const boundaries = getUtcMonthBoundaries(targetYear, targetMonth);
      const exists = cycles.some((c) => c.cycleMonth === boundaries.cycleMonth);
      if (!exists && template.status !== ContestStatus.DRAFT) {
        const isCurrent = offset === 0;
        const built = buildPledgeMonth(
          boundaries,
          asPledgeTemplate(template),
          now,
          crypto.randomUUID(),
        );
        const rowToInsert: RecurringTemplateRow = {
          id: built.id,
          title: built.title,
          description: built.description,
          seriesSlug: built.seriesSlug ?? template.seriesSlug,
          cycleMonth: built.cycleMonth,
          status: isCurrent ? ContestStatus.ACTIVE : ContestStatus.SCHEDULED,
          tagline: built.tagline ?? null,
          bannerUrl: built.bannerUrl ?? null,
          bannerObjectKey: built.bannerObjectKey ?? null,
          thumbnailUrl: built.thumbnailUrl ?? null,
          categoryId: built.categoryId ?? null,
          category: null,
          rules: built.rules,
          prizeSummary: built.prizeSummary,
          autoAdvanceDelayMs: built.autoAdvanceDelayMs,
          minOverallVoters: built.minOverallVoters,
          minCategoryVoters: built.minCategoryVoters,
          isRecurringMonthly: true,
          configFrozenAt: isCurrent ? now : null,
          scoringCategories: built.scoringCategories ?? null,
          combinedScoreEnabled: built.combinedScoreEnabled ?? false,
          winnerCount: built.winnerCount ?? null,
          maxVideoSizeMb: built.maxVideoSizeMb ?? null,
          maxVideoDurationSeconds: built.maxVideoDurationSeconds ?? null,
          allowedVideoFormats: built.allowedVideoFormats ?? null,
          rankingNeedsReview: false,
          isWinnersFinalized: false,
          winnersPublished: false,
          submissionCount: 0,
          startDate: built.startDate,
          endDate: built.endDate,
          votingClosesAt: built.votingClosesAt,
        };
        try {
          const inserted = await store.insert(rowToInsert);
          cycles.push(inserted);
        } catch {
          // In case another process inserted concurrently
        }
      }
    }

    cycles = await store.listCycles(template.seriesSlug);
    return cycles
      .filter((cycle) => cycle.cycleMonth !== null)
      .sort((a, b) => (b.cycleMonth ?? '').localeCompare(a.cycleMonth ?? ''))
      .map((cycle) => ({
        id: cycle.id,
        title: cycle.title,
        tagline: cycle.tagline,
        bannerUrl: cycle.bannerUrl,
        bannerObjectKey: cycle.bannerObjectKey,
        thumbnailUrl: cycle.thumbnailUrl,
        seriesSlug: cycle.seriesSlug,
        cycleMonth: cycle.cycleMonth,
        status: cycle.status,
        configFrozenAt: cycle.configFrozenAt?.toISOString() ?? null,
        minOverallVoters: cycle.minOverallVoters,
        minCategoryVoters: cycle.minCategoryVoters,
        description: cycle.description,
        rules: cycle.rules,
        winnerCount: cycle.winnerCount,
        maxVideoSizeMb: cycle.maxVideoSizeMb,
        maxVideoDurationSeconds: cycle.maxVideoDurationSeconds,
        allowedVideoFormats: cycle.allowedVideoFormats,
        rankingNeedsReview: cycle.rankingNeedsReview,
        isWinnersFinalized: cycle.isWinnersFinalized,
        startDate: cycle.startDate?.toISOString() ?? null,
        endDate: cycle.endDate?.toISOString() ?? null,
        votingClosesAt: cycle.votingClosesAt?.toISOString() ?? null,
        scoringCategories: cycle.scoringCategories ?? [],
        configPhase: pledgeConfigPhase({
          cycleMonth: cycle.cycleMonth,
          status: cycle.status,
          winnersPublished: cycle.winnersPublished,
          now,
        }),
      }));
  }

  static async updateCycle(
    actorId: string,
    id: string,
    input: UpdatePledgeCycleInput,
    now = new Date(),
    store: RecurringStore = prismaRecurringStore,
  ) {
    const current = await store.findById(id);
    if (!current || current.cycleMonth === null || !current.isRecurringMonthly) {
      throw new NotFoundError('Pledge monthly cycle not found');
    }
    if (current.seriesSlug !== PLEDGE_SERIES_SLUG) {
      throw new ConflictError('Only a Pledge monthly cycle can be configured here');
    }
    if (current.winnersPublished) {
      throw new ConflictError(
        'Published historical Pledge configuration cannot be modified',
      );
    }
    const currentPhase = pledgeConfigPhase({
      cycleMonth: current.cycleMonth,
      status: current.status,
      winnersPublished: current.winnersPublished,
      now,
    });
    // Requirement 6.1: Current-month settings must not allow changing rules, winner count, upload size, duration, formats.
    if (currentPhase === 'active-frozen' || current.status === ContestStatus.ACTIVE) {
      if (
        input.rules !== undefined ||
        input.winnerCount !== undefined ||
        input.maxVideoSizeMb !== undefined ||
        input.maxVideoDurationSeconds !== undefined ||
        input.allowedVideoFormats !== undefined
      ) {
        throw new ConflictError(
          'Competition rules, winner count, and upload limits cannot be changed for the current running month',
        );
      }
    }

    const data: Partial<RecurringTemplateRow> = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.tagline !== undefined) data.tagline = blank(input.tagline);
    if (input.bannerUrl !== undefined) data.bannerUrl = blank(input.bannerUrl);
    if (input.bannerObjectKey !== undefined)
      data.bannerObjectKey = assertBanner(input.bannerObjectKey) ?? null;
    if (input.winnerCount !== undefined) {
      data.winnerCount = assertPositiveWinnerCount(input.winnerCount);
      if (
        data.winnerCount !== current.winnerCount &&
        (current.submissionCount > 0 || current.isWinnersFinalized)
      ) {
        data.rankingNeedsReview = true;
      }
    }
    if (
      input.maxVideoSizeMb !== undefined ||
      input.maxVideoDurationSeconds !== undefined ||
      input.allowedVideoFormats !== undefined
    ) {
      const upload = assertPledgeUploadSettings({
        maxVideoSizeMb: input.maxVideoSizeMb ?? current.maxVideoSizeMb ?? Number.NaN,
        maxVideoDurationSeconds:
          input.maxVideoDurationSeconds ?? current.maxVideoDurationSeconds ?? Number.NaN,
        allowedVideoFormats:
          input.allowedVideoFormats ?? current.allowedVideoFormats ?? undefined,
      });
      if (input.maxVideoSizeMb !== undefined) data.maxVideoSizeMb = upload.maxVideoSizeMb;
      if (input.maxVideoDurationSeconds !== undefined) {
        data.maxVideoDurationSeconds = upload.maxVideoDurationSeconds;
      }
      if (input.allowedVideoFormats !== undefined) {
        data.allowedVideoFormats = upload.allowedVideoFormats;
      }
    }
    if (
      input.startDate !== undefined ||
      input.endDate !== undefined ||
      input.votingClosesAt !== undefined
    ) {
      const start = input.startDate ? new Date(input.startDate) : current.startDate;
      const end = input.endDate ? new Date(input.endDate) : current.endDate;
      const voting = input.votingClosesAt
        ? new Date(input.votingClosesAt)
        : current.votingClosesAt;
      if (!start || !end || !(end.getTime() > start.getTime())) {
        throw new ValidationError(
          'Submission deadline must be after submission opening.',
        );
      }
      if (voting && voting.getTime() < end.getTime()) {
        throw new ValidationError(
          'Voting closure must be after the submission deadline.',
        );
      }
      if (input.startDate !== undefined) data.startDate = start;
      if (input.endDate !== undefined) data.endDate = end;
      if (input.votingClosesAt !== undefined) data.votingClosesAt = voting;
    }
    if (input.description !== undefined) data.description = input.description;
    if (input.rules !== undefined) data.rules = input.rules;
    if (input.prizeSummary !== undefined) data.prizeSummary = input.prizeSummary;
    if (input.minOverallVoters !== undefined)
      data.minOverallVoters = input.minOverallVoters;
    if (input.minCategoryVoters !== undefined)
      data.minCategoryVoters = input.minCategoryVoters;
    if (input.scoringCategories !== undefined) {
      data.scoringCategories = parseStoredCategories(input.scoringCategories);
    }
    const updated = await store.update(current.id, data);
    await store.audit({
      actorId,
      action: 'RECURRENCE_UPDATE',
      seriesSlug: updated.seriesSlug,
      templateId: updated.id,
    });
    return {
      id: updated.id,
      title: updated.title,
      tagline: updated.tagline,
      bannerUrl: updated.bannerUrl,
      bannerObjectKey: updated.bannerObjectKey,
      thumbnailUrl: updated.thumbnailUrl,
      cycleMonth: updated.cycleMonth,
      winnerCount: updated.winnerCount,
      maxVideoSizeMb: updated.maxVideoSizeMb,
      maxVideoDurationSeconds: updated.maxVideoDurationSeconds,
      allowedVideoFormats: updated.allowedVideoFormats,
      rankingNeedsReview: updated.rankingNeedsReview,
      configPhase: pledgeConfigPhase({
        cycleMonth: updated.cycleMonth,
        status: updated.status,
        winnersPublished: updated.winnersPublished,
        now,
      }),
      startDate: updated.startDate?.toISOString() ?? null,
      endDate: updated.endDate?.toISOString() ?? null,
      votingClosesAt: updated.votingClosesAt?.toISOString() ?? null,
      description: updated.description,
      rules: updated.rules,
      scoringCategories: updated.scoringCategories ?? [],
    };
  }
}

function pledgeSettingsForWrite(
  seriesSlug: string,
  input: {
    winnerCount?: number;
    maxVideoSizeMb?: number;
    maxVideoDurationSeconds?: number;
    allowedVideoFormats?: string[];
  },
  current: RecurringTemplateRow | null,
): Partial<RecurringTemplateRow> {
  const data: Partial<RecurringTemplateRow> = {};
  const touched =
    input.winnerCount !== undefined ||
    input.maxVideoSizeMb !== undefined ||
    input.maxVideoDurationSeconds !== undefined ||
    input.allowedVideoFormats !== undefined;
  if (seriesSlug === PLEDGE_SERIES_SLUG && current === null) {
    if (
      input.winnerCount === undefined ||
      input.maxVideoSizeMb === undefined ||
      input.maxVideoDurationSeconds === undefined
    ) {
      throw new ValidationError(
        'Pledge requires winnerCount, maxVideoSizeMb, and maxVideoDurationSeconds',
      );
    }
  }
  if (!touched && current) return data;
  if (input.winnerCount !== undefined) {
    data.winnerCount = assertPositiveWinnerCount(input.winnerCount);
  } else if (current === null && seriesSlug === PLEDGE_SERIES_SLUG) {
    data.winnerCount = assertPositiveWinnerCount(input.winnerCount ?? Number.NaN);
  }
  if (
    input.maxVideoSizeMb !== undefined ||
    input.maxVideoDurationSeconds !== undefined ||
    input.allowedVideoFormats !== undefined ||
    (current === null && seriesSlug === PLEDGE_SERIES_SLUG)
  ) {
    const upload = assertPledgeUploadSettings({
      maxVideoSizeMb: input.maxVideoSizeMb ?? current?.maxVideoSizeMb ?? Number.NaN,
      maxVideoDurationSeconds:
        input.maxVideoDurationSeconds ?? current?.maxVideoDurationSeconds ?? Number.NaN,
      allowedVideoFormats: input.allowedVideoFormats,
    });
    if (input.maxVideoSizeMb !== undefined || current === null) {
      data.maxVideoSizeMb = upload.maxVideoSizeMb;
    }
    if (input.maxVideoDurationSeconds !== undefined || current === null) {
      data.maxVideoDurationSeconds = upload.maxVideoDurationSeconds;
    }
    data.allowedVideoFormats = upload.allowedVideoFormats;
  }
  return data;
}

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
} as const;

function toRow(
  row: {
    id: string;
    title: string;
    description: string;
    seriesSlug: string | null;
    cycleMonth: string | null;
    status: ContestStatus;
    tagline: string | null;
    bannerUrl: string | null;
    bannerObjectKey: string | null;
    thumbnailUrl: string | null;
    categoryId: string | null;
    category: RecurringCategory | null;
    rules: Prisma.JsonValue;
    prizeSummary: string | null;
    autoAdvanceDelayMs: number;
    minOverallVoters: number;
    minCategoryVoters: number;
    isRecurringMonthly: boolean;
    configFrozenAt: Date | null;
    scoringCategories?: unknown;
    combinedScoreEnabled?: boolean;
    winnerCount?: number | null;
    maxVideoSizeMb?: number | null;
    maxVideoDurationSeconds?: number | null;
    allowedVideoFormats?: unknown;
    rankingNeedsReview?: boolean;
    isWinnersFinalized?: boolean;
    startDate?: Date;
    endDate?: Date;
    votingClosesAt?: Date | null;
    winnersData?: unknown;
  },
  submissionCount = 0,
): RecurringTemplateRow {
  const winnersPublished =
    row.status === ContestStatus.COMPLETED || row.status === ContestStatus.ARCHIVED;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    seriesSlug: row.seriesSlug ?? '',
    cycleMonth: row.cycleMonth,
    status: row.status,
    tagline: row.tagline,
    bannerUrl: row.bannerUrl,
    bannerObjectKey: row.bannerObjectKey,
    thumbnailUrl: row.thumbnailUrl,
    categoryId: row.categoryId,
    category: row.category,
    rules: row.rules,
    prizeSummary: row.prizeSummary,
    autoAdvanceDelayMs: row.autoAdvanceDelayMs,
    minOverallVoters: row.minOverallVoters,
    minCategoryVoters: row.minCategoryVoters,
    isRecurringMonthly: row.isRecurringMonthly,
    configFrozenAt: row.configFrozenAt,
    scoringCategories: parseStoredCategories(row.scoringCategories ?? null),
    combinedScoreEnabled: row.combinedScoreEnabled === true,
    winnerCount: row.winnerCount ?? null,
    maxVideoSizeMb: row.maxVideoSizeMb ?? null,
    maxVideoDurationSeconds: row.maxVideoDurationSeconds ?? null,
    allowedVideoFormats: readStoredFormats(row.allowedVideoFormats),
    rankingNeedsReview: row.rankingNeedsReview === true,
    isWinnersFinalized: row.isWinnersFinalized === true,
    winnersPublished,
    submissionCount,
    startDate: row.startDate ?? null,
    endDate: row.endDate ?? null,
    votingClosesAt: row.votingClosesAt ?? null,
  };
}

const prismaRecurringStore: RecurringStore = {
  async listTemplates() {
    const rows = await prisma.contest.findMany({
      where: { cycleMonth: null, isRecurringMonthly: true, seriesSlug: { not: null } },
      include: { category: { select: categorySelect } },
      orderBy: { title: 'asc' },
    });
    return rows.map(toRow);
  },
  async findById(id) {
    const row = await prisma.contest.findUnique({
      where: { id },
      include: { category: { select: categorySelect } },
    });
    if (!row) return null;
    const submissionCount = await prisma.submission.count({
      where: { contestId: id, deletedAt: null },
    });
    return toRow(row, submissionCount);
  },
  async findTemplateBySlug(seriesSlug) {
    const row = await prisma.contest.findFirst({
      where: { seriesSlug, cycleMonth: null },
      include: { category: { select: categorySelect } },
    });
    return row ? toRow(row) : null;
  },
  async listCycles(seriesSlug) {
    const rows = await prisma.contest.findMany({
      where: { seriesSlug, cycleMonth: { not: null } },
      include: { category: { select: categorySelect } },
    });
    return rows.map(toRow);
  },
  async insert(row) {
    const parts = utcCycleMonth(new Date());
    const bounds = getUtcMonthBoundaries(parts.year, parts.month);
    try {
      const created = await prisma.contest.create({
        data: {
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          timezone: 'UTC',
          startDate: bounds.start,
          endDate: bounds.end,
          votingClosesAt: null,
          seriesSlug: row.seriesSlug,
          cycleMonth: null,
          isRecurringMonthly: true,
          minOverallVoters: row.minOverallVoters,
          minCategoryVoters: row.minCategoryVoters,
          autoAdvanceDelayMs: row.autoAdvanceDelayMs,
          categoryId: row.categoryId,
          scoringCategories: parseStoredCategories(
            row.scoringCategories ?? null,
          ) as unknown as Prisma.InputJsonValue,
          combinedScoreEnabled: row.combinedScoreEnabled === true,
          tagline: row.tagline,
          bannerUrl: row.bannerUrl,
          bannerObjectKey: row.bannerObjectKey,
          thumbnailUrl: row.thumbnailUrl,
          prizeSummary: row.prizeSummary,
          rules:
            row.rules === null ? Prisma.JsonNull : (row.rules as Prisma.InputJsonValue),
          configFrozenAt: null,
          winnerCount: row.winnerCount,
          maxVideoSizeMb: row.maxVideoSizeMb,
          maxVideoDurationSeconds: row.maxVideoDurationSeconds,
          allowedVideoFormats:
            row.allowedVideoFormats == null
              ? Prisma.JsonNull
              : (row.allowedVideoFormats as unknown as Prisma.InputJsonValue),
          rankingNeedsReview: false,
        },
        include: { category: { select: categorySelect } },
      });
      return toRow(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError('Series slug already exists');
      }
      throw error;
    }
  },
  async update(id, data) {
    const updated = await prisma.contest.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        status: data.status,
        tagline: data.tagline,
        bannerUrl: data.bannerUrl,
        bannerObjectKey: data.bannerObjectKey,
        thumbnailUrl: data.thumbnailUrl,
        categoryId: data.categoryId,
        prizeSummary: data.prizeSummary,
        autoAdvanceDelayMs: data.autoAdvanceDelayMs,
        minOverallVoters: data.minOverallVoters,
        minCategoryVoters: data.minCategoryVoters,
        scoringCategories:
          data.scoringCategories === undefined
            ? undefined
            : (parseStoredCategories(
                data.scoringCategories,
              ) as unknown as Prisma.InputJsonValue),
        combinedScoreEnabled: data.combinedScoreEnabled,
        rules:
          data.rules === undefined
            ? undefined
            : data.rules === null
              ? Prisma.JsonNull
              : (data.rules as Prisma.InputJsonValue),
        winnerCount: data.winnerCount,
        maxVideoSizeMb: data.maxVideoSizeMb,
        maxVideoDurationSeconds: data.maxVideoDurationSeconds,
        allowedVideoFormats:
          data.allowedVideoFormats === undefined
            ? undefined
            : data.allowedVideoFormats === null
              ? Prisma.JsonNull
              : (data.allowedVideoFormats as unknown as Prisma.InputJsonValue),
        rankingNeedsReview: data.rankingNeedsReview,
        startDate: data.startDate ?? undefined,
        endDate: data.endDate ?? undefined,
        votingClosesAt: data.votingClosesAt,
      },
      include: { category: { select: categorySelect } },
    });
    return toRow(updated);
  },
  async remove(id) {
    await prisma.contest.delete({ where: { id } });
  },
  async categoryExists(id) {
    const category = await prisma.category.findUnique({
      where: { id },
      select: { id: true },
    });
    return category !== null;
  },
  async audit(entry) {
    const action = AuditAction[entry.action];
    await AuditLogRepository.create({
      submissionId: null,
      actorId: entry.actorId,
      action,
      reason: null,
      metadata: {
        seriesSlug: entry.seriesSlug,
        templateId: entry.templateId,
        operation: entry.action,
      },
    });
  },
};
