import { randomUUID } from 'node:crypto';
import { ReviewStatus } from '@prisma/client';
import {
  matchesPublicQuery,
  type ActiveReviewCategory,
  type CreateDraftInput,
  type ProductSnapshot,
  type PublicReviewQuery,
  type QueuedReview,
  type ReviewCurrent,
  type ReviewDb,
  type ReviewPage,
  type ReviewRow,
  type ReviewScoreRow,
  type ReviewWrite,
  type PublishedReviewRecord,
  type RevisionRow,
} from '../../src/repositories/product-review.repository.js';

interface State {
  products: ProductSnapshot[];
  categories: ActiveReviewCategory[];
  reviews: ReviewRow[];
  revisions: RevisionRow[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function copyReview(review: ReviewRow): ReviewRow {
  return clone(review);
}

export class MemoryReviewDb implements ReviewDb {
  private state: State = { products: [], categories: [], reviews: [], revisions: [] };
  private chain: Promise<void> = Promise.resolve();

  addProduct(product: ProductSnapshot): void {
    this.state.products.push(clone(product));
  }

  addCategory(category: ActiveReviewCategory): void {
    this.state.categories.push(clone(category));
  }

  private assemble(review: ReviewRow): ReviewRow {
    const product = this.state.products.find((item) => item.productId === review.productId);
    const published =
      this.state.revisions.find((revision) => revision.id === review.publishedRevisionId) ?? null;
    return copyReview({
      ...review,
      product: product ?? review.product,
      publishedRevision: published ? clone(published) : null,
    });
  }

  private bump(review: ReviewRow, data: ReviewWrite): void {
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        (review as unknown as Record<string, unknown>)[key] = value;
      }
    }
    review.updatedAt = new Date();
  }

  async createReview(data: CreateDraftInput & { country: string }): Promise<ReviewRow> {
    if (this.state.reviews.some((review) => review.videoObjectKey === data.videoObjectKey)) {
      const error = new Error('unique');
      (error as Error & { code: string }).code = 'P2002';
      throw error;
    }
    const product = this.state.products.find((item) => item.productId === data.productId);
    if (!product) throw new Error('product missing');
    const now = new Date();
    const review: ReviewRow = {
      id: randomUUID(),
      productId: data.productId,
      testerId: data.testerId,
      status: ReviewStatus.DRAFT,
      dispensaryName: data.dispensaryName ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      country: data.country,
      videoUrl: data.videoUrl,
      videoObjectKey: data.videoObjectKey,
      thumbnailUrl: data.thumbnailUrl ?? null,
      durationSeconds: data.durationSeconds,
      overallScore: 0,
      weightsSnapshot: [],
      reviewNotes: data.reviewNotes ?? null,
      changeRequestNotes: null,
      rejectionReason: null,
      approvedById: null,
      approvedAt: null,
      publishedAt: null,
      publishedRevisionId: null,
      deletedAt: null,
      deletedById: null,
      createdAt: now,
      updatedAt: now,
      categoryScores: [],
      product,
      publishedRevision: null,
    };
    this.state.reviews.push(review);
    return this.assemble(review);
  }

  async findReview(id: string): Promise<ReviewRow | null> {
    const review = this.state.reviews.find((item) => item.id === id);
    return review ? this.assemble(review) : null;
  }

  async listByTester(testerId: string): Promise<ReviewRow[]> {
    return this.state.reviews
      .filter((review) => review.testerId === testerId && review.deletedAt === null)
      .map((review) => this.assemble(review));
  }

