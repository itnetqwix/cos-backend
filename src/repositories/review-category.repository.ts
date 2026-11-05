import { prisma } from '../config/database.js';
import {
  Prisma,
  type ReviewCategory,
  type ReviewCategoryProposal,
  CategoryProposalStatus,
} from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/response.js';

export interface CreateCategoryData {
  name: string;
  slug: string;
  description?: string | null;
  defaultWeight?: number;
  sortOrder?: number;
  isActive?: boolean;
}

export interface UpdateCategoryData {
  name?: string;
  slug?: string;
  description?: string | null;
  defaultWeight?: number;
  sortOrder?: number;
  isActive?: boolean;
  mergedIntoId?: string | null;
}

export interface CreateProposalData {
  name: string;
  description: string;
  proposerId: string;
}

export class ReviewCategoryRepository {
  static async listActive(): Promise<ReviewCategory[]> {
    return prisma.reviewCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  static async findById(id: string) {
    return prisma.reviewCategory.findUnique({
      where: { id },
      include: {
        mergedInto: { select: { id: true, name: true, slug: true } },
        _count: { select: { scores: true } },
      },
    });
  }

  static async findBySlug(slug: string): Promise<ReviewCategory | null> {
    return prisma.reviewCategory.findUnique({
      where: { slug },
    });
  }

  static async findByName(name: string): Promise<ReviewCategory | null> {
    return prisma.reviewCategory.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    });
  }

  static async listAdmin(options?: { includeInactive?: boolean; search?: string }) {
    const where: Prisma.ReviewCategoryWhereInput = {};
    if (!options?.includeInactive) {
      where.isActive = true;
    }
    if (options?.search?.trim()) {
      const q = options.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }

    return prisma.reviewCategory.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        mergedInto: { select: { id: true, name: true, slug: true } },
        _count: { select: { scores: true } },
      },
    });
  }

  static async create(data: CreateCategoryData): Promise<ReviewCategory> {
    return prisma.reviewCategory.create({
      data: {
        name: data.name.trim(),
        slug: data.slug.trim(),
        description: data.description?.trim() ?? null,
        defaultWeight: data.defaultWeight ?? 1.0,
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
      },
    });
  }

  static async update(id: string, data: UpdateCategoryData): Promise<ReviewCategory> {
    return prisma.reviewCategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.slug !== undefined ? { slug: data.slug.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description?.trim() ?? null }
          : {}),
        ...(data.defaultWeight !== undefined
          ? { defaultWeight: data.defaultWeight }
          : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.mergedIntoId !== undefined ? { mergedIntoId: data.mergedIntoId } : {}),
      },
    });
  }

  static async deactivate(id: string): Promise<ReviewCategory> {
    return prisma.reviewCategory.update({
      where: { id },
      data: { isActive: false },
    });
  }

  static async merge(sourceCategoryId: string, targetCategoryId: string) {
    if (sourceCategoryId === targetCategoryId) {
      throw new ValidationError('Source and target categories cannot be the same');
    }

    return prisma.$transaction(async (tx) => {
      const source = await tx.reviewCategory.findUnique({
        where: { id: sourceCategoryId },
        include: { _count: { select: { scores: true } } },
      });
      if (!source) throw new NotFoundError('Source category not found');

      const target = await tx.reviewCategory.findUnique({
        where: { id: targetCategoryId },
      });
      if (!target) throw new NotFoundError('Target category not found');
      if (!target.isActive) throw new ValidationError('Target category must be active');

      // Fetch all scores for the source category
      const sourceScores = await tx.reviewCategoryScore.findMany({
        where: { categoryId: sourceCategoryId },
      });

      let updatedCount = 0;
      for (const score of sourceScores) {
        const existingTargetScore = await tx.reviewCategoryScore.findUnique({
          where: {
            reviewId_categoryId: {
              reviewId: score.reviewId,
              categoryId: targetCategoryId,
            },
          },
        });

        if (existingTargetScore) {
          // Review already has score for target; delete duplicate source score
          await tx.reviewCategoryScore.delete({ where: { id: score.id } });
        } else {
          // Re-point score to target
          await tx.reviewCategoryScore.update({
            where: { id: score.id },
            data: { categoryId: targetCategoryId },
          });
          updatedCount++;
        }
      }

      // Mark source category inactive and record merge lineage
      const updatedSource = await tx.reviewCategory.update({
        where: { id: sourceCategoryId },
        data: {
          isActive: false,
          mergedIntoId: targetCategoryId,
        },
      });

      return {
        source: updatedSource,
        target,
        repointedScoresCount: updatedCount,
        totalSourceScores: sourceScores.length,
      };
    });
  }

  // --- Proposal Methods ---

  static async createProposal(data: CreateProposalData): Promise<ReviewCategoryProposal> {
    return prisma.reviewCategoryProposal.create({
      data: {
        name: data.name.trim(),
        description: data.description.trim(),
        proposerId: data.proposerId,
        status: CategoryProposalStatus.PENDING,
      },
      include: {
        proposer: { select: { id: true, name: true, email: true } },
      },
    });
  }

  static async listProposalsByProposer(proposerId: string) {
    return prisma.reviewCategoryProposal.findMany({
      where: { proposerId },
      orderBy: { createdAt: 'desc' },
      include: {
        approvedCategory: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  static async listAdminProposals(status?: CategoryProposalStatus) {
    return prisma.reviewCategoryProposal.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        proposer: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
        approvedCategory: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  static async findProposalById(id: string) {
    return prisma.reviewCategoryProposal.findUnique({
      where: { id },
      include: {
        proposer: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
        approvedCategory: true,
      },
    });
  }

  static async findPendingProposalByName(
    name: string,
  ): Promise<ReviewCategoryProposal | null> {
    return prisma.reviewCategoryProposal.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        status: CategoryProposalStatus.PENDING,
      },
    });
  }

  static async approveProposal(
    proposalId: string,
    adminId: string,
    options: {
      slug: string;
      defaultWeight?: number;
      sortOrder?: number;
      reviewReason?: string;
    },
  ) {
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.reviewCategoryProposal.findUnique({
        where: { id: proposalId },
      });
      if (!proposal) throw new NotFoundError('Category proposal not found');
      if (proposal.status !== CategoryProposalStatus.PENDING) {
        throw new ValidationError(`Proposal is already ${proposal.status.toLowerCase()}`);
      }

      // Determine next sort order if not specified
      let sortOrder = options.sortOrder;
      if (sortOrder === undefined) {
        const lastCat = await tx.reviewCategory.findFirst({
          orderBy: { sortOrder: 'desc' },
        });
        sortOrder = (lastCat?.sortOrder ?? 0) + 1;
      }

      // Create new active category
      const newCategory = await tx.reviewCategory.create({
        data: {
          name: proposal.name,
          slug: options.slug,
          description: proposal.description,
          defaultWeight: options.defaultWeight ?? 1.0,
          sortOrder,
          isActive: true,
        },
      });

      // Update proposal status
      const updatedProposal = await tx.reviewCategoryProposal.update({
        where: { id: proposalId },
        data: {
          status: CategoryProposalStatus.APPROVED,
          reviewedById: adminId,
          reviewedAt: new Date(),
          approvedCategoryId: newCategory.id,
          reviewReason: options.reviewReason?.trim() ?? 'Approved by administrator',
        },
        include: {
          proposer: { select: { id: true, name: true, email: true } },
          reviewedBy: { select: { id: true, name: true } },
          approvedCategory: true,
        },
      });

      return { proposal: updatedProposal, category: newCategory };
    });
  }

  static async rejectProposal(
    proposalId: string,
    adminId: string,
    rejectionReason: string,
  ) {
    const proposal = await prisma.reviewCategoryProposal.findUnique({
      where: { id: proposalId },
    });
    if (!proposal) throw new NotFoundError('Category proposal not found');
    if (proposal.status !== CategoryProposalStatus.PENDING) {
      throw new ValidationError(`Proposal is already ${proposal.status.toLowerCase()}`);
    }

    return prisma.reviewCategoryProposal.update({
      where: { id: proposalId },
      data: {
        status: CategoryProposalStatus.REJECTED,
        reviewedById: adminId,
        reviewedAt: new Date(),
        reviewReason: rejectionReason.trim(),
      },
      include: {
        proposer: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }
}
