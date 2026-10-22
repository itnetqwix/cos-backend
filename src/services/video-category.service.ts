import { Prisma, Role } from '@prisma/client';
import {
  CategoryAdminRecord,
  CategoryRecord,
  CategoryRepository,
} from '../repositories/category.repository.js';
import { slugifyCategoryName } from './contest.service.js';
import { parsePaginationParams, buildPaginationMeta } from '../utils/pagination.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';
import type {
  CreateVideoCategoryInput,
  ListVideoCategoriesQuery,
  UpdateVideoCategoryInput,
} from '../schemas/video-category.schema.js';

export interface VideoCategoryActor {
  id: string;
  role: Role;
}

export interface VideoCategoryView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  submissionCount: number;
  contestCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedSubmissionCategory {
  categoryId: string | null;
  otherCategoryLabel: string | null;
}

function assertAdmin(actor: VideoCategoryActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new ForbiddenError(
      `Forbidden: User role '${actor.role}' does not have permission to access this resource`,
    );
  }
}

function iso(value: Date): string {
  return value.toISOString();
}

export function toVideoCategoryView(
  category: CategoryRecord,
  counts: { submissionCount?: number; contestCount?: number } = {},
): VideoCategoryView {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    isActive: category.isActive,
    submissionCount: counts.submissionCount ?? 0,
    contestCount: counts.contestCount ?? 0,
    createdAt: iso(category.createdAt),
    updatedAt: iso(category.updatedAt),
  };
}

function toAdminView(category: CategoryAdminRecord): VideoCategoryView {
  return toVideoCategoryView(category, {
    submissionCount: category.submissionCount,
    contestCount: category.contestCount,
  });
}

function cleanDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertSlug(name: string): string {
  const slug = slugifyCategoryName(name);
  if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 1 || slug.length > 50) {
    throw new ValidationError('Category name cannot be turned into a valid slug', [
      { field: 'name', message: 'Use letters or numbers in the category name' },
    ]);
  }
  return slug;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function assertUniqueName(
  name: string,
  slug: string,
  exceptId?: string,
): Promise<void> {
  const [bySlug, byName] = await Promise.all([
    CategoryRepository.findBySlug(slug),
    CategoryRepository.findByNameInsensitive(name),
  ]);
  const clash = [bySlug, byName].find((row) => row && row.id !== exceptId);
  if (clash) {
    throw new ConflictError('A category with this name already exists', [
      { field: 'name', message: 'A category with this name already exists' },
    ]);
  }
}

/**
 * Official video categories. Creator "Other" text is not inserted here.
 * Deletion policy was NOT SPECIFIED. A category that any submission or contest
 * still references is refused so those rows stay intact. Deactivate instead.
 */
export class VideoCategoryService {
  static async listActive(): Promise<VideoCategoryView[]> {
    const rows = await CategoryRepository.listActive();
    return rows.map((row) => toVideoCategoryView(row));
  }

  static async listAdmin(actor: VideoCategoryActor, query: ListVideoCategoriesQuery) {
    assertAdmin(actor);
    const { page, limit, skip } = parsePaginationParams(query);
    const isActive =
      query.status === 'active' ? true : query.status === 'inactive' ? false : undefined;
    const result = await CategoryRepository.listAdmin({
      search: query.search,
      isActive,
      skip,
      take: limit,
    });
    return {
      items: result.items.map(toAdminView),
      pagination: buildPaginationMeta(result.totalCount, page, limit),
    };
  }

  static async create(
    actor: VideoCategoryActor,
    input: CreateVideoCategoryInput,
  ): Promise<VideoCategoryView> {
    assertAdmin(actor);
    const name = input.name.trim();
    const slug = assertSlug(name);
    await assertUniqueName(name, slug);
    try {
      const created = await CategoryRepository.create({
        name,
        slug,
        description: cleanDescription(input.description) ?? null,
        isActive: input.isActive ?? true,
      });
      return toVideoCategoryView(created);
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictError('A category with this name already exists', [
          { field: 'name', message: 'A category with this name already exists' },
        ]);
      }
      throw error;
    }
  }

  static async update(
    actor: VideoCategoryActor,
    id: string,
    input: UpdateVideoCategoryInput,
  ): Promise<VideoCategoryView> {
    assertAdmin(actor);
    const existing = await CategoryRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('Category not found');
    }

    const data: {
      name?: string;
      slug?: string;
      description?: string | null;
      isActive?: boolean;
    } = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      const slug = assertSlug(name);
      await assertUniqueName(name, slug, existing.id);
      data.name = name;
      data.slug = slug;
    }
    if (input.description !== undefined) {
      data.description = cleanDescription(input.description) ?? null;
    }
    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
    }

    try {
      const updated = await CategoryRepository.update(existing.id, data);
      const counts = await CategoryRepository.countReferences(existing.id);
      return toVideoCategoryView(updated, {
        submissionCount: counts.submissions,
        contestCount: counts.contests,
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictError('A category with this name already exists', [
          { field: 'name', message: 'A category with this name already exists' },
        ]);
      }
      throw error;
    }
  }

  static async remove(
    actor: VideoCategoryActor,
    id: string,
  ): Promise<{ id: string; deleted: true }> {
    assertAdmin(actor);
    const existing = await CategoryRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('Category not found');
    }
    const counts = await CategoryRepository.countReferences(existing.id);
    if (counts.submissions > 0 || counts.contests > 0) {
      throw new ConflictError(
        'This category is already used by videos or contests. Deactivate it instead. Nothing was deleted.',
        [
          {
            field: 'id',
            message: 'Category is in use',
          },
        ],
      );
    }
    await CategoryRepository.deleteById(existing.id);
    return { id: existing.id, deleted: true };
  }
}

/**
 * New submissions must name an active official category or a non-empty Other label.
 * Other does not create a Category row and does not borrow another category id.
 */
export async function resolveSubmissionCategory(input: {
  categoryId?: string;
  otherCategoryLabel?: string | null;
}): Promise<ResolvedSubmissionCategory> {
  const categoryId = input.categoryId?.trim() || '';
  const other = input.otherCategoryLabel?.trim() || '';
  if (categoryId && other) {
    throw new ValidationError(
      'Provide either an official category or an Other label, not both',
      [{ field: 'categoryId', message: 'Choose one category option' }],
    );
  }
  if (!categoryId && !other) {
    throw new ValidationError('A video category is required', [
      { field: 'categoryId', message: 'Select a category or specify Other' },
    ]);
  }
  if (other) {
    return { categoryId: null, otherCategoryLabel: other };
  }
  const category = await CategoryRepository.findById(categoryId);
  if (!category) {
    throw new ValidationError('Category not found', [
      { field: 'categoryId', message: 'Category not found' },
    ]);
  }
  if (!category.isActive) {
    throw new ValidationError('This category is inactive and cannot be selected', [
      { field: 'categoryId', message: 'This category is inactive' },
    ]);
  }
  return { categoryId: category.id, otherCategoryLabel: null };
}
