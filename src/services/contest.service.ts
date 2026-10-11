import { ContestStatus, Prisma, Role } from '@prisma/client';
import { CategoryRepository } from '../repositories/category.repository.js';
import {
  ContestRepository,
  UpdateContestData,
} from '../repositories/contest.repository.js';
import {
  CreateContestInput,
  ListContestsQueryInput,
  UpdateContestInput,
  categoryWriteSchema,
} from '../schemas/contest.schema.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';
import {
  assertContestConfigurationMutable,
  assertContestTransition,
  contestDeletionBlockReason,
} from './contest-lifecycle.js';
import {
  DEFAULT_CONTEST_TIMEZONE,
  assertChronologicalSchedule,
  isValidIanaTimeZone,
} from './contest-schedule.js';
import {
  buildBannerObjectKey,
  getStorageService,
  parseBannerObjectKey,
} from './storage.service.js';
import { PresignContestBannerInput } from '../schemas/contest.schema.js';
import { z } from 'zod';

/**
 * Contest administration.
 * ADMIN creates, reads, updates, and lists contests.
 * CREATOR is rejected on these routes. Public active contests use listActive.
 */

export interface ContestActor {
  id?: string;
  role: Role;
}

const CONFIGURATION_KEYS = [
  'title',
  'description',
  'tagline',
  'bannerUrl',
  'bannerObjectKey',
  'thumbnailUrl',
  'timezone',
  'startDate',
  'endDate',
  'votingClosesAt',
  'prizeSummary',
  'rules',
  'autoAdvanceDelayMs',
  'categoryId',
  'category',
] as const;

const VIEWABLE_CONTEST_STATUSES: ContestStatus[] = [
  ContestStatus.ACTIVE,
  ContestStatus.JUDGING,
  ContestStatus.COMPLETED,
  ContestStatus.ARCHIVED,
];

function blankToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type CategoryWrite = z.infer<typeof categoryWriteSchema>;

function assertContestManager(actor: ContestActor): void {
  if (actor.role === Role.ADMIN) {
    return;
  }
  throw new ForbiddenError(
    `Forbidden: User role '${actor.role}' does not have permission to access this resource`,
  );
}

export function slugifyCategoryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function resolveCategoryId(
  categoryId: string | null | undefined,
  category: CategoryWrite | null | undefined,
): Promise<string | null | undefined> {
  if (categoryId === null || category === null) {
    return null;
  }

  if (categoryId) {
    const existing = await CategoryRepository.findById(categoryId);
    if (!existing) {
      throw new NotFoundError('Category not found');
    }
    return existing.id;
  }

  if (!category) {
    return undefined;
  }

  const slug = category.slug ?? slugifyCategoryName(category.name);
  if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 1 || slug.length > 50) {
    throw new ValidationError('Category slug is invalid');
  }

  const existing = await CategoryRepository.findBySlug(slug);
  if (existing) {
    return existing.id;
  }

  try {
    const created = await CategoryRepository.create({
      name: category.name,
      slug,
      description: category.description ?? null,
    });
    return created.id;
  } catch (error) {
    if (isUniqueConflict(error)) {
      const raced = await CategoryRepository.findBySlug(slug);
      if (raced) {
        return raced.id;
      }
    }
    throw error;
  }
}

function changesConfiguration(input: UpdateContestInput): boolean {
  return CONFIGURATION_KEYS.some((key) => input[key] !== undefined);
}

function resolveTimezone(value: string | undefined): string {
  if (value === undefined) return DEFAULT_CONTEST_TIMEZONE;
  if (!isValidIanaTimeZone(value)) {
    throw new ValidationError('timezone must be an IANA time zone identifier');
  }
  return value.trim();
}

function resolveBannerObjectKey(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!parseBannerObjectKey(value)) {
    throw new ValidationError('Contest banner reference is not valid');
  }
  return value;
}

export class ContestService {
  static async list(actor: ContestActor, query: ListContestsQueryInput) {
    assertContestManager(actor);
    return ContestRepository.list({
      status: query.status,
      categorySlug: query.category,
    });
  }

  static async create(actor: ContestActor, input: CreateContestInput) {
    assertContestManager(actor);

    const startDate = new Date(input.startDate);
    const endDate = new Date(input.endDate);
    const votingClosesAt =
      input.votingClosesAt === undefined || input.votingClosesAt === null
        ? null
        : new Date(input.votingClosesAt);
    assertChronologicalSchedule({
      submissionOpenAt: startDate,
      submissionDeadlineAt: endDate,
      votingClosesAt,
    });

    const categoryId = await resolveCategoryId(input.categoryId, input.category);
    const bannerObjectKey = resolveBannerObjectKey(input.bannerObjectKey) ?? null;

    return ContestRepository.create({
      categoryId: categoryId ?? null,
      title: input.title,
      description: input.description,
      tagline: blankToNull(input.tagline),
      bannerUrl: bannerObjectKey ? null : blankToNull(input.bannerUrl),
      bannerObjectKey,
      thumbnailUrl: blankToNull(input.thumbnailUrl),
      timezone: resolveTimezone(input.timezone),
      startDate,
      endDate,
      votingClosesAt,
      prizeSummary: input.prizeSummary ?? null,
      rules: input.rules === undefined ? null : input.rules,
      autoAdvanceDelayMs: input.autoAdvanceDelayMs ?? 1800,
    });
  }