  async listMinePage(testerId: string, skip: number, take: number): Promise<ReviewPage<ReviewRow>> {
    const rows = this.state.reviews
      .filter((review) => review.testerId === testerId && review.deletedAt === null)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? -1 : 1))
      .map((review) => this.assemble(review));
    return { total: rows.length, rows: rows.slice(skip, skip + take) };
  }

  async listPublicPage(query: PublicReviewQuery): Promise<ReviewPage<PublishedReviewRecord>> {
    const matched = this.state.reviews
      .map((review) => this.assemble(review))
      .filter((review) => matchesPublicQuery(review, query));
    matched.sort((a, b) => {
      if (query.sort === 'publishedAt') {
        const at = b.publishedAt?.getTime() ?? 0;
        const bt = a.publishedAt?.getTime() ?? 0;
        if (at !== bt) return at - bt;
      } else if (b.overallScore !== a.overallScore) {
        return b.overallScore - a.overallScore;
      } else {
        const at = b.publishedAt?.getTime() ?? 0;
        const bt = a.publishedAt?.getTime() ?? 0;
        if (at !== bt) return at - bt;
      }
      return a.id < b.id ? -1 : 1;
    });
    const page = matched.slice(query.skip, query.skip + query.take);
    return {
      total: matched.length,
      rows: page.flatMap((review) => {
        const revision = review.publishedRevision;
        if (!revision || revision.id !== review.publishedRevisionId) return [];
        return [
          {
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
          },
        ];
      }),
    };
  }

  async listQueuePage(query: PublicReviewQuery): Promise<ReviewPage<QueuedReview>> {
    const rows = this.state.reviews
      .filter((review) => review.deletedAt === null && review.status === 'SUBMITTED')
      .filter((review) => !query.productId || review.productId === query.productId)
      .filter((review) => !query.testerId || review.testerId === query.testerId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      .map((review) => this.assemble(review));
    return {
      total: rows.length,
      rows: rows.slice(query.skip, query.skip + query.take).map((review) => ({
        ...review,
        tester: { id: review.testerId, name: review.testerId },
      })),
    };
  }

  async listReviews(): Promise<ReviewRow[]> {
    return this.state.reviews.map((review) => this.assemble(review));
  }

  async updateReview(id: string, data: ReviewWrite): Promise<ReviewRow> {
    const review = this.state.reviews.find((item) => item.id === id);
    if (!review) throw new Error('missing review');
    this.bump(review, data);
    return this.assemble(review);
  }

  async updateIfCurrent(id: string, expected: ReviewCurrent, data: ReviewWrite): Promise<number> {
    const review = this.state.reviews.find((item) => item.id === id);
    if (!review || review.deletedAt || review.status !== expected.status) return 0;
    if (review.updatedAt.getTime() !== expected.updatedAt.getTime()) return 0;
    this.bump(review, data);
    return 1;
  }

  async replaceScores(reviewId, scores): Promise<void> {
    const review = this.state.reviews.find((item) => item.id === reviewId);
    if (!review) throw new Error('missing review');
    review.categoryScores = scores.map((score) => {
      const category = this.state.categories.find((item) => item.id === score.categoryId);
      return {
        id: randomUUID(),
        categoryId: score.categoryId,
        categoryName: category?.name ?? score.categoryId,
        categorySlug: category?.slug ?? score.categoryId,
        score: score.score,
        weightApplied: score.weightApplied,
      } satisfies ReviewScoreRow;
    });
  }

  async listActiveCategories(): Promise<ActiveReviewCategory[]> {
    return this.state.categories.filter((category) => category.isActive).map((category) => clone(category));
  }

  async findProduct(id: string): Promise<ProductSnapshot | null> {
    const product = this.state.products.find((item) => item.productId === id);
    return product ? clone(product) : null;
  }

  async maxRevisionVersion(reviewId: string): Promise<number> {
    return this.state.revisions
      .filter((revision) => revision.reviewId === reviewId)
      .reduce((max, revision) => Math.max(max, revision.version), 0);
  }

  async insertRevision(data): Promise<RevisionRow> {
    if (this.state.revisions.some((revision) => revision.reviewId === data.reviewId && revision.version === data.version)) {
      const error = new Error('unique');
      (error as Error & { code: string }).code = 'P2002';
      throw error;
    }
    const row: RevisionRow = { ...clone(data), id: data.id ?? randomUUID(), createdAt: new Date() };
    this.state.revisions.push(row);
    return clone(row);
  }

  async listRevisions(reviewId: string): Promise<RevisionRow[]> {
    return this.state.revisions
      .filter((revision) => revision.reviewId === reviewId)
      .sort((a, b) => a.version - b.version)
      .map((revision) => clone(revision));
  }

  async $transaction<T>(fn: (tx: ReviewDb) => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const snapshot = clone(this.state);
      try {
        return await fn(this);
      } catch (error) {
        this.state = snapshot;
        throw error;
      }
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
