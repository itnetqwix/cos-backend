import { Prisma, PrismaClient, ReviewStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { VIDEO_CONSTRAINTS } from '../config/constants.js';
import { prisma } from '../config/database.js';
import {
  parseReviewObjectKey,
  thumbnailKeyForReview,
} from '../services/storage.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';
import type { FrozenCategoryWeight } from '../services/review-score.service.js';

/**
 * Product review persistence (M02-P01-T03).
 *
 * Revisions are insert-only. `publishedRevisionId` is not moved here.
 * ponytail: discovery filters run in memory after the public-status query.
 * Push snapshot predicates into SQL if the published set needs paging.
 */

const PUBLIC_DISCOVERY_STATUSES: ReviewStatus[] = [
  ReviewStatus.PUBLISHED,
  ReviewStatus.SUBMITTED,
  ReviewStatus.CHANGES_REQUESTED,
  ReviewStatus.APPROVED,
];

const DRAFT_STATUSES: ReviewStatus[] = [
  ReviewStatus.DRAFT,
  ReviewStatus.CHANGES_REQUESTED,
];

export interface ReviewScoreRow {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  score: number;
  weightApplied: number;
}

export interface ProductSnapshot {
  productId: string;
  name: string;
  brandName: string;
  productTypeId: string;
  productTypeName: string;
  productTypeSlug: string;
}

export interface ScoreSnapshotEntry {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  score: number;
  weightApplied: number;
}

export interface RevisionRow {
  id: string;
  reviewId: string;
  version: number;
  productId: string;
  overallScore: number;
  scoresSnapshot: ScoreSnapshotEntry[];
  weightsSnapshot: FrozenCategoryWeight[];
  productSnapshot: ProductSnapshot;
  videoObjectKey: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  reviewNotes: string | null;
  changeRequestNotes: string | null;
  dispensaryName: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  changedById: string;
  changeReason: string | null;
  createdAt: Date;
}

export interface ReviewRow {
  id: string;
  productId: string;
  testerId: string;
  status: ReviewStatus;
  dispensaryName: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  videoUrl: string;
  videoObjectKey: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  overallScore: number;
  weightsSnapshot: FrozenCategoryWeight[];
  reviewNotes: string | null;
  changeRequestNotes: string | null;
  rejectionReason: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  publishedAt: Date | null;
  publishedRevisionId: string | null;
  deletedAt: Date | null;
  deletedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  categoryScores: ReviewScoreRow[];
  product: ProductSnapshot;
  publishedRevision: RevisionRow | null;
}

export interface ActiveReviewCategory {
  id: string;
  name: string;
  slug: string;
  defaultWeight: number;
  isActive: boolean;
  sortOrder: number;
}

export interface CreateDraftInput {
  productId: string;
  testerId: string;
  videoUrl: string;
  videoObjectKey: string;
  thumbnailUrl?: string | null;
  durationSeconds: number;
  dispensaryName?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  reviewNotes?: string | null;
}

export interface DraftPatch {
  productId?: string;
  dispensaryName?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  videoUrl?: string;
  videoObjectKey?: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number;
  reviewNotes?: string | null;
  categoryScores?: Array<{ categoryId: string; score: number; weightApplied: number }>;
}

export interface ReviewCurrent {
  status: ReviewStatus;
  updatedAt: Date;
}

export interface ReviewWrite {
  productId?: string;
  status?: ReviewStatus;
  dispensaryName?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  videoUrl?: string;
  videoObjectKey?: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number;
  overallScore?: number;
  weightsSnapshot?: FrozenCategoryWeight[];
  reviewNotes?: string | null;
  changeRequestNotes?: string | null;
  rejectionReason?: string | null;
  approvedById?: string | null;
  approvedAt?: Date | null;
  publishedAt?: Date | null;
  publishedRevisionId?: string | null;
}

export interface PublishedReviewFilters {
  productId?: string;
  productTypeId?: string;
  /** Strain is not a Product or ProductReview column. */
  categoryId?: string;
  testerId?: string;
  city?: string;
  state?: string;
  country?: string;
  dispensaryName?: string;
  minOverallScore?: number;
  maxOverallScore?: number;
  publishedFrom?: Date;
  publishedTo?: Date;
}

export interface PublishedReviewRecord {
  reviewId: string;
  publishedRevisionId: string;
  testerId: string;
  status: ReviewStatus;
  publishedAt: Date | null;
  version: number;
  productId: string;
  productSnapshot: ProductSnapshot;
  overallScore: number;
  scoresSnapshot: ScoreSnapshotEntry[];
  weightsSnapshot: FrozenCategoryWeight[];
  videoObjectKey: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  reviewNotes: string | null;
  dispensaryName: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface RevisionMeta {
  changedById?: string;
  changeReason?: string | null;
}

export interface PublicReviewQuery {
  skip: number;
  take: number;
  sort?: 'score' | 'publishedAt';
  productId?: string;
  productTypeId?: string;
  categoryId?: string;
  testerId?: string;
  city?: string;
  state?: string;
  country?: string;
  dispensaryName?: string;
  minOverallScore?: number;
  maxOverallScore?: number;
  publishedFrom?: Date;
  publishedTo?: Date;
}

export interface ReviewPage<T> {
  total: number;
  rows: T[];
}

export interface QueuedReview extends ReviewRow {
  tester: { id: string; name: string };
}

export interface ReviewDb {
  createReview(data: CreateDraftInput & { country: string }): Promise<ReviewRow>;
  findReview(id: string): Promise<ReviewRow | null>;
  listByTester(testerId: string): Promise<ReviewRow[]>;
  listMinePage(
    testerId: string,
    skip: number,
    take: number,
  ): Promise<ReviewPage<ReviewRow>>;
  listPublicPage(query: PublicReviewQuery): Promise<ReviewPage<PublishedReviewRecord>>;
  listQueuePage(query: PublicReviewQuery): Promise<ReviewPage<QueuedReview>>;
  listReviews(): Promise<ReviewRow[]>;
  updateReview(id: string, data: ReviewWrite): Promise<ReviewRow>;
  updateIfCurrent(
    id: string,
    expected: ReviewCurrent,
    data: ReviewWrite,
  ): Promise<number>;
  replaceScores(
    reviewId: string,
    scores: Array<{ categoryId: string; score: number; weightApplied: number }>,
  ): Promise<void>;
  listActiveCategories(): Promise<ActiveReviewCategory[]>;
  findProduct(id: string): Promise<ProductSnapshot | null>;
  maxRevisionVersion(reviewId: string): Promise<number>;
  insertRevision(
    data: Omit<RevisionRow, 'id' | 'createdAt'> & { id?: string },
  ): Promise<RevisionRow>;
  listRevisions(reviewId: string): Promise<RevisionRow[]>;
  $transaction<T>(fn: (tx: ReviewDb) => Promise<T>): Promise<T>;
}

const reviewInclude = {
  product: { include: { productType: true } },
  categoryScores: { include: { category: true } },
} satisfies Prisma.ProductReviewInclude;

type ReviewPayload = Prisma.ProductReviewGetPayload<{ include: typeof reviewInclude }>;

function asWeights(value: Prisma.JsonValue): FrozenCategoryWeight[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as FrozenCategoryWeight[];
}

function asScores(value: Prisma.JsonValue): ScoreSnapshotEntry[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as ScoreSnapshotEntry[];
}

function asProduct(value: Prisma.JsonValue): ProductSnapshot {
  return value as unknown as ProductSnapshot;
}

function productSnapshotOf(product: ReviewPayload['product']): ProductSnapshot {
  return {
    productId: product.id,
    name: product.name,
    brandName: product.brandName,
    productTypeId: product.productTypeId,
    productTypeName: product.productType.name,
    productTypeSlug: product.productType.slug,
  };
}

function toRevision(row: {
  id: string;
  reviewId: string;
  version: number;
  productId: string;
  overallScore: number;
  scoresSnapshot: Prisma.JsonValue;
  weightsSnapshot: Prisma.JsonValue;
  productSnapshot: Prisma.JsonValue;
  videoObjectKey: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  reviewNotes: string | null;
  changeRequestNotes: string | null;
  dispensaryName: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  changedById: string;
  changeReason: string | null;
  createdAt: Date;
}): RevisionRow {
  return {
    ...row,
    scoresSnapshot: asScores(row.scoresSnapshot),
    weightsSnapshot: asWeights(row.weightsSnapshot),
    productSnapshot: asProduct(row.productSnapshot),
  };
}

function toReviewRow(
  row: ReviewPayload,
  publishedRevision: RevisionRow | null,
): ReviewRow {
  return {
    id: row.id,
    productId: row.productId,
    testerId: row.testerId,
    status: row.status,
    dispensaryName: row.dispensaryName,
    city: row.city,
    state: row.state,
    country: row.country,
    videoUrl: row.videoUrl,
    videoObjectKey: row.videoObjectKey,
    thumbnailUrl: row.thumbnailUrl,
    durationSeconds: row.durationSeconds,
    overallScore: row.overallScore,
    weightsSnapshot: asWeights(row.weightsSnapshot),
    reviewNotes: row.reviewNotes,
    changeRequestNotes: row.changeRequestNotes,
    rejectionReason: row.rejectionReason,
    approvedById: row.approvedById,
    approvedAt: row.approvedAt,
    publishedAt: row.publishedAt,
    publishedRevisionId: row.publishedRevisionId,
    deletedAt: row.deletedAt,
    deletedById: row.deletedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    categoryScores: row.categoryScores.map((score) => ({
      id: score.id,
      categoryId: score.categoryId,
      categoryName: score.category.name,
      categorySlug: score.category.slug,
      score: score.score,
      weightApplied: score.weightApplied,
    })),
    product: productSnapshotOf(row.product),
    publishedRevision,
  };
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function publicWhere(query: PublicReviewQuery): Prisma.ProductReviewWhereInput {
  const where: Prisma.ProductReviewWhereInput = {
    deletedAt: null,
    status: ReviewStatus.PUBLISHED,
    publishedRevisionId: { not: null },
  };
  if (query.productId) where.productId = query.productId;
  if (query.productTypeId) where.product = { productTypeId: query.productTypeId };
  if (query.categoryId) where.categoryScores = { some: { categoryId: query.categoryId } };
  if (query.testerId) where.testerId = query.testerId;
  if (query.city) where.city = query.city;
  if (query.state) where.state = query.state;
  if (query.country) where.country = query.country;
  if (query.dispensaryName) where.dispensaryName = query.dispensaryName;
  if (query.minOverallScore !== undefined || query.maxOverallScore !== undefined) {
    where.overallScore = {
      ...(query.minOverallScore !== undefined ? { gte: query.minOverallScore } : {}),
      ...(query.maxOverallScore !== undefined ? { lte: query.maxOverallScore } : {}),
    };
  }
  if (query.publishedFrom || query.publishedTo) {
    where.publishedAt = {
      ...(query.publishedFrom ? { gte: query.publishedFrom } : {}),
      ...(query.publishedTo ? { lte: query.publishedTo } : {}),
    };
  }
  return where;
}

function publicOrder(
  sort: PublicReviewQuery['sort'],
): Prisma.ProductReviewOrderByWithRelationInput[] {
  if (sort === 'publishedAt') return [{ publishedAt: 'desc' }, { id: 'asc' }];
  return [{ overallScore: 'desc' }, { publishedAt: 'desc' }, { id: 'asc' }];
}

/** Same predicate as `publicWhere`. Used by the in-memory test store. */
export function matchesPublicQuery(review: ReviewRow, query: PublicReviewQuery): boolean {
  if (
    review.deletedAt ||
    review.status !== ReviewStatus.PUBLISHED ||
    !review.publishedRevisionId
  ) {
    return false;
  }
  if (query.productId && review.productId !== query.productId) return false;
  if (query.productTypeId && review.product.productTypeId !== query.productTypeId)
    return false;
  if (
    query.categoryId &&
    !review.categoryScores.some((score) => score.categoryId === query.categoryId)
  ) {
    return false;
  }
  if (query.testerId && review.testerId !== query.testerId) return false;
  if (query.city && review.city !== query.city) return false;
  if (query.state && review.state !== query.state) return false;
  if (query.country && review.country !== query.country) return false;
  if (query.dispensaryName && review.dispensaryName !== query.dispensaryName)
    return false;
  if (query.minOverallScore !== undefined && review.overallScore < query.minOverallScore)
    return false;
  if (query.maxOverallScore !== undefined && review.overallScore > query.maxOverallScore)
    return false;
  if (
    query.publishedFrom &&
    (!review.publishedAt || review.publishedAt < query.publishedFrom)
  )
    return false;
  if (
    query.publishedTo &&
    (!review.publishedAt || review.publishedAt > query.publishedTo)
  )
    return false;
  return true;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  );
}

function assertVideo(
  testerId: string,
  objectKey: string,
  videoUrl: string,
  durationSeconds: number,
  thumbnailUrl: string | null | undefined,
): void {
  const parsed = parseReviewObjectKey(objectKey);
  if (!parsed || parsed.testerId.toLowerCase() !== testerId.toLowerCase()) {
    throw new ValidationError('Review video key is not valid for this tester');
  }
  if (!videoUrl.trim()) {
    throw new ValidationError('Review video is required');
  }
  if (
    !Number.isInteger(durationSeconds) ||
    durationSeconds < VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS ||
    durationSeconds > VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS
  ) {
    throw new ValidationError('Review video duration is invalid');
  }
  if (thumbnailUrl && thumbnailUrl !== thumbnailKeyForReview(objectKey)) {
    throw new ValidationError('Review thumbnail does not match the video');
  }
}

function assertScoreInputs(
  scores: Array<{ categoryId: string; score: number; weightApplied: number }>,
): void {
  const seen = new Set<string>();
  for (const score of scores) {
    if (seen.has(score.categoryId)) {
      throw new ValidationError('Duplicate category score');
    }
    seen.add(score.categoryId);
    if (!Number.isInteger(score.score) || score.score < 1 || score.score > 10) {
      throw new ValidationError('Category score must be an integer from 1 to 10');
    }
    if (
      typeof score.weightApplied !== 'number' ||
      !Number.isFinite(score.weightApplied) ||
      score.weightApplied < 0
    ) {
      throw new ValidationError('Category weight must be a finite positive number');
    }
  }
}

export function isPublicDiscoveryReview(
  review: Pick<ReviewRow, 'deletedAt' | 'publishedRevisionId' | 'status'>,
): boolean {
  return (
    review.deletedAt === null &&
    review.publishedRevisionId !== null &&
    PUBLIC_DISCOVERY_STATUSES.includes(review.status)
  );
}

function matchesFilters(
  view: PublishedReviewRecord,
  filters: PublishedReviewFilters,
): boolean {
  if (filters.productId && view.productId !== filters.productId) return false;
  if (
    filters.productTypeId &&
    view.productSnapshot.productTypeId !== filters.productTypeId
  )
    return false;
  if (
    filters.categoryId &&
    !view.scoresSnapshot.some((score) => score.categoryId === filters.categoryId)
  ) {
    return false;
  }
  if (filters.testerId && view.testerId !== filters.testerId) return false;
  if (filters.city && view.city !== filters.city) return false;
  if (filters.state && view.state !== filters.state) return false;
  if (filters.country && view.country !== filters.country) return false;
  if (filters.dispensaryName && view.dispensaryName !== filters.dispensaryName)
    return false;
  if (
    filters.minOverallScore !== undefined &&
    view.overallScore < filters.minOverallScore
  )
    return false;
  if (
    filters.maxOverallScore !== undefined &&
    view.overallScore > filters.maxOverallScore
  )
    return false;
  if (
    filters.publishedFrom &&
    (!view.publishedAt || view.publishedAt < filters.publishedFrom)
  )
    return false;
  if (
    filters.publishedTo &&
    (!view.publishedAt || view.publishedAt > filters.publishedTo)
  )
    return false;
  return true;
}

function toPublished(review: ReviewRow): PublishedReviewRecord | null {
  const revision = review.publishedRevision;
  if (!revision || revision.id !== review.publishedRevisionId) return null;
  return {
    reviewId: review.id,
    publishedRevisionId: revision.id,
    testerId: review.testerId,
    status: review.status,
    publishedAt: review.publishedAt,
    version: revision.version,
    productId: revision.productId,
    productSnapshot: revision.productSnapshot,
    overallScore: revision.overallScore,
    scoresSnapshot: revision.scoresSnapshot,
    weightsSnapshot: revision.weightsSnapshot,
    videoObjectKey: revision.videoObjectKey,
    videoUrl: revision.videoUrl,
    thumbnailUrl: revision.thumbnailUrl,
    durationSeconds: revision.durationSeconds,
    reviewNotes: revision.reviewNotes,
    dispensaryName: revision.dispensaryName,
    city: revision.city,
    state: revision.state,
    country: revision.country,
  };
}

type DelegateClient = Prisma.TransactionClient | PrismaClient;

function bindPrisma(client: DelegateClient, nested: boolean): ReviewDb {
  async function load(id: string): Promise<ReviewRow | null> {
    const row = await client.productReview.findUnique({
      where: { id },
      include: reviewInclude,
    });
    if (!row) return null;
    const revision = row.publishedRevisionId
      ? await client.reviewRevision.findUnique({ where: { id: row.publishedRevisionId } })
      : null;
    return toReviewRow(row, revision ? toRevision(revision) : null);
  }

  return {
    async createReview(data) {
      const row = await client.productReview.create({
        data: {
          productId: data.productId,
          testerId: data.testerId,
          status: ReviewStatus.DRAFT,
          videoUrl: data.videoUrl,
          videoObjectKey: data.videoObjectKey,
          thumbnailUrl: data.thumbnailUrl ?? null,
          durationSeconds: data.durationSeconds,
          dispensaryName: data.dispensaryName ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          country: data.country,
          reviewNotes: data.reviewNotes ?? null,
          weightsSnapshot: [],
          overallScore: 0,
        },
        include: reviewInclude,
      });
      return toReviewRow(row, null);
    },
    findReview: load,
    async listByTester(testerId) {
      const rows = await client.productReview.findMany({
        where: { testerId, deletedAt: null },
        include: reviewInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      return rows.map((row) => toReviewRow(row, null));
    },
    async listMinePage(testerId, skip, take) {
      const where = { testerId, deletedAt: null };
      const [total, rows] = await Promise.all([
        client.productReview.count({ where }),
        client.productReview.findMany({
          where,
          skip,
          take,
          include: reviewInclude,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        }),
      ]);
      return { total, rows: rows.map((row) => toReviewRow(row, null)) };
    },
    async listPublicPage(query) {
      const where = publicWhere(query);
      const [total, rows] = await Promise.all([
        client.productReview.count({ where }),
        client.productReview.findMany({
          where,
          skip: query.skip,
          take: query.take,
          include: reviewInclude,
          orderBy: publicOrder(query.sort),
        }),
      ]);
      const ids = rows.flatMap((row) =>
        row.publishedRevisionId ? [row.publishedRevisionId] : [],
      );
      const revisions = ids.length
        ? await client.reviewRevision.findMany({ where: { id: { in: ids } } })
        : [];
      const byId = new Map(
        revisions.map((revision) => [revision.id, toRevision(revision)]),
      );
      const published = rows.flatMap((row) => {
        const view = toPublished(
          toReviewRow(
            row,
            row.publishedRevisionId ? (byId.get(row.publishedRevisionId) ?? null) : null,
          ),
        );
        return view ? [view] : [];
      });
      return { total, rows: published };
    },
    async listQueuePage(query) {
      const where: Prisma.ProductReviewWhereInput = {
        deletedAt: null,
        status: ReviewStatus.SUBMITTED,
      };
      if (query.productId) where.productId = query.productId;
      if (query.testerId) where.testerId = query.testerId;
      const [total, rows] = await Promise.all([
        client.productReview.count({ where }),
        client.productReview.findMany({
          where,
          skip: query.skip,
          take: query.take,
          include: { ...reviewInclude, tester: { select: { id: true, name: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      ]);
      return {
        total,
        rows: rows.map((row) => ({
          ...toReviewRow(row, null),
          tester: row.tester,
        })),
      };
    },
    async listReviews() {
      const rows = await client.productReview.findMany({
        where: {
          deletedAt: null,
          publishedRevisionId: { not: null },
          status: { in: PUBLIC_DISCOVERY_STATUSES },
        },
        include: reviewInclude,
      });
      const ids = rows.flatMap((row) =>
        row.publishedRevisionId ? [row.publishedRevisionId] : [],
      );
      const revisions = ids.length
        ? await client.reviewRevision.findMany({ where: { id: { in: ids } } })
        : [];
      const byId = new Map(
        revisions.map((revision) => [revision.id, toRevision(revision)]),
      );
      return rows.map((row) =>
        toReviewRow(
          row,
          row.publishedRevisionId ? (byId.get(row.publishedRevisionId) ?? null) : null,
        ),
      );
    },
    async updateReview(id, data) {
      const row = await client.productReview.update({
        where: { id },
        data: toPrismaWrite(data),
        include: reviewInclude,
      });
      return (await load(row.id)) as ReviewRow;
    },
    async updateIfCurrent(id, expected, data) {
      const result = await client.productReview.updateMany({
        where: {
          id,
          status: expected.status,
          updatedAt: expected.updatedAt,
          deletedAt: null,
        },
        data: toPrismaWrite(data),
      });
      return result.count;
    },
    async replaceScores(reviewId, scores) {
      await client.reviewCategoryScore.deleteMany({ where: { reviewId } });
      if (scores.length === 0) return;
      await client.reviewCategoryScore.createMany({
        data: scores.map((score) => ({
          reviewId,
          categoryId: score.categoryId,
          score: score.score,
          weightApplied: score.weightApplied,
        })),
      });
    },
    async listActiveCategories() {
      return client.reviewCategory.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          defaultWeight: true,
          isActive: true,
          sortOrder: true,
        },
      });
    },
    async findProduct(id) {
      const product = await client.product.findUnique({
        where: { id },
        include: { productType: true },
      });
      if (!product) return null;
      return productSnapshotOf(product);
    },
    async maxRevisionVersion(reviewId) {
      const agg = await client.reviewRevision.aggregate({
        where: { reviewId },
        _max: { version: true },
      });
      return agg._max.version ?? 0;
    },
    async insertRevision(data) {
      const row = await client.reviewRevision.create({
        data: {
          id: data.id,
          reviewId: data.reviewId,
          version: data.version,
          productId: data.productId,
          overallScore: data.overallScore,
          scoresSnapshot: jsonValue(data.scoresSnapshot),
          weightsSnapshot: jsonValue(data.weightsSnapshot),
          productSnapshot: jsonValue(data.productSnapshot),
          videoObjectKey: data.videoObjectKey,
          videoUrl: data.videoUrl,
          thumbnailUrl: data.thumbnailUrl,
          durationSeconds: data.durationSeconds,
          reviewNotes: data.reviewNotes,
          changeRequestNotes: data.changeRequestNotes,
          dispensaryName: data.dispensaryName,
          city: data.city,
          state: data.state,
          country: data.country,
          changedById: data.changedById,
          changeReason: data.changeReason,
        },
      });
      return toRevision(row);
    },
    async listRevisions(reviewId) {
      const rows = await client.reviewRevision.findMany({
        where: { reviewId },
        orderBy: { version: 'asc' },
      });
      return rows.map(toRevision);
    },
    $transaction(fn) {
      if (nested) return fn(bindPrisma(client, true));
      return prisma.$transaction((tx) => fn(bindPrisma(tx, true)), {
        maxWait: 10000,
        timeout: 30000,
      });
    },
  };
}

function toPrismaWrite(data: ReviewWrite): Prisma.ProductReviewUncheckedUpdateInput {
  const write: Prisma.ProductReviewUncheckedUpdateInput = {};
  if (data.productId !== undefined) write.productId = data.productId;
  if (data.status !== undefined) write.status = data.status;
  if (data.dispensaryName !== undefined) write.dispensaryName = data.dispensaryName;
  if (data.city !== undefined) write.city = data.city;
  if (data.state !== undefined) write.state = data.state;
  if (data.country !== undefined) write.country = data.country;
  if (data.videoUrl !== undefined) write.videoUrl = data.videoUrl;
  if (data.videoObjectKey !== undefined) write.videoObjectKey = data.videoObjectKey;
  if (data.thumbnailUrl !== undefined) write.thumbnailUrl = data.thumbnailUrl;
  if (data.durationSeconds !== undefined) write.durationSeconds = data.durationSeconds;
  if (data.overallScore !== undefined) write.overallScore = data.overallScore;
  if (data.weightsSnapshot !== undefined)
    write.weightsSnapshot = jsonValue(data.weightsSnapshot);
  if (data.reviewNotes !== undefined) write.reviewNotes = data.reviewNotes;
  if (data.changeRequestNotes !== undefined)
    write.changeRequestNotes = data.changeRequestNotes;
  if (data.rejectionReason !== undefined) write.rejectionReason = data.rejectionReason;
  if (data.approvedById !== undefined) write.approvedById = data.approvedById;
  if (data.approvedAt !== undefined) write.approvedAt = data.approvedAt;
  if (data.publishedAt !== undefined) write.publishedAt = data.publishedAt;
  if (data.publishedRevisionId !== undefined)
    write.publishedRevisionId = data.publishedRevisionId;
  return write;
}

let override: ReviewDb | null = null;
const prismaReviewDb = bindPrisma(prisma, false);

export function setProductReviewDb(next: ReviewDb | null): void {
  override = next;
}

function db(): ReviewDb {
  return override ?? prismaReviewDb;
}

async function scope<T>(
  tx: ReviewDb | undefined,
  fn: (store: ReviewDb) => Promise<T>,
): Promise<T> {
  if (tx) return fn(tx);
  return db().$transaction(fn);
}

export class ProductReviewRepository {
  static transaction<T>(fn: (tx: ReviewDb) => Promise<T>): Promise<T> {
    return db().$transaction(fn);
  }

  static async createDraft(input: CreateDraftInput, tx?: ReviewDb): Promise<ReviewRow> {
    assertVideo(
      input.testerId,
      input.videoObjectKey,
      input.videoUrl,
      input.durationSeconds,
      input.thumbnailUrl,
    );
    return scope(tx, async (store) => {
      const product = await store.findProduct(input.productId);
      if (!product) throw new NotFoundError('Product not found');
      try {
        return await store.createReview({ ...input, country: input.country ?? 'USA' });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ConflictError('Review video is already stored');
        }
        throw error;
      }
    });
  }

  static async findById(id: string, tx?: ReviewDb): Promise<ReviewRow | null> {
    return (tx ?? db()).findReview(id);
  }

  static async listByTester(testerId: string, tx?: ReviewDb): Promise<ReviewRow[]> {
    return (tx ?? db()).listByTester(testerId);
  }

  static async listMinePage(
    testerId: string,
    skip: number,
    take: number,
    tx?: ReviewDb,
  ): Promise<ReviewPage<ReviewRow>> {
    return (tx ?? db()).listMinePage(testerId, skip, take);
  }

  static async listPublicPage(
    query: PublicReviewQuery,
    tx?: ReviewDb,
  ): Promise<ReviewPage<PublishedReviewRecord>> {
    return (tx ?? db()).listPublicPage(query);
  }

  static async listQueuePage(
    query: PublicReviewQuery,
    tx?: ReviewDb,
  ): Promise<ReviewPage<QueuedReview>> {
    return (tx ?? db()).listQueuePage(query);
  }

  static async findProduct(id: string, tx?: ReviewDb): Promise<ProductSnapshot | null> {
    return (tx ?? db()).findProduct(id);
  }

  static async findPublished(
    id: string,
    tx?: ReviewDb,
  ): Promise<PublishedReviewRecord | null> {
    const review = await (tx ?? db()).findReview(id);
    if (!review || !matchesPublicQuery(review, { skip: 0, take: 1 })) return null;
    const revision = review.publishedRevision;
    if (!revision || revision.id !== review.publishedRevisionId) return null;
    return {
      reviewId: review.id,
      publishedRevisionId: revision.id,
      testerId: review.testerId,
      status: review.status,
      publishedAt: review.publishedAt,
      version: revision.version,
      productId: revision.productId,
      productSnapshot: revision.productSnapshot,
      overallScore: revision.overallScore,
      scoresSnapshot: revision.scoresSnapshot,
      weightsSnapshot: revision.weightsSnapshot,
      videoObjectKey: revision.videoObjectKey,
      videoUrl: revision.videoUrl,
      thumbnailUrl: revision.thumbnailUrl,
      durationSeconds: revision.durationSeconds,
      reviewNotes: revision.reviewNotes,
      dispensaryName: revision.dispensaryName,
      city: revision.city,
      state: revision.state,
      country: revision.country,
    };
  }

  static async updateDraft(
    reviewId: string,
    testerId: string,
    patch: DraftPatch,
    tx?: ReviewDb,
  ): Promise<ReviewRow> {
    return scope(tx, async (store) => {
      const review = await store.findReview(reviewId);
      if (!review || review.deletedAt) throw new NotFoundError('Review not found');
      if (review.testerId !== testerId) {
        throw new ForbiddenError('Forbidden: review is owned by another tester');
      }
      if (!DRAFT_STATUSES.includes(review.status)) {
        throw new ConflictError(
          'Only a draft or changes-requested review can be updated',
        );
      }
      if (patch.categoryScores) assertScoreInputs(patch.categoryScores);
      const videoObjectKey = patch.videoObjectKey ?? review.videoObjectKey;
      const videoUrl = patch.videoUrl ?? review.videoUrl;
      const durationSeconds = patch.durationSeconds ?? review.durationSeconds;
      const thumbnailUrl =
        patch.thumbnailUrl === undefined ? review.thumbnailUrl : patch.thumbnailUrl;
      assertVideo(
        review.testerId,
        videoObjectKey,
        videoUrl,
        durationSeconds,
        thumbnailUrl,
      );
      if (patch.productId) {
        const product = await store.findProduct(patch.productId);
        if (!product) throw new NotFoundError('Product not found');
      }
      if (patch.categoryScores) {
        await store.replaceScores(reviewId, patch.categoryScores);
      }
      const { categoryScores: _scores, ...fields } = patch;
      return store.updateReview(reviewId, fields);
    });
  }

  static async replaceCategoryScores(
    reviewId: string,
    scores: Array<{ categoryId: string; score: number; weightApplied: number }>,
    tx?: ReviewDb,
  ): Promise<void> {
    assertScoreInputs(scores);
    await (tx ?? db()).replaceScores(reviewId, scores);
  }

  static async saveScore(
    reviewId: string,
    overallScore: number,
    weightsSnapshot: FrozenCategoryWeight[],
    tx?: ReviewDb,
  ): Promise<ReviewRow> {
    if (!Number.isFinite(overallScore)) {
      throw new ValidationError('Overall score is invalid');
    }
    return (tx ?? db()).updateReview(reviewId, { overallScore, weightsSnapshot });
  }

  static async listActiveCategories(tx?: ReviewDb): Promise<ActiveReviewCategory[]> {
    return (tx ?? db()).listActiveCategories();
  }

  static async listPublishedReviews(
    filters: PublishedReviewFilters = {},
    tx?: ReviewDb,
  ): Promise<PublishedReviewRecord[]> {
    const rows = await (tx ?? db()).listReviews();
    const views = rows.flatMap((review) => {
      if (!isPublicDiscoveryReview(review)) return [];
      const view = toPublished(review);
      if (!view || !matchesFilters(view, filters)) return [];
      return [view];
    });
    views.sort((a, b) => {
      const at = a.publishedAt?.getTime() ?? 0;
      const bt = b.publishedAt?.getTime() ?? 0;
      if (bt !== at) return bt - at;
      return a.reviewId < b.reviewId ? -1 : 1;
    });
    return views;
  }

  static async saveIfCurrent(
    id: string,
    expected: ReviewCurrent,
    data: ReviewWrite,
    tx?: ReviewDb,
  ): Promise<ReviewRow> {
    const store = tx ?? db();
    const count = await store.updateIfCurrent(id, expected, data);
    if (count !== 1) {
      throw new ConflictError('Review was updated concurrently');
    }
    const row = await store.findReview(id);
    if (!row) throw new NotFoundError('Review not found');
    return row;
  }

  static async createRevisionSnapshot(
    reviewId: string,
    tx: ReviewDb,
    meta?: RevisionMeta,
  ): Promise<RevisionRow> {
    const review = await tx.findReview(reviewId);
    if (!review || review.deletedAt) throw new NotFoundError('Review not found');
    const version = (await tx.maxRevisionVersion(reviewId)) + 1;
    const scoresSnapshot: ScoreSnapshotEntry[] = review.categoryScores
      .map((score) => ({
        categoryId: score.categoryId,
        categoryName: score.categoryName,
        categorySlug: score.categorySlug,
        score: score.score,
        weightApplied: score.weightApplied,
      }))
      .sort((a, b) => (a.categoryId < b.categoryId ? -1 : 1));
    try {
      return await tx.insertRevision({
        id: randomUUID(),
        reviewId,
        version,
        productId: review.productId,
        overallScore: review.overallScore,
        scoresSnapshot,
        weightsSnapshot: review.weightsSnapshot,
        productSnapshot: review.product,
        videoObjectKey: review.videoObjectKey,
        videoUrl: review.videoUrl,
        thumbnailUrl: review.thumbnailUrl,
        durationSeconds: review.durationSeconds,
        reviewNotes: review.reviewNotes,
        changeRequestNotes: review.changeRequestNotes,
        dispensaryName: review.dispensaryName,
        city: review.city,
        state: review.state,
        country: review.country,
        changedById: meta?.changedById ?? review.testerId,
        changeReason: meta?.changeReason ?? null,
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictError('Review revision already exists');
      }
      throw error;
    }
  }

  static async listRevisions(reviewId: string, tx?: ReviewDb): Promise<RevisionRow[]> {
    return (tx ?? db()).listRevisions(reviewId);
  }
}
