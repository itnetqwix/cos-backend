import { Prisma, Role } from '@prisma/client';
import { CategoryRepository } from '../repositories/category.repository.js';
import {
  ContestRepository,
  UpdateContestData,
} from '../repositories/contest.repository.js';
import { OrganizationRepository } from '../repositories/organization.repository.js';
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
 * Contest administration (M05-P02).
 *
 * Actors are JWT claims `{ role, organizationId }`.
 * BRAND_ADMIN may create, read, update, and list only their organization.
 * SUPER_ADMIN may act across organizations (architecture: cross-tenant admin).
 * CREATOR and VIEWER are rejected. Their read visibility is NOT SPECIFIED.
 *
 * Contests are created as DRAFT. Status moves only through
 * `assertContestTransition`. No automatic date transitions.
 */

export interface ContestActor {
  role: Role;
  organizationId: string | null;
}

const OWN_ORGANIZATION_MESSAGE =
  'Forbidden: Brand administrators can manage contests only for their own organization';

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
  if (actor.role === Role.BRAND_ADMIN || actor.role === Role.SUPER_ADMIN) {
    return;
  }
  throw new ForbiddenError(
    `Forbidden: User role '${actor.role}' does not have permission to access this resource`,
  );
}

function assertOwnOrganization(actor: ContestActor, organizationId: string): void {
  assertContestManager(actor);
  if (actor.role === Role.SUPER_ADMIN) {
    return;
  }
  if (actor.role === Role.BRAND_ADMIN && actor.organizationId === organizationId) {
    return;
  }
  throw new ForbiddenError(OWN_ORGANIZATION_MESSAGE);
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
  organizationId: string,
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
    if (existing.organizationId !== organizationId) {
      throw new ForbiddenError(
        'Forbidden: Category does not belong to the contest organization',
      );
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

  const existing = await CategoryRepository.findByOrganizationAndSlug(
    organizationId,
    slug,
  );
  if (existing) {
    return existing.id;
  }

  try {
    const created = await CategoryRepository.create({
      organizationId,
      name: category.name,
      slug,
      description: category.description ?? null,
    });
    return created.id;
  } catch (error) {
    if (isUniqueConflict(error)) {
      const raced = await CategoryRepository.findByOrganizationAndSlug(
        organizationId,
        slug,
      );
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

    let organizationId: string | undefined;
    if (actor.role === Role.BRAND_ADMIN) {
      if (!actor.organizationId) {
        throw new ForbiddenError(OWN_ORGANIZATION_MESSAGE);
      }
      if (query.tenantId && query.tenantId !== actor.organizationId) {
        throw new ForbiddenError(OWN_ORGANIZATION_MESSAGE);
      }
      organizationId = actor.organizationId;
    } else {
      organizationId = query.tenantId;
    }

    return ContestRepository.list({
      organizationId,
      status: query.status,
      categorySlug: query.category,
    });
  }

  static async create(actor: ContestActor, input: CreateContestInput) {
    assertOwnOrganization(actor, input.organizationId);

    const organization = await OrganizationRepository.findById(input.organizationId);
    if (!organization) {
      throw new NotFoundError('Organization not found');
    }

    const startDate = new Date(input.startDate);
    const endDate = new Date(input.endDate);
    if (endDate.getTime() <= startDate.getTime()) {
      throw new ValidationError('endDate must be after startDate');
    }

    const categoryId = await resolveCategoryId(
      input.organizationId,
      input.categoryId,
      input.category,
    );

    return ContestRepository.create({
      organizationId: input.organizationId,
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
    assertOwnOrganization(actor, contest.organizationId);
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
    if (input.autoAdvanceDelayMs !== undefined)
      data.autoAdvanceDelayMs = input.autoAdvanceDelayMs;

    if (input.categoryId !== undefined || input.category !== undefined) {
      const categoryId = await resolveCategoryId(
        existing.organizationId,
        input.categoryId,
        input.category,
      );
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
}
