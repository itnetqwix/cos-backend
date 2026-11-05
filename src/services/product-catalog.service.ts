import { ProductApprovalStatus, ReviewStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/database.js';
import {
  CreateProductInput,
  ProductCatalogRepository,
  ProductListFilter,
  UpdateProductInput,
} from '../repositories/product-catalog.repository.js';
import {
  getStorageService,
  playbackUrlForSubmission,
  resolveThumbnailUrl,
  signedAvatarUrl,
} from './storage.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/response.js';

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export class ProductCatalogService {
  /**
   * List all active product types for categorization.
   */
  static async getProductTypes() {
    return ProductCatalogRepository.listProductTypes(true);
  }

  /**
   * Search and filter products in the catalog.
   * If forAdmin is false, strictly limits to approved and active products.
   */
  static async searchProducts(filter: ProductListFilter, forAdmin = false) {
    if (!forAdmin) {
      filter.approvalStatus = ProductApprovalStatus.APPROVED;
      filter.isActive = true;
    }
    const result = await ProductCatalogRepository.listProducts(filter);
    if (!forAdmin) {
      const sanitized = result.items.map((item) => {
        const publicItem = { ...item } as Record<string, unknown>;
        delete publicItem.submittedBy;
        delete publicItem.reviewedBy;
        delete publicItem.rejectionReason;
        return {
          ...publicItem,
          publishedReviewsCount: item._count?.reviews ?? 0,
        };
      });
      return {
        ...result,
        items: sanitized,
      };
    }
    return result;
  }

  /**
   * Fetch single product details.
   */
  static async getProduct(id: string, forAdmin = false) {
    const product = await ProductCatalogRepository.findProductById(id);
    if (!product) {
      throw new NotFoundError('Product not found.');
    }

    if (
      !forAdmin &&
      (!product.isActive || product.approvalStatus !== ProductApprovalStatus.APPROVED)
    ) {
      throw new NotFoundError('Product not found or not currently active.');
    }

    if (!forAdmin) {
      const publishedReviews = await prisma.productReview.findMany({
        where: {
          productId: id,
          status: ReviewStatus.PUBLISHED,
          deletedAt: null,
        },
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true,
          overallScore: true,
          durationSeconds: true,
          videoObjectKey: true,
          videoUrl: true,
          thumbnailUrl: true,
          dispensaryName: true,
          city: true,
          state: true,
          publishedAt: true,
          tester: {
            select: {
              id: true,
              name: true,
              testerBio: true,
              avatarObjectKey: true,
            },
          },
        },
      });

      const publishedReviewsCount = publishedReviews.length;
      const averageOverallScore =
        publishedReviewsCount > 0
          ? Math.round(
              (publishedReviews.reduce((sum, r) => sum + r.overallScore, 0) /
                publishedReviewsCount) *
                10,
            ) / 10
          : null;

      const mappedReviews = await Promise.all(
        publishedReviews.map(async (r) => ({
          id: r.id,
          overallScore: r.overallScore,
          durationSeconds: r.durationSeconds,
          videoUrl: await playbackUrlForSubmission(r.videoObjectKey, r.videoUrl, {
            audience: 'public',
          }),
          thumbnailUrl: await resolveThumbnailUrl(r.thumbnailUrl, { audience: 'public' }),
          dispensaryName: r.dispensaryName,
          city: r.city,
          state: r.state,
          publishedAt: r.publishedAt?.toISOString() ?? null,
          tester: {
            id: r.tester.id,
            name: r.tester.name,
            testerBio: r.tester.testerBio,
            avatarUrl: r.tester.avatarObjectKey
              ? await signedAvatarUrl(r.tester.avatarObjectKey)
              : null,
          },
        })),
      );

      const publicProduct = { ...product } as Record<string, unknown>;
      delete publicProduct.submittedBy;
      delete publicProduct.reviewedBy;
      delete publicProduct.rejectionReason;

      return {
        ...publicProduct,
        publishedReviewsCount,
        averageOverallScore,
        publishedReviews: mappedReviews,
      };
    }

    return product;
  }

  /**
   * Verified tester submits a new product for catalog approval.
   * Product enters PENDING status and is not displayed in public search until approved.
   */
  static async submitProduct(
    userId: string,
    input: Omit<CreateProductInput, 'approvalStatus' | 'isActive' | 'submittedById'>,
  ) {
    // 1. Verify product type
    const productType = await ProductCatalogRepository.findProductTypeById(
      input.productTypeId,
    );
    if (!productType || !productType.isActive) {
      throw new ValidationError('Invalid or inactive product type.');
    }

    // 2. Prevent duplicate entries using normalized brand and name
    const existing = await ProductCatalogRepository.findDuplicate(
      input.brandName,
      input.name,
      input.productTypeId,
    );

    if (existing) {
      if (
        existing.approvalStatus === ProductApprovalStatus.APPROVED &&
        existing.isActive
      ) {
        throw new ConflictError(
          `A product with name "${input.name.trim()}" by "${input.brandName.trim()}" already exists in the catalog.`,
        );
      }
      if (existing.approvalStatus === ProductApprovalStatus.PENDING) {
        throw new ConflictError(
          `A product with name "${input.name.trim()}" by "${input.brandName.trim()}" is already pending administrative review.`,
        );
      }
      throw new ConflictError(
        `A product with name "${input.name.trim()}" by "${input.brandName.trim()}" already exists.`,
      );
    }

    // 3. Create as PENDING, isActive = false until approved
    return ProductCatalogRepository.createProduct({
      ...input,
      approvalStatus: ProductApprovalStatus.PENDING,
      isActive: false,
      submittedById: userId,
    });
  }

  /**
   * Admin creates a product directly into the active catalog.
   */
  static async createProductAsAdmin(adminId: string, input: CreateProductInput) {
    // 1. Verify product type
    const productType = await ProductCatalogRepository.findProductTypeById(
      input.productTypeId,
    );
    if (!productType) {
      throw new ValidationError('Invalid product type.');
    }

    // 2. Prevent duplicate
    const existing = await ProductCatalogRepository.findDuplicate(
      input.brandName,
      input.name,
      input.productTypeId,
    );

    if (existing) {
      throw new ConflictError(
        `A product with name "${input.name.trim()}" by "${input.brandName.trim()}" already exists.`,
      );
    }

    return ProductCatalogRepository.createProduct({
      ...input,
      approvalStatus: ProductApprovalStatus.APPROVED,
      isActive: input.isActive ?? true,
      submittedById: adminId,
    });
  }

  /**
   * Admin updates an existing product.
   */
  static async updateProductAsAdmin(
    adminId: string,
    id: string,
    input: UpdateProductInput,
  ) {
    const existing = await ProductCatalogRepository.findProductById(id);
    if (!existing) {
      throw new NotFoundError('Product not found.');
    }

    // Check duplicate if changing brand, name, or productType
    const nextBrand = input.brandName ?? existing.brandName;
    const nextName = input.name ?? existing.name;
    const nextType = input.productTypeId ?? existing.productTypeId;

    if (
      input.brandName !== undefined ||
      input.name !== undefined ||
      input.productTypeId !== undefined
    ) {
      const duplicate = await ProductCatalogRepository.findDuplicate(
        nextBrand,
        nextName,
        nextType,
        id,
      );
      if (duplicate) {
        throw new ConflictError(
          `Another product with name "${nextName.trim()}" by "${nextBrand.trim()}" already exists.`,
        );
      }
    }

    return ProductCatalogRepository.updateProduct(id, input);
  }

  /**
   * Admin approves a pending product submission.
   */
  static async approveProductAsAdmin(adminId: string, id: string) {
    const existing = await ProductCatalogRepository.findProductById(id);
    if (!existing) {
      throw new NotFoundError('Product not found.');
    }

    if (existing.approvalStatus === ProductApprovalStatus.APPROVED && existing.isActive) {
      return existing;
    }

    return ProductCatalogRepository.approveProduct(id, adminId);
  }

  /**
   * Admin rejects a pending product submission with reason.
   */
  static async rejectProductAsAdmin(adminId: string, id: string, reason: string) {
    const existing = await ProductCatalogRepository.findProductById(id);
    if (!existing) {
      throw new NotFoundError('Product not found.');
    }

    if (!reason || !reason.trim()) {
      throw new ValidationError('Rejection reason is required.');
    }

    return ProductCatalogRepository.rejectProduct(id, adminId, reason);
  }

  /**
   * Admin deactivates / archives a product safely without breaking reviews.
   */
  static async deactivateProductAsAdmin(adminId: string, id: string) {
    const existing = await ProductCatalogRepository.findProductById(id);
    if (!existing) {
      throw new NotFoundError('Product not found.');
    }

    return ProductCatalogRepository.deactivateProduct(id);
  }

  /**
   * Admin reactivates an archived product.
   */
  static async activateProductAsAdmin(adminId: string, id: string) {
    const existing = await ProductCatalogRepository.findProductById(id);
    if (!existing) {
      throw new NotFoundError('Product not found.');
    }

    return ProductCatalogRepository.activateProduct(id);
  }

  /**
   * Presign S3 upload for product images.
   */
  static async presignProductImage(
    userId: string,
    input: { contentType: string; fileSizeBytes: number },
  ) {
    const ext = ALLOWED_IMAGE_TYPES[input.contentType];
    if (!ext) {
      throw new ValidationError(
        'Invalid image format. Allowed formats: image/jpeg, image/png, image/webp.',
      );
    }

    const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
    if (input.fileSizeBytes > MAX_IMAGE_BYTES) {
      throw new ValidationError('Image file size exceeds the 10MB limit.');
    }

    const objectKey = `products/uploads/${randomUUID()}.${ext}`;
    const storage = getStorageService();

    const upload = await storage.createPresignedUpload({
      objectKey,
      contentType: input.contentType,
      contentLength: input.fileSizeBytes,
    });

    const publicUrl = storage.getPublicUrl
      ? storage.getPublicUrl(objectKey)
      : `https://example.com/${objectKey}`;

    return {
      uploadUrl: upload.uploadUrl,
      objectKey,
      publicUrl,
      headers: upload.headers,
      expiresInSeconds: upload.expiresInSeconds,
      method: upload.method,
    };
  }
}
