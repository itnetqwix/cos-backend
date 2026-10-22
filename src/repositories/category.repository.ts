import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

export type CategoryRecord = Prisma.CategoryGetPayload<{
  select: typeof categorySelect;
}>;

export interface CreateCategoryData {
  name: string;
  slug: string;
  description?: string | null;
  isActive?: boolean;
}

export interface UpdateCategoryData {
  name?: string;
  slug?: string;
  description?: string | null;
  isActive?: boolean;
}

export interface CategoryListFilters {
  search?: string;
  isActive?: boolean;
  skip: number;
  take: number;
}

export type CategoryAdminRecord = CategoryRecord & {
  submissionCount: number;
  contestCount: number;
};

export class CategoryRepository {
  static async create(data: CreateCategoryData): Promise<CategoryRecord> {
    return prisma.category.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        isActive: data.isActive ?? true,
      },
      select: categorySelect,
    });
  }

  static async update(id: string, data: UpdateCategoryData): Promise<CategoryRecord> {
    return prisma.category.update({
      where: { id },
      data,
      select: categorySelect,
    });
  }

  static async deleteById(id: string): Promise<void> {
    await prisma.category.delete({ where: { id } });
  }

  static async list(): Promise<CategoryRecord[]> {
    return prisma.category.findMany({
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

  static async findBySlug(slug: string): Promise<CategoryRecord | null> {
    return prisma.category.findUnique({
      where: { slug },
      select: categorySelect,
    });
  }

  static async findByNameInsensitive(name: string): Promise<CategoryRecord | null> {
    return prisma.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: categorySelect,
    });
  }

  static async listActive(): Promise<CategoryRecord[]> {
    return prisma.category.findMany({
      where: { isActive: true },
      select: categorySelect,
      orderBy: { name: 'asc' },
    });
  }

  static async countReferences(
    id: string,
  ): Promise<{ submissions: number; contests: number }> {
    const [submissions, contests] = await Promise.all([
      prisma.submission.count({ where: { categoryId: id } }),
      prisma.contest.count({ where: { categoryId: id } }),
    ]);
    return { submissions, contests };
  }

  static async listAdmin(
    filters: CategoryListFilters,
  ): Promise<{ items: CategoryAdminRecord[]; totalCount: number }> {
    const search = filters.search?.trim();
    const where: Prisma.CategoryWhereInput = {
      ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, totalCount] = await Promise.all([
      prisma.category.findMany({
        where,
        select: {
          ...categorySelect,
          _count: { select: { submissions: true, contests: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.category.count({ where }),
    ]);

    return {
      totalCount,
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        isActive: row.isActive,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        submissionCount: row._count.submissions,
        contestCount: row._count.contests,
      })),
    };
  }
}