  /**
   * ADMIN only. Issues a private PUT URL. Does not persist the banner.
   * The contest row stores the object key when create or update receives it.
   */
  static async presignBanner(actor: ContestActor, input: PresignContestBannerInput) {
    assertContestManager(actor);
    if (!actor.id) {
      throw new ForbiddenError('Forbidden: authenticated admin is required');
    }
    const objectKey = buildBannerObjectKey(actor.id, input.contentType);
    return getStorageService().createPresignedUpload({
      objectKey,
      contentType: input.contentType,
    });
  }

  static async getById(actor: ContestActor, id: string) {
    assertContestManager(actor);
    const contest = await ContestRepository.findById(id);
    if (!contest) {
      throw new NotFoundError('Contest not found');
    }
    return contest;
  }

  static async update(actor: ContestActor, id: string, input: UpdateContestInput) {
    const existing = await ContestService.getById(actor, id);

    if (changesConfiguration(input)) {
      assertContestConfigurationMutable(existing.status);
    }

    const startDate = input.startDate ? new Date(input.startDate) : existing.startDate;
    const endDate = input.endDate ? new Date(input.endDate) : existing.endDate;
    const votingClosesAt =
      input.votingClosesAt === undefined
        ? existing.votingClosesAt
        : input.votingClosesAt === null
          ? null
          : new Date(input.votingClosesAt);
    assertChronologicalSchedule({
      submissionOpenAt: startDate,
      submissionDeadlineAt: endDate,
      votingClosesAt,
    });

    const data: UpdateContestData = {};

    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.tagline !== undefined) data.tagline = blankToNull(input.tagline);
    if (input.bannerObjectKey !== undefined) {
      const bannerObjectKey = resolveBannerObjectKey(input.bannerObjectKey) ?? null;
      data.bannerObjectKey = bannerObjectKey;
      if (bannerObjectKey) {
        data.bannerUrl = null;
      } else if (input.bannerUrl !== undefined) {
        data.bannerUrl = blankToNull(input.bannerUrl);
      }
    } else if (input.bannerUrl !== undefined) {
      data.bannerUrl = blankToNull(input.bannerUrl);
    }
    if (input.thumbnailUrl !== undefined)
      data.thumbnailUrl = blankToNull(input.thumbnailUrl);
    if (input.timezone !== undefined) data.timezone = resolveTimezone(input.timezone);
    if (input.startDate !== undefined) data.startDate = startDate;
    if (input.endDate !== undefined) data.endDate = endDate;
    if (input.votingClosesAt !== undefined) data.votingClosesAt = votingClosesAt;
    if (input.prizeSummary !== undefined) data.prizeSummary = input.prizeSummary;
    if (input.rules !== undefined) data.rules = input.rules;
    if (input.autoAdvanceDelayMs !== undefined) {
      data.autoAdvanceDelayMs = input.autoAdvanceDelayMs;
    }

    if (input.categoryId !== undefined || input.category !== undefined) {
      const categoryId = await resolveCategoryId(input.categoryId, input.category);
      if (categoryId !== undefined) {
        data.categoryId = categoryId;
      }
    }

    if (input.status !== undefined) {
      assertContestTransition(existing.status, input.status);
      data.status = input.status;
    }

    return ContestRepository.update(id, data);
  }

  /** Public read of every ACTIVE contest. No client tenant parameter. */
  static async listActive() {
    return ContestRepository.list({ status: 'ACTIVE' });
  }

  /**
   * Every contest in this deployment. CREATOR only.
   * Newly created contests are DRAFT and must still appear.
   */
  static async listForCreator(actor: ContestActor) {
    if (actor.role !== Role.CREATOR) {
      throw new ForbiddenError(
        `Forbidden: User role '${actor.role}' does not have permission to access this resource`,
      );
    }
    return ContestRepository.list({});
  }

  static async getForCreator(actor: ContestActor, id: string) {
    if (actor.role !== Role.CREATOR) {
      throw new ForbiddenError(
        `Forbidden: User role '${actor.role}' does not have permission to access this resource`,
      );
    }
    const contest = await ContestRepository.findById(id);
    if (!contest) {
      throw new NotFoundError('Contest not found');
    }
    return contest;
  }

  /** Public contests a guest can watch. Rating stays closed after COMPLETED. */
  static async listViewable() {
    return ContestRepository.list({ statuses: VIEWABLE_CONTEST_STATUSES });
  }

  static async remove(actor: ContestActor, id: string) {
    const existing = await ContestService.getById(actor, id);
    const reason = contestDeletionBlockReason(existing.status);
    if (reason) {
      throw new ConflictError(reason);
    }
    await ContestRepository.deleteById(id);
    return { id: existing.id };
  }
}
