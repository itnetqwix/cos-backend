import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  createdAt: true,
} satisfies Prisma.CategorySelect;

export type CategoryRecord = Prisma.CategoryGetPayload<{
  select: typeof categorySelect;
}>;

export interface CreateCategoryData {
  name: string;
  slug: string;
  description?: string | null;
}

export class CategoryRepository {
  static async create(data: CreateCategoryData): Promise<CategoryRecord> {
    return prisma.category.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
      },
      select: categorySelect,
    });
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
}
