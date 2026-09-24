import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  organizationId: true,
  createdAt: true,
} satisfies Prisma.CategorySelect;

export type CategoryRecord = Prisma.CategoryGetPayload<{
  select: typeof categorySelect;
}>;

export interface CreateCategoryData {
  organizationId: string;
  name: string;
  slug: string;
  description?: string | null;
}

/**
 * Category persistence (M05-P02-T02).
 * Create and list only. No category HTTP API is defined in M05.
 * ContestService uses these methods when a contest names a category.
 */
export class CategoryRepository {
  static async create(data: CreateCategoryData): Promise<CategoryRecord> {
    return prisma.category.create({
      data: {
        organizationId: data.organizationId,
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
      },
      select: categorySelect,
    });
  }

  static async listByOrganization(organizationId: string): Promise<CategoryRecord[]> {
    return prisma.category.findMany({
      where: { organizationId },
      select: categorySelect,
      orderBy: { name: 'asc' },
    });
  }

  static async findById(id: string): Promise<CategoryRecord | null> {
    return prisma.category.findUnique({
      where: { id },
      select: categorySelect,
    });
  }

  static async findByOrganizationAndSlug(
    organizationId: string,
    slug: string,
  ): Promise<CategoryRecord | null> {
    return prisma.category.findUnique({
      where: {
        organizationId_slug: { organizationId, slug },
      },
      select: categorySelect,
    });
  }
}
