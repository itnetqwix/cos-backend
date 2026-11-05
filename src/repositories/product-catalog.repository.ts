import { Prisma, ProductApprovalStatus } from '@prisma/client';
import { prisma } from '../config/database.js';

export interface ProductListFilter {
  search?: string;
  productTypeId?: string;
  approvalStatus?: ProductApprovalStatus;
  isActive?: boolean;
  page?: number;
  limit?: number;
  orderBy?: 'name' | 'createdAt' | 'brandName';
  orderDirection?: 'asc' | 'desc';
}

export interface CreateProductInput {
  name: string;
  brandName: string;
  productTypeId: string;
  description?: string | null;
  imageUrl?: string | null;
  imageObjectKey?: string | null;
  strain?: string | null;
  batchNumber?: string | null;
  reportedThcPercent?: number | null;
  reportedCbdPercent?: number | null;
  isActive?: boolean;
  approvalStatus?: ProductApprovalStatus;
  submittedById?: string | null;
}

export interface UpdateProductInput {
  name?: string;
  brandName?: string;
  productTypeId?: string;
  description?: string | null;
  imageUrl?: string | null;
  imageObjectKey?: string | null;
  strain?: string | null;
  batchNumber?: string | null;
  reportedThcPercent?: number | null;
  reportedCbdPercent?: number | null;
  isActive?: boolean;
  approvalStatus?: ProductApprovalStatus;
  rejectionReason?: string | null;
}

const productTypeSelect = {
  id: true,
  name: true,
  slug: true,
  isActive: true,
};

const productDetailSelect = {
  id: true,
  name: true,
  brandName: true,
  productTypeId: true,
  description: true,
  imageUrl: true,
  imageObjectKey: true,
  strain: true,
  batchNumber: true,
  reportedThcPercent: true,
  reportedCbdPercent: true,
  isActive: true,
  approvalStatus: true,
  submittedById: true,
  rejectionReason: true,
  reviewedById: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  productType: {
    select: productTypeSelect,
  },
  submittedBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  reviewedBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  _count: {
    select: {
      reviews: true,
    },
  },
};

export class ProductCatalogRepository {
  /**
   * List all product types (e.g. Flower, Concentrate, Edible).
   */
  static async listProductTypes(activeOnly = true) {
    return prisma.productType.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { name: 'asc' },
      select: productTypeSelect,
    });
  }

  /**
   * Find product type by ID.
   */
  static async findProductTypeById(id: string) {
    return prisma.productType.findUnique({
      where: { id },
      select: productTypeSelect,
    });
  }

  /**
   * Find product type by slug.
   */
  static async findProductTypeBySlug(slug: string) {
    return prisma.productType.findUnique({
      where: { slug },
      select: productTypeSelect,
    });
  }

  /**
   * Find existing product with normalized brand, name and productTypeId to prevent duplicates.
   */
  static async findDuplicate(
    brandName: string,
    name: string,
    productTypeId: string,
    excludeId?: string,
  ) {
    const trimmedBrand = brandName.trim();
    const trimmedName = name.trim();

    return prisma.product.findFirst({
      where: {
        productTypeId,
        brandName: { equals: trimmedBrand, mode: 'insensitive' },
        name: { equals: trimmedName, mode: 'insensitive' },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: {
        id: true,
        name: true,
        brandName: true,
        productTypeId: true,
        approvalStatus: true,
        isActive: true,
      },
    });
  }

  /**
   * Paginated product query with search and filters.
   */
  static async listProducts(filter: ProductListFilter = {}) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {};

    if (filter.productTypeId) {
      where.productTypeId = filter.productTypeId;
    }

    if (filter.approvalStatus) {
      where.approvalStatus = filter.approvalStatus;
    }

    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }

    if (filter.search && filter.search.trim()) {
      const search = filter.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { brandName: { contains: search, mode: 'insensitive' } },
        { strain: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orderField = filter.orderBy ?? 'name';
    const orderDirection = filter.orderDirection ?? 'asc';
    const orderBy: Prisma.ProductOrderByWithRelationInput = {
      [orderField]: orderDirection,
    };

    const [items, totalCount] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: productDetailSelect,
      }),
      prisma.product.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return {
      items,
      pagination: {
        totalCount,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Find product by ID with full relations and review count.
   */
  static async findProductById(id: string) {
    return prisma.product.findUnique({
      where: { id },
      select: productDetailSelect,
    });
  }

  /**
   * Create a new product.
   */
  static async createProduct(data: CreateProductInput) {
    return prisma.product.create({
      data: {
        name: data.name.trim(),
        brandName: data.brandName.trim(),
        productTypeId: data.productTypeId,
        description: data.description ? data.description.trim() : null,
        imageUrl: data.imageUrl ?? null,
        imageObjectKey: data.imageObjectKey ?? null,
        strain: data.strain ? data.strain.trim() : null,
        batchNumber: data.batchNumber ? data.batchNumber.trim() : null,
        reportedThcPercent: data.reportedThcPercent ?? null,
        reportedCbdPercent: data.reportedCbdPercent ?? null,
        isActive: data.isActive ?? true,
        approvalStatus: data.approvalStatus ?? ProductApprovalStatus.APPROVED,
        submittedById: data.submittedById ?? null,
      },
      select: productDetailSelect,
    });
  }

  /**
   * Update an existing product.
   */
  static async updateProduct(id: string, data: UpdateProductInput) {
    return prisma.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.brandName !== undefined ? { brandName: data.brandName.trim() } : {}),
        ...(data.productTypeId !== undefined
          ? { productTypeId: data.productTypeId }
          : {}),
        ...(data.description !== undefined
          ? { description: data.description ? data.description.trim() : null }
          : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
        ...(data.imageObjectKey !== undefined
          ? { imageObjectKey: data.imageObjectKey }
          : {}),
        ...(data.strain !== undefined
          ? { strain: data.strain ? data.strain.trim() : null }
          : {}),
        ...(data.batchNumber !== undefined
          ? { batchNumber: data.batchNumber ? data.batchNumber.trim() : null }
          : {}),
        ...(data.reportedThcPercent !== undefined
          ? { reportedThcPercent: data.reportedThcPercent }
          : {}),
        ...(data.reportedCbdPercent !== undefined
          ? { reportedCbdPercent: data.reportedCbdPercent }
          : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.approvalStatus !== undefined
          ? { approvalStatus: data.approvalStatus }
          : {}),
        ...(data.rejectionReason !== undefined
          ? { rejectionReason: data.rejectionReason }
          : {}),
      },
      select: productDetailSelect,
    });
  }

  /**
   * Approve a pending product.
   */
  static async approveProduct(id: string, adminId: string) {
    return prisma.product.update({
      where: { id },
      data: {
        approvalStatus: ProductApprovalStatus.APPROVED,
        isActive: true,
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
      select: productDetailSelect,
    });
  }

  /**
   * Reject a pending product with reason.
   */
  static async rejectProduct(id: string, adminId: string, reason: string) {
    return prisma.product.update({
      where: { id },
      data: {
        approvalStatus: ProductApprovalStatus.REJECTED,
        isActive: false,
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: reason.trim(),
      },
      select: productDetailSelect,
    });
  }

  /**
   * Safe deactivation / archive of product (preserves reviews).
   */
  static async deactivateProduct(id: string) {
    return prisma.product.update({
      where: { id },
      data: { isActive: false },
      select: productDetailSelect,
    });
  }

  /**
   * Activate an archived product.
   */
  static async activateProduct(id: string) {
    return prisma.product.update({
      where: { id },
      data: { isActive: true },
      select: productDetailSelect,
    });
  }
}
