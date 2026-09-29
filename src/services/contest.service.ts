import { Prisma, Role } from '@prisma/client';
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
} from './contest-lifecycle.js';
import { z } from 'zod';

/**
 * Contest administration.
 * ADMIN creates, reads, updates, and lists contests.
 * CREATOR is rejected on these routes. Public active contests use listActive.
 */

export interface ContestActor {
  role: Role;
}

const CONFIGURATION_KEYS = [
  'title',
  'description',
  'startDate',
  'endDate',
  'prizeSummary',
  'rules',
  'autoAdvanceDelayMs',
  'categoryId',
  'category',
] as const;

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
    if (endDate.getTime() <= startDate.getTime()) {
      throw new ValidationError('endDate must be after startDate');
    }

    const categoryId = await resolveCategoryId(input.categoryId, input.category);

    return ContestRepository.create({
      categoryId: categoryId ?? null,
      title: input.title,
      description: input.description,
      startDate,
      endDate,
      prizeSummary: input.prizeSummary ?? null,
      rules: input.rules === undefined ? null : input.rules,
      autoAdvanceDelayMs: input.autoAdvanceDelayMs ?? 1800,
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
    if (
      (input.startDate !== undefined || input.endDate !== undefined) &&
      endDate.getTime() <= startDate.getTime()
    ) {
      throw new ValidationError('endDate must be after startDate');
    }

    const data: UpdateContestData = {};

    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.startDate !== undefined) data.startDate = startDate;
    if (input.endDate !== undefined) data.endDate = endDate;
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
}
